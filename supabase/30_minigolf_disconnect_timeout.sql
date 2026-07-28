-- Talk Cung Lam DZ - Mini Golf v20
-- Chay mot lan sau 29_minigolf_persistent_lobby_reload.sql.
-- Cho phep tai lai trang trong 120 giay. Qua thoi gian nay,
-- nguoi choi bi loai khoi tran va nhan tong gay toi da.

begin;

create or replace function public.expire_disconnected_game_players(
  p_channel_id uuid
)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  target_match public.mini_golf_matches%rowtype;
  expired_user_ids uuid[];
  expired_count integer := 0;
begin
  select m.*
  into target_match
  from public.mini_golf_matches m
  where m.channel_id = p_channel_id
    and m.status = 'playing'
  order by m.created_at desc
  limit 1
  for update;

  if target_match.id is null then
    return 0;
  end if;

  select array_agg(p.user_id order by p.seat_index)
  into expired_user_ids
  from public.game_channel_players p
  join public.mini_golf_match_players mp
    on mp.match_id = target_match.id
    and mp.user_id = p.user_id
  where p.channel_id = p_channel_id
    and mp.player_status = 'playing'
    and p.last_seen_at <= now() - interval '120 seconds';

  expired_count := coalesce(cardinality(expired_user_ids), 0);
  if expired_count = 0 then
    return 0;
  end if;

  update public.mini_golf_match_players mp
  set
    current_hole = target_match.hole_count,
    hole_strokes = 12,
    total_strokes = target_match.hole_count * 12,
    hole_scores = array_fill(
      12::integer,
      array[target_match.hole_count]
    ),
    hole_completed = true,
    player_status = 'dnf',
    finished_at = coalesce(mp.finished_at, now()),
    updated_at = now()
  where mp.match_id = target_match.id
    and mp.user_id = any(expired_user_ids)
    and mp.player_status = 'playing';

  delete from public.game_channel_players p
  where p.channel_id = p_channel_id
    and p.user_id = any(expired_user_ids);

  update public.game_channel_invites i
  set
    status = 'expired',
    responded_at = now()
  where i.channel_id = p_channel_id
    and i.status = 'pending'
    and i.invitee_id = any(expired_user_ids);

  perform public.normalize_game_channel_lobby(p_channel_id);
  perform public.advance_minigolf_hole_if_ready(target_match.id);
  return expired_count;
end;
$$;

-- Luon don nguoi choi da mat ket noi truoc khi cap nhat heartbeat.
-- Neu chua qua 120 giay, hang ghe cu van con va tran duoc tiep tuc.
create or replace function public.resume_game_channel_session(
  p_channel_id uuid
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  room_status text;
begin
  if auth.uid() is null then
    raise exception 'Ban chua dang nhap.'
      using errcode = '42501';
  end if;

  if not public.channel_can_view(p_channel_id, auth.uid()) then
    raise exception 'Ban khong co quyen vao kenh game nay.'
      using errcode = '42501';
  end if;

  perform public.expire_disconnected_game_players(p_channel_id);

  select s.status
  into room_status
  from public.game_channel_states s
  join public.channels c on c.id = s.channel_id
  where s.channel_id = p_channel_id
    and c.channel_type = 'game'
  for update of s;

  if room_status is null then
    return false;
  end if;

  update public.game_channel_players p
  set last_seen_at = now()
  where p.channel_id = p_channel_id
    and p.user_id = auth.uid();

  -- Khong tao lai ghe neu nguoi choi da bi loai sau 120 giay.
  return found;
end;
$$;

create or replace function public.heartbeat_game_channel(
  p_channel_id uuid
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  return public.resume_game_channel_session(p_channel_id);
end;
$$;

-- Khi tran ket thuc, chi giu nhung nguoi van con ket noi trong phong.
-- Khong tao lai ghe cho nguoi da bi loai vi mat ket noi.
create or replace function public.finish_minigolf_match_if_done(
  p_match_id uuid
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  target_channel_id uuid;
begin
  if exists(
    select 1
    from public.mini_golf_match_players p
    where p.match_id = p_match_id
      and p.player_status = 'playing'
  ) then
    return;
  end if;

  update public.mini_golf_matches m
  set
    status = 'finished',
    finished_at = coalesce(m.finished_at, now())
  where m.id = p_match_id
    and m.status = 'playing'
  returning m.channel_id into target_channel_id;

  if target_channel_id is null then
    return;
  end if;

  update public.game_channel_states s
  set
    status = 'waiting',
    updated_at = now()
  where s.channel_id = target_channel_id
    and s.game_key = 'mini-golf';

  update public.game_channel_players p
  set is_ready = false
  where p.channel_id = target_channel_id;

  perform public.normalize_game_channel_lobby(target_channel_id);
end;
$$;

revoke all on function public.expire_disconnected_game_players(uuid)
from public;
revoke all on function public.resume_game_channel_session(uuid)
from public;
revoke all on function public.heartbeat_game_channel(uuid)
from public;

grant execute on function public.resume_game_channel_session(uuid)
to authenticated;
grant execute on function public.heartbeat_game_channel(uuid)
to authenticated;

notify pgrst, 'reload schema';

commit;
