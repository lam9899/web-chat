-- Talk Cung Lam DZ - Mini Golf v10
-- Chạy sau file 27_minigolf_synced_holes_locked_lobby.sql.
-- Nâng thời gian mỗi hố lên 120 giây và cho chủ phòng dừng trận.

begin;

create or replace function public.advance_minigolf_hole_if_ready(
  p_match_id uuid
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  target_match public.mini_golf_matches%rowtype;
  shared_hole integer;
  active_count integer;
  unfinished_count integer;
begin
  select m.*
  into target_match
  from public.mini_golf_matches m
  where m.id = p_match_id
  for update;

  if target_match.id is null
    or target_match.status <> 'playing' then
    return false;
  end if;

  -- Sau 120 giây, máy chủ chốt hố 12 gậy để cả phòng
  -- không bị kẹt nếu một người đóng trình duyệt.
  update public.mini_golf_match_players
  set
    total_strokes =
      total_strokes + greatest(0, 12 - hole_strokes),
    hole_strokes = 12,
    hole_scores = array_append(hole_scores, 12),
    hole_completed = true,
    updated_at = now()
  where match_id = p_match_id
    and player_status = 'playing'
    and not hole_completed
    and hole_started_at <= now() - interval '120 seconds';

  select
    count(*),
    min(p.current_hole),
    count(*) filter (where not p.hole_completed)
  into active_count, shared_hole, unfinished_count
  from public.mini_golf_match_players p
  where p.match_id = p_match_id
    and p.player_status = 'playing';

  if active_count = 0 then
    perform public.finish_minigolf_match_if_done(p_match_id);
    return true;
  end if;

  if unfinished_count > 0 then
    return false;
  end if;

  if shared_hole >= target_match.hole_count then
    update public.mini_golf_match_players
    set
      player_status = 'finished',
      finished_at = coalesce(finished_at, now()),
      updated_at = now()
    where match_id = p_match_id
      and player_status = 'playing';

    perform public.finish_minigolf_match_if_done(p_match_id);
    return true;
  end if;

  update public.mini_golf_match_players
  set
    current_hole = shared_hole + 1,
    hole_strokes = 0,
    ball_x = null,
    ball_y = null,
    hole_started_at = now(),
    hole_completed = false,
    updated_at = now()
  where match_id = p_match_id
    and player_status = 'playing';

  return true;
end;
$$;

create or replace function public.skip_minigolf_hole(
  p_channel_id uuid
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  target_match public.mini_golf_matches%rowtype;
  target_player public.mini_golf_match_players%rowtype;
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
    raise exception 'Trận Mini Golf chưa bắt đầu hoặc đã kết thúc.';
  end if;

  select p.*
  into target_player
  from public.mini_golf_match_players p
  where p.match_id = target_match.id
    and p.user_id = auth.uid()
  for update;

  if target_player.user_id is null
    or target_player.player_status <> 'playing' then
    raise exception 'Bạn không ở trong trận Mini Golf này.'
      using errcode = '42501';
  end if;

  if target_player.hole_completed then
    perform public.advance_minigolf_hole_if_ready(target_match.id);
    return true;
  end if;

  if target_player.hole_started_at >
    now() - interval '120 seconds' then
    raise exception 'Hố này vẫn còn thời gian.';
  end if;

  update public.mini_golf_match_players
  set
    total_strokes =
      total_strokes + greatest(0, 12 - hole_strokes),
    hole_strokes = 12,
    hole_scores = array_append(hole_scores, 12),
    hole_completed = true,
    updated_at = now()
  where match_id = target_match.id
    and user_id = auth.uid();

  perform public.advance_minigolf_hole_if_ready(target_match.id);
  return true;
end;
$$;

create or replace function public.stop_game_channel(
  p_channel_id uuid
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  room_status text;
  current_seat integer;
  active_match_id uuid;
begin
  select s.status
  into room_status
  from public.game_channel_states s
  where s.channel_id = p_channel_id
  for update;

  if room_status is null then
    raise exception 'Phòng game không tồn tại.';
  end if;

  select p.seat_index
  into current_seat
  from public.game_channel_players p
  where p.channel_id = p_channel_id
    and p.user_id = auth.uid()
  for update;

  if current_seat is distinct from 0 then
    raise exception 'Chỉ chủ phòng ở ô số 1 mới được dừng game.'
      using errcode = '42501';
  end if;

  if room_status <> 'playing' then
    raise exception 'Không có trận đấu đang diễn ra.';
  end if;

  select m.id
  into active_match_id
  from public.mini_golf_matches m
  where m.channel_id = p_channel_id
    and m.status = 'playing'
  order by m.created_at desc
  limit 1
  for update;

  if active_match_id is not null then
    update public.mini_golf_match_players
    set
      player_status = 'dnf',
      finished_at = coalesce(finished_at, now()),
      updated_at = now()
    where match_id = active_match_id
      and player_status = 'playing';

    update public.mini_golf_matches
    set
      status = 'cancelled',
      finished_at = coalesce(finished_at, now())
    where id = active_match_id;
  end if;

  update public.game_channel_states
  set
    status = 'waiting',
    updated_by = auth.uid(),
    updated_at = now()
  where channel_id = p_channel_id;

  -- Giữ nguyên người và vị trí trong phòng, chỉ mở khóa và
  -- yêu cầu khách sẵn sàng lại cho trận kế tiếp.
  update public.game_channel_players
  set
    is_ready = false,
    last_seen_at = now()
  where channel_id = p_channel_id;

  return true;
end;
$$;

revoke all on function public.stop_game_channel(uuid)
from public;

grant execute on function public.stop_game_channel(uuid)
to authenticated;

notify pgrst, 'reload schema';

commit;
