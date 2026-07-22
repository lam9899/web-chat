"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/utils/supabase/client";

const supabase = createClient();

type Mode = "login" | "signup";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setNotice("");
    setErrorMessage("");
    setLoading(true);

    try {
      if (mode === "signup") {
        const cleanUsername = username.trim();

        if (cleanUsername.length < 2) {
          setErrorMessage("Tên hiển thị phải có ít nhất 2 ký tự.");
          return;
        }

        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              username: cleanUsername,
            },
            emailRedirectTo: `${window.location.origin}/`,
          },
        });

        if (error) {
          setErrorMessage(error.message);
          return;
        }

        if (data.session) {
          window.location.href = "/";
          return;
        }

        setNotice(
          "Đăng ký thành công. Hãy mở email và bấm liên kết xác nhận tài khoản.",
        );
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) {
          setErrorMessage("Email hoặc mật khẩu không chính xác.");
          return;
        }

        window.location.href = "/";
      }
    } catch {
      setErrorMessage("Đã xảy ra lỗi. Hãy thử lại.");
    } finally {
      setLoading(false);
    }
  }

  function switchMode() {
    setMode((currentMode) =>
      currentMode === "login" ? "signup" : "login",
    );

    setNotice("");
    setErrorMessage("");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#1e1f22] px-4 text-white">
      <section className="w-full max-w-md rounded-xl bg-[#313338] p-8 shadow-2xl">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500 text-2xl font-bold">
            T
          </div>

          <h1 className="text-2xl font-bold">
            {mode === "login"
              ? "Chào mừng trở lại!"
              : "Tạo tài khoản"}
          </h1>

          <p className="mt-2 text-sm text-gray-400">
            {mode === "login"
              ? "Đăng nhập để tiếp tục trò chuyện"
              : "Tham gia cộng đồng Talk Cùng Lâm DZ"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {mode === "signup" && (
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
                placeholder="Ví dụ: Lâm"
                minLength={2}
                maxLength={30}
                required
                className="w-full rounded-md bg-[#1e1f22] px-4 py-3 outline-none ring-indigo-500 focus:ring-2"
              />
            </div>
          )}

          <div>
            <label
              htmlFor="email"
              className="mb-2 block text-xs font-bold uppercase text-gray-300"
            >
              Email
            </label>

            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="email@example.com"
              autoComplete="email"
              required
              className="w-full rounded-md bg-[#1e1f22] px-4 py-3 outline-none ring-indigo-500 focus:ring-2"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-2 block text-xs font-bold uppercase text-gray-300"
            >
              Mật khẩu
            </label>

            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Tối thiểu 6 ký tự"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              minLength={6}
              required
              className="w-full rounded-md bg-[#1e1f22] px-4 py-3 outline-none ring-indigo-500 focus:ring-2"
            />
          </div>

          {errorMessage && (
            <div className="rounded-md bg-red-500/15 px-4 py-3 text-sm text-red-300">
              {errorMessage}
            </div>
          )}

          {notice && (
            <div className="rounded-md bg-green-500/15 px-4 py-3 text-sm text-green-300">
              {notice}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-indigo-500 py-3 font-semibold transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading
              ? "Đang xử lý..."
              : mode === "login"
                ? "Đăng nhập"
                : "Đăng ký"}
          </button>
        </form>

        <p className="mt-6 text-sm text-gray-400">
          {mode === "login"
            ? "Bạn chưa có tài khoản?"
            : "Bạn đã có tài khoản?"}

          <button
            type="button"
            onClick={switchMode}
            className="ml-2 font-semibold text-indigo-400 hover:underline"
          >
            {mode === "login" ? "Đăng ký" : "Đăng nhập"}
          </button>
        </p>
      </section>
    </main>
  );
}