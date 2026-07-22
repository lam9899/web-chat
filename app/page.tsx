"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";

const supabase = createClient();

type MessageRow = {
  id: number;
  user_id: string;
  username: string;
  content: string;
  channel: string;
  created_at: string;
};

type OnlineUser = {
  user_id: string;
  username: string;
  online_at: string;
};

type ChannelItem = {
  id: string;
  label: string;
  description: string;
};

const channels: ChannelItem[] = [
  {
    id: "chung",
    label: "chung",
    description: "Kênh trò chuyện chung của cộng đồng",
  },
  {
    id: "gioi-thieu",
    label: "giới-thiệu",
    description: "Giới thiệu bản thân và làm quen với mọi người",
  },
  {
    id: "gop-y",
    label: "góp-ý",
    description: "Đóng góp ý kiến để cộng đồng tốt hơn",
  },
  {
    id: "tro-chuyen",
    label: "trò-chuyện",
    description: "Trò chuyện tự do cùng các thành viên",
  },
];

export default function Home() {
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [selectedChannel, setSelectedChannel] = useState("chung");
  const [messageInput, setMessageInput] = useState("");
  const [username, setUsername] = useState("Bạn");
  const [userId, setUserId] = useState("");
  const [authLoading, setAuthLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const activeChannel = useMemo(
    () =>
      channels.find((channel) => channel.id === selectedChannel) ??
      channels[0],
    [selectedChannel],
  );

  // Kiểm tra đăng nhập và theo dõi danh sách online.
  useEffect(() => {
    let isActive = true;
    let presenceChannel:
      | ReturnType<typeof supabase.channel>
      | null = null;

    async function initializeUser() {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        window.location.href = "/login";
        return;
      }

      const displayName =
        user.user_metadata?.username ||
        user.email?.split("@")[0] ||
        "Bạn";

      if (!isActive) return;

      setUsername(displayName);
      setUserId(user.id);

      const onlineChannel = supabase.channel("online-users-global", {
        config: {
          presence: {
            key: user.id,
          },
        },
      });

      onlineChannel.on("presence", { event: "sync" }, () => {
        const presenceState = onlineChannel.presenceState();

        const users = Object.values(presenceState)
          .flat()
          .map((presence) => presence as unknown as OnlineUser)
          .filter(
            (onlineUser) =>
              Boolean(onlineUser.user_id) &&
              Boolean(onlineUser.username),
          );

        // Một người mở nhiều tab vẫn chỉ được tính một lần.
        const uniqueUsers = Array.from(
          new Map(
            users.map((onlineUser) => [
              onlineUser.user_id,
              onlineUser,
            ]),
          ).values(),
        ).sort((firstUser, secondUser) =>
          firstUser.username.localeCompare(
            secondUser.username,
            "vi",
          ),
        );

        if (isActive) {
          setOnlineUsers(uniqueUsers);
        }
      });

      presenceChannel = onlineChannel;

      onlineChannel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await onlineChannel.track({
            user_id: user.id,
            username: displayName,
            online_at: new Date().toISOString(),
          });
        }
      });

      setAuthLoading(false);
    }

    void initializeUser();

    return () => {
      isActive = false;

      if (presenceChannel) {
        void supabase.removeChannel(presenceChannel);
      }
    };
  }, []);

  // Tải và theo dõi tin nhắn riêng của kênh đang chọn.
  useEffect(() => {
    if (!userId) return;

    let isActive = true;
    let messageChannel:
      | ReturnType<typeof supabase.channel>
      | null = null;

    async function initializeChannelMessages() {
      setMessagesLoading(true);
      setMessages([]);
      setErrorMessage("");
      setMessageInput("");

      const { data, error } = await supabase
        .from("messages")
        .select(
          "id, user_id, username, content, channel, created_at",
        )
        .eq("channel", selectedChannel)
        .order("created_at", { ascending: true })
        .limit(100);

      if (!isActive) return;

      if (error) {
        setErrorMessage(`Không thể tải tin nhắn: ${error.message}`);
      } else {
        setMessages(data ?? []);
      }

      const subscriptionName = [
        "messages",
        selectedChannel,
        userId,
        Date.now().toString(),
      ].join("-");

      messageChannel = supabase
        .channel(subscriptionName)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `channel=eq.${selectedChannel}`,
          },
          (payload) => {
            if (!isActive) return;

            const newMessage = payload.new as MessageRow;

            setMessages((currentMessages) => {
              const alreadyExists = currentMessages.some(
                (message) => message.id === newMessage.id,
              );

              if (alreadyExists) {
                return currentMessages;
              }

              return [...currentMessages, newMessage];
            });
          },
        )
        .subscribe();

      setMessagesLoading(false);
    }

    void initializeChannelMessages();

    return () => {
      isActive = false;

      if (messageChannel) {
        void supabase.removeChannel(messageChannel);
      }
    };
  }, [selectedChannel, userId]);

  async function sendMessage(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const content = messageInput.trim();

    if (!content || !userId || sending) {
      return;
    }

    setSending(true);
    setErrorMessage("");

    const { error } = await supabase.from("messages").insert({
      user_id: userId,
      username,
      content,
      channel: selectedChannel,
    });

    if (error) {
      setErrorMessage(`Không thể gửi tin nhắn: ${error.message}`);
    } else {
      setMessageInput("");
    }

    setSending(false);
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  function formatTime(dateString: string) {
    return new Date(dateString).toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#1e1f22] text-white">
        <p>Đang tải phòng chat...</p>
      </main>
    );
  }

  return (
    <main className="grid h-screen grid-cols-[72px_240px_minmax(0,1fr)] overflow-hidden bg-[#313338] text-white lg:grid-cols-[72px_240px_minmax(0,1fr)_240px]">
      {/* Danh sách máy chủ */}
      <aside className="flex flex-col items-center gap-3 bg-[#1e1f22] py-3">
        <button className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500 text-xl font-bold">
          T
        </button>

        <div className="h-px w-8 bg-white/10" />

        {["G", "H", "K", "+"].map((server) => (
          <button
            key={server}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-[#313338] text-lg font-semibold transition hover:rounded-xl hover:bg-indigo-500"
          >
            {server}
          </button>
        ))}
      </aside>

      {/* Danh sách kênh */}
      <aside className="flex min-h-0 flex-col bg-[#2b2d31]">
        <header className="border-b border-black/20 px-4 py-4 font-bold shadow">
          Talk Cùng Lâm DZ
        </header>

        <div className="flex-1 overflow-y-auto p-3">
          <div className="mb-2 flex items-center justify-between text-xs font-bold uppercase text-gray-400">
            <span>Kênh văn bản</span>
            <button className="text-lg">+</button>
          </div>

          <nav className="space-y-1">
            {channels.map((channel) => {
              const isSelected = channel.id === selectedChannel;

              return (
                <button
                  key={channel.id}
                  type="button"
                  onClick={() => setSelectedChannel(channel.id)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left ${
                    isSelected
                      ? "bg-white/10 text-white"
                      : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
                  }`}
                >
                  <span className="text-xl text-gray-400">#</span>
                  {channel.label}
                </button>
              );
            })}
          </nav>

          <div className="mb-2 mt-6 flex items-center justify-between text-xs font-bold uppercase text-gray-400">
            <span>Kênh thoại</span>
            <button className="text-lg">+</button>
          </div>

          <button className="flex w-full items-center gap-2 rounded px-2 py-2 text-gray-400 hover:bg-white/5">
            🔊 Phòng trò chuyện
          </button>
        </div>

        <div className="flex items-center gap-3 bg-[#232428] p-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500 font-bold">
            {username.charAt(0).toUpperCase()}
          </div>

          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">
              {username}
            </div>

            <div className="text-xs text-gray-400">
              Đang online
            </div>
          </div>

          <button
            onClick={logout}
            title="Đăng xuất"
            className="text-gray-400 hover:text-white"
          >
            ↪
          </button>
        </div>
      </aside>

      {/* Khu vực trò chuyện */}
      <section className="flex min-w-0 flex-col">
        <header className="flex h-[57px] items-center border-b border-black/20 px-4 shadow">
          <span className="mr-2 text-2xl text-gray-400">#</span>
          <strong>{activeChannel.label}</strong>

          <span className="ml-4 hidden text-sm text-gray-400 md:block">
            {activeChannel.description}
          </span>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="mb-8">
            <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-[#41434a] text-4xl">
              #
            </div>

            <h1 className="text-3xl font-bold">
              Chào mừng đến với #{activeChannel.label}!
            </h1>

            <p className="mt-2 text-gray-400">
              {activeChannel.description}
            </p>
          </div>

          {errorMessage && (
            <div className="mb-4 rounded-md bg-red-500/15 px-4 py-3 text-sm text-red-300">
              {errorMessage}
            </div>
          )}

          {messagesLoading ? (
            <p className="text-sm text-gray-400">
              Đang tải tin nhắn...
            </p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-gray-400">
              Chưa có tin nhắn. Hãy gửi tin nhắn đầu tiên.
            </p>
          ) : (
            <div className="space-y-1">
              {messages.map((message) => (
                <article
                  key={message.id}
                  className="flex gap-4 rounded px-2 py-3 hover:bg-black/10"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-500 font-bold">
                    {message.username
                      .charAt(0)
                      .toUpperCase()}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <strong>{message.username}</strong>

                      <span className="text-xs text-gray-400">
                        Hôm nay lúc{" "}
                        {formatTime(message.created_at)}
                      </span>
                    </div>

                    <p className="mt-1 break-words text-gray-200">
                      {message.content}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={sendMessage} className="px-4 pb-6">
          <div className="flex items-center rounded-lg bg-[#383a40] px-4">
            <button
              type="button"
              className="mr-3 text-2xl text-gray-300 hover:text-white"
              title="Đính kèm"
            >
              +
            </button>

            <input
              value={messageInput}
              onChange={(event) =>
                setMessageInput(event.target.value)
              }
              placeholder={`Nhắn tin trong #${activeChannel.label}`}
              maxLength={2000}
              className="min-w-0 flex-1 bg-transparent py-3 text-gray-100 outline-none placeholder:text-gray-400"
            />

            <button
              type="submit"
              disabled={sending || messagesLoading}
              className="ml-3 rounded bg-indigo-500 px-3 py-1.5 text-sm font-semibold hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? "Đang gửi..." : "Gửi"}
            </button>
          </div>
        </form>
      </section>

      {/* Thành viên online thật */}
      <aside className="hidden overflow-y-auto bg-[#2b2d31] p-4 lg:block">
        <h2 className="mb-3 text-xs font-bold uppercase text-gray-400">
          Đang online — {onlineUsers.length}
        </h2>

        {onlineUsers.length === 0 ? (
          <p className="text-sm text-gray-500">
            Đang cập nhật...
          </p>
        ) : (
          onlineUsers.map((member) => (
            <div
              key={member.user_id}
              className="mb-1 flex items-center gap-3 rounded p-2 text-gray-300 hover:bg-white/5"
            >
              <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500 font-bold">
                {member.username.charAt(0).toUpperCase()}

                <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#2b2d31] bg-green-500" />
              </div>

              <span className="truncate font-medium">
                {member.username}
              </span>
            </div>
          ))
        )}
      </aside>
    </main>
  );
}