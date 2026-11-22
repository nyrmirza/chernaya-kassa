-- Push-уведомления через Expo Push (как в Тайном Санте).
--  1) Организатору: «Все в сборе — можно проводить жеребьёвку».
--  2) Всем участникам: результат жеребьёвки — свой месяц и кто забирает кассу первым.
-- Отправка — из базы через pg_net (асинхронно, не тормозит саму операцию).

create extension if not exists pg_net with schema extensions;

create table if not exists public.push_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  lang text not null default 'ru',
  updated_at timestamptz not null default now()
);
create index if not exists push_tokens_user on public.push_tokens(user_id);
alter table public.push_tokens enable row level security;

alter table public.kassas add column if not exists ready_notified_at timestamptz;

-- Регистрация токена устройства (токен переходит к текущему пользователю).
create or replace function public.register_push(p_token text, p_lang text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_token is null or p_token !~ '^(Exponent|Expo)PushToken\[.+\]$' then raise exception 'BAD_TOKEN'; end if;
  insert into public.push_tokens (token, user_id, lang, updated_at)
  values (p_token, public._uid(), case when p_lang in ('kk','ru','en') then p_lang else 'ru' end, now())
  on conflict (token) do update set user_id = excluded.user_id, lang = excluded.lang, updated_at = now();
end $$;

create or replace function public.unregister_push(p_token text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
$$;

-- Название месяца на языке пользователя: «Қараша 2026», «Ноябрь 2026», «November 2026».
create or replace function public._month_label(d date, lang text) returns text
language sql immutable as $$
  select (case lang
    when 'kk' then (array['Қаңтар','Ақпан','Наурыз','Сәуір','Мамыр','Маусым','Шілде','Тамыз','Қыркүйек','Қазан','Қараша','Желтоқсан'])
    when 'en' then (array['January','February','March','April','May','June','July','August','September','October','November','December'])
    else (array['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'])
  end)[extract(month from d)::int] || ' ' || extract(year from d)::int;
$$;

-- Отправить пачку сообщений в Expo Push.
create or replace function public._push_send(p_messages jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_messages is null or jsonb_array_length(p_messages) = 0 then return; end if;
  perform net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    body := p_messages,
    headers := '{"Content-Type":"application/json","Accept":"application/json"}'::jsonb
  );
exception when others then
  -- Push не критичен: ошибка отправки не должна ломать вход или жеребьёвку.
  raise warning 'push failed: %', sqlerrm;
end $$;

-- 1) Все места заняты → организатору.
create or replace function public._check_ready(p_kassa uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k public.kassas; v_n int; v_msgs jsonb;
begin
  select * into k from public.kassas where id = p_kassa;
  if k.id is null or k.is_demo or k.status <> 'open' or k.target_size is null then return; end if;
  v_n := public._active_seats(p_kassa);
  if v_n < k.target_size then
    if k.ready_notified_at is not null then update public.kassas set ready_notified_at = null where id = p_kassa; end if;
    return;
  end if;
  if k.ready_notified_at is not null then return; end if;
  update public.kassas set ready_notified_at = now() where id = p_kassa;

  select jsonb_agg(jsonb_build_object(
    'to', t.token, 'sound', 'default', 'channelId', 'kassa', 'title', k.title,
    'body', case t.lang
      when 'kk' then format('Барлығы жиналды: %s/%s. Жеребе тартуға болады.', v_n, k.target_size)
      when 'en' then format('Everyone''s in: %s of %s. You can run the draw.', v_n, k.target_size)
      else format('Все в сборе: %s из %s. Можно проводить жеребьёвку.', v_n, k.target_size) end,
    'data', jsonb_build_object('kind', 'ready', 'kassa', k.id)))
  into v_msgs
  from public.push_tokens t where t.user_id = k.owner_id;
  perform public._push_send(v_msgs);
end $$;

create or replace function public._trg_seats_ready() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._check_ready(coalesce(new.kassa_id, old.kassa_id));
  return null;
end $$;

drop trigger if exists seats_ready on public.seats;
create trigger seats_ready after insert or update of removed_at on public.seats
for each row execute function public._trg_seats_ready();

-- 2) Жеребьёвка прошла → всем участникам (каждому — его месяц).
create or replace function public._trg_kassa_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_msgs jsonb; v_first text; v_first_month date;
begin
  -- Изменили число мест — проверить «все в сборе».
  if new.status = 'open' and new.target_size is distinct from old.target_size then
    perform public._check_ready(new.id);
  end if;
  if new.status = 'open' and old.status <> 'open' then
    update public.kassas set ready_notified_at = null where id = new.id;
    perform public._check_ready(new.id);
  end if;

  if not (old.status = 'open' and new.status = 'drawn') or new.is_demo then return null; end if;

  select s.name, m.month into v_first, v_first_month
  from public.meetings m join public.seats s on s.id = m.holder_seat_id
  where m.kassa_id = new.id and m.round = new.round order by m.idx limit 1;

  select jsonb_agg(jsonb_build_object(
    'to', t.token, 'sound', 'default', 'channelId', 'kassa', 'title', new.title,
    'body', case t.lang
      when 'kk' then format('Жеребе тартылды! Сіздің айыңыз — %s. Кассаны бірінші %s алады (%s).',
                            public._month_label(mm.month, 'kk'), v_first, public._month_label(v_first_month, 'kk'))
      when 'en' then format('The draw is done! Your month: %s. %s takes the kassa first (%s).',
                            public._month_label(mm.month, 'en'), v_first, public._month_label(v_first_month, 'en'))
      else format('Жеребьёвка прошла! Ваш месяц — %s. Первым кассу забирает %s (%s).',
                  public._month_label(mm.month, 'ru'), v_first, public._month_label(v_first_month, 'ru')) end,
    'data', jsonb_build_object('kind', 'draw', 'kassa', new.id)))
  into v_msgs
  from public.members mb
  join public.push_tokens t on t.user_id = mb.user_id
  join public.meetings mm on mm.kassa_id = new.id and mm.round = new.round and mm.holder_seat_id = mb.seat_id
  where mb.kassa_id = new.id;

  perform public._push_send(v_msgs);
  return null;
end $$;

drop trigger if exists kassa_status_push on public.kassas;
create trigger kassa_status_push after update of status, target_size on public.kassas
for each row execute function public._trg_kassa_status();

revoke execute on function public._month_label(date, text), public._push_send(jsonb), public._check_ready(uuid),
  public._trg_seats_ready(), public._trg_kassa_status() from public, anon, authenticated;
revoke execute on function public.register_push(text, text), public.unregister_push(text) from public, anon;
grant execute on function public.register_push(text, text), public.unregister_push(text) to authenticated;
