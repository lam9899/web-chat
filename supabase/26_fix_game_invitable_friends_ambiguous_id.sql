-- TALK CÙNG LÂM DZ
-- SQL 26: sửa lỗi "column reference \"id\" is ambiguous"
-- trong RPC get_invitable_game_friends.
--
-- Chỉ cần chạy file này sau khi SQL 24 đã báo Success.
-- Không cần chạy lại SQL 23, 24 hoặc 25.
-- File an toàn khi bấm Run lại.

begin;

create or replace function public.get_invitable_game_friends(
  p_channel_id uuid
)
returns table(
  id uuid,
  username text,
  avatar_url text,
  public_id bigint,
  role text
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  target_server_id uuid;
begin
  if not public.channel_can_view(p_channel_id, auth.uid()) then
    raise exception 'Bạn không có quyền mời người vào kênh game này.'
      using errcode = '42501';
  end if;

  -- Phải ghi rõ c.id. Nếu chỉ viết "id", PostgreSQL sẽ không biết
  -- đó là cột channels.id hay cột đầu ra id của RETURNS TABLE.
  select c.server_id
  into target_server_id
  from public.channels c
  where c.id = p_channel_id;

  return query
  select
    pr.id,
    pr.username,
    pr.avatar_url,
    pr.public_id,
    coalesce(ur.role, 'member')
  from public.friendships f
  join public.profiles pr on pr.id = f.friend_id
  join public.server_members sm
    on sm.server_id = target_server_id
    and sm.user_id = pr.id
  left join public.user_roles ur on ur.user_id = pr.id
  where f.user_id = auth.uid()
    and not exists(
      select 1
      from public.game_channel_players gp
      where gp.channel_id = p_channel_id
        and gp.user_id = pr.id
    )
    and not exists(
      select 1
      from public.game_channel_invites gi
      where gi.channel_id = p_channel_id
        and gi.invitee_id = pr.id
        and gi.status = 'pending'
        and gi.expires_at > now()
    )
  order by pr.username asc;
end;
$$;

grant execute on function public.get_invitable_game_friends(uuid)
to authenticated;

notify pgrst, 'reload schema';

commit;
