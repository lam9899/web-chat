"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/utils/supabase/client";

const supabase = createClient();

type ProfileRow = {
  id: string;
  username: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

type DirectMessageRow = {
  id: number;
  sender_id: string;
  receiver_id: string;
  content: string;
  created_at: string;
  edited_at: string | null;
};

type SuspensionRow = {
  user_id: string;
  reason: string;
  suspended_until: string | null;
};

export default function MessagesPage() {
  const [currentUserId, setCurrentUserId] = useState("");
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [selectedProfile, setSelectedProfile] =
    useState<ProfileRow | null>(null);
  const [messages, setMessages] = useState<DirectMessageRow[]>(
    [],
  );
  const [unreadByUser, setUnreadByUser] = useState<
    Record<string, number>
  >({});

  const [searchQuery, setSearchQuery] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [editingId, setEditingId] = useState<number | null>(
    null,
  );
  const [editingContent, setEditingContent] = useState("");

  const [suspension, setSuspension] =
    useState<SuspensionRow | null>(null);
  const [clock, setClock] = useState(Date.now());

  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [workingId, setWorkingId] = useState<number | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [showContacts, setShowContacts] = useState(true);

  const selectedProfileRef = useRef<ProfileRow | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    selectedProfileRef.current = selectedProfile;
  }, [selectedProfile]);

  const isSuspended = useMemo(() => {
    if (!suspension) return false;

    return (
      suspension.suspended_until === null ||
      new Date(suspension.suspended_until).getTime() > clock
    );
  }, [clock, suspension]);

  const filteredProfiles = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase("vi");

    if (!query) return profiles;

    return profiles.filter((profile) =>
      profile.username
        .toLocaleLowerCase("vi")
        .includes(query),
    );
  }, [profiles, searchQuery]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClock(Date.now());
    }, 30000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  // Xác thực, tải danh sách thành viên và lắng nghe tin nhắn riêng.
  useEffect(() => {
    let active = true;
    let realtimeChannel:
      | ReturnType<typeof supabase.channel>
      | null = null;

    async function initialize() {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        window.location.href = "/login";
        return;
      }

      setCurrentUserId(user.id);

      const [
        { data: profileData, error: profileError },
        { data: suspensionData, error: suspensionError },
      ] = await Promise.all([
        supabase
          .from("profiles")
          .select(
            "id, username, avatar_url, created_at, updated_at",
          )
          .neq("id", user.id)
          .order("username", { ascending: true }),
        supabase
          .from("user_suspensions")
          .select("user_id, reason, suspended_until")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);

      if (!active) return;

      if (profileError) {
        setErrorMessage(
          `Không thể tải danh sách thành viên: ${profileError.message}`,
        );
      } else {
        const loadedProfiles = profileData ?? [];
        setProfiles(loadedProfiles);

        const requestedUserId = new URLSearchParams(
          window.location.search,
        ).get("user");

        const requestedProfile = loadedProfiles.find(
          (profile) => profile.id === requestedUserId,
        );

        if (requestedProfile) {
          setSelectedProfile(requestedProfile);
          setShowContacts(false);
        } else if (loadedProfiles.length > 0) {
          setSelectedProfile(loadedProfiles[0]);
        }
      }

      if (suspensionError) {
        setErrorMessage(
          `Không thể kiểm tra trạng thái tài khoản: ${suspensionError.message}`,
        );
      } else {
        setSuspension(suspensionData ?? null);
      }

      realtimeChannel = supabase
        .channel(`private-messages-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "direct_messages",
          },
          (payload) => {
            if (!active) return;

            if (payload.eventType === "INSERT") {
              const newMessage =
                payload.new as DirectMessageRow;
              const selected =
                selectedProfileRef.current;

              const belongsToSelected =
                selected &&
                ((newMessage.sender_id === user.id &&
                  newMessage.receiver_id === selected.id) ||
                  (newMessage.sender_id === selected.id &&
                    newMessage.receiver_id === user.id));

              if (belongsToSelected) {
                setMessages((current) => {
                  if (
                    current.some(
                      (message) =>
                        message.id === newMessage.id,
                    )
                  ) {
                    return current;
                  }

                  return [...current, newMessage];
                });
              } else if (
                newMessage.receiver_id === user.id
              ) {
                setUnreadByUser((current) => ({
                  ...current,
                  [newMessage.sender_id]:
                    (current[newMessage.sender_id] ?? 0) + 1,
                }));
              }
            }

            if (payload.eventType === "UPDATE") {
              const updatedMessage =
                payload.new as DirectMessageRow;

              setMessages((current) =>
                current.map((message) =>
                  message.id === updatedMessage.id
                    ? updatedMessage
                    : message,
                ),
              );
            }

            if (payload.eventType === "DELETE") {
              const oldMessage =
                payload.old as Partial<DirectMessageRow>;

              if (typeof oldMessage.id === "number") {
                setMessages((current) =>
                  current.filter(
                    (message) =>
                      message.id !== oldMessage.id,
                  ),
                );
              }
            }
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "profiles",
          },
          async () => {
            if (!active) return;

            const { data, error } = await supabase
              .from("profiles")
              .select(
                "id, username, avatar_url, created_at, updated_at",
              )
              .neq("id", user.id)
              .order("username", { ascending: true });

            if (!active) return;

            if (error) {
              setErrorMessage(
                `Không thể cập nhật thành viên: ${error.message}`,
              );
              return;
            }

            const nextProfiles = data ?? [];
            setProfiles(nextProfiles);

            const selectedId =
              selectedProfileRef.current?.id;

            if (selectedId) {
              const updatedSelected =
                nextProfiles.find(
                  (profile) =>
                    profile.id === selectedId,
                ) ?? null;

              setSelectedProfile(updatedSelected);
            }
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "user_suspensions",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            if (!active) return;

            if (
              payload.eventType === "INSERT" ||
              payload.eventType === "UPDATE"
            ) {
              setSuspension(
                payload.new as SuspensionRow,
              );
            }

            if (payload.eventType === "DELETE") {
              setSuspension(null);
            }
          },
        )
        .subscribe();

      setLoading(false);
    }

    void initialize();

    return () => {
      active = false;

      if (realtimeChannel) {
        void supabase.removeChannel(realtimeChannel);
      }
    };
  }, []);

  // Tải cuộc trò chuyện khi chọn thành viên.
  useEffect(() => {
    if (!currentUserId || !selectedProfile) {
      setMessages([]);
      return;
    }

    let active = true;

    async function loadConversation() {
      setMessagesLoading(true);
      setMessages([]);
      setEditingId(null);
      setEditingContent("");
      setErrorMessage("");

      const otherUserId = selectedProfile.id;

      const { data, error } = await supabase
        .from("direct_messages")
        .select(
          "id, sender_id, receiver_id, content, created_at, edited_at",
        )
        .or(
          `and(sender_id.eq.${currentUserId},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${currentUserId})`,
        )
        .order("created_at", { ascending: true })
        .limit(200);

      if (!active) return;

      if (error) {
        setErrorMessage(
          `Không thể tải cuộc trò chuyện: ${error.message}`,
        );
      } else {
        setMessages(data ?? []);
      }

      setUnreadByUser((current) => ({
        ...current,
        [otherUserId]: 0,
      }));
      setMessagesLoading(false);
    }

    void loadConversation();

    return () => {
      active = false;
    };
  }, [currentUserId, selectedProfile]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages.length]);

  function selectMember(profile: ProfileRow) {
    setSelectedProfile(profile);
    setShowContacts(false);
    setMessageInput("");

    const nextUrl = `/messages?user=${encodeURIComponent(
      profile.id,
    )}`;

    window.history.replaceState(null, "", nextUrl);
  }

  async function sendMessage(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const content = messageInput.trim();

    if (
      !content ||
      !currentUserId ||
      !selectedProfile ||
      sending
    ) {
      return;
    }

    if (isSuspended) {
      setErrorMessage(
        "Tài khoản của bạn đang bị khóa quyền chat.",
      );
      return;
    }

    setSending(true);
    setErrorMessage("");

    const { error } = await supabase
      .from("direct_messages")
      .insert({
        sender_id: currentUserId,
        receiver_id: selectedProfile.id,
        content,
      });

    if (error) {
      setErrorMessage(
        `Không thể gửi tin nhắn: ${error.message}`,
      );
    } else {
      setMessageInput("");
    }

    setSending(false);
  }

  function beginEditing(message: DirectMessageRow) {
    if (isSuspended) {
      setErrorMessage(
        "Tài khoản của bạn đang bị khóa quyền chat.",
      );
      return;
    }

    setEditingId(message.id);
    setEditingContent(message.content);
  }

  async function saveEditedMessage(messageId: number) {
    const content = editingContent.trim();

    if (
      !content ||
      workingId !== null ||
      isSuspended
    ) {
      return;
    }

    setWorkingId(messageId);
    setErrorMessage("");

    const editedAt = new Date().toISOString();

    const { error } = await supabase
      .from("direct_messages")
      .update({
        content,
        edited_at: editedAt,
      })
      .eq("id", messageId)
      .eq("sender_id", currentUserId);

    if (error) {
      setErrorMessage(
        `Không thể sửa tin nhắn: ${error.message}`,
      );
    } else {
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                content,
                edited_at: editedAt,
              }
            : message,
        ),
      );
      setEditingId(null);
      setEditingContent("");
    }

    setWorkingId(null);
  }

  async function deleteMessage(messageId: number) {
    if (
      !window.confirm(
        "Bạn có chắc muốn xóa tin nhắn này không?",
      ) ||
      workingId !== null
    ) {
      return;
    }

    setWorkingId(messageId);
    setErrorMessage("");

    const { error } = await supabase
      .from("direct_messages")
      .delete()
      .eq("id", messageId)
      .eq("sender_id", currentUserId);

    if (error) {
      setErrorMessage(
        `Không thể xóa tin nhắn: ${error.message}`,
      );
    } else {
      setMessages((current) =>
        current.filter(
          (message) => message.id !== messageId,
        ),
      );
    }

    setWorkingId(null);
  }

  function formatTime(dateString: string) {
    return new Date(dateString).toLocaleString("vi-VN", {
      dateStyle: "short",
      timeStyle: "short",
    });
  }

  function suspensionText() {
    if (!suspension?.suspended_until) {
      return "vĩnh viễn";
    }

    return new Date(
      suspension.suspended_until,
    ).toLocaleString("vi-VN", {
      dateStyle: "short",
      timeStyle: "short",
    });
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#1e1f22] text-white">
        <p>Đang tải tin nhắn riêng...</p>
      </main>
    );
  }

  return (
    <main className="grid h-screen overflow-hidden bg-[#313338] text-white md:grid-cols-[280px_minmax(0,1fr)]">
      {/* Danh sách thành viên */}
      <aside
        className={`fixed inset-0 z-30 flex min-h-0 flex-col bg-[#2b2d31] transition-transform md:static md:translate-x-0 ${
          showContacts
            ? "translate-x-0"
            : "-translate-x-full"
        }`}
      >
        <header className="border-b border-black/20 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">
                Tin nhắn riêng
              </h1>
              <p className="text-xs text-gray-400">
                Trò chuyện riêng tư với thành viên
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                window.location.href = "/";
              }}
              className="rounded bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/15"
            >
              Chat chung
            </button>
          </div>

          <input
            value={searchQuery}
            onChange={(event) =>
              setSearchQuery(event.target.value)
            }
            placeholder="Tìm thành viên..."
            className="mt-4 w-full rounded-md bg-[#1e1f22] px-4 py-3 outline-none ring-indigo-500 focus:ring-2"
          />
        </header>

        <div className="flex-1 overflow-y-auto p-2">
          {filteredProfiles.length === 0 ? (
            <p className="p-4 text-sm text-gray-400">
              Chưa có thành viên khác.
            </p>
          ) : (
            filteredProfiles.map((profile) => {
              const isSelected =
                selectedProfile?.id === profile.id;
              const unread =
                unreadByUser[profile.id] ?? 0;

              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => selectMember(profile)}
                  className={`mb-1 flex w-full items-center gap-3 rounded-md p-3 text-left ${
                    isSelected
                      ? "bg-white/10"
                      : "hover:bg-white/5"
                  }`}
                >
                  {profile.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt={profile.username}
                      className="h-11 w-11 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-500 font-bold">
                      {profile.username
                        .charAt(0)
                        .toUpperCase()}
                    </div>
                  )}

                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {profile.username}
                  </span>

                  {unread > 0 && (
                    <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Nội dung cuộc trò chuyện */}
      <section className="flex min-w-0 flex-col">
        {selectedProfile ? (
          <>
            <header className="flex h-[64px] items-center gap-3 border-b border-black/20 px-4 shadow">
              <button
                type="button"
                onClick={() => setShowContacts(true)}
                className="rounded p-2 text-xl text-gray-300 md:hidden"
              >
                ☰
              </button>

              {selectedProfile.avatar_url ? (
                <img
                  src={selectedProfile.avatar_url}
                  alt={selectedProfile.username}
                  className="h-10 w-10 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500 font-bold">
                  {selectedProfile.username
                    .charAt(0)
                    .toUpperCase()}
                </div>
              )}

              <div className="min-w-0">
                <h2 className="truncate font-bold">
                  {selectedProfile.username}
                </h2>
                <p className="text-xs text-gray-400">
                  Tin nhắn riêng
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  window.location.href = "/settings";
                }}
                className="ml-auto rounded bg-white/10 px-3 py-2 text-sm hover:bg-white/15"
              >
                Cài đặt
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6">
              {errorMessage && (
                <div className="mb-4 rounded-md bg-red-500/15 px-4 py-3 text-sm text-red-300">
                  {errorMessage}
                </div>
              )}

              {isSuspended && suspension && (
                <div className="mb-4 rounded-md border border-orange-500/30 bg-orange-500/15 px-4 py-3 text-sm text-orange-200">
                  <strong>
                    Bạn đang bị khóa quyền chat.
                  </strong>
                  <div className="mt-1">
                    Lý do: {suspension.reason}
                  </div>
                  <div>
                    Thời hạn: {suspensionText()}
                  </div>
                </div>
              )}

              {messagesLoading ? (
                <p className="text-sm text-gray-400">
                  Đang tải cuộc trò chuyện...
                </p>
              ) : messages.length === 0 ? (
                <div className="flex h-full items-center justify-center text-center text-gray-400">
                  <div>
                    <div className="text-5xl">💬</div>
                    <p className="mt-3">
                      Chưa có tin nhắn. Hãy bắt đầu cuộc
                      trò chuyện.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {messages.map((message) => {
                    const isMine =
                      message.sender_id ===
                      currentUserId;
                    const isEditing =
                      editingId === message.id;
                    const isWorking =
                      workingId === message.id;

                    return (
                      <article
                        key={message.id}
                        className={`group flex ${
                          isMine
                            ? "justify-end"
                            : "justify-start"
                        }`}
                      >
                        <div
                          className={`relative max-w-[85%] rounded-2xl px-4 py-3 md:max-w-[70%] ${
                            isMine
                              ? "rounded-br-md bg-indigo-500"
                              : "rounded-bl-md bg-[#2b2d31]"
                          }`}
                        >
                          {isEditing ? (
                            <div className="min-w-64">
                              <textarea
                                value={editingContent}
                                onChange={(event) =>
                                  setEditingContent(
                                    event.target.value,
                                  )
                                }
                                maxLength={2000}
                                rows={3}
                                autoFocus
                                className="w-full resize-none rounded-md bg-[#1e1f22] px-3 py-2 outline-none ring-indigo-300 focus:ring-2"
                              />

                              <div className="mt-2 flex gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    void saveEditedMessage(
                                      message.id,
                                    )
                                  }
                                  disabled={
                                    isWorking ||
                                    !editingContent.trim()
                                  }
                                  className="rounded bg-white px-3 py-1.5 text-xs font-semibold text-indigo-600 disabled:opacity-50"
                                >
                                  Lưu
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingId(null);
                                    setEditingContent("");
                                  }}
                                  className="rounded bg-black/20 px-3 py-1.5 text-xs"
                                >
                                  Hủy
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className="whitespace-pre-wrap break-words">
                                {message.content}
                              </p>

                              <div
                                className={`mt-1 text-[11px] ${
                                  isMine
                                    ? "text-indigo-100"
                                    : "text-gray-500"
                                }`}
                              >
                                {formatTime(
                                  message.created_at,
                                )}
                                {message.edited_at
                                  ? " · đã sửa"
                                  : ""}
                              </div>
                            </>
                          )}

                          {isMine && !isEditing && (
                            <div className="absolute -top-8 right-0 hidden overflow-hidden rounded-md bg-[#1e1f22] shadow-lg group-hover:flex">
                              <button
                                type="button"
                                onClick={() =>
                                  beginEditing(message)
                                }
                                className="px-3 py-1.5 text-xs hover:bg-white/10"
                              >
                                Sửa
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  void deleteMessage(
                                    message.id,
                                  )
                                }
                                className="px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/15"
                              >
                                Xóa
                              </button>
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}

                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            <form
              onSubmit={sendMessage}
              className="p-3 md:p-4"
            >
              <div className="flex rounded-lg bg-[#383a40] px-4">
                <input
                  value={messageInput}
                  onChange={(event) =>
                    setMessageInput(event.target.value)
                  }
                  disabled={isSuspended}
                  maxLength={2000}
                  placeholder={
                    isSuspended
                      ? "Tài khoản đang bị khóa quyền chat"
                      : `Nhắn tin cho ${selectedProfile.username}`
                  }
                  className="min-w-0 flex-1 bg-transparent py-3 outline-none placeholder:text-gray-400 disabled:cursor-not-allowed"
                />

                <button
                  type="submit"
                  disabled={
                    sending ||
                    isSuspended ||
                    !messageInput.trim()
                  }
                  className="ml-3 my-1.5 rounded bg-indigo-500 px-4 text-sm font-semibold disabled:opacity-50"
                >
                  {sending ? "Đang gửi..." : "Gửi"}
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-gray-400">
            <div>
              <div className="text-6xl">👤</div>
              <h2 className="mt-4 text-xl font-bold text-white">
                Chọn một thành viên
              </h2>
              <p className="mt-2">
                Chọn người ở danh sách bên trái để bắt đầu
                trò chuyện riêng.
              </p>

              <button
                type="button"
                onClick={() => setShowContacts(true)}
                className="mt-5 rounded bg-indigo-500 px-5 py-3 font-semibold text-white md:hidden"
              >
                Mở danh sách thành viên
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
