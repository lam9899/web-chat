-- CÀI ĐẶT RIÊNG CHO TỪNG CUỘC TRÒ CHUYỆN
-- Lưu màu đoạn chat, chuông thông báo và trạng thái bật/tắt thông báo.

create table if not exists public.private_chat_preferences (
  user_id uuid not null
    references public.profiles(id)
    on delete cascade,
  other_user_id uuid not null
    references public.profiles(id)
    on delete cascade,
  chat_color text not null default 'indigo'
    check (
      chat_color in (
        'indigo',
        'blue',
        'green',
        'pink',
        'orange',
        'red'
      )
    ),
  notification_tone text not null default 'default'
    check (
      notification_tone in (
        'default',
        'soft',
        'bell',
        'off'
      )
    ),
  notifications_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, other_user_id),
  constraint private_chat_preferences_different_users
    check (user_id <> other_user_id)
);

alter table public.private_chat_preferences
enable row level security;

drop policy if exists
  "Users can read own private chat preferences"
on public.private_chat_preferences;

create policy
  "Users can read own private chat preferences"
on public.private_chat_preferences
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists
  "Users can insert own private chat preferences"
on public.private_chat_preferences;

create policy
  "Users can insert own private chat preferences"
on public.private_chat_preferences
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists
  "Users can update own private chat preferences"
on public.private_chat_preferences;

create policy
  "Users can update own private chat preferences"
on public.private_chat_preferences
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists
  "Users can delete own private chat preferences"
on public.private_chat_preferences;

create policy
  "Users can delete own private chat preferences"
on public.private_chat_preferences
for delete
to authenticated
using (auth.uid() = user_id);

grant select, insert, update, delete
on public.private_chat_preferences
to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'private_chat_preferences'
  ) then
    alter publication supabase_realtime
      add table public.private_chat_preferences;
  end if;
end
$$;
