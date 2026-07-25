-- FILE VÀ ẢNH TRONG CHAT CHUNG
-- Chạy toàn bộ file trong Supabase SQL Editor.

alter table public.messages
  add column if not exists attachment_type text,
  add column if not exists attachment_size bigint;

comment on column public.messages.attachment_type
  is 'MIME type của tệp đính kèm trong chat chung';

comment on column public.messages.attachment_size
  is 'Dung lượng tệp đính kèm theo byte';

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'chat-files',
  'chat-files',
  true,
  20971520,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip',
    'text/plain'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists
  "Authenticated users upload chat files"
on storage.objects;

create policy
  "Authenticated users upload chat files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'chat-files'
  and auth.uid()::text =
    (storage.foldername(name))[1]
);

drop policy if exists
  "Owners delete chat files"
on storage.objects;

create policy
  "Owners delete chat files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'chat-files'
  and auth.uid()::text =
    (storage.foldername(name))[1]
);
