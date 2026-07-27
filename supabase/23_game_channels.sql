-- ============================================================
-- TALK CÙNG LÂM DZ - KÊNH GAME VÀ PHÒNG CHỜ NHIỀU NGƯỜI
-- Chạy một lần sau 21_servers.sql và 22_main_channel_management.sql.
-- ============================================================

-- 1. Cho phép loại kênh "game".
do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.channels'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%channel_type%'
  loop
    execute format(
      'alter table public.channels drop constraint %I',
      constraint_row.conname
    );
  end loop;
end
$$;

alter table public.channels
  add constraint channels_channel_type_allowed
  check (channel_type in ('text', 'voice', 'both', 'game'));

-- 2. Danh mục game. Sau này chỉ cần thêm game mới vào bảng này.
create table if not exists public.game_catalog (
  game_key text primary key,
  name text not null,
  icon text not null default '🎮',
  description text not null default '',
  max_players integer not null check (max_players between 2 and 32),
  category text not null default 'arcade',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.game_catalog(
  game_key, name, icon, description, max_players, category, sort_order
)
values
  ('racing', 'Đua xe', '🏎️', 'Đua tốc độ cùng bạn bè.', 8, 'racing', 10),
  ('mini-golf', 'Mini Golf', '⛳', 'Mini Golf 9 hố nhiều người, ít gậy nhất chiến thắng.', 16, 'sports', 20),
  ('eight-ball', 'Bi-a', '🎱', 'Bi-a 8 bóng dành cho hai người.', 2, 'sports', 30),
  ('fighting', 'Đối kháng', '🥊', 'Thi đấu đối kháng một chọi một.', 2, 'action', 40),
  ('football', 'Sút bóng', '⚽', 'Thi đấu sút bóng tính điểm.', 4, 'sports', 50),
  ('archery', 'Cung thủ', '🏹', 'So tài bắn cung cùng bạn bè.', 4, 'arcade', 60)
on conflict (game_key) do update
set
  name = excluded.name,
  icon = excluded.icon,
  description = excluded.description,
  max_players = excluded.max_players,
  category = excluded.category,
  sort_order = excluded.sort_order,
  is_active = true;

-- 3. Trạng thái game đang được chọn cho từng kênh.
create table if not exists public.game_channel_states (
  channel_id uuid primary key
    references public.channels(id) on delete cascade,
  game_key text
    references public.game_catalog(game_key) on delete set null,
  status text not null default 'waiting'
    check (status in ('waiting', 'playing')),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Thành viên đang ở trong phòng chờ.
create table if not exists public.game_channel_players (
  channel_id uuid not null
    references public.channels(id) on delete cascade,
  user_id uuid not null
    references auth.users(id) on delete cascade,
  is_ready boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create index if not exists game_channel_players_active_idx
on public.game_channel_players(channel_id, last_seen_at desc);

alter table public.game_catalog enable row level security;
alter table public.game_channel_states enable row level security;
alter table public.game_channel_players enable row level security;

grant select on public.game_catalog to authenticated;
grant select on public.game_channel_states to authenticated;
grant select on public.game_channel_players to authenticated;

drop policy if exists "Authenticated users read game catalog"
on public.game_catalog;
create policy "Authenticated users read game catalog"
on public.game_catalog for select to authenticated
using (is_active);

drop policy if exists "Visible game channel states"
on public.game_channel_states;
create policy "Visible game channel states"
on public.game_channel_states for select to authenticated
using (public.channel_can_view(channel_id, auth.uid()));

drop policy if exists "Visible game channel players"
on public.game_channel_players;
create policy "Visible game channel players"
on public.game_channel_players for select to authenticated
using (public.channel_can_view(channel_id, auth.uid()));

alter table public.game_channel_states replica identity full;
alter table public.game_channel_players replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'game_channel_states'
  ) then
    alter publication supabase_realtime
      add table public.game_channel_states;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'game_channel_players'
  ) then
    alter publication supabase_realtime
      add table public.game_channel_players;
  end if;
end
$$;

-- 4. Tạo kênh server có thêm loại "game".
create or replace function public.create_server_channel(
  p_server_id uuid, p_name text, p_channel_type text default 'text'
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  clean_name text := trim(coalesce(p_name, ''));
  base_slug text;
  new_channel_id uuid;
begin
  if not public.server_can_manage(p_server_id, auth.uid()) then
    raise exception 'Bạn không có quyền tạo kênh trong server này.'
      using errcode = '42501';
  end if;

  if char_length(clean_name) not between 2 and 40 then
    raise exception 'Tên kênh phải có từ 2 đến 40 ký tự.';
  end if;

  if p_channel_type not in ('text', 'voice', 'game') then
    raise exception 'Loại kênh không hợp lệ.';
  end if;

  perform 1
  from public.servers s
  where s.id = p_server_id
  for update;

  if (
    select count(*)
    from public.channels c
    where c.server_id = p_server_id
  ) >= 30 then
    raise exception 'Mỗi server tối đa 30 kênh.';
  end if;

  base_slug := public.channel_slug(clean_name);
  if base_slug = '' then base_slug := 'kenh'; end if;

  insert into public.channels(
    slug, name, description, owner_id, visibility,
    channel_type, server_id
  )
  values(
    left(base_slug, 30) || '-' ||
      substring(gen_random_uuid()::text, 1, 6),
    clean_name, '', auth.uid(), 'private',
    p_channel_type, p_server_id
  )
  returning id into new_channel_id;

  if p_channel_type = 'game' then
    insert into public.game_channel_states(
      channel_id, updated_by
    )
    values(new_channel_id, auth.uid())
    on conflict (channel_id) do nothing;
  end if;

  return new_channel_id;
end;
$$;

-- Giữ khả năng đổi tên/xóa kênh game bằng cửa sổ quản lý hiện có.
create or replace function public.update_channel(
  p_channel_id uuid, p_name text, p_description text,
  p_channel_type text, p_visibility text, p_is_locked boolean
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  role_name text := public.channel_current_role(auth.uid());
  clean_name text := trim(p_name);
begin
  if not public.channel_can_manage(p_channel_id, auth.uid()) then
    raise exception 'Bạn không có quyền sửa kênh.'
      using errcode = '42501';
  end if;

  if char_length(clean_name) not between 2 and 40 then
    raise exception 'Tên kênh phải có từ 2 đến 40 ký tự.';
  end if;

  if p_channel_type not in ('text', 'voice', 'both', 'game') then
    raise exception 'Loại kênh không hợp lệ.';
  end if;

  if p_visibility = 'public'
    and role_name not in ('admin', 'moderator') then
    raise exception 'TV không được chuyển thành kênh chung.';
  end if;

  update public.channels
  set
    name = clean_name,
    description = trim(coalesce(p_description, '')),
    channel_type = p_channel_type,
    visibility = p_visibility,
    is_locked = coalesce(p_is_locked, false),
    updated_at = now()
  where id = p_channel_id;

  if p_channel_type = 'game' then
    insert into public.game_channel_states(
      channel_id, updated_by
    )
    values(p_channel_id, auth.uid())
    on conflict (channel_id) do nothing;
  else
    delete from public.game_channel_states
    where channel_id = p_channel_id;
  end if;

  return true;
end;
$$;

-- 5. Dữ liệu hiển thị dòng nhỏ dưới tên kênh game.
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
        and p.last_seen_at > now() - interval '2 minutes'
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

-- PostgreSQL không cho CREATE OR REPLACE thay đổi các cột của
-- RETURNS TABLE. Xóa đúng chữ ký cũ để file có thể chạy lại sau
-- khi một phiên bản trước đã tạo hàm này.
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
  joined_at timestamptz
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
    p.joined_at
  from public.game_channel_players p
  join public.profiles pr on pr.id = p.user_id
  left join public.user_roles ur on ur.user_id = p.user_id
  where p.channel_id = p_channel_id
    and p.last_seen_at > now() - interval '2 minutes'
  order by p.joined_at asc;
end;
$$;

-- 6. Chọn game, tham gia, rời phòng và trạng thái sẵn sàng.
create or replace function public.set_game_channel_game(
  p_channel_id uuid, p_game_key text
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  target_server_id uuid;
  target_channel_type text;
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

  -- Đổi game sẽ đưa phòng chờ về trạng thái trống.
  delete from public.game_channel_players
  where channel_id = p_channel_id;

  return true;
end;
$$;

create or replace function public.join_game_channel(
  p_channel_id uuid
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  selected_game_key text;
  maximum_players integer;
begin
  if not public.channel_can_view(p_channel_id, auth.uid()) then
    raise exception 'Bạn không có quyền vào kênh game này.'
      using errcode = '42501';
  end if;

  select s.game_key, g.max_players
  into selected_game_key, maximum_players
  from public.game_channel_states s
  join public.game_catalog g on g.game_key = s.game_key
  join public.channels c on c.id = s.channel_id
  where s.channel_id = p_channel_id
    and c.channel_type = 'game'
    and g.is_active;

  if selected_game_key is null then
    raise exception 'Kênh chưa chọn game.';
  end if;

  delete from public.game_channel_players
  where channel_id = p_channel_id
    and last_seen_at <= now() - interval '2 minutes';

  if not exists(
    select 1
    from public.game_channel_players p
    where p.channel_id = p_channel_id
      and p.user_id = auth.uid()
  ) and (
    select count(*)
    from public.game_channel_players p
    where p.channel_id = p_channel_id
  ) >= maximum_players then
    raise exception 'Phòng game đã đủ người.';
  end if;

  insert into public.game_channel_players(
    channel_id, user_id, is_ready, joined_at, last_seen_at
  )
  values(
    p_channel_id, auth.uid(), false, now(), now()
  )
  on conflict (channel_id, user_id) do update
  set last_seen_at = now();

  return true;
end;
$$;

create or replace function public.heartbeat_game_channel(
  p_channel_id uuid
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update public.game_channel_players
  set last_seen_at = now()
  where channel_id = p_channel_id
    and user_id = auth.uid();

  return found;
end;
$$;

create or replace function public.set_game_player_ready(
  p_channel_id uuid, p_is_ready boolean
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update public.game_channel_players
  set
    is_ready = coalesce(p_is_ready, false),
    last_seen_at = now()
  where channel_id = p_channel_id
    and user_id = auth.uid();

  if not found then
    raise exception 'Bạn chưa tham gia phòng game.';
  end if;

  return true;
end;
$$;

create or replace function public.leave_game_channel(
  p_channel_id uuid
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.game_channel_players
  where channel_id = p_channel_id
    and user_id = auth.uid();
  return true;
end;
$$;

-- 7. Quyền thực thi.
revoke all on function public.create_server_channel(uuid,text,text)
from public;
revoke all on function public.update_channel(uuid,text,text,text,text,boolean)
from public;
revoke all on function public.get_server_game_summaries(uuid)
from public;
revoke all on function public.get_game_channel_players(uuid)
from public;
revoke all on function public.set_game_channel_game(uuid,text)
from public;
revoke all on function public.join_game_channel(uuid)
from public;
revoke all on function public.heartbeat_game_channel(uuid)
from public;
revoke all on function public.set_game_player_ready(uuid,boolean)
from public;
revoke all on function public.leave_game_channel(uuid)
from public;

grant execute on function public.create_server_channel(uuid,text,text)
to authenticated;
grant execute on function public.update_channel(uuid,text,text,text,text,boolean)
to authenticated;
grant execute on function public.get_server_game_summaries(uuid)
to authenticated;
grant execute on function public.get_game_channel_players(uuid)
to authenticated;
grant execute on function public.set_game_channel_game(uuid,text)
to authenticated;
grant execute on function public.join_game_channel(uuid)
to authenticated;
grant execute on function public.heartbeat_game_channel(uuid)
to authenticated;
grant execute on function public.set_game_player_ready(uuid,boolean)
to authenticated;
grant execute on function public.leave_game_channel(uuid)
to authenticated;

notify pgrst, 'reload schema';
