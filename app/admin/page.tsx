"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";

const supabase = createClient();

type AdminMessage = {
  id: number;
  user_id: string;
  username: string;
  content: string;
  channel: string;
  created_at: string;
  attachment_url: string | null;
  attachment_name: string | null;
  edited_at: string | null;
};

const channelOptions = [
  { value: "all", label: "Tất cả kênh" },
  { value: "chung", label: "#chung" },
  { value: "gioi-thieu", label: "#giới-thiệu" },
  { value: "gop-y", label: "#góp-ý" },
  { value: "tro-chuyen", label: "#trò-chuyện" },
];

export default function AdminPage() {
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedChannel, setSelectedChannel] = useState("all");
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;
    let realtimeChannel:
      | ReturnType<typeof supabase.channel>
      | null = null;

    async function initializeAdmin() {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        window.location.href = "/login";
        return;
      }

      const { data: roleData, error: roleError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!active) return;

      if (roleError || roleData?.role !== "admin") {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("messages")
        .select(
          "id, user_id, username, content, channel, created_at, attachment_url, attachment_name, edited_at",
        )
        .order("created_at", { ascending: false })
        .limit(300);

      if (!active) return;

      if (error) {
        setErrorMessage(`Không thể tải tin nhắn: ${error.message}`);
      } else {
        setMessages(data ?? []);
      }

      realtimeChannel = supabase
        .channel(`admin-messages-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "messages",
          },
          (payload) => {
            if (!active) return;

            if (payload.eventType === "INSERT") {
              const newMessage = payload.new as AdminMessage;

              setMessages((current) => {
                if (
                  current.some(
                    (message) => message.id === newMessage.id,
                  )
                ) {
                  return current;
                }

                return [newMessage, ...current].slice(0, 300);
              });
            }

            if (payload.eventType === "UPDATE") {
              const updatedMessage = payload.new as AdminMessage;

              setMessages((current) =>
                current.map((message) =>
                  message.id === updatedMessage.id
                    ? updatedMessage
                    : message,
                ),
              );
            }

            if (payload.eventType === "DELETE") {
              const deletedMessage =
                payload.old as Partial<AdminMessage>;

              if (typeof deletedMessage.id === "number") {
                setMessages((current) =>
                  current.filter(
                    (message) =>
                      message.id !== deletedMessage.id,
                  ),
                );
              }
            }
          },
        )
        .subscribe();

      setLoading(false);
    }

    void initializeAdmin();

    return () => {
      active = false;

      if (realtimeChannel) {
        void supabase.removeChannel(realtimeChannel);
      }
    };
  }, []);

  const filteredMessages = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase("vi");

    return messages.filter((message) => {
      const channelMatches =
        selectedChannel === "all" ||
        message.channel === selectedChannel;

      if (!channelMatches) return false;
      if (!query) return true;

      return (
        message.username
          .toLocaleLowerCase("vi")
          .includes(query) ||
        message.content
          .toLocaleLowerCase("vi")
          .includes(query) ||
        message.channel
          .toLocaleLowerCase("vi")
          .includes(query)
      );
    });
  }, [messages, searchQuery, selectedChannel]);

  async function deleteMessage(message: AdminMessage) {
    const confirmed = window.confirm(
      `Xóa tin nhắn của ${message.username}?\n\n${
        message.content || "Ảnh đính kèm"
      }`,
    );

    if (!confirmed || deletingId !== null) return;

    setDeletingId(message.id);
    setErrorMessage("");

    const { error } = await supabase
      .from("messages")
      .delete()
      .eq("id", message.id);

    if (error) {
      setErrorMessage(`Không thể xóa tin nhắn: ${error.message}`);
    } else {
      setMessages((current) =>
        current.filter(
          (currentMessage) =>
            currentMessage.id !== message.id,
        ),
      );
    }

    setDeletingId(null);
  }

  function formatDate(dateString: string) {
    return new Date(dateString).toLocaleString("vi-VN", {
      dateStyle: "short",
      timeStyle: "short",
    });
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#1e1f22] text-white">
        <p>Đang kiểm tra quyền quản trị...</p>
      </main>
    );
  }

  if (accessDenied) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#1e1f22] px-4 text-white">
        <section className="w-full max-w-md rounded-xl bg-[#313338] p-6 text-center shadow-xl">
          <h1 className="text-2xl font-bold">
            Không có quyền truy cập
          </h1>

          <p className="mt-3 text-gray-400">
            Trang này chỉ dành cho quản trị viên.
          </p>

          <button
            type="button"
            onClick={() => {
              window.location.href = "/";
            }}
            className="mt-6 rounded-md bg-indigo-500 px-5 py-3 font-semibold hover:bg-indigo-400"
          >
            Quay lại phòng chat
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#1e1f22] px-4 py-8 text-white">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-2 inline-flex rounded-full bg-red-500/15 px-3 py-1 text-xs font-bold uppercase text-red-300">
              Quản trị viên
            </div>

            <h1 className="text-3xl font-bold">
              Kiểm duyệt tin nhắn
            </h1>

            <p className="mt-1 text-sm text-gray-400">
              Xem và xóa nội dung vi phạm trong cộng đồng.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                window.location.href = "/settings";
              }}
              className="rounded-md bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15"
            >
              Cài đặt
            </button>

            <button
              type="button"
              onClick={() => {
                window.location.href = "/";
              }}
              className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold hover:bg-indigo-400"
            >
              Phòng chat
            </button>
          </div>
        </header>

        {errorMessage && (
          <div className="mb-5 rounded-md bg-red-500/15 px-4 py-3 text-sm text-red-300">
            {errorMessage}
          </div>
        )}

        <section className="mb-5 grid gap-3 rounded-xl bg-[#313338] p-4 md:grid-cols-[1fr_220px_auto]">
          <input
            value={searchQuery}
            onChange={(event) =>
              setSearchQuery(event.target.value)
            }
            placeholder="Tìm theo tên hoặc nội dung..."
            className="rounded-md bg-[#1e1f22] px-4 py-3 outline-none ring-indigo-500 focus:ring-2"
          />

          <select
            value={selectedChannel}
            onChange={(event) =>
              setSelectedChannel(event.target.value)
            }
            className="rounded-md bg-[#1e1f22] px-4 py-3 outline-none"
          >
            {channelOptions.map((channel) => (
              <option
                key={channel.value}
                value={channel.value}
              >
                {channel.label}
              </option>
            ))}
          </select>

          <div className="flex items-center rounded-md bg-[#1e1f22] px-4 text-sm text-gray-300">
            {filteredMessages.length} tin nhắn
          </div>
        </section>

        <section className="space-y-3">
          {filteredMessages.length === 0 ? (
            <div className="rounded-xl bg-[#313338] p-8 text-center text-gray-400">
              Không có tin nhắn phù hợp.
            </div>
          ) : (
            filteredMessages.map((message) => (
              <article
                key={message.id}
                className="rounded-xl bg-[#313338] p-5 shadow"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{message.username}</strong>

                      <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-gray-300">
                        #{message.channel}
                      </span>

                      <span className="text-xs text-gray-500">
                        {formatDate(message.created_at)}
                      </span>

                      {message.edited_at && (
                        <span className="text-xs text-gray-500">
                          Đã sửa
                        </span>
                      )}
                    </div>

                    {message.content && (
                      <p className="mt-3 whitespace-pre-wrap break-words text-gray-200">
                        {message.content}
                      </p>
                    )}

                    {message.attachment_url && (
                      <a
                        href={message.attachment_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 block"
                      >
                        <img
                          src={message.attachment_url}
                          alt={
                            message.attachment_name ??
                            "Ảnh đính kèm"
                          }
                          className="max-h-56 rounded-lg object-contain"
                        />
                      </a>
                    )}

                    <p className="mt-3 break-all text-xs text-gray-600">
                      User ID: {message.user_id}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      void deleteMessage(message)
                    }
                    disabled={deletingId === message.id}
                    className="shrink-0 rounded-md bg-red-500 px-4 py-2 text-sm font-semibold hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {deletingId === message.id
                      ? "Đang xóa..."
                      : "Xóa tin"}
                  </button>
                </div>
              </article>
            ))
          )}
        </section>
      </div>
    </main>
  );
}
