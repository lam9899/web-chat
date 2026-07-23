self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Không cache dữ liệu chat để tránh hiển thị nội dung cũ hoặc riêng tư.
// Service worker này chỉ giúp ứng dụng đáp ứng điều kiện cài đặt PWA.
self.addEventListener("fetch", () => {});
