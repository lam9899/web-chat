"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/utils/supabase/client";
import { notifyPrivateMessage } from "@/utils/notifications";

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
  read_at: string | null;
};

type SuspensionRow = {
  user_id: string;
  reason: string;
  suspended_until: string | null;
};

type BlockRow = {
  blocker_id: string;
  blocked_id: string;
  created_at: string;
};

type CallType = "audio" | "video";

type CreatedCallRow = {
  id: string;
  status: string;
};

type CallHistoryRow = {
  id: string;
  caller_id: string;
  receiver_id: string;
  call_type: "audio" | "video";
  status:
    | "ringing"
    | "accepted"
    | "declined"
    | "ended"
    | "missed";
  created_at: string;
  answered_at: string | null;
  ended_at: string | null;
  updated_at: string;
  end_reason: string | null;
  ended_by: string | null;
};

type ConversationTimelineItem =
  | {
      kind: "message";
      key: string;
      createdAt: string;
      message: DirectMessageRow;
    }
  | {
      kind: "call";
      key: string;
      createdAt: string;
      call: CallHistoryRow;
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
  const [blockedUserIds, setBlockedUserIds] = useState<
    Set<string>
  >(new Set());

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
  const [blockingUserId, setBlockingUserId] = useState<
    string | null
  >(null);
  const [startingCallType, setStartingCallType] =
    useState<CallType | null>(null);
  const [callHistory, setCallHistory] = useState<
    CallHistoryRow[]
  >([]);
  const [callHistoryLoading, setCallHistoryLoading] =
    useState(false);
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

  const isSelectedBlocked = Boolean(
    selectedProfile &&
      blockedUserIds.has(selectedProfile.id),
  );

  const totalUnread = useMemo(
    () =>
      Object.values(unreadByUser).reduce(
        (total, count) => total + count,
        0,
      ),
    [unreadByUser],
  );

  const filteredProfiles = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase("vi");

    if (!query) return profiles;

    return profiles.filter((profile) =>
      profile.username
        .toLocaleLowerCase("vi")
        .includes(query),
    );
  }, [profiles, searchQuery]);

  const conversationTimeline =
    useMemo<ConversationTimelineItem[]>(() => {
      const messageItems: ConversationTimelineItem[] =
        messages.map((message) => ({
          kind: "message",
          key: `message-${message.id}`,
          createdAt: message.created_at,
          message,
        }));

      const callItems: ConversationTimelineItem[] =
        callHistory.map((callItem) => ({
          kind: "call",
          key: `call-${callItem.id}`,
          createdAt: callItem.created_at,
          call: callItem,
        }));

      return [...messageItems, ...callItems].sort(
        (left, right) =>
          new Date(left.createdAt).getTime() -
          new Date(right.createdAt).getTime(),
      );
    }, [callHistory, messages]);

  function callDurationText(callItem: CallHistoryRow) {
    if (!callItem.answered_at || !callItem.ended_at) {
      return "";
    }

    const totalSeconds = Math.max(
      0,
      Math.floor(
        (new Date(callItem.ended_at).getTime() -
          new Date(callItem.answered_at).getTime()) /
          1000,
      ),
    );

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function callStatusText(callItem: CallHistoryRow) {
    const outgoing =
      callItem.caller_id === currentUserId;

    if (callItem.status === "ringing") {
      return outgoing ? "Đang gọi" : "Cuộc gọi đến";
    }

    if (callItem.status === "accepted") {
      return "Đang diễn ra";
    }

    if (callItem.status === "declined") {
      return outgoing ? "Bị từ chối" : "Đã từ chối";
    }

    if (callItem.status === "missed") {
      return outgoing
        ? "Không được trả lời"
        : "Cuộc gọi nhỡ";
    }

    if (!callItem.answered_at) {
      return outgoing ? "Đã hủy" : "Đã kết thúc";
    }

    if (callItem.end_reason === "disconnect") {
      return "Mất kết nối";
    }

    return "Đã kết thúc";
  }

  function callEventTitle(callItem: CallHistoryRow) {
    const outgoing =
      callItem.caller_id === currentUserId;
    const typeText =
      callItem.call_type === "video"
        ? "video"
        : "thoại";

    if (callItem.status === "ringing") {
      return outgoing
        ? `Đang gọi ${typeText}`
        : `Cuộc gọi ${typeText} đến`;
    }

    if (callItem.status === "accepted") {
      return `Cuộc gọi ${typeText} đang diễn ra`;
    }

    if (callItem.status === "declined") {
      return outgoing
        ? `Cuộc gọi ${typeText} bị từ chối`
        : `Bạn đã từ chối cuộc gọi ${typeText}`;
    }

    if (callItem.status === "missed") {
      return outgoing
        ? `Cuộc gọi ${typeText} không được trả lời`
        : `Cuộc gọi ${typeText} nhỡ`;
    }

    if (!callItem.answered_at) {
      return outgoing
        ? `Bạn đã hủy cuộc gọi ${typeText}`
        : `Cuộc gọi ${typeText} đã kết thúc`;
    }

    return outgoing
      ? `Bạn đã gọi ${typeText}`
      : `Bạn đã nhận cuộc gọi ${typeText}`;
  }

  useEffect(() => {
    document.title =
      totalUnread > 0
        ? `(${totalUnread}) Tin nhắn riêng | Talk Cùng Lâm DZ`
        : "Tin nhắn riêng | Talk Cùng Lâm DZ";
  }, [totalUnread]);

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

      await supabase.rpc("cleanup_stale_calls");

      const [
        { data: profileData, error: profileError },
        { data: suspensionData, error: suspensionError },
        { data: unreadData, error: unreadError },
        { data: blockData, error: blockError },
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
        supabase
          .from("direct_messages")
          .select("sender_id")
          .eq("receiver_id", user.id)
          .is("read_at", null),
        supabase
          .from("user_blocks")
          .select("blocked_id")
          .eq("blocker_id", user.id),
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

      if (unreadError) {
        setErrorMessage(
          `Không thể tải số tin chưa đọc: ${unreadError.message}`,
        );
      } else {
        const counts = (unreadData ?? []).reduce<
          Record<string, number>
        >((current, row) => {
          current[row.sender_id] =
            (current[row.sender_id] ?? 0) + 1;
          return current;
        }, {});

        setUnreadByUser(counts);
      }

      if (blockError) {
        setErrorMessage(
          `Không thể tải danh sách chặn: ${blockError.message}`,
        );
      } else {
        setBlockedUserIds(
          new Set(
            (blockData ?? []).map(
              (row) => row.blocked_id,
            ),
          ),
        );
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

              if (
                newMessage.receiver_id === user.id
              ) {
                const senderProfile = (
                  profileData ?? []
                ).find(
                  (profile) =>
                    profile.id === newMessage.sender_id,
                );

                if (
                  document.visibilityState !== "visible" ||
                  !belongsToSelected
                ) {
                  void notifyPrivateMessage({
                    messageId: newMessage.id,
                    senderId: newMessage.sender_id,
                    senderName:
                      senderProfile?.username ??
                      "một thành viên",
                    content: newMessage.content,
                  });
                }
              }

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

                if (
                  newMessage.receiver_id === user.id &&
                  selected
                ) {
                  setUnreadByUser((current) => ({
                    ...current,
                    [selected.id]: 0,
                  }));

                  void supabase.rpc(
                    "mark_direct_messages_read",
                    {
                      p_other_user_id: selected.id,
                    },
                  );
                }
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
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "user_blocks",
            filter: `blocker_id=eq.${user.id}`,
          },
          (payload) => {
            if (!active) return;

            if (payload.eventType === "INSERT") {
              const newBlock = payload.new as BlockRow;

              setBlockedUserIds((current) => {
                const next = new Set(current);
                next.add(newBlock.blocked_id);
                return next;
              });
            }

            if (payload.eventType === "DELETE") {
              const oldBlock = payload.old as Partial<BlockRow>;

              if (oldBlock.blocked_id) {
                setBlockedUserIds((current) => {
                  const next = new Set(current);
                  next.delete(oldBlock.blocked_id as string);
                  return next;
                });
              }
            }
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "call_sessions",
          },
          (payload) => {
            if (!active) return;

            if (payload.eventType === "DELETE") {
              const deletedCall =
                payload.old as Partial<CallHistoryRow>;

              if (deletedCall.id) {
                setCallHistory((current) =>
                  current.filter(
                    (item) => item.id !== deletedCall.id,
                  ),
                );
              }

              return;
            }

            const changedCall =
              payload.new as CallHistoryRow;

            if (
              changedCall.caller_id !== user.id &&
              changedCall.receiver_id !== user.id
            ) {
              return;
            }

            const otherParticipantId =
              changedCall.caller_id === user.id
                ? changedCall.receiver_id
                : changedCall.caller_id;

            if (
              selectedProfileRef.current?.id !==
              otherParticipantId
            ) {
              return;
            }

            setCallHistory((current) => {
              const withoutCurrent = current.filter(
                (item) => item.id !== changedCall.id,
              );

              return [changedCall, ...withoutCurrent]
                .sort(
                  (left, right) =>
                    new Date(right.created_at).getTime() -
                    new Date(left.created_at).getTime(),
                )
                .slice(0, 20);
            });
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
      setCallHistory([]);
      return;
    }

    let active = true;
    const otherUserId = selectedProfile.id;

    async function loadConversation() {
      setMessagesLoading(true);
      setCallHistoryLoading(true);
      setMessages([]);
      setCallHistory([]);
      setEditingId(null);
      setEditingContent("");
      setErrorMessage("");

      const [
        { data, error },
        {
          data: historyData,
          error: historyError,
        },
      ] = await Promise.all([
        supabase
          .from("direct_messages")
          .select(
            "id, sender_id, receiver_id, content, created_at, edited_at, read_at",
          )
          .or(
            `and(sender_id.eq.${currentUserId},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${currentUserId})`,
          )
          .order("created_at", { ascending: true })
          .limit(200),
        supabase
          .from("call_sessions")
          .select(
            "id, caller_id, receiver_id, call_type, status, created_at, answered_at, ended_at, updated_at, end_reason, ended_by",
          )
          .or(
            `and(caller_id.eq.${currentUserId},receiver_id.eq.${otherUserId}),and(caller_id.eq.${otherUserId},receiver_id.eq.${currentUserId})`,
          )
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

      if (!active) return;

      if (historyError) {
        setErrorMessage(
          `Không thể tải lịch sử cuộc gọi: ${historyError.message}`,
        );
      } else {
        setCallHistory(
          (historyData ?? []) as CallHistoryRow[],
        );
      }

      setCallHistoryLoading(false);

      if (error) {
        setErrorMessage(
          `Không thể tải cuộc trò chuyện: ${error.message}`,
        );
      } else {
        const loadedMessages = data ?? [];
        setMessages(loadedMessages);

        const { error: readError } = await supabase.rpc(
          "mark_direct_messages_read",
          {
            p_other_user_id: otherUserId,
          },
        );

        if (!active) return;

        if (readError) {
          setErrorMessage(
            `Không thể đánh dấu đã đọc: ${readError.message}`,
          );
        } else {
          setMessages((current) =>
            current.map((message) =>
              message.receiver_id === currentUserId &&
              message.sender_id === otherUserId &&
              message.read_at === null
                ? {
                    ...message,
                    read_at: new Date().toISOString(),
                  }
                : message,
            ),
          );
        }
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
    if (!currentUserId || !selectedProfile) return;

    async function markVisibleConversationRead() {
      if (
        document.visibilityState !== "visible" ||
        !selectedProfile
      ) {
        return;
      }

      const { error } = await supabase.rpc(
        "mark_direct_messages_read",
        {
          p_other_user_id: selectedProfile.id,
        },
      );

      if (!error) {
        const now = new Date().toISOString();

        setMessages((current) =>
          current.map((message) =>
            message.receiver_id === currentUserId &&
            message.sender_id === selectedProfile.id &&
            message.read_at === null
              ? {
                  ...message,
                  read_at: now,
                }
              : message,
          ),
        );

        setUnreadByUser((current) => ({
          ...current,
          [selectedProfile.id]: 0,
        }));
      }
    }

    function handleVisibility() {
      void markVisibleConversationRead();
    }

    window.addEventListener("focus", handleVisibility);
    document.addEventListener(
      "visibilitychange",
      handleVisibility,
    );

    return () => {
      window.removeEventListener("focus", handleVisibility);
      document.removeEventListener(
        "visibilitychange",
        handleVisibility,
      );
    };
  }, [currentUserId, selectedProfile]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [callHistory.length, messages.length]);

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

    if (isSelectedBlocked) {
      setErrorMessage(
        "Bạn đã chặn thành viên này. Hãy bỏ chặn trước khi gửi tin.",
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
      const blockedByOther =
        error.message.toLocaleLowerCase("vi").includes(
          "row-level security",
        );

      setErrorMessage(
        blockedByOther
          ? "Không thể gửi tin nhắn. Một trong hai tài khoản đã chặn người còn lại."
          : `Không thể gửi tin nhắn: ${error.message}`,
      );
    } else {
      setMessageInput("");
    }

    setSending(false);
  }

  async function startCall(callType: CallType) {
    if (
      !selectedProfile ||
      !currentUserId ||
      startingCallType !== null
    ) {
      return;
    }

    if (isSuspended) {
      setErrorMessage(
        "Tài khoản của bạn đang bị khóa quyền chat.",
      );
      return;
    }

    if (isSelectedBlocked) {
      setErrorMessage(
        "Hãy bỏ chặn thành viên trước khi gọi.",
      );
      return;
    }

    setStartingCallType(callType);
    setErrorMessage("");

    const { data, error } = await supabase.rpc(
      "create_private_call",
      {
        p_receiver_id: selectedProfile.id,
        p_call_type: callType,
      },
    );

    const createdCall = (
      Array.isArray(data) ? data[0] : data
    ) as CreatedCallRow | null;

    if (error || !createdCall?.id) {
      setErrorMessage(
        error
          ? `Không thể bắt đầu cuộc gọi: ${error.message}`
          : "Không thể tạo cuộc gọi.",
      );
      setStartingCallType(null);
      return;
    }

    window.location.href = `/call/${createdCall.id}`;
  }

  async function toggleBlockSelected() {
    if (
      !selectedProfile ||
      !currentUserId ||
      blockingUserId !== null
    ) {
      return;
    }

    const target = selectedProfile;
    const currentlyBlocked = blockedUserIds.has(target.id);

    if (
      !currentlyBlocked &&
      !window.confirm(
        `Chặn ${target.username}? Người này sẽ không thể nhắn tin riêng cho bạn và bạn cũng không thể nhắn cho họ.`,
      )
    ) {
      return;
    }

    setBlockingUserId(target.id);
    setErrorMessage("");

    if (currentlyBlocked) {
      const { error } = await supabase
        .from("user_blocks")
        .delete()
        .eq("blocker_id", currentUserId)
        .eq("blocked_id", target.id);

      if (error) {
        setErrorMessage(
          `Không thể bỏ chặn: ${error.message}`,
        );
      } else {
        setBlockedUserIds((current) => {
          const next = new Set(current);
          next.delete(target.id);
          return next;
        });
      }
    } else {
      const { error } = await supabase
        .from("user_blocks")
        .insert({
          blocker_id: currentUserId,
          blocked_id: target.id,
        });

      if (error) {
        setErrorMessage(
          `Không thể chặn thành viên: ${error.message}`,
        );
      } else {
        setBlockedUserIds((current) => {
          const next = new Set(current);
          next.add(target.id);
          return next;
        });
        setMessageInput("");
        setEditingId(null);
        setEditingContent("");
      }
    }

    setBlockingUserId(null);
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
              <h1 className="flex items-center gap-2 text-xl font-bold">
                <span>Tin nhắn riêng</span>

                {totalUnread > 0 && (
                  <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs">
                    {totalUnread > 99 ? "99+" : totalUnread}
                  </span>
                )}
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
      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        {selectedProfile ? (
          <>
            <header className="flex h-[64px] shrink-0 items-center gap-3 border-b border-black/20 px-4 shadow">
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

              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => void startCall("audio")}
                  disabled={
                    startingCallType !== null ||
                    isSelectedBlocked ||
                    isSuspended
                  }
                  title="Gọi thoại"
                  className="rounded bg-green-600 px-3 py-2 text-sm font-semibold hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {startingCallType === "audio"
                    ? "..."
                    : "📞"}
                </button>

                <button
                  type="button"
                  onClick={() => void startCall("video")}
                  disabled={
                    startingCallType !== null ||
                    isSelectedBlocked ||
                    isSuspended
                  }
                  title="Gọi video"
                  className="rounded bg-indigo-500 px-3 py-2 text-sm font-semibold hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {startingCallType === "video"
                    ? "..."
                    : "🎥"}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void toggleBlockSelected()
                  }
                  disabled={
                    blockingUserId === selectedProfile.id
                  }
                  className={`rounded px-3 py-2 text-sm font-semibold disabled:opacity-50 ${
                    isSelectedBlocked
                      ? "bg-green-600 hover:bg-green-500"
                      : "bg-red-500/20 text-red-300 hover:bg-red-500/30"
                  }`}
                >
                  {blockingUserId === selectedProfile.id
                    ? "Đang xử lý..."
                    : isSelectedBlocked
                      ? "Bỏ chặn"
                      : "Chặn"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    window.location.href = "/settings";
                  }}
                  className="rounded bg-white/10 px-3 py-2 text-sm hover:bg-white/15"
                >
                  Cài đặt
                </button>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 [scrollbar-gutter:stable] md:px-6">
              {errorMessage && (
                <div className="mb-4 rounded-md bg-red-500/15 px-4 py-3 text-sm text-red-300">
                  {errorMessage}
                </div>
              )}

              {isSelectedBlocked && (
                <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/15 px-4 py-3 text-sm text-red-200">
                  Bạn đã chặn {selectedProfile.username}. Tin nhắn cũ vẫn được giữ, nhưng hai bên không thể gửi tin mới cho nhau.
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

              {messagesLoading || callHistoryLoading ? (
                <p className="text-sm text-gray-400">
                  Đang tải cuộc trò chuyện...
                </p>
              ) : conversationTimeline.length === 0 ? (
                <div className="flex h-full items-center justify-center text-center text-gray-400">
                  <div>
                    <div className="text-5xl">💬</div>
                    <p className="mt-3">
                      Chưa có tin nhắn hoặc cuộc gọi. Hãy
                      bắt đầu cuộc trò chuyện.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {conversationTimeline.map(
                    (timelineItem) => {
                      if (timelineItem.kind === "call") {
                        const callItem =
                          timelineItem.call;
                        const outgoing =
                          callItem.caller_id ===
                          currentUserId;
                        const incomingMissed =
                          callItem.status === "missed" &&
                          !outgoing;
                        const duration =
                          callDurationText(callItem);
                        const callActive = [
                          "ringing",
                          "accepted",
                        ].includes(callItem.status);

                        return (
                          <article
                            key={timelineItem.key}
                            className={`flex ${
                              outgoing
                                ? "justify-end"
                                : "justify-start"
                            }`}
                          >
                            <div
                              className={`max-w-[92%] rounded-2xl border px-3 py-2.5 shadow-sm md:max-w-[76%] ${
                                incomingMissed
                                  ? "rounded-bl-md border-red-500/30 bg-red-500/10"
                                  : outgoing
                                    ? "rounded-br-md border-indigo-400/30 bg-indigo-500/20"
                                    : "rounded-bl-md border-white/10 bg-[#2b2d31]"
                              }`}
                            >
                              <div className="flex items-center gap-2.5">
                                <div
                                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base ${
                                    incomingMissed
                                      ? "bg-red-500/20"
                                      : outgoing
                                        ? "bg-indigo-500/25"
                                        : "bg-white/10"
                                  }`}
                                >
                                  {callItem.call_type ===
                                  "video"
                                    ? "🎥"
                                    : "📞"}
                                </div>

                                <div className="min-w-0 flex-1">
                                  <p
                                    className={`truncate text-sm font-bold ${
                                      incomingMissed
                                        ? "text-red-300"
                                        : "text-white"
                                    }`}
                                  >
                                    {callEventTitle(
                                      callItem,
                                    )}
                                  </p>

                                  <p
                                    className={`mt-0.5 truncate text-xs ${
                                      incomingMissed
                                        ? "text-red-300/80"
                                        : outgoing
                                          ? "text-indigo-100/80"
                                          : "text-gray-400"
                                    }`}
                                  >
                                    {callStatusText(
                                      callItem,
                                    )}
                                    {duration
                                      ? ` · ${duration}`
                                      : ""}
                                  </p>

                                  <p
                                    className={`mt-0.5 text-[11px] ${
                                      outgoing
                                        ? "text-indigo-100/60"
                                        : "text-gray-500"
                                    }`}
                                  >
                                    {formatTime(
                                      callItem.created_at,
                                    )}
                                  </p>
                                </div>

                                {!callActive && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void startCall(
                                        callItem.call_type,
                                      )
                                    }
                                    disabled={
                                      startingCallType !==
                                        null ||
                                      isSelectedBlocked ||
                                      isSuspended
                                    }
                                    title={
                                      callItem.call_type ===
                                      "video"
                                        ? "Gọi video lại"
                                        : "Gọi lại"
                                    }
                                    className={`ml-1 shrink-0 rounded-lg px-2.5 py-2 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                                      incomingMissed
                                        ? "bg-red-500/20 text-red-200 hover:bg-red-500/30"
                                        : outgoing
                                          ? "bg-indigo-500/25 text-indigo-100 hover:bg-indigo-500/35"
                                          : "bg-white/10 text-white hover:bg-white/15"
                                    }`}
                                  >
                                    {startingCallType ===
                                    callItem.call_type
                                      ? "..."
                                      : callItem.call_type ===
                                          "video"
                                        ? "🎥 Gọi lại"
                                        : "📞 Gọi lại"}
                                  </button>
                                )}
                              </div>
                            </div>
                          </article>
                        );
                      }

                      const message =
                        timelineItem.message;
                      const isMine =
                        message.sender_id ===
                        currentUserId;
                      const isEditing =
                        editingId === message.id;
                      const isWorking =
                        workingId === message.id;

                      return (
                        <article
                          key={timelineItem.key}
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
                                  {isMine
                                    ? message.read_at
                                      ? " · Đã xem"
                                      : " · Đã gửi"
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
                    },
                  )}

                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            <form
              onSubmit={sendMessage}
              className="shrink-0 border-t border-black/20 bg-[#313338] p-3 md:p-4"
            >
              <div className="flex rounded-lg bg-[#383a40] px-4">
                <input
                  value={messageInput}
                  onChange={(event) =>
                    setMessageInput(event.target.value)
                  }
                  disabled={
                    isSuspended || isSelectedBlocked
                  }
                  maxLength={2000}
                  placeholder={
                    isSuspended
                      ? "Tài khoản đang bị khóa quyền chat"
                      : isSelectedBlocked
                        ? "Bạn đã chặn thành viên này"
                        : `Nhắn tin cho ${selectedProfile.username}`
                  }
                  className="min-w-0 flex-1 bg-transparent py-3 outline-none placeholder:text-gray-400 disabled:cursor-not-allowed"
                />

                <button
                  type="submit"
                  disabled={
                    sending ||
                    isSuspended ||
                    isSelectedBlocked ||
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
