"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";

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