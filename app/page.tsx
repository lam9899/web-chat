"use client";

import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/utils/supabase/client";

const supabase = createClient();

type MessageRow = {
  id: number;
  user_id: string;
  username: string;
  content: string;
  channel: string;
  created_at: string;
  reply_to_id: number | null;
  attachment_url: string | null;
  attachment_name: string | null;
  edited_at: string | null;
};

type ReactionRow = {
  message_id: number;
  user_id: string;
  username: string;
  emoji: string;
  created_at: string;
};

type OnlineUser = {
  user_id: string;
  username: string;
  avatar_url?: string;
  online_at: string;
};

type ChannelItem = {
  id: string;
  label: string;
  description: string;
};

type TypingPayload = {
  user_id: string;
  username: string;
  typing: boolean;
};

type SuspensionRow = {
  user_id: string;
  reason: string;
  suspended_until: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

const initialChannels: ChannelItem[] = [
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

const reactionChoices = ["👍", "❤️", "😂", "😮"];

function safeFileName(fileName: string) {
  return fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
}

export default function Home() {
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [channels, setChannels] =
    useState<ChannelItem[]>(initialChannels);
  const [reactions, setReactions] = useState<ReactionRow[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [privateUnreadCount, setPrivateUnreadCount] =
    useState(0);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>(
    {},
  );

  const [selectedChannel, setSelectedChannel] = useState("chung");
  const [messageInput, setMessageInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const [username, setUsername] = useState("Bạn");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [userId, setUserId] = useState("");

  const [replyingTo, setReplyingTo] = useState<MessageRow | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<number | null>(
    null,
  );
  const [editingContent, setEditingContent] = useState("");

  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState("");

  const [authLoading, setAuthLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [actionMessageId, setActionMessageId] = useState<number | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [suspension, setSuspension] =
    useState<SuspensionRow | null>(null);
  const [clock, setClock] = useState(Date.now());

  const [showChannels, setShowChannels] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const presenceChannelRef =
    useRef<ReturnType<typeof supabase.channel> | null>(null);
  const roomChannelRef =
    useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastTypingSentRef = useRef(0);

  const activeChannel = useMemo(
    () =>
      channels.find((channel) => channel.id === selectedChannel) ??
      channels[0],
    [selectedChannel],
  );

  const isChatSuspended = useMemo(() => {
    if (!suspension) return false;

    return (
      suspension.suspended_until === null ||
      new Date(suspension.suspended_until).getTime() > clock
    );
  }, [clock, suspension]);

  const messageById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  );

  const filteredMessages = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase("vi");

    if (!query) return messages;

    return messages.filter((message) => {
      return (
        message.content.toLocaleLowerCase("vi").includes(query) ||
        message.username.toLocaleLowerCase("vi").includes(query)
      );
    });
  }, [messages, searchQuery]);

  const reactionsByMessage = useMemo(() => {
    const grouped = new Map<
      number,
      Map<string, { count: number; mine: boolean }>
    >();

    for (const reaction of reactions) {
      if (!grouped.has(reaction.message_id)) {
        grouped.set(reaction.message_id, new Map());
      }

      const messageReactions = grouped.get(reaction.message_id)!;
      const current = messageReactions.get(reaction.emoji) ?? {
        count: 0,
        mine: false,
      };

      messageReactions.set(reaction.emoji, {
        count: current.count + 1,
        mine: current.mine || reaction.user_id === userId,
      });
    }

    return grouped;
  }, [reactions, userId]);

  useEffect(() => {
    document.title =
      privateUnreadCount > 0
        ? `(${privateUnreadCount}) Talk Cùng Lâm DZ`
        : "Talk Cùng Lâm DZ";
  }, [privateUnreadCount]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClock(Date.now());
    }, 30000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  // Xác thực và Presence online toàn website.
  useEffect(() => {
    let isActive = true;

    async function initializeUser() {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error || !user) {
        window.location.href = "/login";
        return;
      }

      const displayName =
        user.user_metadata?.username ||
        user.email?.split("@")[0] ||
        "Bạn";
      const currentAvatar = user.user_metadata?.avatar_url || "";

      if (!isActive) return;

      const authenticatedUserId = user.id;

      setUserId(authenticatedUserId);
      setUsername(displayName);
      setAvatarUrl(currentAvatar);

      async function refreshPrivateUnreadCount() {
        const { count, error: countError } = await supabase
          .from("direct_messages")
          .select("id", {
            count: "exact",
            head: true,
          })
          .eq("receiver_id", authenticatedUserId)
          .is("read_at", null);

        if (!isActive) return;

        if (countError) {
          setErrorMessage(
            `Không thể tải số tin riêng chưa đọc: ${countError.message}`,
          );
        } else {
          setPrivateUnreadCount(count ?? 0);
        }
      }

      await refreshPrivateUnreadCount();

      const { data: suspensionData, error: suspensionError } =
        await supabase
          .from("user_suspensions")
          .select(
            "user_id, reason, suspended_until, created_by, created_at, updated_at",
          )
          .eq("user_id", user.id)
          .maybeSingle();

      if (!isActive) return;

      if (suspensionError) {
        setErrorMessage(
          `Không thể kiểm tra trạng thái tài khoản: ${suspensionError.message}`,
        );
      } else {
        setSuspension(suspensionData ?? null);
      }

      const onlineChannel = supabase.channel("online-users-global", {
        config: {
          presence: {
            key: user.id,
          },
        },
      });

      onlineChannel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_suspensions",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (!isActive) return;

          if (
            payload.eventType === "INSERT" ||
            payload.eventType === "UPDATE"
          ) {
            setSuspension(payload.new as SuspensionRow);
          }

          if (payload.eventType === "DELETE") {
            setSuspension(null);
          }
        },
      );

      onlineChannel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "direct_messages",
        },
        () => {
          void refreshPrivateUnreadCount();
        },
      );

      onlineChannel.on("presence", { event: "sync" }, () => {
        const presenceState = onlineChannel.presenceState();

        const users = Object.values(presenceState)
          .flat()
          .map((presence) => presence as unknown as OnlineUser)
          .filter((member) => member.user_id && member.username);

        const uniqueUsers = Array.from(
          new Map(
            users.map((member) => [member.user_id, member]),
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

      presenceChannelRef.current = onlineChannel;

      onlineChannel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await onlineChannel.track({
            user_id: user.id,
            username: displayName,
            avatar_url: currentAvatar,
            online_at: new Date().toISOString(),
          });
        }
      });

      setAuthLoading(false);
    }

    void initializeUser();

    return () => {
      isActive = false;

      if (presenceChannelRef.current) {
        void supabase.removeChannel(presenceChannelRef.current);
        presenceChannelRef.current = null;
      }
    };
  }, []);


  // Tải danh sách kênh từ database và đồng bộ theo thời gian thực.
  useEffect(() => {
    if (!userId) return;

    let active = true;

    async function loadChannels() {
      const { data, error } = await supabase
        .from("channels")
        .select("slug, name, description, position")
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });

      if (!active) return;

      if (error) {
        setErrorMessage(
          `Không thể tải danh sách kênh: ${error.message}`,
        );
        return;
      }

      const loadedChannels: ChannelItem[] = (data ?? []).map(
        (channel) => ({
          id: channel.slug,
          label: channel.name,
          description: channel.description,
        }),
      );

      if (loadedChannels.length > 0) {
        setChannels(loadedChannels);
      }
    }

    void loadChannels();

    const channelListSubscription = supabase
      .channel(`channel-list-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "channels",
        },
        () => {
          void loadChannels();
        },
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channelListSubscription);
    };
  }, [userId]);

  useEffect(() => {
    if (
      channels.length > 0 &&
      !channels.some(
        (channel) => channel.id === selectedChannel,
      )
    ) {
      setSelectedChannel(channels[0].id);
    }
  }, [channels, selectedChannel]);

  // Tải dữ liệu và Realtime của kênh đang chọn.
  useEffect(() => {
    if (!userId) return;

    let isActive = true;

    async function initializeRoom() {
      setMessagesLoading(true);
      setMessages([]);
      setReactions([]);
      setTypingUsers([]);
      setMessageInput("");
      setReplyingTo(null);
      setEditingMessageId(null);
      setEditingContent("");
      setErrorMessage("");

      const { data: messageData, error: messageError } = await supabase
        .from("messages")
        .select(
          "id, user_id, username, content, channel, created_at, reply_to_id, attachment_url, attachment_name, edited_at",
        )
        .eq("channel", selectedChannel)
        .order("created_at", { ascending: true })
        .limit(150);

      if (!isActive) return;

      if (messageError) {
        setErrorMessage(
          `Không thể tải tin nhắn: ${messageError.message}`,
        );
      } else {
        const loadedMessages = messageData ?? [];
        setMessages(loadedMessages);

        const messageIds = loadedMessages.map((message) => message.id);

        if (messageIds.length > 0) {
          const { data: reactionData, error: reactionError } =
            await supabase
              .from("message_reactions")
              .select(
                "message_id, user_id, username, emoji, created_at",
              )
              .in("message_id", messageIds);

          if (!isActive) return;

          if (reactionError) {
            setErrorMessage(
              `Không thể tải reaction: ${reactionError.message}`,
            );
          } else {
            setReactions(reactionData ?? []);
          }
        }
      }

      const roomChannel = supabase
        .channel(`room:${selectedChannel}:${userId}:${Date.now()}`, {
          config: {
            broadcast: {
              self: false,
            },
          },
        })
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "messages",
          },
          (payload) => {
            if (!isActive) return;

            if (payload.eventType === "INSERT") {
              const newMessage = payload.new as MessageRow;

              if (newMessage.channel === selectedChannel) {
                setMessages((currentMessages) => {
                  if (
                    currentMessages.some(
                      (message) => message.id === newMessage.id,
                    )
                  ) {
                    return currentMessages;
                  }

                  return [...currentMessages, newMessage];
                });
              } else {
                setUnreadCounts((currentCounts) => ({
                  ...currentCounts,
                  [newMessage.channel]:
                    (currentCounts[newMessage.channel] ?? 0) + 1,
                }));
              }
            }

            if (payload.eventType === "UPDATE") {
              const updatedMessage = payload.new as MessageRow;

              if (updatedMessage.channel === selectedChannel) {
                setMessages((currentMessages) =>
                  currentMessages.map((message) =>
                    message.id === updatedMessage.id
                      ? updatedMessage
                      : message,
                  ),
                );
              }
            }

            if (payload.eventType === "DELETE") {
              const deletedMessage = payload.old as Partial<MessageRow>;

              if (typeof deletedMessage.id === "number") {
                setMessages((currentMessages) =>
                  currentMessages.filter(
                    (message) => message.id !== deletedMessage.id,
                  ),
                );
                setReactions((currentReactions) =>
                  currentReactions.filter(
                    (reaction) =>
                      reaction.message_id !== deletedMessage.id,
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
            table: "message_reactions",
          },
          (payload) => {
            if (!isActive) return;

            if (payload.eventType === "INSERT") {
              const newReaction = payload.new as ReactionRow;

              setReactions((currentReactions) => {
                const exists = currentReactions.some(
                  (reaction) =>
                    reaction.message_id === newReaction.message_id &&
                    reaction.user_id === newReaction.user_id &&
                    reaction.emoji === newReaction.emoji,
                );

                return exists
                  ? currentReactions
                  : [...currentReactions, newReaction];
              });
            }

            if (payload.eventType === "DELETE") {
              const oldReaction = payload.old as Partial<ReactionRow>;

              setReactions((currentReactions) =>
                currentReactions.filter(
                  (reaction) =>
                    !(
                      reaction.message_id === oldReaction.message_id &&
                      reaction.user_id === oldReaction.user_id &&
                      reaction.emoji === oldReaction.emoji
                    ),
                ),
              );
            }
          },
        )
        .on(
          "broadcast",
          {
            event: "typing",
          },
          ({ payload }) => {
            const typingPayload = payload as TypingPayload;

            if (
              !typingPayload.user_id ||
              typingPayload.user_id === userId
            ) {
              return;
            }

            setTypingUsers((currentUsers) => {
              if (typingPayload.typing) {
                return Array.from(
                  new Set([...currentUsers, typingPayload.username]),
                );
              }

              return currentUsers.filter(
                (name) => name !== typingPayload.username,
              );
            });
          },
        );

      roomChannelRef.current = roomChannel;
      roomChannel.subscribe();

      setUnreadCounts((currentCounts) => ({
        ...currentCounts,
        [selectedChannel]: 0,
      }));
      setMessagesLoading(false);
    }

    void initializeRoom();

    return () => {
      isActive = false;

      if (typingStopTimerRef.current) {
        clearTimeout(typingStopTimerRef.current);
      }

      if (roomChannelRef.current) {
        void supabase.removeChannel(roomChannelRef.current);
        roomChannelRef.current = null;
      }
    };
  }, [selectedChannel, userId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages.length]);

  function announceTyping(value: string) {
    const roomChannel = roomChannelRef.current;

    if (!roomChannel || !userId || isChatSuspended) return;

    const now = Date.now();

    if (value.trim() && now - lastTypingSentRef.current > 600) {
      lastTypingSentRef.current = now;

      void roomChannel.send({
        type: "broadcast",
        event: "typing",
        payload: {
          user_id: userId,
          username,
          typing: true,
        } satisfies TypingPayload,
      });
    }

    if (typingStopTimerRef.current) {
      clearTimeout(typingStopTimerRef.current);
    }

    typingStopTimerRef.current = setTimeout(() => {
      void roomChannel.send({
        type: "broadcast",
        event: "typing",
        payload: {
          user_id: userId,
          username,
          typing: false,
        } satisfies TypingPayload,
      });
    }, 1200);
  }

  function handleMessageInput(event: ChangeEvent<HTMLInputElement>) {
    setMessageInput(event.target.value);
    announceTyping(event.target.value);
  }

  function selectChannel(channelId: string) {
    setSelectedChannel(channelId);
    setShowChannels(false);
  }

  function chooseAttachment(event: ChangeEvent<HTMLInputElement>) {
    if (isChatSuspended) {
      setErrorMessage(
        "Tài khoản của bạn đang bị khóa quyền chat.",
      );
      event.target.value = "";
      return;
    }

    const file = event.target.files?.[0] ?? null;

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setErrorMessage("Hiện tại chỉ hỗ trợ gửi file ảnh.");
      event.target.value = "";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setErrorMessage("Ảnh phải nhỏ hơn hoặc bằng 5 MB.");
      event.target.value = "";
      return;
    }

    if (attachmentPreview) {
      URL.revokeObjectURL(attachmentPreview);
    }

    setAttachmentFile(file);
    setAttachmentPreview(URL.createObjectURL(file));
    setErrorMessage("");
  }

  function clearAttachment() {
    if (attachmentPreview) {
      URL.revokeObjectURL(attachmentPreview);
    }

    setAttachmentFile(null);
    setAttachmentPreview("");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function uploadChatImage(file: File) {
    const path = `${userId}/${Date.now()}-${safeFileName(file.name)}`;

    const { error } = await supabase.storage
      .from("chat-files")
      .upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });

    if (error) {
      throw new Error(error.message);
    }

    const { data } = supabase.storage
      .from("chat-files")
      .getPublicUrl(path);

    return data.publicUrl;
  }

  async function sendMessage(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (isChatSuspended) {
      setErrorMessage(
        "Tài khoản của bạn đang bị khóa quyền chat.",
      );
      return;
    }

    const content = messageInput.trim();

    if (
      (!content && !attachmentFile) ||
      !userId ||
      sending
    ) {
      return;
    }

    setSending(true);
    setErrorMessage("");

    try {
      let uploadedUrl: string | null = null;

      if (attachmentFile) {
        uploadedUrl = await uploadChatImage(attachmentFile);
      }

      const { error } = await supabase.from("messages").insert({
        user_id: userId,
        username,
        content,
        channel: selectedChannel,
        reply_to_id: replyingTo?.id ?? null,
        attachment_url: uploadedUrl,
        attachment_name: attachmentFile?.name ?? null,
      });

      if (error) {
        throw new Error(error.message);
      }

      setMessageInput("");
      setReplyingTo(null);
      clearAttachment();
      announceTyping("");
    } catch (error) {
      setErrorMessage(
        `Không thể gửi tin nhắn: ${
          error instanceof Error ? error.message : "Lỗi không xác định"
        }`,
      );
    } finally {
      setSending(false);
    }
  }

  function beginEditing(message: MessageRow) {
    if (isChatSuspended) {
      setErrorMessage(
        "Tài khoản của bạn đang bị khóa quyền chat.",
      );
      return;
    }

    setEditingMessageId(message.id);
    setEditingContent(message.content);
    setErrorMessage("");
  }

  function cancelEditing() {
    setEditingMessageId(null);
    setEditingContent("");
  }

  async function saveEditedMessage(messageId: number) {
    if (isChatSuspended) {
      setErrorMessage(
        "Tài khoản của bạn đang bị khóa quyền chat.",
      );
      return;
    }

    const cleanContent = editingContent.trim();

    if (!cleanContent || actionMessageId !== null) {
      return;
    }

    setActionMessageId(messageId);
    setErrorMessage("");

    const { error } = await supabase
      .from("messages")
      .update({
        content: cleanContent,
        edited_at: new Date().toISOString(),
      })
      .eq("id", messageId)
      .eq("user_id", userId);

    if (error) {
      setErrorMessage(`Không thể sửa tin nhắn: ${error.message}`);
    } else {
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === messageId
            ? {
                ...message,
                content: cleanContent,
                edited_at: new Date().toISOString(),
              }
            : message,
        ),
      );
      cancelEditing();
    }

    setActionMessageId(null);
  }

  async function deleteMessage(messageId: number) {
    if (
      !window.confirm("Bạn có chắc muốn xóa tin nhắn này không?") ||
      actionMessageId !== null
    ) {
      return;
    }

    setActionMessageId(messageId);
    setErrorMessage("");

    const { error } = await supabase
      .from("messages")
      .delete()
      .eq("id", messageId)
      .eq("user_id", userId);

    if (error) {
      setErrorMessage(`Không thể xóa tin nhắn: ${error.message}`);
    } else {
      setMessages((currentMessages) =>
        currentMessages.filter(
          (message) => message.id !== messageId,
        ),
      );
    }

    setActionMessageId(null);
  }

  async function toggleReaction(messageId: number, emoji: string) {
    if (isChatSuspended) {
      setErrorMessage(
        "Tài khoản của bạn đang bị khóa quyền chat.",
      );
      return;
    }

    const existing = reactions.some(
      (reaction) =>
        reaction.message_id === messageId &&
        reaction.user_id === userId &&
        reaction.emoji === emoji,
    );

    if (existing) {
      const { error } = await supabase
        .from("message_reactions")
        .delete()
        .eq("message_id", messageId)
        .eq("user_id", userId)
        .eq("emoji", emoji);

      if (error) {
        setErrorMessage(`Không thể bỏ reaction: ${error.message}`);
      } else {
        setReactions((currentReactions) =>
          currentReactions.filter(
            (reaction) =>
              !(
                reaction.message_id === messageId &&
                reaction.user_id === userId &&
                reaction.emoji === emoji
              ),
          ),
        );
      }

      return;
    }

    const { error } = await supabase
      .from("message_reactions")
      .insert({
        message_id: messageId,
        user_id: userId,
        username,
        emoji,
      });

    if (error) {
      setErrorMessage(`Không thể thêm reaction: ${error.message}`);
    } else {
      setReactions((currentReactions) => [
        ...currentReactions,
        {
          message_id: messageId,
          user_id: userId,
          username,
          emoji,
          created_at: new Date().toISOString(),
        },
      ]);
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  function suspensionEndText() {
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
    <main className="relative grid h-screen grid-cols-1 overflow-hidden bg-[#313338] text-white md:grid-cols-[72px_240px_minmax(0,1fr)] lg:grid-cols-[72px_240px_minmax(0,1fr)_240px]">
      {showChannels && (
        <button
          type="button"
          aria-label="Đóng danh sách kênh"
          onClick={() => setShowChannels(false)}
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
        />
      )}

      {showMembers && (
        <button
          type="button"
          aria-label="Đóng danh sách thành viên"
          onClick={() => setShowMembers(false)}
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
        />
      )}

      {/* Máy chủ */}
      <aside className="hidden flex-col items-center gap-3 bg-[#1e1f22] py-3 md:flex">
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

      {/* Kênh */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[280px] min-h-0 flex-col bg-[#2b2d31] transition-transform md:static md:w-auto md:translate-x-0 ${
          showChannels ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between border-b border-black/20 px-4 py-4 font-bold shadow">
          <span>Talk Cùng Lâm DZ</span>

          <button
            type="button"
            onClick={() => setShowChannels(false)}
            className="text-gray-400 md:hidden"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-3">
          <div className="mb-2 flex items-center justify-between text-xs font-bold uppercase text-gray-400">
            <span>Kênh văn bản</span>
            <span>+</span>
          </div>

          <nav className="space-y-1">
            {channels.map((channel) => {
              const isSelected = channel.id === selectedChannel;
              const unread = unreadCounts[channel.id] ?? 0;

              return (
                <button
                  key={channel.id}
                  type="button"
                  onClick={() => selectChannel(channel.id)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left ${
                    isSelected
                      ? "bg-white/10 text-white"
                      : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
                  }`}
                >
                  <span className="text-xl text-gray-400">#</span>
                  <span className="min-w-0 flex-1 truncate">
                    {channel.label}
                  </span>

                  {unread > 0 && (
                    <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="mb-2 mt-6 text-xs font-bold uppercase text-gray-400">
            Tin nhắn
          </div>

          <button
            type="button"
            onClick={() => {
              window.location.href = "/messages";
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-2 text-gray-400 hover:bg-white/5 hover:text-gray-200"
          >
            <span>💬</span>
            <span className="min-w-0 flex-1 text-left">
              Tin nhắn riêng
            </span>

            {privateUnreadCount > 0 && (
              <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">
                {privateUnreadCount > 99
                  ? "99+"
                  : privateUnreadCount}
              </span>
            )}
          </button>

          <div className="mb-2 mt-6 text-xs font-bold uppercase text-gray-400">
            Kênh thoại
          </div>

          <button className="flex w-full items-center gap-2 rounded px-2 py-2 text-gray-400 hover:bg-white/5">
            🔊 Phòng trò chuyện
          </button>
        </div>

        <div className="flex items-center gap-3 bg-[#232428] p-3">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={username}
              className="h-9 w-9 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500 font-bold">
              {username.charAt(0).toUpperCase()}
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              window.location.href = "/settings";
            }}
            className="min-w-0 flex-1 text-left"
          >
            <div className="truncate text-sm font-semibold">
              {username}
            </div>
            <div className="text-xs text-gray-400">
              Cài đặt tài khoản
            </div>
          </button>

          <button
            onClick={logout}
            title="Đăng xuất"
            className="text-gray-400 hover:text-white"
          >
            ↪
          </button>
        </div>
      </aside>

      {/* Chat */}
      <section className="flex min-w-0 flex-col">
        <header className="flex h-[57px] items-center gap-3 border-b border-black/20 px-3 shadow md:px-4">
          <button
            type="button"
            onClick={() => setShowChannels(true)}
            className="rounded p-1 text-xl text-gray-300 md:hidden"
          >
            ☰
          </button>

          <span className="text-2xl text-gray-400">#</span>
          <strong>{activeChannel.label}</strong>

          <span className="hidden min-w-0 flex-1 truncate text-sm text-gray-400 sm:block">
            {activeChannel.description}
          </span>

          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Tìm tin nhắn"
            className="ml-auto hidden w-40 rounded bg-[#1e1f22] px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-indigo-500 sm:block"
          />

          <button
            type="button"
            onClick={() => setShowMembers(true)}
            className="rounded p-1 text-xl text-gray-300 lg:hidden"
          >
            👥
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-3 py-5 md:px-5">
          <div className="mb-8">
            <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-[#41434a] text-4xl">
              #
            </div>

            <h1 className="text-2xl font-bold md:text-3xl">
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

          {isChatSuspended && suspension && (
            <div className="mb-4 rounded-md border border-orange-500/30 bg-orange-500/15 px-4 py-3 text-sm text-orange-200">
              <strong>Bạn đang bị khóa quyền chat.</strong>
              <div className="mt-1">
                Lý do: {suspension.reason}
              </div>
              <div>
                Thời hạn: {suspensionEndText()}
              </div>
              <div className="mt-1 text-orange-300">
                Bạn vẫn có thể đọc tin nhắn nhưng không thể gửi,
                sửa tin, reaction hoặc tải ảnh.
              </div>
            </div>
          )}

          {messagesLoading ? (
            <p className="text-sm text-gray-400">
              Đang tải tin nhắn...
            </p>
          ) : filteredMessages.length === 0 ? (
            <p className="text-sm text-gray-400">
              {searchQuery
                ? "Không tìm thấy tin nhắn phù hợp."
                : "Chưa có tin nhắn. Hãy gửi tin nhắn đầu tiên."}
            </p>
          ) : (
            <div className="space-y-1">
              {filteredMessages.map((message) => {
                const isOwnMessage = message.user_id === userId;
                const isEditing =
                  editingMessageId === message.id;
                const isWorking =
                  actionMessageId === message.id;
                const repliedMessage = message.reply_to_id
                  ? messageById.get(message.reply_to_id)
                  : undefined;
                const messageReactions =
                  reactionsByMessage.get(message.id);

                return (
                  <article
                    key={message.id}
                    className="group relative flex gap-3 rounded px-2 py-3 hover:bg-black/10 md:gap-4"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-500 font-bold">
                      {message.username.charAt(0).toUpperCase()}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <strong>{message.username}</strong>

                        <span className="text-xs text-gray-400">
                          {formatTime(message.created_at)}
                        </span>

                        {message.edited_at && (
                          <span className="text-xs text-gray-500">
                            (đã sửa)
                          </span>
                        )}
                      </div>

                      {repliedMessage && (
                        <button
                          type="button"
                          className="mt-1 block max-w-full truncate border-l-2 border-indigo-400 pl-2 text-left text-xs text-gray-400"
                        >
                          Trả lời {repliedMessage.username}:{" "}
                          {repliedMessage.content || "Ảnh đính kèm"}
                        </button>
                      )}

                      {isEditing ? (
                        <div className="mt-2">
                          <textarea
                            value={editingContent}
                            onChange={(event) =>
                              setEditingContent(event.target.value)
                            }
                            maxLength={2000}
                            rows={2}
                            autoFocus
                            className="w-full resize-none rounded-md bg-[#1e1f22] px-3 py-2 outline-none ring-indigo-500 focus:ring-2"
                          />

                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                void saveEditedMessage(message.id)
                              }
                              disabled={
                                isWorking ||
                                !editingContent.trim()
                              }
                              className="rounded bg-indigo-500 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                            >
                              {isWorking
                                ? "Đang lưu..."
                                : "Lưu"}
                            </button>

                            <button
                              type="button"
                              onClick={cancelEditing}
                              className="rounded bg-white/10 px-3 py-1.5 text-xs font-semibold"
                            >
                              Hủy
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {message.content && (
                            <p className="mt-1 whitespace-pre-wrap break-words text-gray-200">
                              {message.content}
                            </p>
                          )}

                          {message.attachment_url && (
                            <a
                              href={message.attachment_url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 block max-w-xl"
                            >
                              <img
                                src={message.attachment_url}
                                alt={
                                  message.attachment_name ??
                                  "Ảnh đính kèm"
                                }
                                className="max-h-80 rounded-lg object-contain"
                              />
                            </a>
                          )}
                        </>
                      )}

                      {!isEditing && (
                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          {messageReactions &&
                            Array.from(messageReactions.entries()).map(
                              ([emoji, reaction]) => (
                                <button
                                  key={emoji}
                                  type="button"
                                  onClick={() =>
                                    void toggleReaction(
                                      message.id,
                                      emoji,
                                    )
                                  }
                                  className={`rounded-full border px-2 py-0.5 text-xs ${
                                    reaction.mine
                                      ? "border-indigo-400 bg-indigo-500/20"
                                      : "border-white/10 bg-white/5"
                                  }`}
                                >
                                  {emoji} {reaction.count}
                                </button>
                              ),
                            )}

                          <div className="hidden gap-1 group-hover:flex">
                            {reactionChoices.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                onClick={() =>
                                  void toggleReaction(
                                    message.id,
                                    emoji,
                                  )
                                }
                                className="rounded px-1.5 py-0.5 text-xs hover:bg-white/10"
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {!isEditing && (
                      <div className="absolute right-2 top-2 hidden overflow-hidden rounded-md border border-black/20 bg-[#2b2d31] shadow-lg group-hover:flex">
                        <button
                          type="button"
                          onClick={() => setReplyingTo(message)}
                          className="px-2 py-1.5 text-xs text-gray-300 hover:bg-white/10"
                        >
                          Trả lời
                        </button>

                        {isOwnMessage && (
                          <>
                            <button
                              type="button"
                              onClick={() => beginEditing(message)}
                              className="px-2 py-1.5 text-xs text-gray-300 hover:bg-white/10"
                            >
                              Sửa
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                void deleteMessage(message.id)
                              }
                              disabled={isWorking}
                              className="px-2 py-1.5 text-xs text-red-300 hover:bg-red-500/15"
                            >
                              Xóa
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="px-3 pb-2 md:px-4">
          {typingUsers.length > 0 && (
            <p className="mb-1 text-xs text-gray-400">
              {typingUsers.slice(0, 2).join(", ")}
              {typingUsers.length > 2
                ? ` và ${typingUsers.length - 2} người khác`
                : ""}{" "}
              đang nhập...
            </p>
          )}

          {replyingTo && (
            <div className="flex items-center justify-between rounded-t-lg bg-[#2b2d31] px-4 py-2 text-xs text-gray-300">
              <span className="truncate">
                Đang trả lời <strong>{replyingTo.username}</strong>:{" "}
                {replyingTo.content || "Ảnh đính kèm"}
              </span>

              <button
                type="button"
                onClick={() => setReplyingTo(null)}
                className="ml-3 text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>
          )}

          {attachmentPreview && (
            <div className="relative w-fit bg-[#2b2d31] p-3">
              <img
                src={attachmentPreview}
                alt="Ảnh sắp gửi"
                className="max-h-32 rounded object-contain"
              />

              <button
                type="button"
                onClick={clearAttachment}
                className="absolute right-1 top-1 rounded-full bg-black/70 px-2 py-1 text-xs"
              >
                ✕
              </button>
            </div>
          )}

          <form onSubmit={sendMessage}>
            <div className="flex items-center rounded-lg bg-[#383a40] px-3 md:px-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={chooseAttachment}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isChatSuspended}
                className="mr-3 text-2xl text-gray-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                title={
                  isChatSuspended
                    ? "Tài khoản đang bị khóa chat"
                    : "Gửi ảnh"
                }
              >
                +
              </button>

              <input
                value={messageInput}
                onChange={handleMessageInput}
                disabled={isChatSuspended}
                placeholder={
                  isChatSuspended
                    ? "Tài khoản đang bị khóa quyền chat"
                    : `Nhắn tin trong #${activeChannel.label}`
                }
                maxLength={2000}
                className="min-w-0 flex-1 bg-transparent py-3 outline-none placeholder:text-gray-400 disabled:cursor-not-allowed"
              />

              <button
                type="submit"
                disabled={
                  sending ||
                  messagesLoading ||
                  isChatSuspended
                }
                className="ml-3 rounded bg-indigo-500 px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
              >
                {sending ? "Đang gửi..." : "Gửi"}
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* Thành viên */}
      <aside
        className={`fixed inset-y-0 right-0 z-40 w-[260px] overflow-y-auto bg-[#2b2d31] p-4 transition-transform lg:static lg:w-auto lg:translate-x-0 ${
          showMembers ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase text-gray-400">
            Đang online — {onlineUsers.length}
          </h2>

          <button
            type="button"
            onClick={() => setShowMembers(false)}
            className="text-gray-400 lg:hidden"
          >
            ✕
          </button>
        </div>

        {onlineUsers.map((member) => (
          <button
            key={member.user_id}
            type="button"
            onClick={() => {
              window.location.href =
                member.user_id === userId
                  ? "/settings"
                  : `/messages?user=${encodeURIComponent(
                      member.user_id,
                    )}`;
            }}
            className="mb-1 flex w-full items-center gap-3 rounded p-2 text-left text-gray-300 hover:bg-white/5"
          >
            <div className="relative">
              {member.avatar_url ? (
                <img
                  src={member.avatar_url}
                  alt={member.username}
                  className="h-9 w-9 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500 font-bold">
                  {member.username.charAt(0).toUpperCase()}
                </div>
              )}

              <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#2b2d31] bg-green-500" />
            </div>

            <span className="min-w-0 flex-1 truncate font-medium">
              {member.username}
            </span>

            <span className="text-xs text-gray-500">
              {member.user_id === userId
                ? "Bạn"
                : "Nhắn tin"}
            </span>
          </button>
        ))}
      </aside>

    </main>
  );
}
