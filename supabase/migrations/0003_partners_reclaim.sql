-- 0003: пара с двух телефонов (личная ссылка, два имени) и возврат места на новом телефоне через организатора.
-- Вход через Apple / Google делается на стороне Supabase Auth (привязка к анонимному аккаунту), здесь не нужен.

alter table public.seats add column if not exists names text[];
alter table public.seats add column if not exists invite_token text unique
  check (invite_token is null or invite_token ~ '^[A-HJ-NP-Z2-9]{8}$');
alter table public.members add column if not exists person_idx smallint not null default 0 check (person_idx in (0,1));

create table if not exists public.reclaim_requests (
  id         uuid primary key default gen_random_uuid(),
  kassa_id   uuid not null references public.kassas(id) on delete cascade,
  seat_id    uuid not null references public.seats(id) on delete cascade,
  person_idx smallint not null default 0 check (person_idx in (0,1)),
  user_id    uuid not null references auth.users(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists reclaim_kassa_idx on public.reclaim_requests (kassa_id);
create index if not exists reclaim_seat_idx on public.reclaim_requests (seat_id);
create index if not exists reclaim_user_idx on public.reclaim_requests (user_id);
create unique index if not exists reclaim_pending_uniq on public.reclaim_requests (kassa_id, user_id) where status = 'pending';
alter table public.reclaim_requests enable row level security;
revoke all on public.reclaim_requests from anon, authenticated;

-- ---------- Имена ----------
create or replace function public._clean_names(p_kind text, p_names text[], p_label text) returns text[]
language plpgsql immutable set search_path = public as $$
declare a text := public._clean(p_names[1]); b text := public._clean(p_names[2]);
begin
  if p_names is null then return array[public._clean(p_label)]; end if;
  if char_length(a) = 0 then raise exception 'NAME_REQUIRED'; end if;
  if p_kind = 'pair' then
    if char_length(b) = 0 then raise exception 'PARTNER_NAME_REQUIRED'; end if;
    return array[left(a, 30), left(b, 30)];
  end if;
  return array[left(a, 30)];
end $$;

create or replace function public._gen_token() returns text
language plpgsql volatile set search_path = public as $$
declare v text; al constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; r bytea; i int;
begin
  loop
    v := ''; r := uuid_send(gen_random_uuid());
    for i in 0..7 loop v := v || substr(al, 1 + (get_byte(r, i) % 32), 1); end loop;
    exit when not exists (select 1 from public.seats where invite_token = v);
  end loop;
  return v;
end $$;

drop function if exists public.create_kassa(text, text, text, integer, integer, date, integer);
create or replace function public.create_kassa(
  p_title text, p_seat_name text, p_kind text,
  p_share_pair integer, p_share_single integer, p_start date default null, p_size integer default null, p_names text[] default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_id uuid; v_seat uuid; v_names text[];
begin
  if char_length(public._clean(p_title)) = 0 then raise exception 'TITLE_REQUIRED'; end if;
  if char_length(public._clean(p_seat_name)) = 0 then raise exception 'NAME_REQUIRED'; end if;
  if p_kind not in ('pair','single') then raise exception 'BAD_KIND'; end if;
  if coalesce(p_share_pair,0) <= 0 or coalesce(p_share_single,0) <= 0 then raise exception 'BAD_SHARE'; end if;
  if p_size is not null and (p_size < 2 or p_size > 50) then raise exception 'BAD_SIZE'; end if;
  if (select count(*) from public.kassas where owner_id = v_uid) >= 20 then raise exception 'TOO_MANY_KASSAS'; end if;
  v_names := public._clean_names(p_kind, p_names, p_seat_name);

  insert into public.kassas (code, title, owner_id, share_pair, share_single, start_month, target_size)
  values (public._gen_code(), left(public._clean(p_title), 60), v_uid, p_share_pair, p_share_single,
          date_trunc('month', coalesce(p_start, (now() + interval '1 month')::date))::date, p_size)
  returning id into v_id;
  insert into public.seats (kassa_id, name, kind, names) values (v_id, left(public._clean(p_seat_name), 60), p_kind, v_names)
  returning id into v_seat;
  insert into public.members (kassa_id, user_id, seat_id, person_idx) values (v_id, v_uid, v_seat, 0);
  return v_id;
end $$;

drop function if exists public.join_kassa(text, text, text, uuid);
create or replace function public.join_kassa(
  p_code text, p_name text default null, p_kind text default null, p_seat uuid default null, p_names text[] default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); k public.kassas; s public.seats; v_name text := public._clean(p_name); v_names text[];
begin
  select * into k from public.kassas where code = upper(trim(p_code)) for update;
  if not found then raise exception 'KASSA_NOT_FOUND'; end if;
  if exists (select 1 from public.members where kassa_id = k.id and user_id = v_uid) then return k.id; end if;

  if p_seat is not null then
    -- Только место, которое организатор добавил вручную и в котором ещё никого нет.
    -- Второй из пары входит по личной ссылке, вернувшийся участник — через запрос организатору.
    select * into s from public.seats where id = p_seat and kassa_id = k.id and removed_at is null for update;
    if not found then raise exception 'SEAT_NOT_FOUND'; end if;
    if exists (select 1 from public.members where seat_id = s.id) then raise exception 'SEAT_TAKEN'; end if;
    insert into public.members (kassa_id, user_id, seat_id, person_idx) values (k.id, v_uid, s.id, 0);
    return k.id;
  end if;

  if k.status <> 'open' then raise exception 'ALREADY_DRAWN'; end if;
  if char_length(v_name) = 0 then raise exception 'NAME_REQUIRED'; end if;
  if p_kind not in ('pair','single') then raise exception 'BAD_KIND'; end if;
  v_names := public._clean_names(p_kind, p_names, v_name);
  if exists (select 1 from public.seats where kassa_id = k.id and removed_at is null and lower(name) = lower(v_name)) then
    raise exception 'NAME_TAKEN';
  end if;
  if public._active_seats(k.id) >= coalesce(k.target_size, 50) then raise exception 'KASSA_FULL'; end if;
  insert into public.seats (kassa_id, name, kind, names) values (k.id, left(v_name, 60), p_kind, v_names) returning * into s;
  insert into public.members (kassa_id, user_id, seat_id, person_idx) values (k.id, v_uid, s.id, 0);
  return k.id;
end $$;

drop function if exists public.add_seat(uuid, text, text);
create or replace function public.add_seat(p_kassa uuid, p_name text, p_kind text, p_names text[] default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare k public.kassas := public._owned_kassa(p_kassa); v_name text := public._clean(p_name); v_id uuid; v_names text[];
begin
  if k.status = 'finished' then raise exception 'ROUND_FINISHED'; end if;
  if char_length(v_name) = 0 then raise exception 'NAME_REQUIRED'; end if;
  if p_kind not in ('pair','single') then raise exception 'BAD_KIND'; end if;
  v_names := public._clean_names(p_kind, p_names, v_name);
  if exists (select 1 from public.seats where kassa_id = p_kassa and removed_at is null and lower(name) = lower(v_name)) then
    raise exception 'NAME_TAKEN';
  end if;
  if public._active_seats(p_kassa) >= 50 then raise exception 'KASSA_FULL'; end if;
  if k.status = 'open' and k.target_size is not null and public._active_seats(p_kassa) >= k.target_size then
    raise exception 'KASSA_FULL';
  end if;
  insert into public.seats (kassa_id, name, kind, names) values (p_kassa, left(v_name, 60), p_kind, v_names) returning id into v_id;
  if k.status = 'drawn' then
    insert into public.meetings (kassa_id, round, idx, holder_seat_id, month)
    values (p_kassa, k.round,
            (select coalesce(max(idx), -1) + 1 from public.meetings where kassa_id = p_kassa and round = k.round),
            v_id, k.start_month);
    perform public._renumber(p_kassa);
    update public.kassas set target_size = target_size + 1 where id = p_kassa and target_size is not null;
  end if;
  return v_id;
end $$;

-- ---------- Личная ссылка для второго из пары ----------
create or replace function public.partner_invite(p_kassa uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); s public.seats; v_tok text;
begin
  select st.* into s from public.seats st join public.members m on m.seat_id = st.id
  where m.kassa_id = p_kassa and m.user_id = v_uid for update of st;
  if not found then raise exception 'NOT_A_MEMBER'; end if;
  if s.kind <> 'pair' then raise exception 'NOT_A_PAIR'; end if;
  if (select count(*) from public.members where seat_id = s.id) >= 2 then raise exception 'PARTNER_ALREADY_IN'; end if;
  if s.invite_token is null then
    v_tok := public._gen_token();
    update public.seats set invite_token = v_tok where id = s.id;
    return v_tok;
  end if;
  return s.invite_token;
end $$;

create or replace function public.partner_preview(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public._uid(); s public.seats; k public.kassas; v_taken int; v_idx int;
begin
  select * into s from public.seats where invite_token = upper(trim(p_token)) and removed_at is null;
  if not found then raise exception 'INVITE_NOT_FOUND'; end if;
  select * into k from public.kassas where id = s.kassa_id;
  select min(person_idx) into v_taken from public.members where seat_id = s.id;
  v_idx := case when v_taken = 0 then 1 else 0 end;
  return jsonb_build_object(
    'kassa_id', k.id, 'title', k.title, 'seat_name', s.name,
    'my_name', coalesce(s.names[v_idx + 1], ''),
    'partner_name', coalesce(s.names[2 - v_idx], ''),
    'already_member', exists (select 1 from public.members where kassa_id = k.id and user_id = v_uid),
    'full', (select count(*) from public.members where seat_id = s.id) >= 2
  );
end $$;

create or replace function public.join_partner(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); s public.seats; v_n int; v_taken int;
begin
  select * into s from public.seats where invite_token = upper(trim(p_token)) and removed_at is null for update;
  if not found then raise exception 'INVITE_NOT_FOUND'; end if;
  if exists (select 1 from public.members where kassa_id = s.kassa_id and user_id = v_uid) then return s.kassa_id; end if;
  select count(*), min(person_idx) into v_n, v_taken from public.members where seat_id = s.id;
  if v_n >= 2 then raise exception 'PARTNER_ALREADY_IN'; end if;
  insert into public.members (kassa_id, user_id, seat_id, person_idx)
  values (s.kassa_id, v_uid, s.id, case when v_taken = 0 then 1 else 0 end);
  update public.seats set invite_token = null where id = s.id;   -- ссылка одноразовая
  return s.kassa_id;
end $$;

-- ---------- Возврат места на новом телефоне ----------
create or replace function public.request_reclaim(p_code text, p_seat uuid, p_person smallint default 0) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); k public.kassas; s public.seats; v_id uuid;
begin
  select * into k from public.kassas where code = upper(trim(p_code));
  if not found then raise exception 'KASSA_NOT_FOUND'; end if;
  if exists (select 1 from public.members where kassa_id = k.id and user_id = v_uid) then raise exception 'ALREADY_MEMBER'; end if;
  select * into s from public.seats where id = p_seat and kassa_id = k.id and removed_at is null;
  if not found then raise exception 'SEAT_NOT_FOUND'; end if;
  if p_person not in (0, 1) or (s.kind = 'single' and p_person <> 0) then raise exception 'BAD_PERSON'; end if;
  update public.reclaim_requests set status = 'cancelled', decided_at = now()
  where kassa_id = k.id and user_id = v_uid and status = 'pending';
  insert into public.reclaim_requests (kassa_id, seat_id, person_idx, user_id) values (k.id, s.id, p_person, v_uid)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.respond_reclaim(p_request uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r public.reclaim_requests;
begin
  select * into r from public.reclaim_requests where id = p_request for update;
  if not found or r.status <> 'pending' then raise exception 'RECLAIM_NOT_FOUND'; end if;
  perform public._owned_kassa(r.kassa_id);
  if not p_accept then
    update public.reclaim_requests set status = 'declined', decided_at = now() where id = p_request;
    return;
  end if;
  if not exists (select 1 from public.seats where id = r.seat_id and removed_at is null) then raise exception 'SEAT_NOT_FOUND'; end if;
  -- Старый телефон теряет доступ к этому месту.
  delete from public.members where seat_id = r.seat_id and person_idx = r.person_idx;
  delete from public.members where kassa_id = r.kassa_id and user_id = r.user_id;
  insert into public.members (kassa_id, user_id, seat_id, person_idx) values (r.kassa_id, r.user_id, r.seat_id, r.person_idx);
  update public.reclaim_requests set status = 'accepted', decided_at = now() where id = p_request;
  update public.reclaim_requests set status = 'cancelled', decided_at = now()
  where kassa_id = r.kassa_id and seat_id = r.seat_id and person_idx = r.person_idx and status = 'pending';
end $$;

create or replace function public.cancel_reclaim(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.reclaim_requests set status = 'cancelled', decided_at = now()
  where id = p_request and user_id = public._uid() and status = 'pending';
end $$;

create or replace function public.my_reclaims() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kassa_title', k.title, 'seat_name', s.name,
    'created_at', r.created_at) order by r.created_at desc), '[]'::jsonb)
  from public.reclaim_requests r join public.kassas k on k.id = r.kassa_id join public.seats s on s.id = r.seat_id
  where r.user_id = auth.uid() and r.status = 'pending';
$$;

-- ---------- Чтение ----------
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
    'pending_reclaim', exists (select 1 from public.reclaim_requests where kassa_id = k.id and user_id = v_uid and status = 'pending'),
    'seats', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'kind', s.kind, 'names', to_jsonb(s.names),
        'members', (select count(*) from public.members x where x.seat_id = s.id)) order by s.created_at)
      from public.seats s where s.kassa_id = k.id and s.removed_at is null), '[]'::jsonb)
  );
end $$;

create or replace function public._seat_people(p_seat uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(person_idx order by person_idx), '[]'::jsonb) from public.members where seat_id = p_seat;
$$;

create or replace function public.get_kassa(p_kassa uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public._uid(); k public.kassas; v_seat uuid; v_pidx int;
begin
  select * into k from public.kassas where id = p_kassa;
  if not found then raise exception 'KASSA_NOT_FOUND'; end if;
  select seat_id, person_idx into v_seat, v_pidx from public.members where kassa_id = p_kassa and user_id = v_uid;
  if v_seat is null then raise exception 'NOT_A_MEMBER'; end if;

  return jsonb_build_object(
    'kassa', jsonb_build_object('id', k.id, 'code', k.code, 'title', k.title,
      'share_pair', k.share_pair, 'share_single', k.share_single, 'start_month', k.start_month,
      'round', k.round, 'status', k.status, 'is_owner', k.owner_id = v_uid, 'target_size', k.target_size),
    'my_seat_id', v_seat,
    'my_person_idx', v_pidx,
    'seats', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'kind', s.kind, 'position', s.position, 'names', to_jsonb(s.names),
        'members', (select count(*) from public.members x where x.seat_id = s.id),
        'joined', public._seat_people(s.id),
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
    'reclaims', case when k.owner_id = v_uid then coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'seat_id', r.seat_id, 'seat_name', s.name,
        'person_name', coalesce(s.names[r.person_idx + 1], s.name), 'created_at', r.created_at) order by r.created_at)
      from public.reclaim_requests r join public.seats s on s.id = r.seat_id
      where r.kassa_id = k.id and r.status = 'pending'), '[]'::jsonb) else '[]'::jsonb end,
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
    'pending_swaps', (select count(*) from public.swap_requests r where r.kassa_id = k.id and r.status = 'pending' and r.to_seat = mb.seat_id),
    'pending_reclaims', case when k.owner_id = auth.uid()
      then (select count(*) from public.reclaim_requests r where r.kassa_id = k.id and r.status = 'pending') else 0 end
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
  public.create_kassa(text, text, text, integer, integer, date, integer, text[]),
  public.kassa_preview(text),
  public.join_kassa(text, text, text, uuid, text[]),
  public.leave_kassa(uuid),
  public.update_kassa(uuid, text, integer, integer, date, integer),
  public.add_seat(uuid, text, text, text[]),
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
  public.delete_my_account(),
  public.partner_invite(uuid),
  public.partner_preview(text),
  public.join_partner(text),
  public.request_reclaim(text, uuid, smallint),
  public.respond_reclaim(uuid, boolean),
  public.cancel_reclaim(uuid),
  public.my_reclaims()
to authenticated;
revoke execute on function public._clean_names(text, text[], text), public._gen_token(), public._seat_people(uuid) from authenticated;
