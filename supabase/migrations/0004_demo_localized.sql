-- Демо-касса на языке приложения (kk / ru / en).
create or replace function public.start_demo(p_lang text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._uid();
  v_lang text := case when p_lang in ('kk','ru','en') then p_lang else 'ru' end;
  k uuid; s uuid[] := '{}'; m uuid[] := '{}'; v_id uuid; i int;
  v_start date := (date_trunc('month', now()) - interval '1 month')::date;
  p uuid; o uuid[] := '{}';
  v_title text; v_seats text[][]; v_place_prev text; v_place_cur text; v_q text; v_opts text[];
begin
  if v_lang = 'kk' then
    v_title := 'Демо-касса';
    v_seats := array[
      array['Ерлан мен Жанар','pair','Ерлан','Жанар'],
      array['Сіз және жұбайыңыз','pair','Сіз','Жұбайыңыз'],
      array['Тимур','single','Тимур',''],
      array['Дамир мен Света','pair','Дамир','Света'],
      array['Камила','single','Камила',''],
      array['Асхат пен Динара','pair','Асхат','Динара']];
    v_place_prev := '«Алаша» мейрамханасы';
    v_place_cur := '«Дастархан» кафесі, Абай 52';
    v_q := 'Келесі айда қайда кездесеміз?';
    v_opts := array['Дамирдің үйінде','«Дастархан» кафесі','«Алаша» мейрамханасы'];
  elsif v_lang = 'en' then
    v_title := 'Demo kassa';
    v_seats := array[
      array['Erlan & Zhanar','pair','Erlan','Zhanar'],
      array['You & spouse','pair','You','Spouse'],
      array['Timur','single','Timur',''],
      array['Damir & Sveta','pair','Damir','Sveta'],
      array['Kamila','single','Kamila',''],
      array['Askhat & Dinara','pair','Askhat','Dinara']];
    v_place_prev := 'Alasha restaurant';
    v_place_cur := 'Dastarkhan café, 52 Abay Ave';
    v_q := 'Where do we meet next month?';
    v_opts := array['At Damir’s place','Dastarkhan café','Alasha restaurant'];
  else
    v_title := 'Демо-касса';
    v_seats := array[
      array['Ерлан и Жанар','pair','Ерлан','Жанар'],
      array['Вы и супруг(а)','pair','Вы','Супруг(а)'],
      array['Тимур','single','Тимур',''],
      array['Дамир и Света','pair','Дамир','Света'],
      array['Камила','single','Камила',''],
      array['Асхат и Динара','pair','Асхат','Динара']];
    v_place_prev := 'Ресторан «Алаша»';
    v_place_cur := 'Кафе «Дастархан», Абая 52';
    v_q := 'Где встречаемся в следующем месяце?';
    v_opts := array['У Дамира дома','Кафе «Дастархан»','Ресторан «Алаша»'];
  end if;

  delete from public.kassas where owner_id = v_uid and is_demo;

  insert into public.kassas (code, title, owner_id, share_pair, share_single, start_month, target_size, status, drawn_at, is_demo)
  values (public._gen_code(), v_title, v_uid, 50000, 30000, v_start, 6, 'drawn', now(), true)
  returning id into k;

  for i in 1..6 loop
    insert into public.seats (kassa_id, name, kind, names, position)
    values (k, v_seats[i][1], v_seats[i][2],
            case when v_seats[i][2] = 'pair' then array[v_seats[i][3], v_seats[i][4]] else array[v_seats[i][3]] end,
            i - 1)
    returning id into v_id;
    s := s || v_id;
    insert into public.meetings (kassa_id, round, idx, holder_seat_id, month)
    values (k, 1, i - 1, v_id, (v_start + make_interval(months => i - 1))::date)
    returning id into v_id;
    m := m || v_id;
  end loop;

  insert into public.members (kassa_id, user_id, seat_id, person_idx) values (k, v_uid, s[2], 0);

  update public.meetings set meet_date = (v_start + 20)::date, meet_time = '19:00', place = v_place_prev,
    bill = 180000, bill_split = 'person', bill_people = 10, closed_at = now() - interval '10 days'
  where id = m[1];
  insert into public.payments (meeting_id, seat_id, method, amount)
  select m[1], s[j], case when j = 2 then 'kaspi' else 'cash' end, case when j in (3, 5) then 30000 else 50000 end
  from generate_series(2, 6) j;

  update public.meetings set meet_date = (current_date + 3), meet_time = '19:00', place = v_place_cur
  where id = m[2];
  insert into public.payments (meeting_id, seat_id, method, amount) values
    (m[2], s[1], 'cash', 50000), (m[2], s[3], 'kaspi', 30000), (m[2], s[4], 'cash', 50000);

  insert into public.polls (kassa_id, question, multi, created_by_seat)
  values (k, v_q, false, s[4]) returning id into p;
  for i in 1..3 loop
    insert into public.poll_options (poll_id, text, ord) values (p, v_opts[i], i) returning id into v_id;
    o := o || v_id;
  end loop;
  insert into public.poll_votes (poll_id, option_id, seat_id) values (p, o[1], s[4]), (p, o[2], s[1]), (p, o[1], s[3]);

  return k;
end $$;

revoke execute on function public.start_demo(text) from public, anon;
grant execute on function public.start_demo(text) to authenticated;
