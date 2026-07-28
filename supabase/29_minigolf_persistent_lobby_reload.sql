-- Talk Cung Lam DZ - Mini Golf v15
-- Chay mot lan sau 28_minigolf_120s_host_stop.sql.
-- Giu nguyen nguoi choi sau khi ket thuc va khoi phuc tran khi reload.

begin;

-- Nguoi choi chi roi phong khi ho chu dong bam Roi phong hoac khi
-- quan tri vien doi game. Khong xoa ghe chi vi tab bi an/reload.
create or replace function public.normalize_game_channel_lobby(
  p_channel_id uuid
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  next_host_id uuid;
begin
  update public.game_channel_invites
  set
    status = 'expired',
    responded_at = now()
  where channel_id = p_channel_id
    and status = 'pending'
    and expires_at <= now();

  if exists(
    select 1
    from public.game_channel_players p
    where p.channel_id = p_channel_id
  ) and not exists(
    select 1
    from public.game_channel_players p
    where p.channel_id = p_channel_id
      and p.seat_index = 0
  ) then
    select p.user_id
    into next_host_id
    from public.game_channel_players p
    where p.channel_id = p_channel_id
    order by p.seat_index asc, p.joined_at asc
    limit 1;

    update public.game_channel_players p
    set seat_index = 0
    where p.channel_id = p_channel_id
      and p.user_id = next_host_id;
  end if;
end;
$$;

-- Danh sach phong cho la danh sach ben vung, khong con an nguoi
-- sau hai phut. last_seen_at chi dung de biet phien vua ket noi lai.
create or replace function public.get_game_channel_players(
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
    raise exception 'Ban khong co quyen xem kenh game nay.'
      using errcode = '42501';
  end if;

  return query
  select
    p.user_id,
    coalesce(pr.username, 'Nguoi choi'),
    pr.avatar_url,
    pr.public_id,
    coalesce(ur.role, 'member'),
    p.is_ready,
    p.joined_at,
    p.seat_index
  from public.game_channel_players p
  join public.profiles pr on pr.id = p.user_id
  left join public.user_roles ur on ur.user_id = p.user_id
  where p.channel_id = p_channel_id
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
    raise exception 'Ban chua tham gia server nay.'
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

-- Khoi phuc thanh vien phong bi mat do ban SQL cu da don heartbeat.
-- Tran va tien do bong van lay tu mini_golf_match_players.
create or replace function public.resume_game_channel_session(
  p_channel_id uuid
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  room_status text;
  room_game_key text;
  restored_seat integer;
begin
  if auth.uid() is null then
    raise exception 'Ban chua dang nhap.'
      using errcode = '42501';
  end if;

  if not public.channel_can_view(p_channel_id, auth.uid()) then
    raise exception 'Ban khong co quyen vao kenh game nay.'
      using errcode = '42501';
  end if;

  select s.status, s.game_key
  into room_status, room_game_key
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

  if found then
    return true;
  end if;

  if room_status <> 'playing'
    or room_game_key <> 'mini-golf' then
    return false;
  end if;

  select mp.seat_index
  into restored_seat
  from public.mini_golf_matches m
  join public.mini_golf_match_players mp
    on mp.match_id = m.id
  where m.channel_id = p_channel_id
    and m.status = 'playing'
    and mp.user_id = auth.uid()
    and mp.player_status <> 'dnf'
  order by m.created_at desc
  limit 1;

  if restored_seat is null then
    return false;
  end if;

  if exists(
    select 1
    from public.game_channel_players p
    where p.channel_id = p_channel_id
      and p.seat_index = restored_seat
      and p.user_id <> auth.uid()
  ) then
    return false;
  end if;

  insert into public.game_channel_players(
    channel_id,
    user_id,
    seat_index,
    is_ready,
    joined_at,
    last_seen_at
  )
  values(
    p_channel_id,
    auth.uid(),
    restored_seat,
    true,
    now(),
    now()
  )
  on conflict (channel_id, user_id) do update
  set last_seen_at = now();

  return true;
end;
$$;

-- Heartbeat moi cung co kha nang tu noi lai thanh vien cua tran dang choi.
create or replace function public.heartbeat_game_channel(
  p_channel_id uuid
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update public.game_channel_players p
  set last_seen_at = now()
  where p.channel_id = p_channel_id
    and p.user_id = auth.uid();

  if found then
    return true;
  end if;

  return public.resume_game_channel_session(p_channel_id);
end;
$$;

-- Khi tat ca nguoi choi hoan thanh, tao lai bat ky ghe nao cua nguoi
-- da ve dich bi thieu va chi dat lai trang thai san sang.
create or replace function public.finish_minigolf_match_if_done(
  p_match_id uuid
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  target_channel_id uuid;
  target_started_at timestamptz;
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
  returning m.channel_id, m.started_at
  into target_channel_id, target_started_at;

  if target_channel_id is null then
    return;
  end if;

  update public.game_channel_states s
  set
    status = 'waiting',
    updated_at = now()
  where s.channel_id = target_channel_id
    and s.game_key = 'mini-golf';

  insert into public.game_channel_players(
    channel_id,
    user_id,
    seat_index,
    is_ready,
    joined_at,
    last_seen_at
  )
  select
    target_channel_id,
    mp.user_id,
    mp.seat_index,
    false,
    coalesce(target_started_at, now()),
    now()
  from public.mini_golf_match_players mp
  where mp.match_id = p_match_id
    and mp.player_status = 'finished'
    and not exists(
      select 1
      from public.game_channel_players occupied
      where occupied.channel_id = target_channel_id
        and occupied.seat_index = mp.seat_index
        and occupied.user_id <> mp.user_id
    )
  on conflict (channel_id, user_id) do update
  set
    is_ready = false,
    last_seen_at = now();

  update public.game_channel_players p
  set
    is_ready = false,
    last_seen_at = now()
  where p.channel_id = target_channel_id;

  perform public.normalize_game_channel_lobby(target_channel_id);
end;
$$;

-- Neu migration duoc chay khi mot tran dang dien ra, khoi phuc ngay
-- cac ghe bi SQL cu xoa ma khong thay doi tien do tran.
insert into public.game_channel_players(
  channel_id,
  user_id,
  seat_index,
  is_ready,
  joined_at,
  last_seen_at
)
select
  m.channel_id,
  mp.user_id,
  mp.seat_index,
  true,
  m.started_at,
  now()
from public.mini_golf_matches m
join public.mini_golf_match_players mp
  on mp.match_id = m.id
where m.status = 'playing'
  and mp.player_status <> 'dnf'
  and not exists(
    select 1
    from public.game_channel_players occupied
    where occupied.channel_id = m.channel_id
      and occupied.seat_index = mp.seat_index
      and occupied.user_id <> mp.user_id
  )
on conflict (channel_id, user_id) do update
set last_seen_at = now();

-- Sua luon phong vua ket thuc bang ban cu: neu phong dang trong va
-- tran moi nhat ket thuc trong 6 gio qua, dua cac nguoi ve dich
-- tro lai dung ghe cu.
with latest_finished_match as (
  select distinct on (m.channel_id)
    m.id,
    m.channel_id,
    m.started_at
  from public.mini_golf_matches m
  join public.game_channel_states s
    on s.channel_id = m.channel_id
  where m.status = 'finished'
    and m.finished_at >= now() - interval '6 hours'
    and s.status = 'waiting'
    and s.game_key = 'mini-golf'
    and not exists(
      select 1
      from public.game_channel_players existing
      where existing.channel_id = m.channel_id
    )
  order by m.channel_id, m.finished_at desc
)
insert into public.game_channel_players(
  channel_id,
  user_id,
  seat_index,
  is_ready,
  joined_at,
  last_seen_at
)
select
  latest.channel_id,
  mp.user_id,
  mp.seat_index,
  false,
  latest.started_at,
  now()
from latest_finished_match latest
join public.mini_golf_match_players mp
  on mp.match_id = latest.id
where mp.player_status = 'finished'
on conflict (channel_id, user_id) do nothing;

revoke all on function public.resume_game_channel_session(uuid)
from public;
revoke all on function public.heartbeat_game_channel(uuid)
from public;
revoke all on function public.get_game_channel_players(uuid)
from public;
revoke all on function public.get_server_game_summaries(uuid)
from public;

grant execute on function public.resume_game_channel_session(uuid)
to authenticated;
grant execute on function public.heartbeat_game_channel(uuid)
to authenticated;
grant execute on function public.get_game_channel_players(uuid)
to authenticated;
grant execute on function public.get_server_game_summaries(uuid)
to authenticated;

notify pgrst, 'reload schema';

commit;
