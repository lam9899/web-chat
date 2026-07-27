-- ============================================================
-- TALK CÙNG LÂM DZ - MINI GOLF NHIỀU NGƯỜI
-- Tối đa 16 người, 9 hố, ít gậy nhất thắng, xếp hạng Top 1-2-3.
-- Chạy một lần sau 24_game_lobby_seats.sql.
-- File có thể chạy lại an toàn.
-- ============================================================

begin;

-- 1. Mini Golf hỗ trợ tối đa 16 người trong một phòng.
update public.game_catalog
set
  max_players = 16,
  description = 'Mini Golf 9 hố nhiều người, ít gậy nhất chiến thắng.'
where game_key = 'mini-golf';

-- 2. Trận đấu và tiến độ riêng của từng người chơi.
create table if not exists public.mini_golf_matches (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null
    references public.channels(id) on delete cascade,
  status text not null default 'playing'
    check (status in ('playing', 'finished', 'cancelled')),
  hole_count integer not null default 9
    check (hole_count between 3 and 18),
  course_seed integer not null
    default floor(random() * 1000000)::integer,
  started_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists
mini_golf_matches_one_playing_per_channel_uidx
on public.mini_golf_matches(channel_id)
where status = 'playing';

create index if not exists mini_golf_matches_channel_created_idx
on public.mini_golf_matches(channel_id, created_at desc);

create table if not exists public.mini_golf_match_players (
  match_id uuid not null
    references public.mini_golf_matches(id) on delete cascade,
  user_id uuid not null
    references auth.users(id) on delete cascade,
  seat_index integer not null check (seat_index between 0 and 15),
  current_hole integer not null default 1 check (current_hole >= 1),
  hole_strokes integer not null default 0
    check (hole_strokes between 0 and 12),
  total_strokes integer not null default 0 check (total_strokes >= 0),
  hole_scores integer[] not null default '{}'::integer[],
  ball_x double precision,
  ball_y double precision,
  hole_started_at timestamptz not null default now(),
  player_status text not null default 'playing'
    check (player_status in ('playing', 'finished', 'dnf')),
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (match_id, user_id),
  unique (match_id, seat_index)
);

create index if not exists mini_golf_players_match_rank_idx
on public.mini_golf_match_players(
  match_id, player_status, total_strokes, finished_at
);

alter table public.mini_golf_matches enable row level security;
alter table public.mini_golf_match_players enable row level security;

grant select on public.mini_golf_matches to authenticated;
grant select on public.mini_golf_match_players to authenticated;

drop policy if exists "Visible mini golf matches"
on public.mini_golf_matches;
create policy "Visible mini golf matches"
on public.mini_golf_matches for select to authenticated
using (public.channel_can_view(channel_id, auth.uid()));

drop policy if exists "Visible mini golf players"
on public.mini_golf_match_players;
create policy "Visible mini golf players"
on public.mini_golf_match_players for select to authenticated
using (
  exists(
    select 1
    from public.mini_golf_matches m
    where m.id = match_id
      and public.channel_can_view(m.channel_id, auth.uid())
  )
);

alter table public.mini_golf_matches replica identity full;
alter table public.mini_golf_match_players replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'mini_golf_matches'
  ) then
    alter publication supabase_realtime
      add table public.mini_golf_matches;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'mini_golf_match_players'
  ) then
    alter publication supabase_realtime
      add table public.mini_golf_match_players;
  end if;
end
$$;

-- 3. Đọc trận gần nhất và bảng điểm 16 người.
drop function if exists public.get_minigolf_match(uuid);

create function public.get_minigolf_match(
  p_channel_id uuid
)
returns table(
  match_id uuid,
  status text,
  hole_count integer,
  course_seed integer,
  started_at timestamptz,
  finished_at timestamptz
)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.channel_can_view(p_channel_id, auth.uid()) then
    raise exception 'Bạn không có quyền xem trận Mini Golf này.'
      using errcode = '42501';
  end if;

  return query
  select
    m.id,
    m.status,
    m.hole_count,
    m.course_seed,
    m.started_at,
    m.finished_at
  from public.mini_golf_matches m
  where m.channel_id = p_channel_id
  order by
    case when m.status = 'playing' then 0 else 1 end,
    m.created_at desc
  limit 1;
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
    r.player_status,
    r.finished_at,
    r.calculated_rank
  from ranked r
  join public.profiles pr on pr.id = r.user_id
  left join public.user_roles ur on ur.user_id = r.user_id
  order by r.calculated_rank asc;
end;
$$;

-- 4. Khi chủ phòng bấm Bắt đầu, tự tạo trận và lấy tối đa
-- 16 người đang ở trong phòng chờ.
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
      hole_scores, player_status, hole_started_at
    )
    select
      new_match_id,
      p.user_id,
      p.seat_index,
      1,
      0,
      0,
      '{}'::integer[],
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

drop trigger if exists create_minigolf_match_on_start_trigger
on public.game_channel_states;

create trigger create_minigolf_match_on_start_trigger
after update of status on public.game_channel_states
for each row execute function public.create_minigolf_match_on_start();

-- 5. Kết thúc trận khi không còn người ở trạng thái đang chơi.
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
    set is_ready = false
    where channel_id = target_channel_id;
  end if;
end;
$$;

-- 6. Ghi nhận một cú đánh. Trình duyệt mô phỏng chuyển động,
-- máy chủ chỉ chấp nhận kết quả của chính người đang đăng nhập.
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
  next_hole integer;
  next_player_status text;
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
    next_hole := target_player.current_hole + 1;
    next_player_status := case
      when next_hole > target_match.hole_count
        then 'finished'
      else 'playing'
    end;

    update public.mini_golf_match_players
    set
      current_hole = next_hole,
      hole_strokes = 0,
      total_strokes = total_strokes + stroke_delta,
      hole_scores = array_append(
        hole_scores,
        least(next_hole_strokes, 12)
      ),
      ball_x = null,
      ball_y = null,
      hole_started_at = now(),
      player_status = next_player_status,
      finished_at = case
        when next_player_status = 'finished' then now()
        else null
      end,
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

  perform public.finish_minigolf_match_if_done(target_match.id);
  return true;
end;
$$;

-- Hết 60 giây: hố hiện tại được tính 12 gậy và chuyển hố.
create or replace function public.skip_minigolf_hole(
  p_channel_id uuid
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  target_match public.mini_golf_matches%rowtype;
  target_player public.mini_golf_match_players%rowtype;
  next_hole integer;
  next_player_status text;
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

  if target_player.hole_started_at >
    now() - interval '60 seconds' then
    raise exception 'Hố này vẫn còn thời gian.';
  end if;

  next_hole := target_player.current_hole + 1;
  next_player_status := case
    when next_hole > target_match.hole_count
      then 'finished'
    else 'playing'
  end;

  update public.mini_golf_match_players
  set
    current_hole = next_hole,
    hole_strokes = 0,
    total_strokes =
      total_strokes + greatest(0, 12 - hole_strokes),
    hole_scores = array_append(hole_scores, 12),
    ball_x = null,
    ball_y = null,
    hole_started_at = now(),
    player_status = next_player_status,
    finished_at = case
      when next_player_status = 'finished' then now()
      else null
    end,
    updated_at = now()
  where match_id = target_match.id
    and user_id = auth.uid();

  perform public.finish_minigolf_match_if_done(target_match.id);
  return true;
end;
$$;

-- 7. Nếu người chơi rời phòng chờ giữa trận thì đánh dấu DNF,
-- tránh làm cả phòng bị kẹt mãi ở trạng thái đang chơi.
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

    perform public.finish_minigolf_match_if_done(target_match_id);
  end if;

  return old;
end;
$$;

drop trigger if exists mark_minigolf_player_dnf_on_leave_trigger
on public.game_channel_players;

create trigger mark_minigolf_player_dnf_on_leave_trigger
after delete on public.game_channel_players
for each row execute function public.mark_minigolf_player_dnf_on_leave();

-- Đổi sang game khác sẽ hủy trận Mini Golf đang chạy.
create or replace function public.cancel_minigolf_on_game_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.game_key = 'mini-golf'
    and new.game_key is distinct from 'mini-golf' then
    update public.mini_golf_matches
    set
      status = 'cancelled',
      finished_at = coalesce(finished_at, now())
    where channel_id = new.channel_id
      and status = 'playing';
  end if;

  return new;
end;
$$;

drop trigger if exists cancel_minigolf_on_game_change_trigger
on public.game_channel_states;

create trigger cancel_minigolf_on_game_change_trigger
after update of game_key on public.game_channel_states
for each row execute function public.cancel_minigolf_on_game_change();

-- 8. Quyền gọi API.
revoke all on function public.get_minigolf_match(uuid)
from public;
revoke all on function public.get_minigolf_players(uuid)
from public;
revoke all on function public.record_minigolf_shot(
  uuid,double precision,double precision,boolean,boolean
) from public;
revoke all on function public.skip_minigolf_hole(uuid)
from public;
revoke all on function public.finish_minigolf_match_if_done(uuid)
from public;

grant execute on function public.get_minigolf_match(uuid)
to authenticated;
grant execute on function public.get_minigolf_players(uuid)
to authenticated;
grant execute on function public.record_minigolf_shot(
  uuid,double precision,double precision,boolean,boolean
) to authenticated;
grant execute on function public.skip_minigolf_hole(uuid)
to authenticated;

notify pgrst, 'reload schema';

commit;
