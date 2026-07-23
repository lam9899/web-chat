"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import InstallAppButton from "../install-app-button";
import {
  getNotificationPermission,
  getNotificationsEnabled,
  getSoundEnabled,
  playNotificationSound,
  requestNotificationPermission,
  setNotificationsEnabled,
  setSoundEnabled,
  supportsBrowserNotifications,
} from "@/utils/notifications";

const supabase = createClient();

function safeFileName(fileName: string) {
  return fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
}

export default function SettingsPage() {
  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [notificationsSupported, setNotificationsSupported] =
    useState(false);
  const [notificationPermission, setNotificationPermission] =
    useState<
      NotificationPermission | "unsupported"
    >("unsupported");
  const [notificationsEnabled, setNotificationEnabledState] =
    useState(false);
  const [soundEnabled, setSoundEnabledState] =
    useState(false);
  const [requestingNotification, setRequestingNotification] =
    useState(false);

  useEffect(() => {
    const supported = supportsBrowserNotifications();

    setNotificationsSupported(supported);
    setNotificationPermission(
      getNotificationPermission(),
    );
    setNotificationEnabledState(
      getNotificationsEnabled(),
    );
    setSoundEnabledState(getSoundEnabled());
  }, []);

  useEffect(() => {
    let active = true;

    async function loadUser() {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error || !user) {
        window.location.href = "/login";
        return;
      }

      if (!active) return;

      setUserId(user.id);
      setEmail(user.email ?? "");
      setUsername(
        user.user_metadata?.username ||
          user.email?.split("@")[0] ||
          "Bạn",
      );
      setAvatarUrl(user.user_metadata?.avatar_url || "");

      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!active) return;

      setIsAdmin(roleData?.role === "admin");
      setLoading(false);
    }

    void loadUser();

    return () => {
      active = false;
    };
  }, []);

  function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setErrorMessage("Vui lòng chọn một file ảnh.");
      event.target.value = "";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setErrorMessage("Ảnh đại diện phải nhỏ hơn hoặc bằng 5 MB.");
      event.target.value = "";
      return;
    }

    setAvatarFile(file);
    setErrorMessage("");
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanUsername = username.trim();

    if (cleanUsername.length < 2) {
      setErrorMessage("Tên hiển thị phải có ít nhất 2 ký tự.");
      return;
    }

    setSavingProfile(true);
    setNotice("");
    setErrorMessage("");

    try {
      let nextAvatarUrl = avatarUrl;

      if (avatarFile) {
        const path = `${userId}/${Date.now()}-${safeFileName(
          avatarFile.name,
        )}`;

        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(path, avatarFile, {
            cacheControl: "3600",
            upsert: false,
            contentType: avatarFile.type,
          });

        if (uploadError) {
          throw new Error(uploadError.message);
        }

        const { data } = supabase.storage
          .from("avatars")
          .getPublicUrl(path);

        nextAvatarUrl = data.publicUrl;
      }

      const { error } = await supabase.auth.updateUser({
        data: {
          username: cleanUsername,
          avatar_url: nextAvatarUrl,
        },
      });

      if (error) {
        throw new Error(error.message);
      }

      setUsername(cleanUsername);
      setAvatarUrl(nextAvatarUrl);
      setAvatarFile(null);
      setNotice("Đã lưu hồ sơ.");
    } catch (error) {
      setErrorMessage(
        `Không thể lưu hồ sơ: ${
          error instanceof Error ? error.message : "Lỗi không xác định"
        }`,
      );
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (newPassword.length < 8) {
      setErrorMessage("Mật khẩu mới phải có ít nhất 8 ký tự.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage("Hai mật khẩu chưa khớp.");
      return;
    }

    setSavingPassword(true);
    setNotice("");
    setErrorMessage("");

    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      setErrorMessage(`Không thể đổi mật khẩu: ${error.message}`);
    } else {
      setNewPassword("");
      setConfirmPassword("");
      setNotice("Đã đổi mật khẩu thành công.");
    }

    setSavingPassword(false);
  }

  async function enableBrowserNotifications() {
    setRequestingNotification(true);
    setNotice("");
    setErrorMessage("");

    const permission =
      await requestNotificationPermission();

    setNotificationPermission(permission);
    setNotificationEnabledState(
      permission === "granted",
    );

    if (permission === "granted") {
      setNotice(
        "Đã bật thông báo trên trình duyệt này.",
      );
    } else if (permission === "denied") {
      setErrorMessage(
        "Trình duyệt đã chặn thông báo. Hãy bấm biểu tượng ổ khóa cạnh địa chỉ website để cho phép lại.",
      );
    } else if (permission === "unsupported") {
      setErrorMessage(
        "Trình duyệt này không hỗ trợ thông báo hệ thống.",
      );
    }

    setRequestingNotification(false);
  }

  function disableBrowserNotifications() {
    setNotificationsEnabled(false);
    setNotificationEnabledState(false);
    setNotice(
      "Đã tắt thông báo trong Talk Cùng Lâm DZ.",
    );
    setErrorMessage("");
  }

  function toggleSoundNotification() {
    const nextValue = !soundEnabled;

    setSoundEnabled(nextValue);
    setSoundEnabledState(nextValue);
    setNotice(
      nextValue
        ? "Đã bật âm thanh thông báo."
        : "Đã tắt âm thanh thông báo.",
    );
    setErrorMessage("");

    if (nextValue) {
      void playNotificationSound();
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#1e1f22] text-white">
        <p>Đang tải cài đặt...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#1e1f22] px-4 py-8 text-white">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Cài đặt</h1>
            <p className="mt-1 text-sm text-gray-400">
              Quản lý hồ sơ và mật khẩu của bạn
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              window.location.href = "/";
            }}
            className="rounded-md bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15"
          >
            Quay lại phòng chat
          </button>
        </header>

        {errorMessage && (
          <div className="mb-5 rounded-md bg-red-500/15 px-4 py-3 text-sm text-red-300">
            {errorMessage}
          </div>
        )}

        {notice && (
          <div className="mb-5 rounded-md bg-green-500/15 px-4 py-3 text-sm text-green-300">
            {notice}
          </div>
        )}

        <section className="mb-6 rounded-xl bg-[#313338] p-6 shadow-xl">
          <h2 className="mb-5 text-xl font-bold">Hồ sơ</h2>

          <form onSubmit={saveProfile} className="space-y-5">
            <div className="flex items-center gap-4">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={username}
                  className="h-20 w-20 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-indigo-500 text-3xl font-bold">
                  {username.charAt(0).toUpperCase()}
                </div>
              )}

              <div className="min-w-0">
                <p className="truncate font-semibold">{username}</p>
                <p className="truncate text-sm text-gray-400">{email}</p>
              </div>
            </div>

            <div>
              <label
                htmlFor="username"
                className="mb-2 block text-xs font-bold uppercase text-gray-300"
              >
                Tên hiển thị
              </label>

              <input
                id="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                minLength={2}
                maxLength={30}
                required
                className="w-full rounded-md bg-[#1e1f22] px-4 py-3 outline-none ring-indigo-500 focus:ring-2"
              />
            </div>

            <div>
              <label
                htmlFor="avatar"
                className="mb-2 block text-xs font-bold uppercase text-gray-300"
              >
                Ảnh đại diện mới
              </label>

              <input
                id="avatar"
                type="file"
                accept="image/*"
                onChange={chooseAvatar}
                className="block w-full rounded-md bg-[#1e1f22] px-4 py-3 text-sm text-gray-300"
              />

              <p className="mt-2 text-xs text-gray-500">
                Chỉ dùng file ảnh, tối đa 5 MB.
              </p>
            </div>

            <button
              type="submit"
              disabled={savingProfile}
              className="rounded-md bg-indigo-500 px-5 py-3 font-semibold hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingProfile ? "Đang lưu..." : "Lưu hồ sơ"}
            </button>
          </form>
        </section>



        <section className="mb-6 rounded-xl bg-[#313338] p-6 shadow-xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold">
                Cài ứng dụng
              </h2>

              <p className="mt-2 text-sm text-gray-400">
                Cài Talk Cùng Lâm DZ lên máy tính hoặc điện thoại để mở như một ứng dụng riêng.
              </p>
            </div>

            <InstallAppButton />
          </div>

          <p className="mt-4 text-xs text-gray-500">
            Trên Chrome, nút chỉ sáng khi website đáp ứng điều kiện cài đặt. Bạn cũng có thể bấm biểu tượng cài đặt ở cuối thanh địa chỉ.
          </p>
        </section>

        <section className="mb-6 rounded-xl bg-[#313338] p-6 shadow-xl">
          <h2 className="text-xl font-bold">
            Thông báo
          </h2>

          <p className="mt-2 text-sm text-gray-400">
            Nhận thông báo và âm thanh khi có tin nhắn riêng mới.
          </p>

          <div className="mt-5 space-y-4">
            <div className="flex flex-col gap-4 rounded-lg bg-[#1e1f22] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold">
                  Thông báo trên máy tính
                </h3>

                <p className="mt-1 text-sm text-gray-400">
                  Trạng thái:{" "}
                  {notificationPermission === "granted" &&
                  notificationsEnabled
                    ? "Đang bật"
                    : notificationPermission === "denied"
                      ? "Đã bị trình duyệt chặn"
                      : notificationsSupported
                        ? "Đang tắt"
                        : "Không được hỗ trợ"}
                </p>
              </div>

              {notificationPermission === "granted" &&
              notificationsEnabled ? (
                <button
                  type="button"
                  onClick={disableBrowserNotifications}
                  className="rounded-md bg-white/10 px-4 py-2 font-semibold hover:bg-white/15"
                >
                  Tắt thông báo
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    void enableBrowserNotifications()
                  }
                  disabled={
                    requestingNotification ||
                    !notificationsSupported ||
                    notificationPermission === "denied"
                  }
                  className="rounded-md bg-indigo-500 px-4 py-2 font-semibold hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {requestingNotification
                    ? "Đang xin quyền..."
                    : "Bật thông báo"}
                </button>
              )}
            </div>

            <div className="flex flex-col gap-4 rounded-lg bg-[#1e1f22] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold">
                  Âm thanh tin nhắn
                </h3>

                <p className="mt-1 text-sm text-gray-400">
                  Phát một âm ngắn khi có tin nhắn riêng mới.
                </p>
              </div>

              <button
                type="button"
                onClick={toggleSoundNotification}
                className={`rounded-md px-4 py-2 font-semibold ${
                  soundEnabled
                    ? "bg-green-600 hover:bg-green-500"
                    : "bg-white/10 hover:bg-white/15"
                }`}
              >
                {soundEnabled ? "Đang bật" : "Đang tắt"}
              </button>
            </div>
          </div>

          <p className="mt-4 text-xs text-gray-500">
            Phiên bản này thông báo khi website đang mở hoặc đang
            nằm ở tab nền. Muốn nhận khi đã đóng hoàn toàn trình
            duyệt cần thêm Push API và service worker.
          </p>
        </section>

        <section className="mb-6 rounded-xl bg-[#313338] p-6 shadow-xl">
          <h2 className="mb-5 text-xl font-bold">Đổi mật khẩu</h2>

          <form onSubmit={changePassword} className="space-y-5">
            <div>
              <label
                htmlFor="new-password"
                className="mb-2 block text-xs font-bold uppercase text-gray-300"
              >
                Mật khẩu mới
              </label>

              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                minLength={8}
                autoComplete="new-password"
                required
                className="w-full rounded-md bg-[#1e1f22] px-4 py-3 outline-none ring-indigo-500 focus:ring-2"
              />
            </div>

            <div>
              <label
                htmlFor="confirm-password"
                className="mb-2 block text-xs font-bold uppercase text-gray-300"
              >
                Nhập lại mật khẩu
              </label>

              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(event.target.value)
                }
                minLength={8}
                autoComplete="new-password"
                required
                className="w-full rounded-md bg-[#1e1f22] px-4 py-3 outline-none ring-indigo-500 focus:ring-2"
              />
            </div>

            <button
              type="submit"
              disabled={savingPassword}
              className="rounded-md bg-indigo-500 px-5 py-3 font-semibold hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingPassword
                ? "Đang đổi mật khẩu..."
                : "Đổi mật khẩu"}
            </button>
          </form>
        </section>


        {isAdmin && (
          <section className="mb-6 rounded-xl border border-red-500/20 bg-[#313338] p-6 shadow-xl">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-bold">
                  Công cụ quản trị
                </h2>

                <p className="mt-2 text-sm text-gray-400">
                  Kiểm tra và xóa nội dung vi phạm trong cộng đồng.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  window.location.href = "/admin";
                }}
                className="rounded-md bg-red-500 px-5 py-3 font-semibold hover:bg-red-400"
              >
                Mở trang quản trị
              </button>
            </div>
          </section>
        )}

        <section className="rounded-xl border border-red-500/20 bg-[#313338] p-6">
          <h2 className="text-xl font-bold">Phiên đăng nhập</h2>

          <p className="mt-2 text-sm text-gray-400">
            Đăng xuất khỏi tài khoản trên trình duyệt này.
          </p>

          <button
            type="button"
            onClick={() => void logout()}
            className="mt-5 rounded-md bg-red-500 px-5 py-3 font-semibold hover:bg-red-400"
          >
            Đăng xuất
          </button>
        </section>
      </div>
    </main>
  );
}
