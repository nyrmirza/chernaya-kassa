-- 0002: число мест и ожидание всех, состав после жеребьёвки, обмен очередью,
-- опросы, история кругов, деление счёта дастархана.

-- ---------- Схема ----------
alter table public.kassas add column if not exists target_size integer
  check (target_size is null or target_size between 2 and 50);

alter table public.seats add column if not exists removed_at timestamptz;
drop index if exists public.seats_name_uniq;
create unique index seats_name_uniq on public.seats (kassa_id, lower(name)) where removed_at is null;

alter table public.meetings
  add column if not exists bill_split text not null default 'person' check (bill_split in ('person','seat')),
  add column if not exists bill_people integer check (bill_people is null or bill_people between 1 and 200);

create table if not exists public.swap_requests (
  id         uuid primary key default gen_random_uuid(),
  kassa_id   uuid not null references public.kassas(id) on delete cascade,
  round      integer not null,
  from_seat  uuid not null references public.seats(id) on delete cascade,
  to_seat    uuid not null references public.seats(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists swap_requests_kassa_idx on public.swap_requests (kassa_id);
create index if not exists swap_requests_to_idx on public.swap_requests (to_seat);
create index if not exists swap_requests_from_idx on public.swap_requests (from_seat);
create unique index if not exists swap_pending_uniq on public.swap_requests (from_seat, to_seat) where status = 'pending';

create table if not exists public.polls (
  id              uuid primary key default gen_random_uuid(),
  kassa_id        uuid not null references public.kassas(id) on delete cascade,
  question        text not null check (char_length(question) between 1 and 200),
  multi           boolean not null default false,
  created_by_seat uuid references public.seats(id) on delete set null,
  created_at      timestamptz not null default now(),
  closed_at       timestamptz
);
create index if not exists polls_kassa_idx on public.polls (kassa_id);
create index if not exists polls_seat_idx on public.polls (created_by_seat);

create table if not exists public.poll_options (
  id      uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  text    text not null check (char_length(text) between 1 and 100),
  ord     integer not null
);
create index if not exists poll_options_poll_idx on public.poll_options (poll_id);

-- Один голос от места (пара голосует один раз).
create table if not exists public.poll_votes (
  poll_id   uuid not null references public.polls(id) on delete cascade,
  option_id uuid not null references public.poll_options(id) on delete cascade,
  seat_id   uuid not null references public.seats(id) on delete cascade,
  voted_at  timestamptz not null default now(),
  primary key (poll_id, option_id, seat_id)
);
create index if not exists poll_votes_option_idx on public.poll_votes (option_id);
create index if not exists poll_votes_seat_idx on public.poll_votes (seat_id);

alter table public.swap_requests enable row level security;
alter table public.polls         enable row level security;
alter table public.poll_options  enable row level security;
alter table public.poll_votes    enable row level security;
revoke all on public.swap_requests, public.polls, public.poll_options, public.poll_votes from anon, authenticated;

-- ---------- Вспомогательные ----------
create or replace function public._active_seats(p_kassa uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.seats where kassa_id = p_kassa and removed_at is null;
$$;

-- Перенумеровать встречи текущего круга подряд (0..n-1), пересчитать месяцы и места в очереди.
-- Закрытые встречи всегда идут первыми, поэтому их месяцы не меняются.
create or replace function public._renumber(p_kassa uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k public.kassas;
begin
  select * into k from public.kassas where id = p_kassa;
  update public.meetings set idx = idx + 10000 where kassa_id = p_kassa and round = k.round;
  update public.meetings m set idx = r.n, month = (k.start_month + make_interval(months => r.n))::date
  from (select id, (row_number() over (order by idx) - 1)::int as n
        from public.meetings where kassa_id = p_kassa and round = k.round) r
  where m.id = r.id;
  update public.seats set position = null where kassa_id = p_kassa;
  update public.seats s set position = m.idx
  from public.meetings m
  where m.kassa_id = p_kassa and m.round = k.round and m.holder_seat_id = s.id and s.removed_at is null;
  if k.status = 'drawn' and not exists (
    select 1 from public.meetings where kassa_id = p_kassa and round = k.round and closed_at is null
  ) then
    update public.kassas set status = 'finished' where id = p_kassa;
  end if;
end $$;

create or replace function public._cancel_swaps(p_seat uuid) returns void
language sql security definer set search_path = public as $$
  update public.swap_requests set status = 'cancelled', decided_at = now()
  where status = 'pending' and (from_seat = p_seat or to_seat = p_seat);
$$;

-- Поменять местами в очереди два места текущего круга.
create or replace function public._do_swap(p_kassa uuid, a uuid, b uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k public.kassas; ma public.meetings; mb public.meetings;
begin
  select * into k from public.kassas where id = p_kassa;
  if k.status <> 'drawn' then raise exception 'NOT_DRAWN'; end if;
  if a = b then raise exception 'SAME_SEAT'; end if;
  select * into ma from public.meetings where kassa_id = p_kassa and round = k.round and holder_seat_id = a for update;
  select * into mb from public.meetings where kassa_id = p_kassa and round = k.round and holder_seat_id = b for update;
  if ma.id is null or mb.id is null then raise exception 'SEAT_NOT_FOUND'; end if;
  if ma.closed_at is not null or mb.closed_at is not null then raise exception 'ALREADY_TOOK'; end if;
  if exists (select 1 from public.payments where meeting_id in (ma.id, mb.id)) then
    raise exception 'MEETING_HAS_PAYMENTS';
  end if;
  update public.meetings set holder_seat_id = b where id = ma.id;
  update public.meetings set holder_seat_id = a where id = mb.id;
  update public.seats set position = null where id in (a, b);
  update public.seats set position = mb.idx where id = a;
  update public.seats set position = ma.idx where id = b;
  perform public._cancel_swaps(a);
  perform public._cancel_swaps(b);
end $$;

-- ---------- Создание, вход: число мест ----------
drop function if exists public.create_kassa(text, text, text, integer, integer, date);
create or replace function public.create_kassa(
  p_title text, p_seat_name text, p_kind text,
  p_share_pair integer, p_share_single integer, p_start date default null, p_size integer default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_id uuid; v_seat uuid;
begin
  if char_length(public._clean(p_title)) = 0 then raise exception 'TITLE_REQUIRED'; end if;
  if char_length(public._clean(p_seat_name)) = 0 then raise exception 'NAME_REQUIRED'; end if;
  if p_kind not in ('pair','single') then raise exception 'BAD_KIND'; end if;
  if coalesce(p_share_pair,0) <= 0 or coalesce(p_share_single,0) <= 0 then raise exception 'BAD_SHARE'; end if;
  if p_size is not null and (p_size < 2 or p_size > 50) then raise exception 'BAD_SIZE'; end if;
  if (select count(*) from public.kassas where owner_id = v_uid) >= 20 then raise exception 'TOO_MANY_KASSAS'; end if;

  insert into public.kassas (code, title, owner_id, share_pair, share_single, start_month, target_size)
  values (public._gen_code(), left(public._clean(p_title), 60), v_uid, p_share_pair, p_share_single,
          date_trunc('month', coalesce(p_start, (now() + interval '1 month')::date))::date, p_size)
  returning id into v_id;
  insert into public.seats (kassa_id, name, kind) values (v_id, left(public._clean(p_seat_name), 60), p_kind)
  returning id into v_seat;
  insert into public.members (kassa_id, user_id, seat_id) values (v_id, v_uid, v_seat);
  return v_id;
end $$;

drop function if exists public.update_kassa(uuid, text, integer, integer, date);
create or replace function public.update_kassa(
  p_kassa uuid, p_title text, p_share_pair integer, p_share_single integer, p_start date, p_size integer default null
) returns void
language plpgsql security definer set search_path = public as $$
declare k public.kassas := public._owned_kassa(p_kassa);
begin
  if char_length(public._clean(p_title)) = 0 then raise exception 'TITLE_REQUIRED'; end if;
  if coalesce(p_share_pair,0) <= 0 or coalesce(p_share_single,0) <= 0 then raise exception 'BAD_SHARE'; end if;
  if p_size is not null then
    if p_size < 2 or p_size > 50 then raise exception 'BAD_SIZE'; end if;
    if k.status <> 'open' then raise exception 'ALREADY_DRAWN'; end if;
    if p_size < public._active_seats(p_kassa) then raise exception 'SIZE_TOO_SMALL'; end if;
  end if;
  update public.kassas set
    title = left(public._clean(p_title), 60),
    share_pair = p_share_pair, share_single = p_share_single,
    start_month = case when k.status = 'open' and p_start is not null then date_trunc('month', p_start)::date else start_month end,
    target_size = coalesce(p_size, target_size)
  where id = p_kassa;
end $$;

create or replace function public.kassa_preview(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare k public.kassas; v_uid uuid := public._uid();
begin
  select * into k from public.kassas where code = upper(trim(p_code));
  if not found then raise exception 'KASSA_NOT_FOUND'; end if;
  return jsonb_build_object(
    'id', k.id, 'title', k.title, 'status', k.status,
    'share_pair', k.share_pair, 'share_single', k.share_single,
    'target_size', k.target_size, 'seat_count', public._active_seats(k.id),
    'already_member', exists (select 1 from public.members where kassa_id = k.id and user_id = v_uid),
    'seats', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'kind', s.kind,
        'members', (select count(*) from public.members x where x.seat_id = s.id)) order by s.created_at)
      from public.seats s where s.kassa_id = k.id and s.removed_at is null), '[]'::jsonb)
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
    select * into s from public.seats where id = p_seat and kassa_id = k.id and removed_at is null;
    if not found then raise exception 'SEAT_NOT_FOUND'; end if;
    select count(*) into v_n from public.members where seat_id = s.id;
    if v_n > 0 and (s.kind = 'single' or v_n >= 2) then raise exception 'SEAT_TAKEN'; end if;
    insert into public.members (kassa_id, user_id, seat_id) values (k.id, v_uid, s.id);
    return k.id;
  end if;

  if k.status <> 'open' then raise exception 'ALREADY_DRAWN'; end if;
  if char_length(v_name) = 0 then raise exception 'NAME_REQUIRED'; end if;
  if p_kind not in ('pair','single') then raise exception 'BAD_KIND'; end if;
  if exists (select 1 from public.seats where kassa_id = k.id and removed_at is null and lower(name) = lower(v_name)) then
    raise exception 'NAME_TAKEN';
  end if;
  if public._active_seats(k.id) >= coalesce(k.target_size, 50) then raise exception 'KASSA_FULL'; end if;
  insert into public.seats (kassa_id, name, kind) values (k.id, left(v_name, 60), p_kind) returning * into s;
  insert into public.members (kassa_id, user_id, seat_id) values (k.id, v_uid, s.id);
  return k.id;
end $$;

-- ---------- Состав: добавить / убрать в любой момент ----------
create or replace function public.add_seat(p_kassa uuid, p_name text, p_kind text) returns uuid
language plpgsql security definer set search_path = public as $$
declare k public.kassas := public._owned_kassa(p_kassa); v_name text := public._clean(p_name); v_id uuid;
begin
  if k.status = 'finished' then raise exception 'ROUND_FINISHED'; end if;
  if char_length(v_name) = 0 then raise exception 'NAME_REQUIRED'; end if;
  if p_kind not in ('pair','single') then raise exception 'BAD_KIND'; end if;
  if exists (select 1 from public.seats where kassa_id = p_kassa and removed_at is null and lower(name) = lower(v_name)) then
    raise exception 'NAME_TAKEN';
  end if;
  if public._active_seats(p_kassa) >= 50 then raise exception 'KASSA_FULL'; end if;
  if k.status = 'open' and k.target_size is not null and public._active_seats(p_kassa) >= k.target_size then
    raise exception 'KASSA_FULL';
  end if;

  insert into public.seats (kassa_id, name, kind) values (p_kassa, left(v_name, 60), p_kind) returning id into v_id;

  if k.status = 'drawn' then
    -- Новое место встаёт в конец очереди.
    insert into public.meetings (kassa_id, round, idx, holder_seat_id, month)
    values (p_kassa, k.round,
            (select coalesce(max(idx), -1) + 1 from public.meetings where kassa_id = p_kassa and round = k.round),
            v_id, k.start_month);
    perform public._renumber(p_kassa);
    update public.kassas set target_size = target_size + 1 where id = p_kassa and target_size is not null;
  end if;
  return v_id;
end $$;

create or replace function public.remove_seat(p_kassa uuid, p_seat uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k public.kassas := public._owned_kassa(p_kassa);
begin
  if not exists (select 1 from public.seats where id = p_seat and kassa_id = p_kassa and removed_at is null) then
    raise exception 'SEAT_NOT_FOUND';
  end if;
  if exists (select 1 from public.members where seat_id = p_seat and user_id = k.owner_id) then
    raise exception 'CANNOT_REMOVE_OWNER';
  end if;

  if k.status = 'open' and not exists (select 1 from public.meetings where holder_seat_id = p_seat) then
    delete from public.seats where id = p_seat;   -- ещё ни в одном круге не было — удаляем полностью
    return;
  end if;

  -- Иначе место уходит из очереди, но остаётся в истории.
  delete from public.meetings
  where kassa_id = p_kassa and round = k.round and holder_seat_id = p_seat and closed_at is null;
  delete from public.payments p using public.meetings m
  where p.meeting_id = m.id and m.kassa_id = p_kassa and m.round = k.round and m.closed_at is null and p.seat_id = p_seat;
  perform public._cancel_swaps(p_seat);
  update public.seats set removed_at = now(), position = null where id = p_seat;
  delete from public.members where seat_id = p_seat;
  delete from public.poll_votes v using public.polls pl where v.poll_id = pl.id and pl.closed_at is null and v.seat_id = p_seat;
  if k.status <> 'open' then
    perform public._renumber(p_kassa);
    update public.kassas set target_size = greatest(2, target_size - 1) where id = p_kassa and target_size is not null;
  end if;
end $$;

-- ---------- Жеребьёвка: ждать, пока все войдут ----------
create or replace function public.draw_kassa(p_kassa uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k public.kassas := public._owned_kassa(p_kassa); v_n int;
begin
  if k.status <> 'open' then raise exception 'ALREADY_DRAWN'; end if;
  v_n := public._active_seats(p_kassa);
  if v_n < 2 then raise exception 'NEED_2_SEATS'; end if;
  if k.target_size is not null and v_n < k.target_size then raise exception 'NOT_ALL_JOINED'; end if;

  update public.seats set position = null where kassa_id = p_kassa;
  update public.seats s set position = r.pos
  from (select id, (row_number() over (order by gen_random_uuid()) - 1)::int as pos
        from public.seats where kassa_id = p_kassa and removed_at is null) r
  where s.id = r.id;

  insert into public.meetings (kassa_id, round, idx, holder_seat_id, month)
  select p_kassa, k.round, s.position, s.id, (k.start_month + make_interval(months => s.position))::date
  from public.seats s where s.kassa_id = p_kassa and s.removed_at is null;

  update public.kassas set status = 'drawn', drawn_at = now() where id = p_kassa;
end $$;

create or replace function public.reset_draw(p_kassa uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k public.kassas := public._owned_kassa(p_kassa);
begin
  if k.status <> 'drawn' then raise exception 'NOT_DRAWN'; end if;
  if exists (select 1 from public.meetings where kassa_id = p_kassa and round = k.round and closed_at is not null) then
    raise exception 'ROUND_STARTED';
  end if;
  delete from public.meetings where kassa_id = p_kassa and round = k.round;
  update public.swap_requests set status = 'cancelled', decided_at = now()
  where kassa_id = p_kassa and round = k.round and status = 'pending';
  update public.seats set position = null where kassa_id = p_kassa;
  update public.kassas set status = 'open', drawn_at = null where id = p_kassa;
end $$;

-- Новый круг: состав прежний, число мест = текущее число участников.
create or replace function public.new_round(p_kassa uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k public.kassas := public._owned_kassa(p_kassa); v_n int;
begin
  if k.status <> 'finished' then raise exception 'ROUND_NOT_FINISHED'; end if;
  select count(*) into v_n from public.meetings where kassa_id = p_kassa and round = k.round;
  update public.seats set position = null where kassa_id = p_kassa;
  update public.kassas set status = 'open', round = round + 1, drawn_at = null,
    start_month = (start_month + make_interval(months => v_n))::date,
    target_size = case when target_size is null then null else public._active_seats(p_kassa) end
  where id = p_kassa;
end $$;

-- ---------- Обмен очередью ----------
create or replace function public.swap_queue(p_kassa uuid, p_seat_a uuid, p_seat_b uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k public.kassas := public._owned_kassa(p_kassa);
begin
  perform public._do_swap(p_kassa, p_seat_a, p_seat_b);
end $$;

create or replace function public.request_swap(p_kassa uuid, p_to_seat uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); k public.kassas; v_me uuid; ma public.meetings; mb public.meetings; v_id uuid;
begin
  select * into k from public.kassas where id = p_kassa;
  if not found then raise exception 'KASSA_NOT_FOUND'; end if;
  select seat_id into v_me from public.members where kassa_id = p_kassa and user_id = v_uid;
  if v_me is null then raise exception 'NOT_A_MEMBER'; end if;
  if k.status <> 'drawn' then raise exception 'NOT_DRAWN'; end if;
  if v_me = p_to_seat then raise exception 'SAME_SEAT'; end if;
  select * into ma from public.meetings where kassa_id = p_kassa and round = k.round and holder_seat_id = v_me;
  select * into mb from public.meetings where kassa_id = p_kassa and round = k.round and holder_seat_id = p_to_seat;
  if ma.id is null or mb.id is null then raise exception 'SEAT_NOT_FOUND'; end if;
  if ma.closed_at is not null or mb.closed_at is not null then raise exception 'ALREADY_TOOK'; end if;
  if exists (select 1 from public.payments where meeting_id in (ma.id, mb.id)) then raise exception 'MEETING_HAS_PAYMENTS'; end if;
  if exists (select 1 from public.swap_requests where status = 'pending' and from_seat = v_me and to_seat = p_to_seat) then
    raise exception 'SWAP_ALREADY_ASKED';
  end if;
  insert into public.swap_requests (kassa_id, round, from_seat, to_seat) values (p_kassa, k.round, v_me, p_to_seat)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.respond_swap(p_request uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); r public.swap_requests;
begin
  select * into r from public.swap_requests where id = p_request for update;
  if not found or r.status <> 'pending' then raise exception 'SWAP_NOT_FOUND'; end if;
  if not exists (select 1 from public.members where seat_id = r.to_seat and user_id = v_uid) then raise exception 'NOT_ALLOWED'; end if;
  if p_accept then
    perform public._do_swap(r.kassa_id, r.from_seat, r.to_seat);
    update public.swap_requests set status = 'accepted', decided_at = now() where id = p_request;
  else
    update public.swap_requests set status = 'declined', decided_at = now() where id = p_request;
  end if;
end $$;

create or replace function public.cancel_swap(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); r public.swap_requests;
begin
  select * into r from public.swap_requests where id = p_request for update;
  if not found or r.status <> 'pending' then return; end if;
  if not (exists (select 1 from public.members where seat_id = r.from_seat and user_id = v_uid) or public._is_owner(r.kassa_id)) then
    raise exception 'NOT_ALLOWED';
  end if;
  update public.swap_requests set status = 'cancelled', decided_at = now() where id = p_request;
end $$;

-- ---------- Опросы ----------
create or replace function public.create_poll(p_kassa uuid, p_question text, p_options text[], p_multi boolean default false)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_me uuid; v_id uuid; v_opts text[]; i int;
begin
  select seat_id into v_me from public.members where kassa_id = p_kassa and user_id = v_uid;
  if v_me is null then raise exception 'NOT_A_MEMBER'; end if;
  if char_length(public._clean(p_question)) = 0 then raise exception 'QUESTION_REQUIRED'; end if;
  select array_agg(left(public._clean(o), 100) order by n) into v_opts
  from unnest(p_options) with ordinality as t(o, n) where char_length(public._clean(o)) > 0;
  if coalesce(array_length(v_opts, 1), 0) < 2 then raise exception 'NEED_2_OPTIONS'; end if;
  if array_length(v_opts, 1) > 10 then raise exception 'TOO_MANY_OPTIONS'; end if;
  if (select count(*) from public.polls where kassa_id = p_kassa and closed_at is null) >= 20 then raise exception 'TOO_MANY_POLLS'; end if;
  insert into public.polls (kassa_id, question, multi, created_by_seat)
  values (p_kassa, left(public._clean(p_question), 200), coalesce(p_multi, false), v_me) returning id into v_id;
  for i in 1..array_length(v_opts, 1) loop
    insert into public.poll_options (poll_id, text, ord) values (v_id, v_opts[i], i);
  end loop;
  return v_id;
end $$;

create or replace function public.vote_poll(p_poll uuid, p_options uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); p public.polls; v_me uuid; v_n int;
begin
  select * into p from public.polls where id = p_poll;
  if not found then raise exception 'POLL_NOT_FOUND'; end if;
  select seat_id into v_me from public.members where kassa_id = p.kassa_id and user_id = v_uid;
  if v_me is null then raise exception 'NOT_A_MEMBER'; end if;
  if p.closed_at is not null then raise exception 'POLL_CLOSED'; end if;
  v_n := coalesce(array_length(p_options, 1), 0);
  if not p.multi and v_n > 1 then raise exception 'BAD_VOTE'; end if;
  if v_n > 0 and (select count(*) from public.poll_options where poll_id = p_poll and id = any(p_options)) <> v_n then
    raise exception 'BAD_VOTE';
  end if;
  delete from public.poll_votes where poll_id = p_poll and seat_id = v_me;
  insert into public.poll_votes (poll_id, option_id, seat_id)
  select p_poll, o, v_me from unnest(p_options) as o;
end $$;

create or replace function public._can_manage_poll(p_poll uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.polls p
    where p.id = p_poll and (
      public._is_owner(p.kassa_id)
      or exists (select 1 from public.members x where x.seat_id = p.created_by_seat and x.user_id = auth.uid())
    )
  );
$$;

create or replace function public.close_poll(p_poll uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._uid();
  if not public._can_manage_poll(p_poll) then raise exception 'NOT_ALLOWED'; end if;
  update public.polls set closed_at = coalesce(closed_at, now()) where id = p_poll;
end $$;

create or replace function public.delete_poll(p_poll uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._uid();
  if not public._can_manage_poll(p_poll) then raise exception 'NOT_ALLOWED'; end if;
  delete from public.polls where id = p_poll;
end $$;

-- ---------- Встреча: деление счёта ----------
drop function if exists public.update_meeting(uuid, date, time, text, integer);
create or replace function public.update_meeting(
  p_meeting uuid, p_date date, p_time time, p_place text, p_bill integer,
  p_split text default null, p_people integer default null
) returns void
language plpgsql security definer set search_path = public as $$
declare m public.meetings;
begin
  perform public._uid();
  select * into m from public.meetings where id = p_meeting;
  if not found then raise exception 'MEETING_NOT_FOUND'; end if;
  if not (public._can_manage(p_meeting) or public._is_owner(m.kassa_id)) then raise exception 'NOT_ALLOWED'; end if;
  if p_split is not null and p_split not in ('person','seat') then raise exception 'BAD_SPLIT'; end if;
  update public.meetings set meet_date = p_date, meet_time = p_time,
    place = left(public._clean(p_place), 120), bill = greatest(coalesce(p_bill, 0), 0),
    bill_split = coalesce(p_split, bill_split),
    bill_people = case when p_people is null then bill_people when p_people between 1 and 200 then p_people else bill_people end
  where id = p_meeting;
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
      'round', k.round, 'status', k.status, 'is_owner', k.owner_id = v_uid, 'target_size', k.target_size),
    'my_seat_id', v_seat,
    'seats', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'kind', s.kind, 'position', s.position,
        'members', (select count(*) from public.members x where x.seat_id = s.id),
        'is_owner', exists (select 1 from public.members x where x.seat_id = s.id and x.user_id = k.owner_id)
      ) order by s.position nulls last, s.created_at)
      from public.seats s where s.kassa_id = k.id and s.removed_at is null), '[]'::jsonb),
    'meetings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'idx', m.idx, 'month', m.month, 'holder_seat_id', m.holder_seat_id, 'holder_name', h.name,
        'meet_date', m.meet_date, 'meet_time', to_char(m.meet_time, 'HH24:MI'), 'place', m.place, 'bill', m.bill,
        'bill_split', m.bill_split, 'bill_people', m.bill_people,
        'closed', m.closed_at is not null,
        'can_manage', public._can_manage(m.id),
        'payments', coalesce((
          select jsonb_agg(
            case when public._can_manage(m.id) or p.seat_id = v_seat
              then jsonb_build_object('seat_id', p.seat_id, 'method', p.method, 'amount', p.amount,
                                      'received', p.kaspi_received_at is not null)
              else jsonb_build_object('seat_id', p.seat_id)
            end)
          from public.payments p where p.meeting_id = m.id), '[]'::jsonb)
      ) order by m.idx)
      from public.meetings m left join public.seats h on h.id = m.holder_seat_id
      where m.kassa_id = k.id and m.round = k.round), '[]'::jsonb),
    'swaps', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'from_seat', r.from_seat, 'to_seat', r.to_seat,
        'from_name', fs.name, 'to_name', ts.name, 'created_at', r.created_at) order by r.created_at)
      from public.swap_requests r join public.seats fs on fs.id = r.from_seat join public.seats ts on ts.id = r.to_seat
      where r.kassa_id = k.id and r.round = k.round and r.status = 'pending'), '[]'::jsonb),
    'polls', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pl.id, 'question', pl.question, 'multi', pl.multi, 'closed', pl.closed_at is not null,
        'created_at', pl.created_at, 'author', a.name, 'can_manage', public._can_manage_poll(pl.id),
        'voters', (select count(distinct v.seat_id) from public.poll_votes v where v.poll_id = pl.id),
        'options', (
          select jsonb_agg(jsonb_build_object('id', o.id, 'text', o.text,
            'votes', (select count(*) from public.poll_votes v where v.option_id = o.id),
            'mine', exists (select 1 from public.poll_votes v where v.option_id = o.id and v.seat_id = v_seat),
            'names', coalesce((select jsonb_agg(vs.name order by vs.name) from public.poll_votes v
                               join public.seats vs on vs.id = v.seat_id where v.option_id = o.id), '[]'::jsonb)
          ) order by o.ord)
          from public.poll_options o where o.poll_id = pl.id)
      ) order by (pl.closed_at is not null), pl.created_at desc)
      from (select * from public.polls where kassa_id = k.id order by created_at desc limit 30) pl
      left join public.seats a on a.id = pl.created_by_seat), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('round', hr.round, 'meetings', hr.meetings) order by hr.round desc)
      from (
        select m.round, jsonb_agg(jsonb_build_object(
          'month', m.month, 'holder_name', h.name, 'meet_date', m.meet_date, 'place', m.place, 'bill', m.bill,
          'collected', (select coalesce(sum(p.amount), 0) from public.payments p where p.meeting_id = m.id),
          'closed', m.closed_at is not null
        ) order by m.idx) as meetings
        from public.meetings m left join public.seats h on h.id = m.holder_seat_id
        where m.kassa_id = k.id and m.round < k.round
        group by m.round
      ) hr), '[]'::jsonb),
    'secret_debts', coalesce((
      select jsonb_agg(jsonb_build_object('meeting_id', m.id, 'month', m.month, 'seat_id', s.id,
        'seat_name', s.name, 'amount', p.amount) order by m.month)
      from public.payments p join public.meetings m on m.id = p.meeting_id join public.seats s on s.id = p.seat_id
      where m.kassa_id = k.id and p.method = 'kaspi' and p.kaspi_received_at is null and public._can_manage(m.id)), '[]'::jsonb),
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
    'seats', (select count(*) from public.seats s where s.kassa_id = k.id and s.removed_at is null),
    'target_size', k.target_size,
    'is_owner', k.owner_id = auth.uid(),
    'current_month', cm.month, 'current_holder', cm.holder_name,
    'pending_swaps', (select count(*) from public.swap_requests r where r.kassa_id = k.id and r.status = 'pending' and r.to_seat = mb.seat_id)
  ) order by mb.joined_at desc), '[]'::jsonb)
  from public.members mb
  join public.kassas k on k.id = mb.kassa_id
  left join lateral (
    select m.month, s.name as holder_name from public.meetings m left join public.seats s on s.id = m.holder_seat_id
    where m.kassa_id = k.id and m.round = k.round and m.closed_at is null order by m.idx limit 1
  ) cm on true
  where mb.user_id = auth.uid();
$$;

-- ---------- Права ----------
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.create_kassa(text, text, text, integer, integer, date, integer),
  public.kassa_preview(text),
  public.join_kassa(text, text, text, uuid),
  public.leave_kassa(uuid),
  public.update_kassa(uuid, text, integer, integer, date, integer),
  public.add_seat(uuid, text, text),
  public.remove_seat(uuid, uuid),
  public.draw_kassa(uuid),
  public.reset_draw(uuid),
  public.new_round(uuid),
  public.swap_queue(uuid, uuid, uuid),
  public.request_swap(uuid, uuid),
  public.respond_swap(uuid, boolean),
  public.cancel_swap(uuid),
  public.create_poll(uuid, text, text[], boolean),
  public.vote_poll(uuid, uuid[]),
  public.close_poll(uuid),
  public.delete_poll(uuid),
  public.update_meeting(uuid, date, time, text, integer, text, integer),
  public.mark_payment(uuid, uuid, text),
  public.confirm_kaspi(uuid, uuid),
  public.close_meeting(uuid),
  public.get_kassa(uuid),
  public.my_kassas(),
  public.delete_my_account()
to authenticated;
revoke execute on function
  public._can_manage(uuid), public._my_seat(uuid), public._is_owner(uuid), public._owned_kassa(uuid),
  public._share(uuid, uuid), public._gen_code(), public._active_seats(uuid), public._renumber(uuid),
  public._cancel_swaps(uuid), public._do_swap(uuid, uuid, uuid), public._can_manage_poll(uuid)
from authenticated;
