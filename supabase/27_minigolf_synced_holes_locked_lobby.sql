-- ============================================================
-- TALK CÙNG LÂM DZ
-- SQL 27: MINI GOLF ĐỒNG BỘ HỐ + KHÓA PHÒNG KHI ĐANG CHƠI
--
-- Chạy MỘT LẦN sau SQL 26.
-- File có thể chạy lại an toàn.
--
-- Thay đổi chính:
-- - Một người vào lỗ sẽ chờ; cả phòng chỉ sang hố khi mọi người xong.
-- - Người hết 60 giây tự nhận 12 gậy để phòng không bị kẹt.
-- - Phòng chờ giữ nguyên người chơi và bị khóa trong lúc thi đấu.
-- - Chủ phòng không cần Sẵn sàng; có thể chơi một mình.
-- ============================================================

begin;

do $$
declare
  first_install boolean;
begin
  select not exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mini_golf_match_players'
      and column_name = 'hole_completed'
  )
  into first_install;

  alter table public.mini_golf_match_players
    add column if not exists hole_completed boolean not null default false;

  -- Chỉ ở lần cài đầu: hủy trận kiểu cũ để không trộn tiến độ
  -- mỗi người một hố với luật đồng bộ mới. Run lại SQL 27 sẽ
  -- không làm gián đoạn một trận đã dùng luật mới.
  if first_install then
    update public.mini_golf_matches
    set
      status = 'cancelled',
      finished_at = coalesce(finished_at, now())
    where status = 'playing';

    update public.game_channel_states
    set
      status = 'waiting',
      updated_at = now()
    where game_key = 'mini-golf'
      and status = 'playing';

    update public.game_channel_players p
    set
      is_ready = false,
      last_seen_at = now()
    where exists(
      select 1
      from public.game_channel_states s
      where s.channel_id = p.channel_id
        and s.game_key = 'mini-golf'
    );
  end if;
end
$$;

-- Không xóa người mất heartbeat khi trận đang chạy: phòng chờ phải
-- giữ nguyên danh sách đã được chốt lúc chủ phòng bấm Bắt đầu.
create or replace function public.normalize_game_channel_lobby(
  p_channel_id uuid
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  next_host_id uuid;
  room_status text;
begin
  select s.status
  into room_status
  from public.game_channel_states s
  where s.channel_id = p_channel_id;

  update public.game_channel_invites
  set
    status = 'expired',
    responded_at = now()
  where channel_id = p_channel_id
    and status = 'pending'
    and expires_at <= now();

  if coalesce(room_status, 'waiting') <> 'playing' then
    delete from public.game_channel_players
    where channel_id = p_channel_id
      and last_seen_at <= now() - interval '2 minutes';
  end if;

  if exists(
    select 1
    from public.game_channel_players
    where channel_id = p_channel_id
  ) and not exists(
    select 1
    from public.game_channel_players
    where channel_id = p_channel_id
      and seat_index = 0
  ) then
    select p.user_id
    into next_host_id
    from public.game_channel_players p
    where p.channel_id = p_channel_id
    order by p.seat_index asc, p.joined_at asc
    limit 1;

    update public.game_channel_players
    set seat_index = 0
    where channel_id = p_channel_id
      and user_id = next_host_id;
  end if;
end;
$$;

drop function if exists public.get_game_channel_players(uuid);

create function public.get_game_channel_players(
  p_channel_id uuid
)
returns table(
  id uuid,
  username text,
  avatar_url text,
  public_id bigint,
  role text,
  is_ready boolean,
  joined_at timestamptz,
  seat_index integer
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.channel_can_view(p_channel_id, auth.uid()) then
    raise exception 'Bạn không có quyền xem kênh game này.'
      using errcode = '42501';
  end if;

  return query
  select
    p.user_id,
    coalesce(pr.username, 'Người chơi'),
    pr.avatar_url,
    pr.public_id,
    coalesce(ur.role, 'member'),
    p.is_ready,
    p.joined_at,
    p.seat_index
  from public.game_channel_players p
  join public.profiles pr on pr.id = p.user_id
  left join public.user_roles ur on ur.user_id = p.user_id
  left join public.game_channel_states s on s.channel_id = p.channel_id
  where p.channel_id = p_channel_id
    and (
      s.status = 'playing'
      or p.last_seen_at > now() - interval '2 minutes'
    )
  order by p.seat_index asc;
end;
$$;

create or replace function public.get_server_game_summaries(
  p_server_id uuid
)
returns table(
  channel_id uuid,
  game_key text,
  game_name text,
  game_icon text,
  max_players integer,
  player_count bigint,
  status text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.server_is_member(p_server_id, auth.uid())
    and public.channel_current_role(auth.uid()) <> 'admin' then
    raise exception 'Bạn chưa tham gia server này.'
      using errcode = '42501';
  end if;

  return query
  select
    c.id,
    s.game_key,
    g.name,
    g.icon,
    g.max_players,
    (
      select count(*)
      from public.game_channel_players p
      where p.channel_id = c.id
        and (
          s.status = 'playing'
          or p.last_seen_at > now() - interval '2 minutes'
        )
    ),
    coalesce(s.status, 'waiting')
  from public.channels c
  left join public.game_channel_states s
    on s.channel_id = c.id
  left join public.game_catalog g
    on g.game_key = s.game_key
  where c.server_id = p_server_id
    and c.channel_type = 'game'
  order by c.created_at asc;
end;
$$;

-- Không cho đổi game trong lúc phòng đã khóa.
create or replace function public.set_game_channel_game(
  p_channel_id uuid,
  p_game_key text
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  target_server_id uuid;
  target_channel_type text;
  room_status text;
  clean_game_key text := nullif(trim(coalesce(p_game_key, '')), '');
begin
  select c.server_id, c.channel_type
  into target_server_id, target_channel_type
  from public.channels c
  where c.id = p_channel_id;

  if target_channel_type is distinct from 'game' then
    raise exception 'Đây không phải kênh game.';
  end if;

  if target_server_id is null
    or not public.server_can_manage(target_server_id, auth.uid()) then
    raise exception 'Bạn không có quyền chọn game cho kênh này.'
      using errcode = '42501';
  end if;

  select s.status
  into room_status
  from public.game_channel_states s
  where s.channel_id = p_channel_id
  for update;

  if room_status = 'playing' then
    raise exception 'Phòng đang thi đấu nên chưa thể đổi game.';
  end if;

  if clean_game_key is not null and not exists(
    select 1
    from public.game_catalog g
    where g.game_key = clean_game_key
      and g.is_active
  ) then
    raise exception 'Game không tồn tại hoặc đang tạm ẩn.';
  end if;

  insert into public.game_channel_states(
    channel_id, game_key, status, updated_by, updated_at
  )
  values(
    p_channel_id, clean_game_key, 'waiting', auth.uid(), now()
  )
  on conflict (channel_id) do update
  set
    game_key = excluded.game_key,
    status = 'waiting',
    updated_by = auth.uid(),
    updated_at = now();

  delete from public.game_channel_players
  where channel_id = p_channel_id;

  return true;
end;
$$;

create or replace function public.join_game_channel(
  p_channel_id uuid,
  p_seat_index integer default null
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  maximum_players integer;
  target_seat integer;
  current_count integer;
  room_status text;
begin
  if not public.channel_can_view(p_channel_id, auth.uid()) then
    raise exception 'Bạn không có quyền vào kênh game này.'
      using errcode = '42501';
  end if;

  select s.status, g.max_players
  into room_status, maximum_players
  from public.game_channel_states s
  join public.game_catalog g on g.game_key = s.game_key
  join public.channels c on c.id = s.channel_id
  where s.channel_id = p_channel_id
    and c.channel_type = 'game'
    and g.is_active
  for update of s;

  if room_status = 'playing' then
    raise exception 'Trận đang diễn ra. Phòng chờ đã bị khóa.';
  end if;

  if maximum_players is null then
    raise exception 'Kênh chưa chọn game.';
  end if;

  perform public.normalize_game_channel_lobby(p_channel_id);

  if exists(
    select 1
    from public.game_channel_players
    where channel_id = p_channel_id
      and user_id = auth.uid()
  ) then
    update public.game_channel_players
    set last_seen_at = now()
    where channel_id = p_channel_id
      and user_id = auth.uid();
    return true;
  end if;

  select count(*)
  into current_count
  from public.game_channel_players
  where channel_id = p_channel_id;

  if current_count >= maximum_players then
    raise exception 'Phòng game đã đủ người.';
  end if;

  if current_count = 0 then
    target_seat := 0;
  elsif p_seat_index is not null then
    target_seat := p_seat_index;
  else
    select seat_number
    into target_seat
    from generate_series(0, maximum_players - 1) seat_number
    where not exists(
      select 1
      from public.game_channel_players p
      where p.channel_id = p_channel_id
        and p.seat_index = seat_number
    )
      and not exists(
        select 1
        from public.game_channel_invites i
        where i.channel_id = p_channel_id
          and i.seat_index = seat_number
          and i.status = 'pending'
          and i.expires_at > now()
      )
    order by seat_number
    limit 1;
  end if;

  if target_seat is null
    or target_seat < 0
    or target_seat >= maximum_players then
    raise exception 'Vị trí chờ không hợp lệ.';
  end if;

  if exists(
    select 1
    from public.game_channel_players
    where channel_id = p_channel_id
      and seat_index = target_seat
  ) or exists(
    select 1
    from public.game_channel_invites
    where channel_id = p_channel_id
      and seat_index = target_seat
      and status = 'pending'
      and expires_at > now()
  ) then
    raise exception 'Ô chờ này đã có người hoặc đã được giữ chỗ.';
  end if;

  insert into public.game_channel_players(
    channel_id, user_id, seat_index,
    is_ready, joined_at, last_seen_at
  )
  values(
    p_channel_id, auth.uid(), target_seat,
    false, now(), now()
  );

  update public.game_channel_invites
  set
    status = 'cancelled',
    responded_at = now()
  where channel_id = p_channel_id
    and invitee_id = auth.uid()
    and status = 'pending';

  return true;
end;
$$;

create or replace function public.move_game_channel_seat(
  p_channel_id uuid,
  p_seat_index integer
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  maximum_players integer;
  current_seat integer;
  room_status text;
begin
  select s.status, g.max_players
  into room_status, maximum_players
  from public.game_channel_states s
  join public.game_catalog g on g.game_key = s.game_key
  where s.channel_id = p_channel_id
  for update of s;

  if room_status = 'playing' then
    raise exception 'Trận đang diễn ra. Không thể đổi vị trí.';
  end if;

  perform public.normalize_game_channel_lobby(p_channel_id);

  select p.seat_index
  into current_seat
  from public.game_channel_players p
  where p.channel_id = p_channel_id
    and p.user_id = auth.uid()
  for update;

  if current_seat is null then
    raise exception 'Bạn chưa tham gia phòng game.';
  end if;

  if current_seat = 0 then
    raise exception 'Chủ phòng phải ở ô số 1. Hãy rời phòng để chuyển chủ.';
  end if;

  if p_seat_index <= 0 or p_seat_index >= maximum_players then
    raise exception 'Vị trí chờ không hợp lệ.';
  end if;

  if exists(
    select 1
    from public.game_channel_players
    where channel_id = p_channel_id
      and seat_index = p_seat_index
  ) or exists(
    select 1
    from public.game_channel_invites
    where channel_id = p_channel_id
      and seat_index = p_seat_index
      and status = 'pending'
      and expires_at > now()
  ) then
    raise exception 'Ô chờ này đã có người hoặc đã được giữ chỗ.';
  end if;

  update public.game_channel_players
  set
    seat_index = p_seat_index,
    last_seen_at = now()
  where channel_id = p_channel_id
    and user_id = auth.uid();

  return true;
end;
$$;

create or replace function public.invite_friend_to_game_channel(
  p_channel_id uuid,
  p_friend_id uuid,
  p_seat_index integer
)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  maximum_players integer;
  target_server_id uuid;
  target_seat integer := p_seat_index;
  new_invite_id bigint;
  current_count integer;
  room_status text;
begin
  if not public.channel_can_view(p_channel_id, auth.uid()) then
    raise exception 'Bạn không có quyền mời người vào kênh game này.'
      using errcode = '42501';
  end if;

  select c.server_id, g.max_players, s.status
  into target_server_id, maximum_players, room_status
  from public.channels c
  join public.game_channel_states s on s.channel_id = c.id
  join public.game_catalog g on g.game_key = s.game_key
  where c.id = p_channel_id
    and c.channel_type = 'game'
  for update of s;

  if room_status = 'playing' then
    raise exception 'Trận đang diễn ra. Không thể mời thêm người.';
  end if;

  if maximum_players is null then
    raise exception 'Kênh chưa chọn game.';
  end if;

  perform public.normalize_game_channel_lobby(p_channel_id);

  if not exists(
    select 1
    from public.game_channel_players
    where channel_id = p_channel_id
      and user_id = auth.uid()
  ) then
    raise exception 'Bạn phải ở trong phòng chờ mới có thể mời bạn.';
  end if;

  if not exists(
    select 1
    from public.friendships
    where user_id = auth.uid()
      and friend_id = p_friend_id
  ) then
    raise exception 'Bạn chỉ có thể mời người trong danh sách bạn bè.';
  end if;

  if not exists(
    select 1
    from public.server_members
    where server_id = target_server_id
      and user_id = p_friend_id
  ) then
    raise exception 'Người bạn này chưa tham gia server.';
  end if;

  if exists(
    select 1
    from public.game_channel_players
    where channel_id = p_channel_id
      and user_id = p_friend_id
  ) then
    raise exception 'Người bạn này đã ở trong phòng chờ.';
  end if;

  select count(*)
  into current_count
  from public.game_channel_players
  where channel_id = p_channel_id;

  if current_count = 0 then
    target_seat := 0;
  end if;

  if target_seat < 0 or target_seat >= maximum_players then
    raise exception 'Vị trí chờ không hợp lệ.';
  end if;

  if exists(
    select 1
    from public.game_channel_players
    where channel_id = p_channel_id
      and seat_index = target_seat
  ) or exists(
    select 1
    from public.game_channel_invites
    where channel_id = p_channel_id
      and seat_index = target_seat
      and status = 'pending'
      and expires_at > now()
  ) then
    raise exception 'Ô chờ này đã có người hoặc đã được giữ chỗ.';
  end if;

  update public.game_channel_invites
  set
    status = 'cancelled',
    responded_at = now()
  where channel_id = p_channel_id
    and invitee_id = p_friend_id
    and status = 'pending';

  insert into public.game_channel_invites(
    channel_id, seat_index, inviter_id, invitee_id
  )
  values(
    p_channel_id, target_seat, auth.uid(), p_friend_id
  )
  returning id into new_invite_id;

  return new_invite_id;
end;
$$;

create or replace function public.respond_game_channel_invite(
  p_invite_id bigint,
  p_accept boolean
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  target_invite public.game_channel_invites%rowtype;
  maximum_players integer;
  current_count integer;
  target_seat integer;
  room_status text;
begin
  select i.*
  into target_invite
  from public.game_channel_invites i
  where i.id = p_invite_id
    and i.invitee_id = auth.uid()
    and i.status = 'pending'
  for update;

  if target_invite.id is null then
    raise exception 'Lời mời không còn hiệu lực.';
  end if;

  if target_invite.expires_at <= now() then
    update public.game_channel_invites
    set status = 'expired', responded_at = now()
    where id = p_invite_id;
    raise exception 'Lời mời đã hết hạn.';
  end if;

  if not coalesce(p_accept, false) then
    update public.game_channel_invites
    set status = 'declined', responded_at = now()
    where id = p_invite_id;
    return true;
  end if;

  select s.status, g.max_players
  into room_status, maximum_players
  from public.game_channel_states s
  join public.game_catalog g on g.game_key = s.game_key
  where s.channel_id = target_invite.channel_id
  for update of s;

  if room_status = 'playing' then
    update public.game_channel_invites
    set status = 'cancelled', responded_at = now()
    where id = p_invite_id;
    raise exception 'Trận đã bắt đầu nên lời mời không còn hiệu lực.';
  end if;

  perform public.normalize_game_channel_lobby(
    target_invite.channel_id
  );

  select count(*)
  into current_count
  from public.game_channel_players
  where channel_id = target_invite.channel_id;

  target_seat := case
    when current_count = 0 then 0
    else target_invite.seat_index
  end;

  if current_count >= maximum_players then
    raise exception 'Phòng game đã đủ người.';
  end if;

  if exists(
    select 1
    from public.game_channel_players
    where channel_id = target_invite.channel_id
      and seat_index = target_seat
  ) then
    raise exception 'Ô chờ được mời đã có người.';
  end if;

  insert into public.game_channel_players(
    channel_id, user_id, seat_index,
    is_ready, joined_at, last_seen_at
  )
  values(
    target_invite.channel_id, auth.uid(), target_seat,
    false, now(), now()
  )
  on conflict (channel_id, user_id) do update
  set
    seat_index = excluded.seat_index,
    last_seen_at = now();

  update public.game_channel_invites
  set
    status = case
      when id = p_invite_id then 'accepted'
      else 'cancelled'
    end,
    responded_at = now()
  where channel_id = target_invite.channel_id
    and status = 'pending'
    and (
      invitee_id = auth.uid()
      or seat_index = target_seat
    );

  return true;
end;
$$;

create or replace function public.leave_game_channel(
  p_channel_id uuid
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  leaving_seat integer;
  next_host_id uuid;
  room_status text;
begin
  select s.status
  into room_status
  from public.game_channel_states s
  where s.channel_id = p_channel_id
  for update;

  if room_status = 'playing' then
    raise exception 'Trận đang diễn ra. Phòng chờ đã bị khóa.';
  end if;

  select p.seat_index
  into leaving_seat
  from public.game_channel_players p
  where p.channel_id = p_channel_id
    and p.user_id = auth.uid();

  delete from public.game_channel_players
  where channel_id = p_channel_id
    and user_id = auth.uid();

  if leaving_seat = 0 then
    select p.user_id
    into next_host_id
    from public.game_channel_players p
    where p.channel_id = p_channel_id
    order by p.seat_index asc, p.joined_at asc
    limit 1;

    if next_host_id is not null then
      update public.game_channel_players
      set seat_index = 0
      where channel_id = p_channel_id
        and user_id = next_host_id;
    end if;
  end if;

  update public.game_channel_invites
  set
    status = 'cancelled',
    responded_at = now()
  where channel_id = p_channel_id
    and inviter_id = auth.uid()
    and status = 'pending';

  return true;
end;
$$;

create or replace function public.set_game_player_ready(
  p_channel_id uuid,
  p_is_ready boolean
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  current_seat integer;
  room_status text;
begin
  select s.status
  into room_status
  from public.game_channel_states s
  where s.channel_id = p_channel_id
  for update;

  if room_status = 'playing' then
    raise exception 'Trận đang diễn ra. Không thể đổi trạng thái.';
  end if;

  select p.seat_index
  into current_seat
  from public.game_channel_players p
  where p.channel_id = p_channel_id
    and p.user_id = auth.uid();

  if current_seat is null then
    raise exception 'Bạn chưa tham gia phòng game.';
  end if;

  if current_seat = 0 then
    raise exception 'Chủ phòng không cần bấm Sẵn sàng.';
  end if;

  update public.game_channel_players
  set
    is_ready = coalesce(p_is_ready, false),
    last_seen_at = now()
  where channel_id = p_channel_id
    and user_id = auth.uid();

  return true;
end;
$$;

create or replace function public.start_game_channel(
  p_channel_id uuid
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  player_count integer;
  not_ready_count integer;
  room_status text;
begin
  select s.status
  into room_status
  from public.game_channel_states s
  where s.channel_id = p_channel_id
    and s.game_key is not null
  for update;

  if room_status is null then
    raise exception 'Kênh chưa chọn game.';
  end if;

  if room_status = 'playing' then
    raise exception 'Trận đấu đã bắt đầu.';
  end if;

  update public.game_channel_players
  set last_seen_at = now()
  where channel_id = p_channel_id
    and user_id = auth.uid();

  perform public.normalize_game_channel_lobby(p_channel_id);

  if not exists(
    select 1
    from public.game_channel_players
    where channel_id = p_channel_id
      and user_id = auth.uid()
      and seat_index = 0
  ) then
    raise exception 'Chỉ chủ phòng ở ô số 1 mới được bắt đầu.';
  end if;

  select
    count(*),
    count(*) filter (
      where seat_index <> 0 and not is_ready
    )
  into player_count, not_ready_count
  from public.game_channel_players
  where channel_id = p_channel_id;

  if player_count < 1 then
    raise exception 'Phòng chưa có người chơi.';
  end if;

  if not_ready_count > 0 then
    raise exception 'Tất cả người chơi khác phải sẵn sàng.';
  end if;

  -- Chủ phòng được xem là sẵn sàng tự động.
  update public.game_channel_players
  set
    is_ready = true,
    last_seen_at = now()
  where channel_id = p_channel_id
    and user_id = auth.uid();

  update public.game_channel_invites
  set
    status = 'cancelled',
    responded_at = now()
  where channel_id = p_channel_id
    and status = 'pending';

  update public.game_channel_states
  set
    status = 'playing',
    updated_by = auth.uid(),
    updated_at = now()
  where channel_id = p_channel_id;

  return true;
end;
$$;

-- Tạo trận mới từ danh sách phòng chờ đã khóa.
create or replace function public.create_minigolf_match_on_start()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  new_match_id uuid;
begin
  if new.status = 'playing'
    and old.status is distinct from 'playing'
    and new.game_key = 'mini-golf' then

    update public.mini_golf_matches
    set
      status = 'cancelled',
      finished_at = coalesce(finished_at, now())
    where channel_id = new.channel_id
      and status = 'playing';

    insert into public.mini_golf_matches(
      channel_id, status, hole_count, started_by
    )
    values(
      new.channel_id, 'playing', 9, new.updated_by
    )
    returning id into new_match_id;

    insert into public.mini_golf_match_players(
      match_id, user_id, seat_index,
      current_hole, hole_strokes, total_strokes,
      hole_scores, hole_completed, player_status,
      hole_started_at
    )
    select
      new_match_id,
      p.user_id,
      p.seat_index,
      1,
      0,
      0,
      '{}'::integer[],
      false,
      'playing',
      now()
    from public.game_channel_players p
    where p.channel_id = new.channel_id
    order by p.seat_index asc
    limit 16;
  end if;

  return new;
end;
$$;

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

  update public.mini_golf_matches
  set
    status = 'finished',
    finished_at = coalesce(finished_at, now())
  where id = p_match_id
    and status = 'playing'
  returning channel_id into target_channel_id;

  if target_channel_id is not null then
    update public.game_channel_states
    set
      status = 'waiting',
      updated_at = now()
    where channel_id = target_channel_id
      and game_key = 'mini-golf';

    update public.game_channel_players
    set
      is_ready = false,
      last_seen_at = now()
    where channel_id = target_channel_id;
  end if;
end;
$$;

-- Chỉ khi tất cả người đang chơi hoàn thành hố, toàn phòng mới
-- được chuyển cùng lúc sang hố kế tiếp.
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

  -- Trình duyệt có thể bị đóng. Khi quá 60 giây, máy chủ tự chốt
  -- hố 12 gậy trong lần đồng bộ tiếp theo để cả phòng không kẹt.
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
    and hole_started_at <= now() - interval '60 seconds';

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

drop function if exists public.get_minigolf_players(uuid);

create function public.get_minigolf_players(
  p_channel_id uuid
)
returns table(
  match_id uuid,
  id uuid,
  username text,
  avatar_url text,
  public_id bigint,
  role text,
  seat_index integer,
  current_hole integer,
  hole_strokes integer,
  total_strokes integer,
  hole_scores integer[],
  ball_x double precision,
  ball_y double precision,
  hole_started_at timestamptz,
  hole_completed boolean,
  player_status text,
  finished_at timestamptz,
  rank_position bigint
)
language plpgsql security definer set search_path = ''
as $$
declare
  target_match_id uuid;
begin
  if not public.channel_can_view(p_channel_id, auth.uid()) then
    raise exception 'Bạn không có quyền xem bảng điểm Mini Golf.'
      using errcode = '42501';
  end if;

  select m.id
  into target_match_id
  from public.mini_golf_matches m
  where m.channel_id = p_channel_id
  order by
    case when m.status = 'playing' then 0 else 1 end,
    m.created_at desc
  limit 1;

  if target_match_id is null then
    return;
  end if;

  perform public.advance_minigolf_hole_if_ready(target_match_id);

  return query
  with ranked as (
    select
      p.*,
      row_number() over (
        order by
          case p.player_status
            when 'finished' then 0
            when 'playing' then 1
            else 2
          end,
          case
            when p.player_status = 'finished'
              then p.total_strokes
            else 999999
          end asc,
          p.current_hole desc,
          p.total_strokes asc,
          p.finished_at asc nulls last,
          p.seat_index asc
      ) as calculated_rank
    from public.mini_golf_match_players p
    where p.match_id = target_match_id
  )
  select
    r.match_id,
    r.user_id,
    coalesce(pr.username, 'Người chơi'),
    pr.avatar_url,
    pr.public_id,
    coalesce(ur.role, 'member'),
    r.seat_index,
    r.current_hole,
    r.hole_strokes,
    r.total_strokes,
    r.hole_scores,
    r.ball_x,
    r.ball_y,
    r.hole_started_at,
    r.hole_completed,
    r.player_status,
    r.finished_at,
    r.calculated_rank
  from ranked r
  join public.profiles pr on pr.id = r.user_id
  left join public.user_roles ur on ur.user_id = r.user_id
  order by r.calculated_rank asc;
end;
$$;

create or replace function public.record_minigolf_shot(
  p_channel_id uuid,
  p_ball_x double precision,
  p_ball_y double precision,
  p_holed boolean,
  p_penalty boolean default false
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  target_match public.mini_golf_matches%rowtype;
  target_player public.mini_golf_match_players%rowtype;
  stroke_delta integer;
  next_hole_strokes integer;
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

  if p_ball_x is null or p_ball_y is null
    or p_ball_x < 0 or p_ball_x > 1
    or p_ball_y < 0 or p_ball_y > 1 then
    raise exception 'Vị trí bóng không hợp lệ.';
  end if;

  stroke_delta := case when p_penalty then 2 else 1 end;
  stroke_delta := least(
    stroke_delta,
    greatest(0, 12 - target_player.hole_strokes)
  );

  if stroke_delta <= 0 then
    raise exception 'Hố này đã đạt giới hạn 12 gậy.';
  end if;

  next_hole_strokes :=
    target_player.hole_strokes + stroke_delta;

  if coalesce(p_holed, false)
    or next_hole_strokes >= 12 then
    update public.mini_golf_match_players
    set
      hole_strokes = least(next_hole_strokes, 12),
      total_strokes = total_strokes + stroke_delta,
      hole_scores = array_append(
        hole_scores,
        least(next_hole_strokes, 12)
      ),
      ball_x = p_ball_x,
      ball_y = p_ball_y,
      hole_completed = true,
      updated_at = now()
    where match_id = target_match.id
      and user_id = auth.uid();
  else
    update public.mini_golf_match_players
    set
      hole_strokes = next_hole_strokes,
      total_strokes = total_strokes + stroke_delta,
      ball_x = p_ball_x,
      ball_y = p_ball_y,
      updated_at = now()
    where match_id = target_match.id
      and user_id = auth.uid();
  end if;

  perform public.advance_minigolf_hole_if_ready(target_match.id);
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
    now() - interval '60 seconds' then
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

create or replace function public.mark_minigolf_player_dnf_on_leave()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  target_match_id uuid;
begin
  select m.id
  into target_match_id
  from public.mini_golf_matches m
  where m.channel_id = old.channel_id
    and m.status = 'playing'
  order by m.created_at desc
  limit 1;

  if target_match_id is not null then
    update public.mini_golf_match_players
    set
      player_status = 'dnf',
      finished_at = now(),
      updated_at = now()
    where match_id = target_match_id
      and user_id = old.user_id
      and player_status = 'playing';

    perform public.advance_minigolf_hole_if_ready(target_match_id);
  end if;

  return old;
end;
$$;

revoke all on function public.advance_minigolf_hole_if_ready(uuid)
from public;
revoke all on function public.get_game_channel_players(uuid)
from public;
revoke all on function public.get_server_game_summaries(uuid)
from public;
revoke all on function public.get_minigolf_players(uuid)
from public;

grant execute on function public.get_game_channel_players(uuid)
to authenticated;
grant execute on function public.get_server_game_summaries(uuid)
to authenticated;
grant execute on function public.get_minigolf_players(uuid)
to authenticated;

grant execute on function public.set_game_channel_game(uuid,text)
to authenticated;
grant execute on function public.join_game_channel(uuid,integer)
to authenticated;
grant execute on function public.move_game_channel_seat(uuid,integer)
to authenticated;
grant execute on function public.invite_friend_to_game_channel(
  uuid,uuid,integer
) to authenticated;
grant execute on function public.respond_game_channel_invite(bigint,boolean)
to authenticated;
grant execute on function public.leave_game_channel(uuid)
to authenticated;
grant execute on function public.set_game_player_ready(uuid,boolean)
to authenticated;
grant execute on function public.start_game_channel(uuid)
to authenticated;
grant execute on function public.record_minigolf_shot(
  uuid,double precision,double precision,boolean,boolean
) to authenticated;
grant execute on function public.skip_minigolf_hole(uuid)
to authenticated;

notify pgrst, 'reload schema';

commit;
