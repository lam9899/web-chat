"use client";

import { FormEvent, useState } from "react";

type Message = {
  id: number;
  author: string;
  text: string;
  time: string;
};

const initialMessages: Message[] = [
  {
    id: 1,
    author: "Minh Anh",
    text: "Chào mừng mọi người đến với cộng đồng!",
    time: "14:50",
  },
  {
    id: 2,
    author: "Hoàng Nam",
    text: "Website chat của chúng ta đã hoạt động 🎉",
    time: "14:52",
  },
  {
    id: 3,
    author: "Bạn",
    text: "Xin chào mọi người!",
    time: "14:55",
  },
];

const channels = ["chung", "giới-thiệu", "góp-ý", "trò-chuyện"];
const members = ["Bạn", "Minh Anh", "Hoàng Nam"];

export default function Home() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [messageInput, setMessageInput] = useState("");

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const content = messageInput.trim();

    if (!content) return;

    const currentTime = new Date().toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
    });

    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: Date.now(),
        author: "Bạn",
        text: content,
        time: currentTime,
      },
    ]);

    setMessageInput("");
  }

  return (
    <main className="grid h-screen grid-cols-[72px_240px_minmax(0,1fr)] overflow-hidden bg-[#313338] text-white lg:grid-cols-[72px_240px_minmax(0,1fr)_240px]">
      {/* Thanh máy chủ */}
      <aside className="flex flex-col items-center gap-3 bg-[#1e1f22] py-3">
        <button className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500 text-xl font-bold transition hover:rounded-xl">
          C
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
          Cộng đồng Việt Nam
        </header>

        <div className="flex-1 overflow-y-auto p-3">
          <div className="mb-2 flex items-center justify-between text-xs font-bold uppercase text-gray-400">
            <span>Kênh văn bản</span>
            <button className="text-lg">+</button>
          </div>

          <nav className="space-y-1">
            {channels.map((channel, index) => (
              <button
                key={channel}
                className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left ${
                  index === 0
                    ? "bg-white/10 text-white"
                    : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
                }`}
              >
                <span className="text-xl text-gray-400">#</span>
                {channel}
              </button>
            ))}
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
            B
          </div>

          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">Bạn</div>
            <div className="text-xs text-gray-400">Đang online</div>
          </div>

          <button title="Cài đặt">⚙️</button>
        </div>
      </aside>

      {/* Khu vực chat */}
      <section className="flex min-w-0 flex-col">
        <header className="flex h-[57px] items-center border-b border-black/20 px-4 shadow">
          <span className="mr-2 text-2xl text-gray-400">#</span>
          <strong>chung</strong>

          <span className="ml-4 hidden text-sm text-gray-400 md:block">
            Kênh trò chuyện chung của cộng đồng
          </span>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="mb-8">
            <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-[#41434a] text-4xl">
              #
            </div>

            <h1 className="text-3xl font-bold">
              Chào mừng đến với #chung!
            </h1>

            <p className="mt-2 text-gray-400">
              Đây là nơi bắt đầu của kênh trò chuyện.
            </p>
          </div>

          <div className="space-y-1">
            {messages.map((message) => (
              <article
                key={message.id}
                className="flex gap-4 rounded px-2 py-3 hover:bg-black/10"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-500 font-bold">
                  {message.author.charAt(0).toUpperCase()}
                </div>

                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <strong>{message.author}</strong>

                    <span className="text-xs text-gray-400">
                      Hôm nay lúc {message.time}
                    </span>
                  </div>

                  <p className="mt-1 break-words text-gray-200">
                    {message.text}
                  </p>
                </div>
              </article>
            ))}
          </div>
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
              onChange={(event) => setMessageInput(event.target.value)}
              placeholder="Nhắn tin trong #chung"
              className="min-w-0 flex-1 bg-transparent py-3 text-gray-100 outline-none placeholder:text-gray-400"
            />

            <button
              type="submit"
              className="ml-3 rounded bg-indigo-500 px-3 py-1.5 text-sm font-semibold hover:bg-indigo-400"
            >
              Gửi
            </button>
          </div>
        </form>
      </section>

      {/* Danh sách thành viên */}
      <aside className="hidden overflow-y-auto bg-[#2b2d31] p-4 lg:block">
        <h2 className="mb-3 text-xs font-bold uppercase text-gray-400">
          Đang online — {members.length}
        </h2>

        {members.map((member) => (
          <div
            key={member}
            className="mb-1 flex items-center gap-3 rounded p-2 text-gray-300 hover:bg-white/5"
          >
            <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500 font-bold">
              {member.charAt(0)}

              <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#2b2d31] bg-green-500" />
            </div>

            <span className="truncate font-medium">{member}</span>
          </div>
        ))}
      </aside>
    </main>
  );
}