# Tính năng SERVER (giống Discord) — Hướng dẫn triển khai

## Cách hoạt động

Mỗi **server** có nhiều kênh văn bản + kênh thoại riêng, giống Discord:

- Cột ngoài cùng bên trái giờ hiển thị: nút Kênh chung → **danh sách server** → các kênh đơn lẻ kiểu cũ → nút **+** → chuông lời mời.
- Ai cũng tạo được kênh tổng/server (tối đa 5 kênh tổng/người). Kênh tổng mới có sẵn kênh `#chung` và `🔊 Phòng trò chuyện`.
- Tham gia bằng **mã mời** 12 ký tự (bấm + → "Nhập mã mời"). Mọi thành viên xem được mã để chia sẻ; chủ server/quản lý đổi được mã mới.
- Trong server: chủ server và quản lý (🛡️) tạo/sửa/xóa kênh, sửa thông tin server, kick thành viên; chủ server phong/bỏ quản lý và xóa server.
- Danh sách thành viên hiển thị nhãn AD/QT/TV, ID 6 số, online/offline và thời gian hoạt động gần nhất.
- Kênh thoại hiển thị người đang ở trong phòng ngay dưới tên kênh; khi đã tham gia, người đang nói có viền xanh theo thời gian thực.
- Trên điện thoại có nút nổi ☰ ở góc dưới bên trái để mở danh sách server/kênh.
- Các kênh đơn lẻ kiểu cũ (#chung, #test, kênh riêng đã tạo) **giữ nguyên, không ảnh hưởng**.

## Bước 1 — Chạy SQL (bắt buộc, trước khi deploy code)

Nếu chưa từng chạy `supabase/20_dynamic_channels.sql`, hãy chạy file 20 trước.
Sau đó mở **Supabase Dashboard → SQL Editor**, dán toàn bộ nội dung file
`supabase/21_servers.sql` và bấm Run. Chạy được nhiều lần không sao (idempotent).

File này tạo bảng `servers`, `server_members`, thêm cột `channels.server_id`,
RLS, các hàm RPC (`create_server`, `join_server_with_code`, `get_my_servers`...)
và policy storage cho avatar server.

## Bước 2 — Deploy code

Các file đã thay đổi/thêm mới:

| File | Thay đổi |
|---|---|
| `supabase/21_servers.sql` | **MỚI** — toàn bộ schema + RPC server |
| `app/servers/[serverId]/page.tsx` | **MỚI** — giao diện server (sidebar kênh, chat, voice, thành viên, các modal) |
| `app/channel-rail.tsx` | Rail hiển thị server; nút + mở modal Tạo server / Nhập mã mời |
| `app/channel-types.ts` | Thêm type `ServerSummary`, `ServerMember`...; `DynamicChannel.server_id` |
| `app/channel-voice-room.tsx` | Đồng bộ người trong phòng và trạng thái đang nói với sidebar |
| `app/api/channel-voice-participants/route.ts` | Đọc an toàn danh sách người trong các phòng LiveKit mà người dùng được phép xem |
| `app/api/channel-livekit-token/route.ts` | Gắn avatar người dùng vào metadata LiveKit |
| `app/channels/[channelId]/page.tsx` | Kênh thuộc server tự chuyển hướng sang giao diện server |

Commit + push như bình thường, Vercel tự build. Bản này đã được kiểm tra
TypeScript, lint cho các file thay đổi và `next build`.

Lưu ý: nếu deploy code **trước** khi chạy SQL, app vẫn chạy nhưng phần server
sẽ trống (rail bỏ qua lỗi RPC chưa tồn tại). Cứ chạy SQL là hiện.

## Kiến trúc (để sau này mở rộng)

Kênh trong server vẫn là row trong bảng `channels` (có `server_id`), nên
tin nhắn, unread, khóa kênh, LiveKit voice **dùng lại toàn bộ hạ tầng cũ**.
Quyền xem/gửi được quyết định ở 2 hàm `channel_can_view` / `channel_can_manage`
(đã nâng cấp): kênh có `server_id` → theo thành viên server; kênh cũ → như trước.

Muốn thêm tính năng sau này (ghim tin, phân quyền theo kênh, category...)
chỉ cần mở rộng từ 2 hàm này và bảng `channels`.

## Giới hạn hiện tại

- Tối đa 5 server/người, 30 kênh/server, 100 thành viên/server (đổi trong SQL: `max_members`).
- Danh sách phòng thoại khi chưa tham gia làm mới khoảng 8 giây/lần; viền nói xanh cập nhật trực tiếp sau khi bạn vào phòng.
- Tin nhắn kênh chưa có sửa/xóa/reply/reactions như tin nhắn riêng — có thể đồng bộ ở giai đoạn sau.
