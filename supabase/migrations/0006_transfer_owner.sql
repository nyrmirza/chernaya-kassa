-- Передать роль организатора другому участнику (только тому, кто вошёл в приложение).
create or replace function public.transfer_owner(p_kassa uuid, p_seat uuid, p_person smallint default 0) returns void
language plpgsql security definer set search_path = public as $$
declare k public.kassas := public._owned_kassa(p_kassa); v_new uuid; v_name text; v_msgs jsonb;
begin
  select mb.user_id, coalesce(s.names[mb.person_idx + 1], s.name) into v_new, v_name
  from public.members mb join public.seats s on s.id = mb.seat_id
  where mb.kassa_id = p_kassa and mb.seat_id = p_seat and mb.person_idx = coalesce(p_person, 0) and s.removed_at is null;
  if v_new is null then raise exception 'NOT_A_MEMBER'; end if;
  if v_new = k.owner_id then return; end if;

  update public.kassas set owner_id = v_new where id = p_kassa;

  if not k.is_demo then
    select jsonb_agg(jsonb_build_object(
      'to', t.token, 'sound', 'default', 'channelId', 'kassa', 'title', k.title,
      'body', case t.lang
        when 'kk' then 'Сіз енді кассаның ұйымдастырушысысыз: жеребе, кезек және құрам сізде.'
        when 'en' then 'You are now the organizer of this kassa: the draw, queue and members are in your hands.'
        else 'Теперь вы организатор кассы: жеребьёвка, очередь и состав — на вас.' end,
      'data', jsonb_build_object('kind', 'owner', 'kassa', k.id)))
    into v_msgs from public.push_tokens t where t.user_id = v_new;
    perform public._push_send(v_msgs);
  end if;
end $$;

revoke execute on function public.transfer_owner(uuid, uuid, smallint) from public, anon;
grant execute on function public.transfer_owner(uuid, uuid, smallint) to authenticated;
