-- TALK CÙNG LÂM DZ — KÊNH ĐỘNG GIAI ĐOẠN 1
-- Kênh chung/riêng, avatar, thành viên, lời mời, online và tin chưa đọc.
-- Chạy toàn bộ file trong Supabase SQL Editor.

create extension if not exists pgcrypto;

-- ============================================================
-- TƯƠNG THÍCH VỚI BẢNG channels CŨ
--
-- Bản cũ dùng:
--   slug text primary key
--
-- Bản mới cần thêm:
--   id uuid unique
--   owner_id, visibility, channel_type, avatar_path...
--
-- Khối này chỉ THÊM cột và giữ nguyên toàn bộ kênh/tin nhắn cũ.
-- Không xóa dữ liệu.
-- ============================================================

do $$
declare
  has_legacy_columns boolean := false;
begin
  if to_regclass('public.channels') is not null then
    select exists(
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'channels'
        and column_name in (
          'position',
          'is_default',
          'created_by'
        )
    )
    into has_legacy_columns;

    alter table public.channels
      add column if not exists id uuid;

    update public.channels
    set id = gen_random_uuid()
    where id is null;

    alter table public.channels
      alter column id set default gen_random_uuid();

    alter table public.channels
      alter column id set not null;

    alter table public.channels
      add column if not exists avatar_path text;

    alter table public.channels
      add column if not exists owner_id uuid;

    alter table public.channels
      add column if not exists visibility text
        default 'private';

    alter table public.channels
      add column if not exists channel_type text
        default 'text';

    alter table public.channels
      add column if not exists is_locked boolean
        default false;

    alter table public.channels
      add column if not exists is_system boolean
        default false;

    alter table public.channels
      add column if not exists max_members integer
        default 25;

    alter table public.channels
      add column if not exists updated_at timestamptz
        default now();

    update public.channels
    set
      visibility = coalesce(visibility, 'public'),
      channel_type = coalesce(channel_type, 'text'),
      is_locked = coalesce(is_locked, false),
      is_system = coalesce(is_system, false),
      max_members = coalesce(max_members, 25),
      updated_at = coalesce(updated_at, now());

    if has_legacy_columns then
      -- Các kênh đã tồn tại là kênh chung của hệ thống.
      update public.channels
      set
        visibility = 'public',
        channel_type = 'text',
        is_system = true,
        is_locked = false,
        max_members = 100;

      if exists(
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'channels'
          and column_name = 'created_by'
      ) then
        execute $sql$
          update public.channels channel
          set owner_id = channel.created_by
          where channel.owner_id is null
            and channel.created_by is not null
            and exists(
              select 1
              from public.profiles profile
              where profile.id = channel.created_by
            )
        $sql$;
      end if;

      -- Bảng cũ giới hạn mô tả 200 ký tự.
      -- Bản mới dùng tối đa 300 ký tự.
      alter table public.channels
        drop constraint if exists
          channels_description_check;
    end if;

    alter table public.channels
      alter column visibility set default 'private',
      alter column visibility set not null,
      alter column channel_type set default 'text',
      alter column channel_type set not null,
      alter column is_locked set default false,
      alter column is_locked set not null,
      alter column is_system set default false,
      alter column is_system set not null,
      alter column max_members set default 25,
      alter column max_members set not null,
      alter column updated_at set default now(),
      alter column updated_at set not null;
  end if;
end
$$;

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  avatar_path text,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  visibility text not null default 'private'
    check (visibility in ('public', 'private')),
  channel_type text not null default 'text'
    check (channel_type in ('text', 'voice', 'both')),
  is_locked boolean not null default false,
  is_system boolean not null default false,
  max_members integer not null default 25
    check (max_members between 2 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(name)) between 2 and 40),
  check (char_length(description) <= 300)
);

-- Bảng cũ có khóa chính là slug. Tạo khóa UNIQUE cho id để
-- các bảng mới có thể dùng foreign key tới public.channels(id).
create unique index if not exists channels_id_uidx
on public.channels(id);

-- Chuẩn hóa các ràng buộc mới cho cả bảng cũ và bảng mới.
do $$
begin
  if not exists(
    select 1
    from pg_constraint
    where conrelid = 'public.channels'::regclass
      and conname = 'channels_visibility_valid'
  ) then
    alter table public.channels
      add constraint channels_visibility_valid
      check (visibility in ('public', 'private'))
      not valid;
  end if;

  if not exists(
    select 1
    from pg_constraint
    where conrelid = 'public.channels'::regclass
      and conname = 'channels_type_valid'
  ) then
    alter table public.channels
      add constraint channels_type_valid
      check (channel_type in ('text', 'voice', 'both'))
      not valid;
  end if;

  if not exists(
    select 1
    from pg_constraint
    where conrelid = 'public.channels'::regclass
      and conname = 'channels_members_valid'
  ) then
    alter table public.channels
      add constraint channels_members_valid
      check (max_members between 2 and 100)
      not valid;
  end if;

  if not exists(
    select 1
    from pg_constraint
    where conrelid = 'public.channels'::regclass
      and conname = 'channels_description_length'
  ) then
    alter table public.channels
      add constraint channels_description_length
      check (char_length(description) <= 300)
      not valid;
  end if;
end
$$;

alter table public.channels
  validate constraint channels_visibility_valid;

alter table public.channels
  validate constraint channels_type_valid;

alter table public.channels
  validate constraint channels_members_valid;

alter table public.channels
  validate constraint channels_description_length;

create table if not exists public.channel_members (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  member_role text not null default 'member'
    check (member_role in ('owner', 'moderator', 'member')),
  joined_at timestamptz not null default now(),
  primary key(channel_id, user_id)
);

create table if not exists public.channel_invites (
  id bigint generated by default as identity primary key,
  channel_id uuid not null references public.channels(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (sender_id <> receiver_id)
);

create unique index if not exists channel_invites_pending_uidx
on public.channel_invites(channel_id, receiver_id)
where status = 'pending';

create table if not exists public.channel_messages (
  id bigint generated by default as identity primary key,
  channel_id uuid not null references public.channels(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text not null default '',
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  check (char_length(content) between 1 and 4000)
);

create index if not exists channel_messages_channel_idx
on public.channel_messages(channel_id, id desc);

create table if not exists public.channel_read_states (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_message_id bigint,
  last_read_at timestamptz not null default now(),
  primary key(channel_id, user_id)
);

create or replace function public.channel_current_role(p_user_id uuid default auth.uid())
returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce((select role from public.user_roles where user_id = p_user_id limit 1), 'member');
$$;

create or replace function public.channel_is_member(p_channel_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists(
    select 1 from public.channel_members m
    where m.channel_id = p_channel_id and m.user_id = p_user_id
  );
$$;

create or replace function public.channel_can_view(p_channel_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists(
    select 1 from public.channels c
    where c.id = p_channel_id
      and (c.visibility = 'public' or public.channel_is_member(c.id, p_user_id))
  );
$$;

create or replace function public.channel_can_manage(p_channel_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists(
    select 1 from public.channels c
    where c.id = p_channel_id
      and (
        c.owner_id = p_user_id
        or public.channel_current_role(p_user_id) = 'admin'
        or (c.visibility = 'public' and public.channel_current_role(p_user_id) = 'moderator')
        or exists(
          select 1 from public.channel_members m
          where m.channel_id = c.id and m.user_id = p_user_id and m.member_role = 'moderator'
        )
      )
  );
$$;

create or replace function public.channel_can_send(p_channel_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists(
    select 1 from public.channels c
    where c.id = p_channel_id
      and c.channel_type in ('text', 'both')
      and public.channel_can_view(c.id, p_user_id)
      and (not c.is_locked or public.channel_can_manage(c.id, p_user_id))
  );
$$;

alter table public.channels enable row level security;

-- Policy của bản kênh cũ cho phép mọi tài khoản đọc mọi kênh.
-- Phải xóa để kênh riêng thực sự riêng tư.
drop policy if exists
  "Authenticated users can read channels"
on public.channels;
alter table public.channel_members enable row level security;
alter table public.channel_invites enable row level security;
alter table public.channel_messages enable row level security;
alter table public.channel_read_states enable row level security;

grant select on public.channels, public.channel_members, public.channel_invites,
  public.channel_messages, public.channel_read_states to authenticated;

drop policy if exists "Visible channels" on public.channels;
create policy "Visible channels" on public.channels for select to authenticated
using (public.channel_can_view(id, auth.uid()));

drop policy if exists "Visible channel members" on public.channel_members;
create policy "Visible channel members" on public.channel_members for select to authenticated
using (public.channel_can_view(channel_id, auth.uid()));

drop policy if exists "Invite participants" on public.channel_invites;
create policy "Invite participants" on public.channel_invites for select to authenticated
using (
  auth.uid() = sender_id or auth.uid() = receiver_id
  or public.channel_can_manage(channel_id, auth.uid())
);

drop policy if exists "Visible channel messages" on public.channel_messages;
create policy "Visible channel messages" on public.channel_messages for select to authenticated
using (public.channel_can_view(channel_id, auth.uid()));

drop policy if exists "Own channel read states" on public.channel_read_states;
create policy "Own channel read states" on public.channel_read_states for select to authenticated
using (auth.uid() = user_id);

create or replace function public.channel_slug(p_name text)
returns text language sql immutable set search_path = ''
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function public.get_visible_channels()
returns table(
  id uuid, slug text, name text, description text, avatar_path text,
  owner_id uuid, visibility text, channel_type text, is_locked boolean,
  is_system boolean, created_at timestamptz, member_role text,
  member_ids uuid[], member_count bigint, unread_count bigint, can_manage boolean
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
    public.channel_can_manage(c.id, auth.uid())
  from public.channels c
  left join public.channel_members me
    on me.channel_id = c.id and me.user_id = auth.uid()
  where public.channel_can_view(c.id, auth.uid())
  order by c.is_system desc, c.created_at asc;
$$;

create or replace function public.get_channel_detail(p_channel_id uuid)
returns table(
  id uuid, slug text, name text, description text, avatar_path text,
  owner_id uuid, visibility text, channel_type text, is_locked boolean,
  is_system boolean, created_at timestamptz, member_role text,
  member_ids uuid[], member_count bigint, unread_count bigint, can_manage boolean
)
language sql stable security definer set search_path = ''
as $$ select * from public.get_visible_channels() where id = p_channel_id; $$;

create or replace function public.get_channel_members(p_channel_id uuid)
returns table(
  id uuid, username text, avatar_url text, public_id bigint,
  role text, channel_role text, joined_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.username, p.avatar_url, p.public_id,
    coalesce(r.role, 'member'), m.member_role, m.joined_at
  from public.channel_members m
  join public.profiles p on p.id = m.user_id
  left join public.user_roles r on r.user_id = p.id
  where m.channel_id = p_channel_id
    and public.channel_can_view(p_channel_id, auth.uid())
  order by case m.member_role when 'owner' then 0 when 'moderator' then 1 else 2 end,
    p.username;
$$;

create or replace function public.get_channel_invites()
returns table(
  invite_id bigint, channel_id uuid, channel_name text,
  channel_avatar_path text, channel_type text, sender_id uuid,
  sender_username text, sender_avatar_url text, created_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select i.id, c.id, c.name, c.avatar_path, c.channel_type,
    p.id, p.username, p.avatar_url, i.created_at
  from public.channel_invites i
  join public.channels c on c.id = i.channel_id
  join public.profiles p on p.id = i.sender_id
  where i.receiver_id = auth.uid() and i.status = 'pending'
  order by i.created_at desc;
$$;

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
    select count(*) from public.channels c where c.owner_id = uid and c.visibility = 'private'
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

create or replace function public.respond_channel_invite(p_invite_id bigint, p_response text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare i public.channel_invites; c public.channels;
begin
  if p_response not in ('accepted', 'declined') then raise exception 'Phản hồi không hợp lệ.'; end if;
  select * into i from public.channel_invites where id = p_invite_id for update;
  if not found then raise exception 'Không tìm thấy lời mời.'; end if;
  if i.receiver_id <> auth.uid() then raise exception 'Bạn không thể xử lý lời mời này.' using errcode = '42501'; end if;
  if i.status <> 'pending' then return i.channel_id; end if;
  select * into c from public.channels where id = i.channel_id;
  if p_response = 'accepted' then
    if (select count(*) from public.channel_members m where m.channel_id = c.id) >= c.max_members then
      raise exception 'Kênh đã đủ thành viên.';
    end if;
    insert into public.channel_members(channel_id, user_id, member_role)
    values(c.id, auth.uid(), 'member') on conflict do nothing;
    insert into public.channel_read_states(channel_id, user_id)
    values(c.id, auth.uid()) on conflict do nothing;
  end if;
  update public.channel_invites set status = p_response, responded_at = now() where id = p_invite_id;
  return i.channel_id;
end;
$$;

create or replace function public.invite_to_channel(p_channel_id uuid, p_receiver_id uuid)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare result_id bigint; c public.channels;
begin
  if not public.channel_can_manage(p_channel_id, auth.uid()) then raise exception 'Bạn không có quyền mời thành viên.' using errcode = '42501'; end if;
  select * into c from public.channels where id = p_channel_id;
  if c.visibility <> 'private' then raise exception 'Kênh chung không cần lời mời.'; end if;
  if not public.are_friends(auth.uid(), p_receiver_id) then raise exception 'Chỉ được mời người đã kết bạn.'; end if;
  if public.channel_is_member(p_channel_id, p_receiver_id) then raise exception 'Người này đã ở trong kênh.'; end if;
  insert into public.channel_invites(channel_id, sender_id, receiver_id)
  values(p_channel_id, auth.uid(), p_receiver_id) returning id into result_id;
  return result_id;
exception when unique_violation then raise exception 'Lời mời đang chờ xử lý.';
end;
$$;

create or replace function public.update_channel(
  p_channel_id uuid, p_name text, p_description text, p_channel_type text,
  p_visibility text, p_is_locked boolean
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare role_name text := public.channel_current_role(auth.uid()); clean_name text := trim(p_name);
begin
  if not public.channel_can_manage(p_channel_id, auth.uid()) then raise exception 'Bạn không có quyền sửa kênh.' using errcode = '42501'; end if;
  if char_length(clean_name) not between 2 and 40 then raise exception 'Tên kênh phải có từ 2 đến 40 ký tự.'; end if;
  if p_visibility = 'public' and role_name not in ('admin', 'moderator') then raise exception 'TV không được chuyển thành kênh chung.'; end if;
  update public.channels set name = clean_name, description = trim(coalesce(p_description, '')),
    channel_type = p_channel_type, visibility = p_visibility, is_locked = coalesce(p_is_locked, false),
    updated_at = now() where id = p_channel_id;
  return true;
end;
$$;

create or replace function public.set_channel_avatar(p_channel_id uuid, p_avatar_path text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.channel_can_manage(p_channel_id, auth.uid()) then raise exception 'Bạn không có quyền đổi avatar.' using errcode = '42501'; end if;
  update public.channels set avatar_path = nullif(trim(p_avatar_path), ''), updated_at = now() where id = p_channel_id;
  return true;
end;
$$;

create or replace function public.remove_channel_member(p_channel_id uuid, p_member_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.channel_can_manage(p_channel_id, auth.uid()) then raise exception 'Bạn không có quyền xóa thành viên.' using errcode = '42501'; end if;
  if exists(select 1 from public.channels c where c.id = p_channel_id and c.owner_id = p_member_id) then raise exception 'Không thể xóa chủ kênh.'; end if;
  delete from public.channel_members where channel_id = p_channel_id and user_id = p_member_id;
  delete from public.channel_read_states where channel_id = p_channel_id and user_id = p_member_id;
  return true;
end;
$$;

create or replace function public.leave_channel(p_channel_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if exists(select 1 from public.channels c where c.id = p_channel_id and c.owner_id = auth.uid()) then
    raise exception 'Chủ kênh phải xóa kênh thay vì rời.';
  end if;
  delete from public.channel_members where channel_id = p_channel_id and user_id = auth.uid();
  delete from public.channel_read_states where channel_id = p_channel_id and user_id = auth.uid();
  return true;
end;
$$;

create or replace function public.delete_channel(p_channel_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.channel_can_manage(p_channel_id, auth.uid()) then raise exception 'Bạn không có quyền xóa kênh.' using errcode = '42501'; end if;
  if exists(select 1 from public.channels c where c.id = p_channel_id and c.is_system) then raise exception 'Không thể xóa kênh hệ thống.'; end if;
  delete from public.channels where id = p_channel_id;
  return true;
end;
$$;

create or replace function public.get_channel_messages(p_channel_id uuid, p_limit integer default 100)
returns table(
  id bigint, channel_id uuid, sender_id uuid, sender_username text,
  sender_avatar_url text, sender_public_id bigint, sender_role text,
  content text, created_at timestamptz, edited_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select m.id, m.channel_id, m.sender_id, p.username, p.avatar_url, p.public_id,
    coalesce(r.role, 'member'), m.content, m.created_at, m.edited_at
  from public.channel_messages m
  join public.profiles p on p.id = m.sender_id
  left join public.user_roles r on r.user_id = p.id
  where m.channel_id = p_channel_id and public.channel_can_view(p_channel_id, auth.uid())
  order by m.id desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

create or replace function public.send_channel_message(p_channel_id uuid, p_content text)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare result_id bigint; clean_content text := trim(coalesce(p_content, ''));
begin
  if not public.channel_can_send(p_channel_id, auth.uid()) then raise exception 'Bạn không thể gửi tin vào kênh này.' using errcode = '42501'; end if;
  if char_length(clean_content) not between 1 and 4000 then raise exception 'Tin nhắn phải có từ 1 đến 4000 ký tự.'; end if;
  insert into public.channel_messages(channel_id, sender_id, content)
  values(p_channel_id, auth.uid(), clean_content) returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.mark_channel_read(p_channel_id uuid, p_message_id bigint default null)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare target_id bigint;
begin
  if not public.channel_can_view(p_channel_id, auth.uid()) then raise exception 'Bạn không thể đọc kênh này.'; end if;
  target_id := coalesce(p_message_id, (select max(id) from public.channel_messages where channel_id = p_channel_id));
  insert into public.channel_read_states(channel_id, user_id, last_read_message_id, last_read_at)
  values(p_channel_id, auth.uid(), target_id, now())
  on conflict(channel_id, user_id) do update set
    last_read_message_id = greatest(coalesce(public.channel_read_states.last_read_message_id, 0), coalesce(excluded.last_read_message_id, 0)),
    last_read_at = now();
  return true;
end;
$$;

revoke all on function public.get_visible_channels() from public;
revoke all on function public.get_channel_detail(uuid) from public;
revoke all on function public.get_channel_members(uuid) from public;
revoke all on function public.get_channel_invites() from public;
revoke all on function public.create_channel(text,text,text,text,uuid[]) from public;
revoke all on function public.respond_channel_invite(bigint,text) from public;
revoke all on function public.invite_to_channel(uuid,uuid) from public;
revoke all on function public.update_channel(uuid,text,text,text,text,boolean) from public;
revoke all on function public.set_channel_avatar(uuid,text) from public;
revoke all on function public.remove_channel_member(uuid,uuid) from public;
revoke all on function public.leave_channel(uuid) from public;
revoke all on function public.delete_channel(uuid) from public;
revoke all on function public.get_channel_messages(uuid,integer) from public;
revoke all on function public.send_channel_message(uuid,text) from public;
revoke all on function public.mark_channel_read(uuid,bigint) from public;

grant execute on function public.get_visible_channels() to authenticated;
grant execute on function public.get_channel_detail(uuid) to authenticated;
grant execute on function public.get_channel_members(uuid) to authenticated;
grant execute on function public.get_channel_invites() to authenticated;
grant execute on function public.create_channel(text,text,text,text,uuid[]) to authenticated;
grant execute on function public.respond_channel_invite(bigint,text) to authenticated;
grant execute on function public.invite_to_channel(uuid,uuid) to authenticated;
grant execute on function public.update_channel(uuid,text,text,text,text,boolean) to authenticated;
grant execute on function public.set_channel_avatar(uuid,text) to authenticated;
grant execute on function public.remove_channel_member(uuid,uuid) to authenticated;
grant execute on function public.leave_channel(uuid) to authenticated;
grant execute on function public.delete_channel(uuid) to authenticated;
grant execute on function public.get_channel_messages(uuid,integer) to authenticated;
grant execute on function public.send_channel_message(uuid,text) to authenticated;
grant execute on function public.mark_channel_read(uuid,bigint) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values('channel-avatars', 'channel-avatars', true, 5242880,
  array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Channel managers upload avatars" on storage.objects;
create policy "Channel managers upload avatars" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'channel-avatars'
  and public.channel_can_manage(((storage.foldername(name))[2])::uuid, auth.uid())
);

drop policy if exists "Channel managers update avatars" on storage.objects;
create policy "Channel managers update avatars" on storage.objects
for update to authenticated
using (
  bucket_id = 'channel-avatars'
  and public.channel_can_manage(((storage.foldername(name))[2])::uuid, auth.uid())
)
with check (
  bucket_id = 'channel-avatars'
  and public.channel_can_manage(((storage.foldername(name))[2])::uuid, auth.uid())
);

drop policy if exists "Channel managers delete avatars" on storage.objects;
create policy "Channel managers delete avatars" on storage.objects
for delete to authenticated
using (
  bucket_id = 'channel-avatars'
  and public.channel_can_manage(((storage.foldername(name))[2])::uuid, auth.uid())
);

-- Thêm khóa ngoại owner_id cho bảng được nâng cấp từ bản cũ.
-- owner_id được phép NULL đối với kênh hệ thống cũ.
do $$
begin
  if not exists(
    select 1
    from pg_constraint
    where conrelid = 'public.channels'::regclass
      and conname = 'channels_owner_id_fkey'
  ) then
    alter table public.channels
      add constraint channels_owner_id_fkey
      foreign key(owner_id)
      references public.profiles(id)
      on delete set null
      not valid;
  end if;
end
$$;

alter table public.channels
  validate constraint channels_owner_id_fkey;

alter table public.channels replica identity full;
alter table public.channel_members replica identity full;
alter table public.channel_invites replica identity full;
alter table public.channel_messages replica identity full;
alter table public.channel_read_states replica identity full;

do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='channels') then alter publication supabase_realtime add table public.channels; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='channel_members') then alter publication supabase_realtime add table public.channel_members; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='channel_invites') then alter publication supabase_realtime add table public.channel_invites; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='channel_messages') then alter publication supabase_realtime add table public.channel_messages; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='channel_read_states') then alter publication supabase_realtime add table public.channel_read_states; end if;
end $$;
