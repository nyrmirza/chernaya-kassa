-- Черная касса: касса по очереди. Анонимный вход (как в Тайном Санте), вход по 6-значному коду.
-- Все записи идут через SECURITY DEFINER функции; клиент читает состояние через get_kassa().
-- Тихий долг (оплата «Kaspi позже») видят только хозяин кассы этого месяца и сам должник.

create extension if not exists pgcrypto;

-- ---------- Таблицы ----------
create table public.kassas (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  title        text not null check (char_length(title) between 1 and 60),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  share_pair   integer not null check (share_pair between 1 and 100000000),
  share_single integer not null check (share_single between 1 and 100000000),
  start_month  date not null check (extract(day from start_month) = 1),
  round        integer not null default 1,
  status       text not null default 'open' check (status in ('open','drawn','finished')),
  created_at   timestamptz not null default now(),
  drawn_at     timestamptz
);

create table public.seats (
  id         uuid primary key default gen_random_uuid(),
  kassa_id   uuid not null references public.kassas(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  kind       text not null check (kind in ('pair','single')),
  position   integer,
  created_at timestamptz not null default now(),
  unique (kassa_id, position)
);
create unique index seats_name_uniq on public.seats (kassa_id, lower(name));

create table public.members (
  kassa_id  uuid not null references public.kassas(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  seat_id   uuid not null references public.seats(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (kassa_id, user_id)
);
create index members_user_idx on public.members (user_id);
create index members_seat_idx on public.members (seat_id);

create table public.meetings (
  id             uuid primary key default gen_random_uuid(),
  kassa_id       uuid not null references public.kassas(id) on delete cascade,
  round          integer not null,
  idx            integer not null,
  holder_seat_id uuid references public.seats(id) on delete set null,
  month          date not null,
  meet_date      date,
  meet_time      time,
  place          text not null default '' check (char_length(place) <= 120),
  bill           integer not null default 0 check (bill >= 0),
  closed_at      timestamptz,
  unique (kassa_id, round, idx)
);
create index meetings_holder_idx on public.meetings (holder_seat_id);

create table public.payments (
  meeting_id        uuid not null references public.meetings(id) on delete cascade,
  seat_id           uuid not null references public.seats(id) on delete cascade,
  method            text not null check (method in ('cash','kaspi')),
  amount            integer not null check (amount > 0),
  kaspi_received_at timestamptz,
  marked_at         timestamptz not null default now(),
  primary key (meeting_id, seat_id)
);
create index payments_seat_idx on public.payments (seat_id);

-- ---------- RLS: прямого доступа к таблицам нет, только через функции ----------
alter table public.kassas   enable row level security;
alter table public.seats    enable row level security;
alter table public.members  enable row level security;
alter table public.meetings enable row level security;
alter table public.payments enable row level security;
revoke all on public.kassas, public.seats, public.members, public.meetings, public.payments from anon, authenticated;

-- ---------- Вспомогательные ----------
create or replace function public._clean(p text) returns text
language sql immutable set search_path = public as $$
  select regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g');
$$;

create or replace function public._gen_code() returns text
language plpgsql volatile set search_path = public as $$
declare v text; a constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; r bytea; i int;
begin
  loop
    v := ''; r := uuid_send(gen_random_uuid());
    for i in 0..5 loop v := v || substr(a, 1 + (get_byte(r, i) % 32), 1); end loop;
    exit when not exists (select 1 from public.kassas where code = v);
  end loop;
  return v;
end $$;

create or replace function public._uid() returns uuid
language plpgsql stable set search_path = public as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'NOT_SIGNED_IN'; end if;
  return v;
end $$;

create or replace function public._my_seat(p_kassa uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select seat_id from public.members where kassa_id = p_kassa and user_id = auth.uid();
$$;

create or replace function public._is_owner(p_kassa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.kassas where id = p_kassa and owner_id = auth.uid());
$$;

-- Кто ведёт сбор за встречу: хозяин кассы этого месяца; если у его места нет приложения — организатор.
create or replace function public._can_manage(p_meeting uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.meetings m
    where m.id = p_meeting and (
      exists (select 1 from public.members x where x.seat_id = m.holder_seat_id and x.user_id = auth.uid())
      or (
        not exists (select 1 from public.members x where x.seat_id = m.holder_seat_id)
        and exists (select 1 from public.kassas k where k.id = m.kassa_id and k.owner_id = auth.uid())
      )
    )
  );
$$;

create or replace function public._owned_kassa(p_kassa uuid) returns public.kassas
language plpgsql security definer set search_path = public as $$
declare k public.kassas;
begin
  select * into k from public.kassas where id = p_kassa for update;
  if not found or k.owner_id <> public._uid() then raise exception 'NOT_OWNER'; end if;
  return k;
end $$;

create or replace function public._share(p_kassa uuid, p_seat uuid) returns integer
language sql stable security definer set search_path = public as $$
  select case s.kind when 'pair' then k.share_pair else k.share_single end
  from public.seats s join public.kassas k on k.id = s.kassa_id
  where s.id = p_seat and k.id = p_kassa;
$$;

-- ---------- Создание и вход ----------
create or replace function public.create_kassa(
  p_title text, p_seat_name text, p_kind text,
  p_share_pair integer, p_share_single integer, p_start date default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_id uuid; v_seat uuid;
begin
  if char_length(public._clean(p_title)) = 0 then raise exception 'TITLE_REQUIRED'; end if;
  if char_length(public._clean(p_seat_name)) = 0 then raise exception 'NAME_REQUIRED'; end if;
  if p_kind not in ('pair','single') then raise exception 'BAD_KIND'; end if;
  if coalesce(p_share_pair,0) <= 0 or coalesce(p_share_single,0) <= 0 then raise exception 'BAD_SHARE'; end if;
  if (select count(*) from public.kassas where owner_id = v_uid) >= 20 then raise exception 'TOO_MANY_KASSAS'; end if;

  insert into public.kassas (code, title, owner_id, share_pair, share_single, start_month)
  values (public._gen_code(), left(public._clean(p_title), 60), v_uid, p_share_pair, p_share_single,
          date_trunc('month', coalesce(p_start, (now() + interval '1 month')::date))::date)
  returning id into v_id;
  insert into public.seats (kassa_id, name, kind) values (v_id, left(public._clean(p_seat_name), 60), p_kind)
  returning id into v_seat;
  insert into public.members (kassa_id, user_id, seat_id) values (v_id, v_uid, v_seat);
  return v_id;
end $$;

-- Экран входа по коду: название кассы и места (чтобы второй из пары присоединился к своему месту).
create or replace function public.kassa_preview(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare k public.kassas; v_uid uuid := public._uid();
begin
  select * into k from public.kassas where code = upper(trim(p_code));
  if not found then raise exception 'KASSA_NOT_FOUND'; end if;
  return jsonb_build_object(
    'id', k.id, 'title', k.title, 'status', k.status,
    'share_pair', k.share_pair, 'share_single', k.share_single,
    'already_member', exists (select 1 from public.members where kassa_id = k.id and user_id = v_uid),
    'seats', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'kind', s.kind,
        'members', (select count(*) from public.members x where x.seat_id = s.id)) order by s.created_at)
      from public.seats s where s.kassa_id = k.id), '[]'::jsonb)
  );
end $$;

create or replace function public.join_kassa(p_code text, p_name text default null, p_kind text default null, p_seat uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); k public.kassas; s public.seats; v_n int; v_name text := public._clean(p_name);
begin
  select * into k from public.kassas where code = upper(trim(p_code)) for update;
  if not found then raise exception 'KASSA_NOT_FOUND'; end if;
  if exists (select 1 from public.members where kassa_id = k.id and user_id = v_uid) then return k.id; end if;

  if p_seat is not null then
    -- Присоединиться к существующему месту: второй из пары или место, добавленное организатором вручную.
    select * into s from public.seats where id = p_seat and kassa_id = k.id;
    if not found then raise exception 'SEAT_NOT_FOUND'; end if;
    select count(*) into v_n from public.members where seat_id = s.id;
    if v_n > 0 and (s.kind = 'single' or v_n >= 2) then raise exception 'SEAT_TAKEN'; end if;
    insert into public.members (kassa_id, user_id, seat_id) values (k.id, v_uid, s.id);
    return k.id;
  end if;

  if k.status <> 'open' then raise exception 'ALREADY_DRAWN'; end if;
  if char_length(v_name) = 0 then raise exception 'NAME_REQUIRED'; end if;
  if p_kind not in ('pair','single') then raise exception 'BAD_KIND'; end if;
  if exists (select 1 from public.seats where kassa_id = k.id and lower(name) = lower(v_name)) then raise exception 'NAME_TAKEN'; end if;
  if (select count(*) from public.seats where kassa_id = k.id) >= 50 then raise exception 'KASSA_FULL'; end if;
  insert into public.seats (kassa_id, name, kind) values (k.id, left(v_name, 60), p_kind) returning * into s;
  insert into public.members (kassa_id, user_id, seat_id) values (k.id, v_uid, s.id);
  return k.id;
end $$;

create or replace function public.leave_kassa(p_kassa uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); k public.kassas; v_seat uuid;
begin
  select * into k from public.kassas where id = p_kassa for update;
  if not found then return; end if;
  if k.owner_id = v_uid then
    if exists (select 1 from public.members where kassa_id = p_kassa and user_id <> v_uid) then
      raise exception 'OWNER_CANNOT_LEAVE';
    end if;
    delete from public.kassas where id = p_kassa;
    return;
  end if;
  select seat_id into v_seat from public.members where kassa_id = p_kassa and user_id = v_uid;
  delete from public.members where kassa_id = p_kassa and user_id = v_uid;
  -- До жеребьёвки пустое место убираем; после — место остаётся в очереди.
  if k.status = 'open' and not exists (select 1 from public.members where seat_id = v_seat) then
    delete from public.seats where id = v_seat;
  end if;
end $$;

-- ---------- Организатор ----------
create or replace function public.update_kassa(p_kassa uuid, p_title text, p_share_pair integer, p_share_single integer, p_start date)
returns void
language plpgsql security definer set search_path = public as $$
declare k public.kassas := public._owned_kassa(p_kassa);
begin
  if char_length(public._clean(p_title)) = 0 then raise exception 'TITLE_REQUIRED'; end if;
  if coalesce(p_share_pair,0) <= 0 or coalesce(p_share_single,0) <= 0 then raise exception 'BAD_SHARE'; end if;
  update public.kassas set
    title = left(public._clean(p_title), 60),
    share_pair = p_share_pair, share_single = p_share_single,
    start_month = case when k.status = 'open' and p_start is not null then date_trunc('month', p_start)::date else start_month end
  where id = p_kassa;
end $$;

create or replace function public.add_seat(p_kassa uuid, p_name text, p_kind text) returns uuid
language plpgsql security definer set search_path = public as $$
declare k public.kassas := public._owned_kassa(p_kassa); v_name text := public._clean(p_name); v_id uuid;
begin
  if k.status <> 'open' then raise exception 'ALREADY_DRAWN'; end if;
  if char_length(v_name) = 0 then raise exception 'NAME_REQUIRED'; end if;
  if p_kind not in ('pair','single') then raise exception 'BAD_KIND'; end if;
  if exists (select 1 from public.seats where kassa_id = p_kassa and lower(name) = lower(v_name)) then raise exception 'NAME_TAKEN'; end if;
  if (select count(*) from public.seats where kassa_id = p_kassa) >= 50 then raise exception 'KASSA_FULL'; end if;
  insert into public.seats (kassa_id, name, kind) values (p_kassa, left(v_name, 60), p_kind) returning id into v_id;
  return v_id;
end $$;

create or replace function public.remove_seat(p_kassa uuid, p_seat uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k public.kassas := public._owned_kassa(p_kassa);
begin
  if k.status <> 'open' then raise exception 'ALREADY_DRAWN'; end if;
  if exists (select 1 from public.members where seat_id = p_seat and user_id = k.owner_id) then raise exception 'CANNOT_REMOVE_OWNER'; end if;
  delete from public.seats where id = p_seat and kassa_id = p_kassa;
end $$;

create or replace function public.draw_kassa(p_kassa uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k public.kassas := public._owned_kassa(p_kassa); v_n int;
begin
  if k.status <> 'open' then raise exception 'ALREADY_DRAWN'; end if;
  select count(*) into v_n from public.seats where kassa_id = p_kassa;
  if v_n < 2 then raise exception 'NEED_2_SEATS'; end if;

  update public.seats set position = null where kassa_id = p_kassa;
  update public.seats s set position = r.pos
  from (select id, (row_number() over (order by gen_random_uuid()) - 1)::int as pos
        from public.seats where kassa_id = p_kassa) r
  where s.id = r.id;

  insert into public.meetings (kassa_id, round, idx, holder_seat_id, month)
  select p_kassa, k.round, s.position, s.id, (k.start_month + make_interval(months => s.position))::date
  from public.seats s where s.kassa_id = p_kassa;

  update public.kassas set status = 'drawn', drawn_at = now() where id = p_kassa;
end $$;

-- Перетянуть жребий можно, пока ни одна встреча круга не закрыта.
create or replace function public.reset_draw(p_kassa uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k public.kassas := public._owned_kassa(p_kassa);
begin
  if k.status <> 'drawn' then raise exception 'NOT_DRAWN'; end if;
  if exists (select 1 from public.meetings where kassa_id = p_kassa and round = k.round and closed_at is not null) then
    raise exception 'ROUND_STARTED';
  end if;
  delete from public.meetings where kassa_id = p_kassa and round = k.round;
  update public.seats set position = null where kassa_id = p_kassa;
  update public.kassas set status = 'open', drawn_at = null where id = p_kassa;
end $$;

create or replace function public.new_round(p_kassa uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k public.kassas := public._owned_kassa(p_kassa); v_n int;
begin
  if k.status <> 'finished' then raise exception 'ROUND_NOT_FINISHED'; end if;
  select count(*) into v_n from public.meetings where kassa_id = p_kassa and round = k.round;
  update public.seats set position = null where kassa_id = p_kassa;
  update public.kassas set status = 'open', round = round + 1, drawn_at = null,
    start_month = (start_month + make_interval(months => v_n))::date
  where id = p_kassa;
end $$;

-- ---------- Встреча и сбор ----------
create or replace function public.update_meeting(p_meeting uuid, p_date date, p_time time, p_place text, p_bill integer)
returns void
language plpgsql security definer set search_path = public as $$
declare m public.meetings;
begin
  perform public._uid();
  select * into m from public.meetings where id = p_meeting;
  if not found then raise exception 'MEETING_NOT_FOUND'; end if;
  if not (public._can_manage(p_meeting) or public._is_owner(m.kassa_id)) then raise exception 'NOT_ALLOWED'; end if;
  update public.meetings set meet_date = p_date, meet_time = p_time,
    place = left(public._clean(p_place), 120), bill = greatest(coalesce(p_bill, 0), 0)
  where id = p_meeting;
end $$;

-- p_method: 'cash' | 'kaspi' | null (снять отметку)
create or replace function public.mark_payment(p_meeting uuid, p_seat uuid, p_method text) returns void
language plpgsql security definer set search_path = public as $$
declare m public.meetings; s public.seats;
begin
  perform public._uid();
  select * into m from public.meetings where id = p_meeting for update;
  if not found then raise exception 'MEETING_NOT_FOUND'; end if;
  if not public._can_manage(p_meeting) then raise exception 'NOT_HOLDER'; end if;
  if m.closed_at is not null then raise exception 'MEETING_CLOSED'; end if;
  select * into s from public.seats where id = p_seat and kassa_id = m.kassa_id;
  if not found or s.position is null then raise exception 'SEAT_NOT_FOUND'; end if;
  if s.id = m.holder_seat_id then raise exception 'HOLDER_SELF'; end if;

  if p_method is null then
    delete from public.payments where meeting_id = p_meeting and seat_id = p_seat;
  elsif p_method in ('cash','kaspi') then
    insert into public.payments (meeting_id, seat_id, method, amount)
    values (p_meeting, p_seat, p_method, public._share(m.kassa_id, p_seat))
    on conflict (meeting_id, seat_id) do update
      set method = excluded.method, amount = excluded.amount, marked_at = now(),
          kaspi_received_at = case when excluded.method = 'kaspi' then payments.kaspi_received_at else null end;
  else
    raise exception 'BAD_METHOD';
  end if;
end $$;

create or replace function public.confirm_kaspi(p_meeting uuid, p_seat uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._uid();
  if not public._can_manage(p_meeting) then raise exception 'NOT_HOLDER'; end if;
  update public.payments set kaspi_received_at = now()
  where meeting_id = p_meeting and seat_id = p_seat and method = 'kaspi' and kaspi_received_at is null;
end $$;

create or replace function public.close_meeting(p_meeting uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.meetings; k public.kassas;
begin
  perform public._uid();
  select * into m from public.meetings where id = p_meeting for update;
  if not found then raise exception 'MEETING_NOT_FOUND'; end if;
  if not public._can_manage(p_meeting) then raise exception 'NOT_HOLDER'; end if;
  if m.closed_at is not null then return; end if;
  select * into k from public.kassas where id = m.kassa_id for update;
  if m.round <> k.round then raise exception 'OLD_ROUND'; end if;
  if exists (select 1 from public.meetings where kassa_id = k.id and round = k.round and idx < m.idx and closed_at is null) then
    raise exception 'PREVIOUS_OPEN';
  end if;
  if exists (
    select 1 from public.seats s
    where s.kassa_id = k.id and s.position is not null and s.id is distinct from m.holder_seat_id
      and not exists (select 1 from public.payments p where p.meeting_id = m.id and p.seat_id = s.id)
  ) then raise exception 'NOT_ALL_PAID'; end if;

  update public.meetings set closed_at = now() where id = p_meeting;
  if not exists (select 1 from public.meetings where kassa_id = k.id and round = k.round and closed_at is null) then
    update public.kassas set status = 'finished' where id = k.id;
  end if;
end $$;

-- ---------- Чтение ----------
create or replace function public.get_kassa(p_kassa uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public._uid(); k public.kassas; v_seat uuid;
begin
  select * into k from public.kassas where id = p_kassa;
  if not found then raise exception 'KASSA_NOT_FOUND'; end if;
  select seat_id into v_seat from public.members where kassa_id = p_kassa and user_id = v_uid;
  if v_seat is null then raise exception 'NOT_A_MEMBER'; end if;

  return jsonb_build_object(
    'kassa', jsonb_build_object('id', k.id, 'code', k.code, 'title', k.title,
      'share_pair', k.share_pair, 'share_single', k.share_single, 'start_month', k.start_month,
      'round', k.round, 'status', k.status, 'is_owner', k.owner_id = v_uid),
    'my_seat_id', v_seat,
    'seats', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'kind', s.kind, 'position', s.position,
        'members', (select count(*) from public.members x where x.seat_id = s.id),
        'is_owner', exists (select 1 from public.members x where x.seat_id = s.id and x.user_id = k.owner_id)
      ) order by s.position nulls last, s.created_at)
      from public.seats s where s.kassa_id = k.id), '[]'::jsonb),
    'meetings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'idx', m.idx, 'month', m.month, 'holder_seat_id', m.holder_seat_id,
        'meet_date', m.meet_date, 'meet_time', to_char(m.meet_time, 'HH24:MI'), 'place', m.place, 'bill', m.bill,
        'closed', m.closed_at is not null,
        'can_manage', public._can_manage(m.id),
        'payments', coalesce((
          select jsonb_agg(
            case when public._can_manage(m.id) or p.seat_id = v_seat
              then jsonb_build_object('seat_id', p.seat_id, 'method', p.method, 'amount', p.amount,
                                      'received', p.kaspi_received_at is not null)
              else jsonb_build_object('seat_id', p.seat_id)   -- для остальных просто «сдал»
            end)
          from public.payments p where p.meeting_id = m.id), '[]'::jsonb)
      ) order by m.idx)
      from public.meetings m where m.kassa_id = k.id and m.round = k.round), '[]'::jsonb),
    -- Тихие долги, которые ждёт этот пользователь как хозяин кассы (за все круги)
    'secret_debts', coalesce((
      select jsonb_agg(jsonb_build_object('meeting_id', m.id, 'month', m.month, 'seat_id', s.id,
        'seat_name', s.name, 'amount', p.amount) order by m.month)
      from public.payments p join public.meetings m on m.id = p.meeting_id join public.seats s on s.id = p.seat_id
      where m.kassa_id = k.id and p.method = 'kaspi' and p.kaspi_received_at is null and public._can_manage(m.id)), '[]'::jsonb),
    -- Переводы, которые должен сам пользователь
    'my_debts', coalesce((
      select jsonb_agg(jsonb_build_object('meeting_id', m.id, 'month', m.month,
        'holder_name', h.name, 'amount', p.amount) order by m.month)
      from public.payments p join public.meetings m on m.id = p.meeting_id left join public.seats h on h.id = m.holder_seat_id
      where m.kassa_id = k.id and p.seat_id = v_seat and p.method = 'kaspi' and p.kaspi_received_at is null), '[]'::jsonb)
  );
end $$;

create or replace function public.my_kassas() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', k.id, 'title', k.title, 'code', k.code, 'status', k.status,
    'seats', (select count(*) from public.seats s where s.kassa_id = k.id),
    'is_owner', k.owner_id = auth.uid(),
    'current_month', cm.month, 'current_holder', cm.holder_name
  ) order by mb.joined_at desc), '[]'::jsonb)
  from public.members mb
  join public.kassas k on k.id = mb.kassa_id
  left join lateral (
    select m.month, s.name as holder_name from public.meetings m left join public.seats s on s.id = m.holder_seat_id
    where m.kassa_id = k.id and m.round = k.round and m.closed_at is null order by m.idx limit 1
  ) cm on true
  where mb.user_id = auth.uid();
$$;

-- ---------- Аккаунт ----------
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid := public._uid(); r record; v_new uuid;
begin
  for r in select id from public.kassas where owner_id = v_uid loop
    select user_id into v_new from public.members where kassa_id = r.id and user_id <> v_uid order by joined_at limit 1;
    if v_new is null then delete from public.kassas where id = r.id;
    else update public.kassas set owner_id = v_new where id = r.id; end if;
  end loop;
  delete from auth.users where id = v_uid;
end $$;

-- ---------- Права на вызов ----------
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.create_kassa(text, text, text, integer, integer, date),
  public.kassa_preview(text),
  public.join_kassa(text, text, text, uuid),
  public.leave_kassa(uuid),
  public.update_kassa(uuid, text, integer, integer, date),
  public.add_seat(uuid, text, text),
  public.remove_seat(uuid, uuid),
  public.draw_kassa(uuid),
  public.reset_draw(uuid),
  public.new_round(uuid),
  public.update_meeting(uuid, date, time, text, integer),
  public.mark_payment(uuid, uuid, text),
  public.confirm_kaspi(uuid, uuid),
  public.close_meeting(uuid),
  public.get_kassa(uuid),
  public.my_kassas(),
  public.delete_my_account()
to authenticated;
revoke execute on function public._can_manage(uuid), public._my_seat(uuid), public._is_owner(uuid),
  public._owned_kassa(uuid), public._share(uuid, uuid), public._gen_code() from authenticated;
