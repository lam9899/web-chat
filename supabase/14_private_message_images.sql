-- GỬI ẢNH TRONG TIN NHẮN RIÊNG
-- Chạy toàn bộ file trong Supabase SQL Editor.

alter table public.direct_messages
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists attachment_type text,
  add column if not exists attachment_size bigint;

comment on column public.direct_messages.attachment_path
  is 'Đường dẫn tệp trong Supabase Storage';

comment on column public.direct_messages.attachment_name
  is 'Tên tệp gốc';

comment on column public.direct_messages.attachment_type
  is 'MIME type của tệp';

comment on column public.direct_messages.attachment_size
  is 'Dung lượng tệp theo byte';

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'private-message-media',
  'private-message-media',
  false,
  5242880,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists
  "Private message media insert"
on storage.objects;

create policy
  "Private message media insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'private-message-media'
  and auth.uid()::text =
    (storage.foldername(name))[1]
);

drop policy if exists
  "Private message media select"
on storage.objects;

create policy
  "Private message media select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'private-message-media'
  and (
    auth.uid()::text =
      (storage.foldername(name))[1]
    or
    auth.uid()::text =
      (storage.foldername(name))[2]
  )
);

drop policy if exists
  "Private message media delete"
on storage.objects;

create policy
  "Private message media delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'private-message-media'
  and auth.uid()::text =
    (storage.foldername(name))[1]
);
