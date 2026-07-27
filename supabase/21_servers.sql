-- TALK CÙNG LÂM DZ — SERVER (GIAI ĐOẠN 2 CỦA KÊNH ĐỘNG)
-- Mỗi server giống Discord: có nhiều kênh văn bản + kênh thoại riêng,
-- ai cũng tạo được server, tham gia bằng mã mời.
-- Chạy SAU file 20_dynamic_channels.sql, toàn bộ trong Supabase SQL Editor.

create extension if not exists pgcrypto;

-- ============================================================
-- 1. BẢNG MỚI: servers + server_members
-- ============================================================

create table if not exists public.servers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  avatar_path text,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  invite_code text not null unique,
  max_members integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(name)) between 2 and 40),
  check (char_length(description) <= 300),
  check (max_members between 2 and 500)
);

create table if not exists public.server_members (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  member_role text not null default 'member'
    check (member_role in ('owner', 'moderator', 'member')),
  joined_at timestamptz not null default now(),
  primary key(server_id, user_id)
);

-- Kênh thuộc server. NULL = kênh đơn lẻ kiểu cũ (không đổi hành vi).
alter table public.channels
  add column if not exists server_id uuid;

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conrelid = 'public.channels'::regclass
      and conname = 'channels_server_id_fkey'
  ) then
    alter table public.channels
      add constraint channels_server_id_fkey
      foreign key(server_id) references public.servers(id)
      on delete cascade;
  end if;
end
$$;

create index if not exists channels_server_idx
on public.channels(server_id);

create index if not exists server_members_user_idx
on public.server_members(user_id);

-- ============================================================
-- 2. HÀM KIỂM TRA QUYỀN
-- ============================================================

create or replace function public.server_is_member(p_server_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists(
    select 1 from public.server_members m
    where m.server_id = p_server_id and m.user_id = p_user_id
  );
$$;

create or replace function public.server_can_manage(p_server_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists(
    select 1 from public.servers s
    where s.id = p_server_id
      and (
        s.owner_id = p_user_id
        or public.channel_current_role(p_user_id) = 'admin'
        or exists(
          select 1 from public.server_members m
          where m.server_id = s.id
            and m.user_id = p_user_id
            and m.member_role in ('owner', 'moderator')
        )
      )
  );
$$;

create or replace function public.generate_server_invite_code()
returns text
language sql volatile set search_path = ''
as $$
  -- 12 ký tự hex = 48 bit ngẫu nhiên, khó dò hơn mã 8 ký tự cũ.
  select upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 12));
$$;

-- ============================================================
-- 3. NÂNG CẤP QUYỀN KÊNH: kênh trong server đi theo thành viên server
--    (giữ nguyên chữ ký hàm nên mọi policy/RPC cũ dùng lại được)
-- ============================================================

create or replace function public.channel_can_view(p_channel_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists(
    select 1 from public.channels c
    where c.id = p_channel_id
      and case
        when c.server_id is not null
          then public.server_is_member(c.server_id, p_user_id)
        else
          c.visibility = 'public'
          or public.channel_is_member(c.id, p_user_id)
      end
  );
$$;

create or replace function public.channel_can_manage(p_channel_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists(
    select 1 from public.channels c
    where c.id = p_channel_id
      and case
        when c.server_id is not null
          then public.server_can_manage(c.server_id, p_user_id)
        else
          c.owner_id = p_user_id
          or public.channel_current_role(p_user_id) = 'admin'
          or (c.visibility = 'public' and public.channel_current_role(p_user_id) = 'moderator')
          or exists(
            select 1 from public.channel_members m
            where m.channel_id = c.id and m.user_id = p_user_id and m.member_role = 'moderator'
          )
      end
  );
$$;

-- channel_can_send giữ nguyên: nó gọi channel_can_view/channel_can_manage nên tự đúng.

-- Kênh trong server không dùng lời mời từng kênh (vào server là thấy mọi kênh).
create or replace function public.invite_to_channel(p_channel_id uuid, p_receiver_id uuid)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare result_id bigint; c public.channels;
begin
  if not public.channel_can_manage(p_channel_id, auth.uid()) then raise exception 'Bạn không có quyền mời thành viên.' using errcode = '42501'; end if;
  select * into c from public.channels where id = p_channel_id;
  if c.server_id is not null then raise exception 'Kênh trong server không cần lời mời. Hãy chia sẻ mã mời của server.'; end if;
  if c.visibility <> 'private' then raise exception 'Kênh chung không cần lời mời.'; end if;
  if not public.are_friends(auth.uid(), p_receiver_id) then raise exception 'Chỉ được mời người đã kết bạn.'; end if;
  if public.channel_is_member(p_channel_id, p_receiver_id) then raise exception 'Người này đã ở trong kênh.'; end if;
  insert into public.channel_invites(channel_id, sender_id, receiver_id)
  values(p_channel_id, auth.uid(), p_receiver_id) returning id into result_id;
  return result_id;
exception when unique_violation then raise exception 'Lời mời đang chờ xử lý.';
end;
$$;

-- ============================================================
-- 4. RLS CHO BẢNG MỚI (ghi dữ liệu chỉ qua RPC security definer)
-- ============================================================

alter table public.servers enable row level security;
alter table public.server_members enable row level security;

grant select on public.servers, public.server_members to authenticated;

drop policy if exists "Visible servers" on public.servers;
create policy "Visible servers" on public.servers for select to authenticated
using (
  public.server_is_member(id, auth.uid())
  or public.channel_current_role(auth.uid()) = 'admin'
);

drop policy if exists "Visible server members" on public.server_members;
create policy "Visible server members" on public.server_members for select to authenticated
using (public.server_is_member(server_id, auth.uid()));

-- ============================================================
-- 5. get_visible_channels THÊM CỘT server_id
--    (đổi kiểu trả về nên phải drop rồi tạo lại cả hàm phụ thuộc)
-- ============================================================

drop function if exists public.get_channel_detail(uuid);
drop function if exists public.get_visible_channels();

create function public.get_visible_channels()
returns table(
  id uuid, slug text, name text, description text, avatar_path text,
  owner_id uuid, visibility text, channel_type text, is_locked boolean,
  is_system boolean, created_at timestamptz, member_role text,
  member_ids uuid[], member_count bigint, unread_count bigint, can_manage boolean,
  server_id uuid
)
language sql stable security definer set search_path = ''
as $$
  select
    c.id, c.slug, c.name, c.description, c.avatar_path, c.owner_id,
    c.visibility, c.channel_type, c.is_locked, c.is_system, c.created_at,
    coalesce(me.member_role, 'public'),
    coalesce((select array_agg(m.user_id) from public.channel_members m where m.channel_id = c.id), array[]::uuid[]),
    (select count(*) from public.channel_members m where m.channel_id = c.id),
    (
      select count(*) from public.channel_messages msg
      where msg.channel_id = c.id
        and msg.sender_id <> auth.uid()
        and msg.id > coalesce((
          select rs.last_read_message_id from public.channel_read_states rs
          where rs.channel_id = c.id and rs.user_id = auth.uid()
        ), 0)
    ),
    public.channel_can_manage(c.id, auth.uid()),
    c.server_id
  from public.channels c
  left join public.channel_members me
    on me.channel_id = c.id and me.user_id = auth.uid()
  where public.channel_can_view(c.id, auth.uid())
  order by c.is_system desc, c.created_at asc;
$$;

create function public.get_channel_detail(p_channel_id uuid)
returns table(
  id uuid, slug text, name text, description text, avatar_path text,
  owner_id uuid, visibility text, channel_type text, is_locked boolean,
  is_system boolean, created_at timestamptz, member_role text,
  member_ids uuid[], member_count bigint, unread_count bigint, can_manage boolean,
  server_id uuid
)
language sql stable security definer set search_path = ''
as $$ select * from public.get_visible_channels() where id = p_channel_id; $$;

-- Kênh trong server không tính vào hạn mức 5 kênh riêng kiểu cũ.
create or replace function public.create_channel(
  p_name text, p_description text default '', p_channel_type text default 'text',
  p_visibility text default 'private', p_invited_user_ids uuid[] default array[]::uuid[]
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  user_role text;
  channel_id uuid;
  clean_name text := trim(coalesce(p_name, ''));
  base_slug text;
  friend_id uuid;
  invited uuid[];
begin
  if uid is null then raise exception 'Bạn chưa đăng nhập.' using errcode = '42501'; end if;
  user_role := public.channel_current_role(uid);
  if char_length(clean_name) not between 2 and 40 then raise exception 'Tên kênh phải có từ 2 đến 40 ký tự.'; end if;
  if char_length(coalesce(p_description, '')) > 300 then raise exception 'Mô tả tối đa 300 ký tự.'; end if;
  if p_channel_type not in ('text', 'voice', 'both') then raise exception 'Loại kênh không hợp lệ.'; end if;
  if p_visibility not in ('public', 'private') then raise exception 'Quyền riêng tư không hợp lệ.'; end if;
  if p_visibility = 'public' and user_role not in ('admin', 'moderator') then
    raise exception 'TV chỉ được tạo kênh riêng.' using errcode = '42501';
  end if;
  if p_visibility = 'private' and (
    select count(*) from public.channels c
    where c.owner_id = uid and c.visibility = 'private' and c.server_id is null
  ) >= 5 then raise exception 'Mỗi tài khoản tối đa 5 kênh riêng.'; end if;

  select coalesce(array_agg(distinct x), array[]::uuid[]) into invited
  from unnest(coalesce(p_invited_user_ids, array[]::uuid[])) x where x <> uid;
  if cardinality(invited) > 24 then raise exception 'Kênh tối đa 25 thành viên gồm chủ kênh.'; end if;
  if exists(select 1 from unnest(invited) x where not public.are_friends(uid, x)) then
    raise exception 'Chỉ được mời người đã kết bạn.' using errcode = '42501';
  end if;

  base_slug := public.channel_slug(clean_name);
  if base_slug = '' then base_slug := 'kenh'; end if;

  insert into public.channels(slug, name, description, owner_id, visibility, channel_type)
  values(left(base_slug, 30) || '-' || substring(gen_random_uuid()::text, 1, 6),
    clean_name, trim(coalesce(p_description, '')), uid, p_visibility, p_channel_type)
  returning id into channel_id;

  insert into public.channel_members(channel_id, user_id, member_role)
  values(channel_id, uid, 'owner');

  insert into public.channel_read_states(channel_id, user_id)
  values(channel_id, uid) on conflict do nothing;

  if p_visibility = 'private' then
    foreach friend_id in array invited loop
      insert into public.channel_invites(channel_id, sender_id, receiver_id)
      values(channel_id, uid, friend_id) on conflict do nothing;
    end loop;
  end if;

  return channel_id;
end;
$$;

-- ============================================================
-- 6. RPC CHO SERVER
-- ============================================================

create or replace function public.get_my_servers()
returns table(
  id uuid, name text, description text, avatar_path text, owner_id uuid,
  invite_code text, max_members integer, created_at timestamptz,
  member_role text, member_ids uuid[], member_count bigint, can_manage boolean
)
language sql stable security definer set search_path = ''
as $$
  select
    s.id, s.name, s.description, s.avatar_path, s.owner_id,
    s.invite_code, s.max_members, s.created_at,
    me.member_role,
    coalesce((select array_agg(m.user_id) from public.server_members m where m.server_id = s.id), array[]::uuid[]),
    (select count(*) from public.server_members m where m.server_id = s.id),
    public.server_can_manage(s.id, auth.uid())
  from public.servers s
  join public.server_members me
    on me.server_id = s.id and me.user_id = auth.uid()
  order by s.created_at asc;
$$;

-- Drop để file vẫn chạy lại an toàn khi kiểu trả về được bổ sung last_seen_at.
drop function if exists public.get_server_members(uuid);

create function public.get_server_members(p_server_id uuid)
returns table(
  id uuid, username text, avatar_url text, public_id bigint,
  role text, server_role text, joined_at timestamptz,
  last_seen_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.username, p.avatar_url, p.public_id,
    coalesce(r.role, 'member'), m.member_role, m.joined_at,
    p.last_seen_at
  from public.server_members m
  join public.profiles p on p.id = m.user_id
  left join public.user_roles r on r.user_id = p.id
  where m.server_id = p_server_id
    and public.server_is_member(p_server_id, auth.uid())
  order by case m.member_role when 'owner' then 0 when 'moderator' then 1 else 2 end,
    p.username;
$$;

create or replace function public.create_server(
  p_name text, p_description text default ''
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  clean_name text := trim(coalesce(p_name, ''));
  new_server_id uuid;
  new_code text;
  base_slug text;
  attempt integer := 0;
begin
  if uid is null then raise exception 'Bạn chưa đăng nhập.' using errcode = '42501'; end if;
  if char_length(clean_name) not between 2 and 40 then raise exception 'Tên server phải có từ 2 đến 40 ký tự.'; end if;
  if char_length(coalesce(p_description, '')) > 300 then raise exception 'Mô tả tối đa 300 ký tự.'; end if;

  -- Chặn hai yêu cầu đồng thời cùng vượt giới hạn 5 server/tài khoản.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 21001));

  if (select count(*) from public.servers s where s.owner_id = uid) >= 5 then
    raise exception 'Mỗi tài khoản tạo tối đa 5 server.';
  end if;

  loop
    attempt := attempt + 1;
    new_code := public.generate_server_invite_code();
    begin
      insert into public.servers(name, description, owner_id, invite_code)
      values(clean_name, trim(coalesce(p_description, '')), uid, new_code)
      returning id into new_server_id;
      exit;
    exception when unique_violation then
      if attempt >= 5 then raise exception 'Không thể tạo mã mời, hãy thử lại.'; end if;
    end;
  end loop;

  insert into public.server_members(server_id, user_id, member_role)
  values(new_server_id, uid, 'owner');

  base_slug := public.channel_slug(clean_name);
  if base_slug = '' then base_slug := 'server'; end if;

  -- Kênh mặc định của server: 1 văn bản + 1 thoại.
  insert into public.channels(slug, name, description, owner_id, visibility, channel_type, server_id)
  values(
    left(base_slug, 24) || '-chung-' || substring(gen_random_uuid()::text, 1, 6),
    'chung', 'Kênh văn bản của server', uid, 'private', 'text', new_server_id
  );

  insert into public.channels(slug, name, description, owner_id, visibility, channel_type, server_id)
  values(
    left(base_slug, 24) || '-thoai-' || substring(gen_random_uuid()::text, 1, 6),
    'Phòng trò chuyện', 'Kênh thoại của server', uid, 'private', 'voice', new_server_id
  );

  return new_server_id;
end;
$$;

-- Đổi tên kênh thoại mặc định của những server đã tạo bằng bản trước.
-- Chỉ đổi đúng tên mặc định cũ, không chạm vào kênh người dùng đã đặt tên khác.
update public.channels
set name = 'Phòng trò chuyện'
where server_id is not null
  and channel_type = 'voice'
  and name = 'Phòng thoại';

create or replace function public.preview_server_invite(p_code text)
returns table(
  id uuid, name text, description text, avatar_path text,
  member_count bigint, max_members integer, already_member boolean
)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.name, s.description, s.avatar_path,
    (select count(*) from public.server_members m where m.server_id = s.id),
    s.max_members,
    public.server_is_member(s.id, auth.uid())
  from public.servers s
  where s.invite_code = upper(trim(coalesce(p_code, '')));
$$;

create or replace function public.join_server_with_code(p_code text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  target public.servers;
begin
  if uid is null then raise exception 'Bạn chưa đăng nhập.' using errcode = '42501'; end if;

  -- Khóa row trong lúc kiểm tra số thành viên để không vượt max_members
  -- khi nhiều người dùng cùng tham gia.
  select * into target
  from public.servers s
  where s.invite_code = upper(trim(coalesce(p_code, '')))
  for update;

  if not found then raise exception 'Mã mời không đúng hoặc đã bị đổi.'; end if;

  if public.server_is_member(target.id, uid) then
    return target.id;
  end if;

  if (select count(*) from public.server_members m where m.server_id = target.id) >= target.max_members then
    raise exception 'Server đã đủ thành viên.';
  end if;

  insert into public.server_members(server_id, user_id, member_role)
  values(target.id, uid, 'member')
  on conflict do nothing;

  return target.id;
end;
$$;

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
    raise exception 'Bạn không có quyền tạo kênh trong server này.' using errcode = '42501';
  end if;
  if char_length(clean_name) not between 2 and 40 then raise exception 'Tên kênh phải có từ 2 đến 40 ký tự.'; end if;
  if p_channel_type not in ('text', 'voice') then raise exception 'Loại kênh không hợp lệ.'; end if;

  -- Tuần tự hóa thao tác tạo kênh để giới hạn 30 kênh luôn chính xác.
  perform 1
  from public.servers s
  where s.id = p_server_id
  for update;

  if (select count(*) from public.channels c where c.server_id = p_server_id) >= 30 then
    raise exception 'Mỗi server tối đa 30 kênh.';
  end if;

  base_slug := public.channel_slug(clean_name);
  if base_slug = '' then base_slug := 'kenh'; end if;

  insert into public.channels(slug, name, description, owner_id, visibility, channel_type, server_id)
  values(
    left(base_slug, 30) || '-' || substring(gen_random_uuid()::text, 1, 6),
    clean_name, '', auth.uid(), 'private', p_channel_type, p_server_id
  )
  returning id into new_channel_id;

  return new_channel_id;
end;
$$;

create or replace function public.update_server(
  p_server_id uuid, p_name text, p_description text
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare clean_name text := trim(coalesce(p_name, ''));
begin
  if not public.server_can_manage(p_server_id, auth.uid()) then
    raise exception 'Bạn không có quyền sửa server.' using errcode = '42501';
  end if;
  if char_length(clean_name) not between 2 and 40 then raise exception 'Tên server phải có từ 2 đến 40 ký tự.'; end if;
  if char_length(coalesce(p_description, '')) > 300 then raise exception 'Mô tả tối đa 300 ký tự.'; end if;

  update public.servers
  set name = clean_name,
    description = trim(coalesce(p_description, '')),
    updated_at = now()
  where id = p_server_id;

  return true;
end;
$$;

create or replace function public.set_server_avatar(p_server_id uuid, p_avatar_path text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  clean_path text := nullif(trim(coalesce(p_avatar_path, '')), '');
begin
  if not public.server_can_manage(p_server_id, auth.uid()) then
    raise exception 'Bạn không có quyền đổi avatar server.' using errcode = '42501';
  end if;

  if clean_path is not null and (
    split_part(clean_path, '/', 1) <> auth.uid()::text
    or split_part(clean_path, '/', 2) <> p_server_id::text
    or split_part(clean_path, '/', 3) = ''
  ) then
    raise exception 'Đường dẫn avatar server không hợp lệ.' using errcode = '22023';
  end if;

  update public.servers
  set avatar_path = clean_path, updated_at = now()
  where id = p_server_id;
  return true;
end;
$$;

create or replace function public.regenerate_server_invite(p_server_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  new_code text;
  attempt integer := 0;
begin
  if not public.server_can_manage(p_server_id, auth.uid()) then
    raise exception 'Bạn không có quyền đổi mã mời.' using errcode = '42501';
  end if;

  loop
    attempt := attempt + 1;
    new_code := public.generate_server_invite_code();
    begin
      update public.servers
      set invite_code = new_code, updated_at = now()
      where id = p_server_id;
      exit;
    exception when unique_violation then
      if attempt >= 5 then raise exception 'Không thể tạo mã mời mới, hãy thử lại.'; end if;
    end;
  end loop;

  return new_code;
end;
$$;

create or replace function public.set_server_member_role(
  p_server_id uuid, p_member_id uuid, p_role text
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if p_role not in ('moderator', 'member') then raise exception 'Vai trò không hợp lệ.'; end if;
  if not exists(
    select 1 from public.servers s
    where s.id = p_server_id
      and (s.owner_id = auth.uid() or public.channel_current_role(auth.uid()) = 'admin')
  ) then
    raise exception 'Chỉ chủ server được đổi vai trò.' using errcode = '42501';
  end if;
  if exists(select 1 from public.servers s where s.id = p_server_id and s.owner_id = p_member_id) then
    raise exception 'Không thể đổi vai trò của chủ server.';
  end if;

  update public.server_members
  set member_role = p_role
  where server_id = p_server_id and user_id = p_member_id;

  return true;
end;
$$;

create or replace function public.remove_server_member(p_server_id uuid, p_member_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  caller_is_owner_or_admin boolean;
  target_role text;
begin
  if not public.server_can_manage(p_server_id, auth.uid()) then
    raise exception 'Bạn không có quyền xóa thành viên.' using errcode = '42501';
  end if;

  select (
    s.owner_id = auth.uid()
    or public.channel_current_role(auth.uid()) = 'admin'
  )
  into caller_is_owner_or_admin
  from public.servers s
  where s.id = p_server_id;

  select m.member_role
  into target_role
  from public.server_members m
  where m.server_id = p_server_id
    and m.user_id = p_member_id;

  if target_role is null then
    raise exception 'Thành viên không tồn tại trong server.';
  end if;

  if exists(select 1 from public.servers s where s.id = p_server_id and s.owner_id = p_member_id) then
    raise exception 'Không thể xóa chủ server.';
  end if;

  if target_role = 'moderator' and not coalesce(caller_is_owner_or_admin, false) then
    raise exception 'Quản lý không thể xóa một quản lý khác.' using errcode = '42501';
  end if;

  delete from public.server_members
  where server_id = p_server_id and user_id = p_member_id;

  delete from public.channel_read_states rs
  using public.channels c
  where rs.channel_id = c.id
    and c.server_id = p_server_id
    and rs.user_id = p_member_id;

  return true;
end;
$$;

create or replace function public.leave_server(p_server_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if exists(select 1 from public.servers s where s.id = p_server_id and s.owner_id = auth.uid()) then
    raise exception 'Chủ server phải xóa server thay vì rời.';
  end if;

  delete from public.server_members
  where server_id = p_server_id and user_id = auth.uid();

  delete from public.channel_read_states rs
  using public.channels c
  where rs.channel_id = c.id
    and c.server_id = p_server_id
    and rs.user_id = auth.uid();

  return true;
end;
$$;

create or replace function public.delete_server(p_server_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists(
    select 1 from public.servers s
    where s.id = p_server_id
      and (s.owner_id = auth.uid() or public.channel_current_role(auth.uid()) = 'admin')
  ) then
    raise exception 'Chỉ chủ server được xóa server.' using errcode = '42501';
  end if;

  -- Kênh, tin nhắn, thành viên tự xóa theo khóa ngoại cascade.
  delete from public.servers where id = p_server_id;
  return true;
end;
$$;

-- ============================================================
-- 7. QUYỀN THỰC THI
-- ============================================================

revoke all on function public.get_my_servers() from public;
revoke all on function public.get_server_members(uuid) from public;
revoke all on function public.create_server(text,text) from public;
revoke all on function public.preview_server_invite(text) from public;
revoke all on function public.join_server_with_code(text) from public;
revoke all on function public.create_server_channel(uuid,text,text) from public;
revoke all on function public.update_server(uuid,text,text) from public;
revoke all on function public.set_server_avatar(uuid,text) from public;
revoke all on function public.regenerate_server_invite(uuid) from public;
revoke all on function public.set_server_member_role(uuid,uuid,text) from public;
revoke all on function public.remove_server_member(uuid,uuid) from public;
revoke all on function public.leave_server(uuid) from public;
revoke all on function public.delete_server(uuid) from public;
revoke all on function public.get_visible_channels() from public;
revoke all on function public.get_channel_detail(uuid) from public;
revoke all on function public.server_is_member(uuid,uuid) from public;
revoke all on function public.server_can_manage(uuid,uuid) from public;
revoke all on function public.generate_server_invite_code() from public;

grant execute on function public.get_my_servers() to authenticated;
grant execute on function public.get_server_members(uuid) to authenticated;
grant execute on function public.create_server(text,text) to authenticated;
grant execute on function public.preview_server_invite(text) to authenticated;
grant execute on function public.join_server_with_code(text) to authenticated;
grant execute on function public.create_server_channel(uuid,text,text) to authenticated;
grant execute on function public.update_server(uuid,text,text) to authenticated;
grant execute on function public.set_server_avatar(uuid,text) to authenticated;
grant execute on function public.regenerate_server_invite(uuid) to authenticated;
grant execute on function public.set_server_member_role(uuid,uuid,text) to authenticated;
grant execute on function public.remove_server_member(uuid,uuid) to authenticated;
grant execute on function public.leave_server(uuid) to authenticated;
grant execute on function public.delete_server(uuid) to authenticated;
grant execute on function public.get_visible_channels() to authenticated;
grant execute on function public.get_channel_detail(uuid) to authenticated;
grant execute on function public.server_is_member(uuid,uuid) to authenticated;
grant execute on function public.server_can_manage(uuid,uuid) to authenticated;

-- ============================================================
-- 8. STORAGE: avatar server dùng chung bucket channel-avatars
--    Đường dẫn: {user_id}/{server_id}/avatar-*.jpg|png|webp
-- ============================================================

drop policy if exists "Server managers upload avatars" on storage.objects;
create policy "Server managers upload avatars" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'channel-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
  and cardinality(storage.foldername(name)) >= 3
  and public.server_can_manage(((storage.foldername(name))[2])::uuid, auth.uid())
);

drop policy if exists "Server managers update avatars" on storage.objects;
create policy "Server managers update avatars" on storage.objects
for update to authenticated
using (
  bucket_id = 'channel-avatars'
  and cardinality(storage.foldername(name)) >= 3
  and public.server_can_manage(((storage.foldername(name))[2])::uuid, auth.uid())
)
with check (
  bucket_id = 'channel-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
  and cardinality(storage.foldername(name)) >= 3
  and public.server_can_manage(((storage.foldername(name))[2])::uuid, auth.uid())
);

drop policy if exists "Server managers delete avatars" on storage.objects;
create policy "Server managers delete avatars" on storage.objects
for delete to authenticated
using (
  bucket_id = 'channel-avatars'
  and cardinality(storage.foldername(name)) >= 3
  and public.server_can_manage(((storage.foldername(name))[2])::uuid, auth.uid())
);

-- ============================================================
-- 9. REALTIME
-- ============================================================

alter table public.servers replica identity full;
alter table public.server_members replica identity full;

do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='servers') then
    alter publication supabase_realtime add table public.servers;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='server_members') then
    alter publication supabase_realtime add table public.server_members;
  end if;
end $$;
