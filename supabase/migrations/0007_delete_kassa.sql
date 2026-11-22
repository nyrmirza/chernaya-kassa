-- Организатор может удалить кассу целиком, даже если в ней уже есть участники.
-- Участникам (кроме организатора) приходит push: «Касса удалена организатором».
-- Все связанные данные (места, встречи, взносы, опросы) удаляются каскадно.

create or replace function public.delete_kassa(p_kassa uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k public.kassas := public._owned_kassa(p_kassa); v_msgs jsonb;
begin
  if not k.is_demo then
    select jsonb_agg(jsonb_build_object(
      'to', t.token, 'sound', 'default', 'channelId', 'kassa', 'title', k.title,
      'body', case t.lang
        when 'kk' then 'Ұйымдастырушы кассаны өшірді.'
        when 'en' then 'The organizer deleted this kassa.'
        else 'Организатор удалил кассу.' end,
      'data', jsonb_build_object('kind', 'deleted')))
    into v_msgs
    from public.members mb
    join public.push_tokens t on t.user_id = mb.user_id
    where mb.kassa_id = p_kassa and mb.user_id <> k.owner_id;
  end if;

  delete from public.kassas where id = p_kassa;
  perform public._push_send(v_msgs);
end $$;

revoke execute on function public.delete_kassa(uuid) from public, anon;
grant execute on function public.delete_kassa(uuid) to authenticated;
