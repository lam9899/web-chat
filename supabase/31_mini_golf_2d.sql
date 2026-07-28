-- ============================================================
-- TALK CUNG LAM DZ - MINI GOLF 2D
-- Chay mot lan sau 30_minigolf_disconnect_timeout.sql.
-- Them game rieng Mini Golf 2D va tach lich su tran theo game_key.
-- File co the chay lai an toan.
-- ============================================================

begin;

-- 1. Them game moi vao bo chon game.
insert into public.game_catalog(
  game_key,
  name,
  icon,
  description,
  max_players,
  category,
  sort_order
)
values(
  'mini-golf-2d',
  'Mini Golf 2D',
  '⛳',
  'Mini Golf 2D keo tha, 9 man va nhieu co che vat ly.',
  16,
  'sports',
  21
)
on conflict (game_key) do update
set
  name = excluded.name,
  icon = excluded.icon,
  description = excluded.description,
  max_players = excluded.max_players,
  category = excluded.category,
  sort_order = excluded.sort_order,
  is_active = true;

-- 2. Danh dau tung tran thuoc Mini Golf nao.
alter table public.mini_golf_matches
  add column if not exists game_key text;

update public.mini_golf_matches
set game_key = 'mini-golf'
where game_key is null;

alter table public.mini_golf_matches
  alter column game_key set default 'mini-golf';

alter table public.mini_golf_matches
  alter column game_key set not null;

do $$
begin
  if not exists(
    select 1
    from pg_constraint
    where conrelid = 'public.mini_golf_matches'::regclass
      and conname = 'mini_golf_matches_game_key_fkey'
  ) then
    alter table public.mini_golf_matches
      add constraint mini_golf_matches_game_key_fkey
      foreign key (game_key)
      references public.game_catalog(game_key)
      on update cascade
      on delete restrict;
  end if;
end
$$;

create index if not exists mini_golf_matches_channel_game_created_idx
on public.mini_golf_matches(channel_id, game_key, created_at desc);

-- 3. Chi tra ve tran cua game hien dang duoc chon trong kenh.
create or replace function public.get_minigolf_match(
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
declare
  target_game_key text;
begin
  if not public.channel_can_view(p_channel_id, auth.uid()) then
    raise exception 'Ban khong co quyen xem tran Mini Golf nay.'
      using errcode = '42501';
  end if;

  select s.game_key
  into target_game_key
  from public.game_channel_states s
  where s.channel_id = p_channel_id;

  if target_game_key not in ('mini-golf', 'mini-golf-2d') then
    return;
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
    and m.game_key = target_game_key
  order by
    case when m.status = 'playing' then 0 else 1 end,
    m.created_at desc
  limit 1;
end;
$$;

create or replace function public.get_minigolf_players(
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
  target_game_key text;
begin
  if not public.channel_can_view(p_channel_id, auth.uid()) then
    raise exception 'Ban khong co quyen xem bang diem Mini Golf.'
      using errcode = '42501';
  end if;

  select s.game_key
  into target_game_key
  from public.game_channel_states s
  where s.channel_id = p_channel_id;

  if target_game_key not in ('mini-golf', 'mini-golf-2d') then
    return;
  end if;

  select m.id
  into target_match_id
  from public.mini_golf_matches m
  where m.channel_id = p_channel_id
    and m.game_key = target_game_key
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
    coalesce(pr.username, 'Nguoi choi'),
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

-- 4. Tao dung loai tran khi chu phong bat dau game.
create or replace function public.create_minigolf_match_on_start()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  new_match_id uuid;
begin
  if new.status = 'playing'
    and old.status is distinct from 'playing'
    and new.game_key in ('mini-golf', 'mini-golf-2d') then

    update public.mini_golf_matches
    set
      status = 'cancelled',
      finished_at = coalesce(finished_at, now())
    where channel_id = new.channel_id
      and status = 'playing';

    insert into public.mini_golf_matches(
      channel_id,
      game_key,
      status,
      hole_count,
      started_by
    )
    values(
      new.channel_id,
      new.game_key,
      'playing',
      9,
      new.updated_by
    )
    returning id into new_match_id;

    insert into public.mini_golf_match_players(
      match_id,
      user_id,
      seat_index,
      current_hole,
      hole_strokes,
      total_strokes,
      hole_scores,
      hole_completed,
      player_status,
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

-- 5. Ket thuc dung game, giu nguoi choi con ket noi trong phong cho.
create or replace function public.finish_minigolf_match_if_done(
  p_match_id uuid
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  target_channel_id uuid;
  target_game_key text;
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
  returning m.channel_id, m.game_key
  into target_channel_id, target_game_key;

  if target_channel_id is null then
    return;
  end if;

  update public.game_channel_states s
  set
    status = 'waiting',
    updated_at = now()
  where s.channel_id = target_channel_id
    and s.game_key = target_game_key;

  update public.game_channel_players p
  set is_ready = false
  where p.channel_id = target_channel_id;

  perform public.normalize_game_channel_lobby(target_channel_id);
end;
$$;

-- 6. Doi qua game khac thi huy dung tran dang chay.
create or replace function public.cancel_minigolf_on_game_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.game_key in ('mini-golf', 'mini-golf-2d')
    and new.game_key is distinct from old.game_key then
    update public.mini_golf_matches
    set
      status = 'cancelled',
      finished_at = coalesce(finished_at, now())
    where channel_id = new.channel_id
      and game_key = old.game_key
      and status = 'playing';
  end if;

  return new;
end;
$$;

revoke all on function public.get_minigolf_match(uuid)
from public;
revoke all on function public.get_minigolf_players(uuid)
from public;

grant execute on function public.get_minigolf_match(uuid)
to authenticated;
grant execute on function public.get_minigolf_players(uuid)
to authenticated;

notify pgrst, 'reload schema';

commit;
