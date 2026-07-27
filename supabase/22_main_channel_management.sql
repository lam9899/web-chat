-- TALK CÙNG LÂM DZ — QUẢN LÝ KÊNH CHÍNH
-- Chạy SAU 20_dynamic_channels.sql và 21_servers.sql.
--
-- Cho phép AD, QT hoặc chủ kênh xóa các kênh cũ ở khu vực chính.
-- Migration 20 đã đánh dấu toàn bộ kênh cũ là is_system = true,
-- vì vậy hàm cũ chặn nhầm cả những kênh phụ do quản trị viên tạo.
-- Chỉ giữ lại #chung mặc định (slug = 'chung') để ứng dụng luôn có
-- một kênh văn bản chính.

create or replace function public.delete_channel(p_channel_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.channels;
begin
  if auth.uid() is null then
    raise exception 'Bạn chưa đăng nhập.' using errcode = '42501';
  end if;

  select *
  into target
  from public.channels
  where id = p_channel_id;

  if not found then
    raise exception 'Kênh không tồn tại.';
  end if;

  if not public.channel_can_manage(p_channel_id, auth.uid()) then
    raise exception 'Bạn không có quyền xóa kênh.'
      using errcode = '42501';
  end if;

  if target.server_id is null
    and target.is_system
    and target.slug = 'chung'
  then
    raise exception 'Không thể xóa #chung mặc định.';
  end if;

  -- Tin nhắn của khu vực chính dùng slug cũ thay vì khóa ngoại UUID.
  -- Xóa chúng trước để thao tác xóa kênh không để lại dữ liệu mồ côi.
  if target.server_id is null then
    delete from public.messages
    where channel = target.slug;
  end if;

  delete from public.channels
  where id = p_channel_id;

  return true;
end;
$$;

revoke all on function public.delete_channel(uuid) from public;
grant execute on function public.delete_channel(uuid) to authenticated;
