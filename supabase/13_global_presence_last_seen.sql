-- ONLINE TOÀN WEBSITE + THỜI GIAN HOẠT ĐỘNG GẦN NHẤT
-- Chạy một lần sau 11_friendships_ids_roles.sql.

alter table public.profiles
  add column if not exists last_seen_at timestamptz;

update public.profiles
set last_seen_at = coalesce(last_seen_at, updated_at, created_at, now())
where last_seen_at is null;

create index if not exists profiles_last_seen_at_idx
on public.profiles (last_seen_at desc);

create or replace function public.touch_my_presence()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  touched_at timestamptz := now();
begin
  if current_user_id is null then
    raise exception 'Bạn chưa đăng nhập.'
      using errcode = '42501';
  end if;

  update public.profiles
  set last_seen_at = touched_at
  where id = current_user_id;

  return touched_at;
end;
$$;

revoke all
on function public.touch_my_presence()
from public;

grant execute
on function public.touch_my_presence()
to authenticated;

-- Cần tạo lại vì kiểu trả về được bổ sung cột last_seen_at.
drop function if exists public.get_my_friends();

create function public.get_my_friends()
returns table(
  id uuid,
  username text,
  avatar_url text,
  public_id bigint,
  role text,
  created_at timestamptz,
  last_seen_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.username,
    p.avatar_url,
    p.public_id,
    coalesce(r.role, 'member') as role,
    f.created_at,
    p.last_seen_at
  from public.friendships f
  join public.profiles p
    on p.id = f.friend_id
  left join public.user_roles r
    on r.user_id = p.id
  where f.user_id = auth.uid()
  order by p.username asc;
$$;

revoke all
on function public.get_my_friends()
from public;

grant execute
on function public.get_my_friends()
to authenticated;
