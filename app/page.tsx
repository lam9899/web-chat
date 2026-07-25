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
import { notifyPrivateMessage } from "@/utils/notifications";
import MemberBadge, {
  formatPublicId,
  type MemberRole,
} from "@/components/member-badge";
import FriendManager from "./messages/friend-manager";

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
  attachment_type: string | null;
  attachment_size: number | null;
  edited_at: string | null;
};

type ReactionRow = {
  message_id: number;
  user_id: string;
  username: string;
  emoji: string;
  created_at: string;
};

type MemberCard = {
  id: string;
  username: string;
  avatar_url: string | null;
  public_id: number;
  role: MemberRole;
  last_seen_at: string | null;
};

type OnlineUser = {
  user_id: string;
  username: string;
  avatar_url?: string;
  public_id: number;
  role: MemberRole;
  online_at: string;
  last_seen_at?: string | null;
};

type GlobalPresenceWindow = Window &
  typeof globalThis & {
    __talkGlobalPresence?: OnlineUser[];
  };

const GLOBAL_PRESENCE_EVENT =
  "talk-global-presence-sync";

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

type PrivateMessageNotificationRow = {
  id: number;
  sender_id: string;
  receiver_id: string;
  content: string;
};

type ReportCategory =
  | "profanity"
  | "sexual_content"
  | "illegal_content"
  | "spam_scam"
  | "other";

const reportCategoryOptions: Array<{
  id: ReportCategory;
  label: string;
  description: string;
  icon: string;
}> = [
  {
    id: "profanity",
    label: "Chửi bậy hoặc xúc phạm",
    description: "Lăng mạ, quấy rối hoặc công kích thành viên.",
    icon: "🤬",
  },
  {
    id: "sexual_content",
    label: "Link hoặc nội dung đồi trụy",
    description: "Hình ảnh, nội dung hoặc liên kết khiêu dâm.",
    icon: "🔞",
  },
  {
    id: "illegal_content",
    label: "Nội dung phạm pháp",
    description: "Hướng dẫn, mua bán hoặc chia sẻ nội dung trái pháp luật.",
    icon: "⚠️",
  },
  {
    id: "spam_scam",
    label: "Spam hoặc lừa đảo",
    description: "Quảng cáo rác, giả mạo hoặc dụ dỗ chuyển tiền.",
    icon: "🚫",
  },
  {
    id: "other",
    label: "Lý do khác",
    description: "Nội dung không phù hợp khác cần quản trị kiểm tra.",
    icon: "📝",
  },
];

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

const composerEmojiChoices = [
  "😀",
  "😁",
  "😂",
  "🤣",
  "😊",
  "😍",
  "🥰",
  "😎",
  "🤔",
  "😮",
  "😭",
  "😡",
  "👍",
  "👎",
  "👏",
  "🙏",
  "❤️",
  "🔥",
  "🎉",
  "✅",
  "💯",
  "🤝",
  "🌹",
  "😴",
];

const MAX_PUBLIC_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_PUBLIC_FILE_SIZE = 20 * 1024 * 1024;

const allowedPublicImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const allowedPublicFileTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
  "text/plain",
]);

const PUBLIC_FILE_ACCEPT = [
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".zip",
  ".txt",
].join(",");

function isPublicImageAttachment(
  attachmentType: string | null | undefined,
  attachmentName?: string | null,
) {
  if (attachmentType?.startsWith("image/")) {
    return true;
  }

  return Boolean(
    attachmentName?.match(
      /\.(jpe?g|png|webp|gif)$/i,
    ),
  );
}

function formatPublicAttachmentSize(
  size: number | null | undefined,
) {
  if (!size || size <= 0) return "";

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

function publicAttachmentIcon(
  attachmentType: string | null | undefined,
  attachmentName?: string | null,
) {
  const name = attachmentName?.toLowerCase() ?? "";

  if (
    attachmentType === "application/pdf" ||
    name.endsWith(".pdf")
  ) {
    return "📕";
  }

  if (
    attachmentType?.includes("word") ||
    attachmentType === "application/msword" ||
    name.endsWith(".doc") ||
    name.endsWith(".docx")
  ) {
    return "📘";
  }

  if (
    attachmentType?.includes("excel") ||
    attachmentType?.includes("spreadsheet") ||
    name.endsWith(".xls") ||
    name.endsWith(".xlsx")
  ) {
    return "📗";
  }

  if (
    attachmentType?.includes("powerpoint") ||
    attachmentType?.includes("presentation") ||
    name.endsWith(".ppt") ||
    name.endsWith(".pptx")
  ) {
    return "📙";
  }

  if (
    attachmentType === "application/zip" ||
    name.endsWith(".zip")
  ) {
    return "🗜️";
  }

  if (
    attachmentType === "text/plain" ||
    name.endsWith(".txt")
  ) {
    return "📄";
  }

  return "📎";
}

function safeFileName(fileName: string) {
  return fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
}

function formatLastActive(
  lastSeenAt: string | null | undefined,
  now: number,
) {
  if (!lastSeenAt) return "không rõ";

  const lastSeenTime = new Date(lastSeenAt).getTime();
  const difference = Math.max(0, now - lastSeenTime);
  const minutes = Math.floor(difference / 60_000);

  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày trước`;

  return new Date(lastSeenAt).toLocaleString(
    "vi-VN",
    {
      dateStyle: "short",
      timeStyle: "short",
    },
  );
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
  const [publicId, setPublicId] = useState<number | null>(null);
  const [memberRole, setMemberRole] =
    useState<MemberRole>("member");
  const [memberCards, setMemberCards] = useState<
    Record<string, MemberCard>
  >({});
  const [friendIds, setFriendIds] = useState<Set<string>>(
    new Set(),
  );
  const [blockedUserIds, setBlockedUserIds] = useState<
    Set<string>
  >(new Set());
  const [friendRequestSentIds, setFriendRequestSentIds] =
    useState<Set<string>>(new Set());

  const [replyingTo, setReplyingTo] = useState<MessageRow | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<number | null>(
    null,
  );
  const [editingContent, setEditingContent] = useState("");

  const [attachmentFile, setAttachmentFile] =
    useState<File | null>(null);
  const [attachmentPreview, setAttachmentPreview] =
    useState("");
  const [
    showComposerEmojiPicker,
    setShowComposerEmojiPicker,
  ] = useState(false);

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
  const [
    friendsSidebarCollapsed,
    setFriendsSidebarCollapsed,
  ] = useState(false);
  const [
    openMessageMenuId,
    setOpenMessageMenuId,
  ] = useState<number | null>(null);
  const [workingMemberId, setWorkingMemberId] =
    useState<string | null>(null);
  const [reportingMessage, setReportingMessage] =
    useState<MessageRow | null>(null);
  const [reportCategory, setReportCategory] =
    useState<ReportCategory>("profanity");
  const [reportDetails, setReportDetails] = useState("");
  const [submittingReport, setSubmittingReport] =
    useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(
    null,
  );
  const documentInputRef =
    useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const presenceChannelRef =
    useRef<ReturnType<typeof supabase.channel> | null>(null);
  const memberCardsRef = useRef<Record<string, MemberCard>>({});
  const friendIdsRef = useRef<Set<string>>(new Set());
  const roomChannelRef =
    useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastTypingSentRef = useRef(0);

  useEffect(() => {
    const savedState = window.localStorage.getItem(
      "friends-sidebar-collapsed",
    );

    setFriendsSidebarCollapsed(savedState === "1");
  }, []);

  function toggleFriendsSidebar() {
    setFriendsSidebarCollapsed((current) => {
      const next = !current;

      window.localStorage.setItem(
        "friends-sidebar-collapsed",
        next ? "1" : "0",
      );

      return next;
    });
  }

  const activeChannel = useMemo(
    () =>
      channels.find((channel) => channel.id === selectedChannel) ??
      channels[0],
    [selectedChannel],
  );

  const onlineUserIds = useMemo(
    () =>
      new Set(
        onlineUsers.map((member) => member.user_id),
      ),
    [onlineUsers],
  );

  const sidebarMembers = useMemo(() => {
    return Object.values(memberCards)
      .filter(
        (member) =>
          member.id === userId || friendIds.has(member.id),
      )
      .sort((firstMember, secondMember) => {
        const firstOnline = onlineUserIds.has(firstMember.id);
        const secondOnline = onlineUserIds.has(secondMember.id);

        if (firstOnline !== secondOnline) {
          return firstOnline ? -1 : 1;
        }

        return firstMember.username.localeCompare(
          secondMember.username,
          "vi",
        );
      });
  }, [friendIds, memberCards, onlineUserIds, userId]);

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
    memberCardsRef.current = memberCards;
  }, [memberCards]);

  useEffect(() => {
    function closeMessageMenu(event: MouseEvent) {
      const target = event.target as HTMLElement | null;

      if (target?.closest("[data-public-message-menu]")) {
        return;
      }

      setOpenMessageMenuId(null);
    }

    document.addEventListener("mousedown", closeMessageMenu);

    return () => {
      document.removeEventListener(
        "mousedown",
        closeMessageMenu,
      );
    };
  }, []);

  useEffect(() => {
    friendIdsRef.current = friendIds;
  }, [friendIds]);

  useEffect(() => {
    function applyPresence(members: OnlineUser[]) {
      const allowedIds = new Set(
        [userId, ...friendIds].filter(Boolean),
      );

      const visibleMembers = members
        .filter(
          (member) =>
            member.user_id &&
            allowedIds.has(member.user_id),
        )
        .map((member) => {
          const card = memberCards[member.user_id];

          return {
            ...member,
            username: card?.username ?? member.username,
            avatar_url:
              card?.avatar_url ?? member.avatar_url,
            public_id:
              card?.public_id ?? member.public_id ?? 0,
            role: card?.role ?? member.role ?? "member",
            last_seen_at:
              card?.last_seen_at ??
              member.last_seen_at ??
              null,
          } as OnlineUser;
        });

      const uniqueMembers = Array.from(
        new Map(
          visibleMembers.map((member) => [
            member.user_id,
            member,
          ]),
        ).values(),
      ).sort((firstMember, secondMember) =>
        firstMember.username.localeCompare(
          secondMember.username,
          "vi",
        ),
      );

      setOnlineUsers(uniqueMembers);
    }

    const browserWindow =
      window as GlobalPresenceWindow;

    applyPresence(
      browserWindow.__talkGlobalPresence ?? [],
    );

    function handlePresence(event: Event) {
      applyPresence(
        (
          event as CustomEvent<OnlineUser[]>
        ).detail ?? [],
      );
    }

    window.addEventListener(
      GLOBAL_PRESENCE_EVENT,
      handlePresence,
    );

    return () => {
      window.removeEventListener(
        GLOBAL_PRESENCE_EVENT,
        handlePresence,
      );
    };
  }, [friendIds, memberCards, userId]);

  async function loadMemberCards(ids: string[]) {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (uniqueIds.length === 0) return;

    const [{ data: profiles }, { data: roles }] = await Promise.all([
      supabase
        .from("profiles")
        .select(
              "id, username, avatar_url, public_id, last_seen_at",
            )
        .in("id", uniqueIds),
      supabase
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", uniqueIds),
    ]);

    const roleMap = new Map<string, MemberRole>(
      (roles ?? []).map(
        (row: {
          user_id: string;
          role: MemberRole;
        }) => [row.user_id, row.role],
      ),
    );

    const cards = (profiles ?? []).reduce(
      (
        current: Record<string, MemberCard>,
        profile: {
          id: string;
          username: string;
          avatar_url: string | null;
          public_id: number;
          last_seen_at: string | null;
        },
      ) => {
        current[profile.id] = {
          id: profile.id,
          username: profile.username,
          avatar_url: profile.avatar_url,
          public_id: profile.public_id,
          role: roleMap.get(profile.id) ?? "member",
          last_seen_at: profile.last_seen_at,
        };
        return current;
      },
      {} as Record<string, MemberCard>,
    );

    setMemberCards((current) => {
      const next = { ...current, ...cards };
      memberCardsRef.current = next;
      return next;
    });
  }

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

      const authenticatedUserId = user.id;

      const [
        profileResponse,
        roleResponse,
        friendsResponse,
        blocksResponse,
      ] = await Promise.all([
          supabase
            .from("profiles")
            .select(
              "id, username, avatar_url, public_id, last_seen_at",
            )
            .eq("id", authenticatedUserId)
            .maybeSingle(),
          supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", authenticatedUserId)
            .maybeSingle(),
          supabase.rpc("get_my_friends"),
          supabase
            .from("user_blocks")
            .select("blocked_id")
            .eq("blocker_id", authenticatedUserId),
        ]);

      if (!isActive) return;

      const displayName =
        profileResponse.data?.username ||
        user.user_metadata?.username ||
        user.email?.split("@")[0] ||
        "Bạn";
      const currentAvatar =
        profileResponse.data?.avatar_url ||
        user.user_metadata?.avatar_url ||
        "";
      const currentPublicId =
        profileResponse.data?.public_id ?? 0;
      const currentRole =
        (roleResponse.data?.role as MemberRole | undefined) ??
        "member";
      const friends = (friendsResponse.data ?? []) as Array<{
        id: string;
        username: string;
        avatar_url: string | null;
        public_id: number;
        role: MemberRole;
        last_seen_at: string | null;
      }>;
      const friendIdSet = new Set(
        friends.map((friend) => friend.id),
      );
      const blockedIdSet = new Set<string>(
        (blocksResponse.data ?? []).map(
          (row: { blocked_id: string }) =>
            row.blocked_id,
        ),
      );
      const initialCards: Record<string, MemberCard> = {
        [authenticatedUserId]: {
          id: authenticatedUserId,
          username: displayName,
          avatar_url: currentAvatar || null,
          public_id: currentPublicId,
          role: currentRole,
          last_seen_at:
            profileResponse.data?.last_seen_at ?? null,
        },
      };

      friends.forEach((friend) => {
        initialCards[friend.id] = friend;
      });

      memberCardsRef.current = initialCards;
      friendIdsRef.current = friendIdSet;
      setMemberCards(initialCards);
      setFriendIds(friendIdSet);
      setBlockedUserIds(blockedIdSet);
      setUserId(authenticatedUserId);
      setUsername(displayName);
      setAvatarUrl(currentAvatar);
      setPublicId(currentPublicId);
      setMemberRole(currentRole);

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

      const onlineChannel = supabase.channel(
        `home-data-${authenticatedUserId}`,
      );

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
          event: "UPDATE",
          schema: "public",
          table: "profiles",
        },
        (payload) => {
          if (!isActive) return;

          const updatedProfile = payload.new as {
            id: string;
            username: string;
            avatar_url: string | null;
            public_id: number;
            last_seen_at: string | null;
          };

          if (!memberCardsRef.current[updatedProfile.id]) {
            return;
          }

          setMemberCards((current) => {
            const existing = current[updatedProfile.id];
            if (!existing) return current;

            const next = {
              ...current,
              [updatedProfile.id]: {
                ...existing,
                username: updatedProfile.username,
                avatar_url: updatedProfile.avatar_url,
                public_id: updatedProfile.public_id,
                last_seen_at: updatedProfile.last_seen_at,
              },
            };

            memberCardsRef.current = next;
            return next;
          });
        },
      );

      onlineChannel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "direct_messages",
        },
        (payload) => {
          void refreshPrivateUnreadCount();

          if (payload.eventType !== "INSERT") return;

          const newMessage =
            payload.new as PrivateMessageNotificationRow;

          if (
            newMessage.receiver_id !== authenticatedUserId
          ) {
            return;
          }

          void notifyPrivateMessage({
            messageId: newMessage.id,
            senderId: newMessage.sender_id,
            senderName:
              memberCardsRef.current[newMessage.sender_id]
                ?.username ?? "một người bạn",
            content: newMessage.content,
          });
        },
      );

      onlineChannel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_blocks",
          filter: `blocker_id=eq.${authenticatedUserId}`,
        },
        (payload) => {
          if (!isActive) return;

          if (payload.eventType === "INSERT") {
            const blockedId = String(
              (payload.new as { blocked_id: string })
                .blocked_id,
            );

            setBlockedUserIds((current) => {
              const next = new Set(current);
              next.add(blockedId);
              return next;
            });
          }

          if (payload.eventType === "DELETE") {
            const blockedId = String(
              (
                payload.old as {
                  blocked_id?: string;
                }
              ).blocked_id ?? "",
            );

            if (!blockedId) return;

            setBlockedUserIds((current) => {
              const next = new Set(current);
              next.delete(blockedId);
              return next;
            });
          }
        },
      );

      onlineChannel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friendships",
          filter: `user_id=eq.${authenticatedUserId}`,
        },
        async () => {
          const { data } = await supabase.rpc("get_my_friends");
          if (!isActive) return;

          const nextFriends = (data ?? []) as Array<{
            id: string;
            username: string;
            avatar_url: string | null;
            public_id: number;
            role: MemberRole;
            last_seen_at: string | null;
          }>;
          const nextIds = new Set(
            nextFriends.map((friend) => friend.id),
          );
          const ownCard =
            memberCardsRef.current[authenticatedUserId];
          const nextCards: Record<string, MemberCard> = {};
          if (ownCard) nextCards[authenticatedUserId] = ownCard;
          nextFriends.forEach((friend) => {
            nextCards[friend.id] = friend;
          });
          friendIdsRef.current = nextIds;
          memberCardsRef.current = nextCards;
          setFriendIds(nextIds);
          setMemberCards(nextCards);
          setOnlineUsers((current) =>
            current.filter(
              (member) =>
                member.user_id === authenticatedUserId ||
                nextIds.has(member.user_id),
            ),
          );
        },
      );

      presenceChannelRef.current = onlineChannel;

      onlineChannel.subscribe();

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
          "id, user_id, username, content, channel, created_at, reply_to_id, attachment_url, attachment_name, attachment_type, attachment_size, edited_at",
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
        void loadMemberCards(
          loadedMessages.map((message) => message.user_id),
        );

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
              void loadMemberCards([newMessage.user_id]);

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
    setShowComposerEmojiPicker(false);
  }

  function validatePublicAttachment(
    file: File,
    mode: "image" | "document",
  ) {
    if (mode === "image") {
      if (!allowedPublicImageTypes.has(file.type)) {
        return "Chỉ hỗ trợ ảnh JPG, PNG, WEBP hoặc GIF.";
      }

      if (file.size > MAX_PUBLIC_IMAGE_SIZE) {
        return "Ảnh phải nhỏ hơn hoặc bằng 5 MB.";
      }

      return "";
    }

    if (!allowedPublicFileTypes.has(file.type)) {
      return "Chỉ hỗ trợ PDF, Word, Excel, PowerPoint, ZIP hoặc TXT.";
    }

    if (file.size > MAX_PUBLIC_FILE_SIZE) {
      return "Tệp phải nhỏ hơn hoặc bằng 20 MB.";
    }

    return "";
  }

  function setPublicAttachment(
    file: File,
    mode: "image" | "document",
  ) {
    const validationError =
      validatePublicAttachment(file, mode);

    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    if (attachmentPreview) {
      URL.revokeObjectURL(attachmentPreview);
    }

    setAttachmentFile(file);
    setAttachmentPreview(
      mode === "image"
        ? URL.createObjectURL(file)
        : "",
    );
    setShowComposerEmojiPicker(false);
    setErrorMessage("");
  }

  function chooseImageAttachment(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    if (isChatSuspended) {
      setErrorMessage(
        "Tài khoản của bạn đang bị khóa quyền chat.",
      );
      event.target.value = "";
      return;
    }

    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) return;

    setPublicAttachment(file, "image");
  }

  function chooseDocumentAttachment(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    if (isChatSuspended) {
      setErrorMessage(
        "Tài khoản của bạn đang bị khóa quyền chat.",
      );
      event.target.value = "";
      return;
    }

    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) return;

    setPublicAttachment(file, "document");
  }

  function clearAttachment() {
    if (attachmentPreview) {
      URL.revokeObjectURL(attachmentPreview);
    }

    setAttachmentFile(null);
    setAttachmentPreview("");

    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }

    if (documentInputRef.current) {
      documentInputRef.current.value = "";
    }
  }

  function insertComposerEmoji(emoji: string) {
    setMessageInput((current) => {
      const next = `${current}${emoji}`;
      announceTyping(next);
      return next;
    });

    setShowComposerEmojiPicker(false);
  }

  async function uploadChatAttachment(file: File) {
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
        uploadedUrl = await uploadChatAttachment(attachmentFile);
      }

      const { error } = await supabase.from("messages").insert({
        user_id: userId,
        username,
        content,
        channel: selectedChannel,
        reply_to_id: replyingTo?.id ?? null,
        attachment_url: uploadedUrl,
        attachment_name: attachmentFile?.name ?? null,
        attachment_type: attachmentFile?.type ?? null,
        attachment_size: attachmentFile?.size ?? null,
      });

      if (error) {
        throw new Error(error.message);
      }

      setMessageInput("");
      setReplyingTo(null);
      clearAttachment();
      setShowComposerEmojiPicker(false);
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

  async function sendFriendRequestFromMessage(
    targetUserId: string,
    targetUsername: string,
  ) {
    if (
      !userId ||
      targetUserId === userId ||
      friendIds.has(targetUserId) ||
      friendRequestSentIds.has(targetUserId) ||
      workingMemberId
    ) {
      return;
    }

    setWorkingMemberId(targetUserId);
    setErrorMessage("");

    const { error } = await supabase.rpc(
      "send_friend_request",
      {
        p_receiver_id: targetUserId,
      },
    );

    if (error) {
      setErrorMessage(
        `Không thể gửi lời mời kết bạn: ${error.message}`,
      );
    } else {
      setFriendRequestSentIds((current) => {
        const next = new Set(current);
        next.add(targetUserId);
        return next;
      });

      window.alert(
        `Đã gửi lời mời kết bạn tới ${targetUsername}.`,
      );
    }

    setOpenMessageMenuId(null);
    setWorkingMemberId(null);
  }

  async function toggleBlockPublicMember(
    targetUserId: string,
    targetUsername: string,
  ) {
    if (
      !userId ||
      targetUserId === userId ||
      workingMemberId
    ) {
      return;
    }

    const currentlyBlocked =
      blockedUserIds.has(targetUserId);

    if (
      !currentlyBlocked &&
      !window.confirm(
        `Chặn ${targetUsername}? Hai người sẽ bị hủy kết bạn và không thể nhắn tin riêng hoặc gọi điện cho nhau.`,
      )
    ) {
      return;
    }

    setWorkingMemberId(targetUserId);
    setErrorMessage("");

    if (currentlyBlocked) {
      const { error } = await supabase
        .from("user_blocks")
        .delete()
        .eq("blocker_id", userId)
        .eq("blocked_id", targetUserId);

      if (error) {
        setErrorMessage(
          `Không thể bỏ chặn: ${error.message}`,
        );
      } else {
        setBlockedUserIds((current) => {
          const next = new Set(current);
          next.delete(targetUserId);
          return next;
        });
      }
    } else {
      const { error } = await supabase
        .from("user_blocks")
        .insert({
          blocker_id: userId,
          blocked_id: targetUserId,
        });

      if (error) {
        setErrorMessage(
          `Không thể chặn thành viên: ${error.message}`,
        );
      } else {
        setBlockedUserIds((current) => {
          const next = new Set(current);
          next.add(targetUserId);
          return next;
        });

        setFriendIds((current) => {
          const next = new Set(current);
          next.delete(targetUserId);
          friendIdsRef.current = next;
          return next;
        });

        setOnlineUsers((current) =>
          current.filter(
            (member) =>
              member.user_id !== targetUserId,
          ),
        );
      }
    }

    setOpenMessageMenuId(null);
    setWorkingMemberId(null);
  }

  function openReportDialog(message: MessageRow) {
    setReportingMessage(message);
    setReportCategory("profanity");
    setReportDetails("");
    setOpenMessageMenuId(null);
  }

  async function submitMessageReport() {
    if (!reportingMessage || submittingReport) return;

    setSubmittingReport(true);
    setErrorMessage("");

    const { error } = await supabase.rpc(
      "report_public_message",
      {
        p_message_id: reportingMessage.id,
        p_category: reportCategory,
        p_details: reportDetails.trim() || null,
      },
    );

    if (error) {
      setErrorMessage(
        `Không thể gửi báo cáo: ${error.message}`,
      );
      setSubmittingReport(false);
      return;
    }

    setReportingMessage(null);
    setReportDetails("");
    setSubmittingReport(false);

    window.alert(
      "Đã gửi báo cáo. Quản trị viên sẽ kiểm tra nội dung này.",
    );
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
    <main
      className={`relative grid h-screen grid-cols-1 overflow-hidden bg-[#313338] text-white md:grid-cols-[72px_240px_minmax(0,1fr)] ${
        friendsSidebarCollapsed
          ? "lg:grid-cols-[72px_240px_minmax(0,1fr)_76px]"
          : "lg:grid-cols-[72px_240px_minmax(0,1fr)_340px]"
      }`}
    >
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
            <div className="flex min-w-0 items-center gap-2">
              <div className="truncate text-sm font-semibold">
                {username}
              </div>
              <MemberBadge role={memberRole} />
            </div>
            <div className="truncate text-xs text-gray-400">
              {formatPublicId(publicId)} · Cài đặt tài khoản
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
      <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        <header className="flex h-[57px] shrink-0 items-center gap-3 border-b border-black/20 px-3 shadow md:px-4">
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

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-5 [scrollbar-gutter:stable] md:px-5">
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
                    {memberCards[message.user_id]?.avatar_url ? (
                      <img
                        src={memberCards[message.user_id].avatar_url ?? ""}
                        alt={memberCards[message.user_id].username}
                        className="h-10 w-10 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-500 font-bold">
                        {(memberCards[message.user_id]?.username ??
                          message.username)
                          .charAt(0)
                          .toUpperCase()}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2">
                        <strong>
                          {memberCards[message.user_id]?.username ??
                            message.username}
                        </strong>
                        <MemberBadge
                          role={memberCards[message.user_id]?.role}
                        />

                        <span className="text-xs text-gray-400">
                          {formatTime(message.created_at)}
                        </span>

                        {message.edited_at && (
                          <span className="text-xs text-gray-500">
                            (đã sửa)
                          </span>
                        )}
                      </div>

                      <div className="mt-0.5 text-[11px] text-gray-500">
                        {formatPublicId(
                          memberCards[message.user_id]?.public_id,
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

                          {message.attachment_url &&
                          isPublicImageAttachment(
                            message.attachment_type,
                            message.attachment_name,
                          ) ? (
                            <a
                              href={message.attachment_url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 block max-w-xl"
                              title="Mở ảnh"
                            >
                              <img
                                src={message.attachment_url}
                                alt={
                                  message.attachment_name ??
                                  "Ảnh đính kèm"
                                }
                                className="max-h-80 max-w-full rounded-lg object-contain"
                                loading="lazy"
                              />
                            </a>
                          ) : message.attachment_url ? (
                            <a
                              href={message.attachment_url}
                              download={
                                message.attachment_name ??
                                undefined
                              }
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 flex max-w-xl items-center gap-3 rounded-xl border border-white/10 bg-black/15 p-3 transition hover:bg-black/25"
                              title="Tải tệp xuống"
                            >
                              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-2xl">
                                {publicAttachmentIcon(
                                  message.attachment_type,
                                  message.attachment_name,
                                )}
                              </span>

                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-semibold text-white">
                                  {message.attachment_name ??
                                    "Tệp đính kèm"}
                                </span>
                                <span className="mt-0.5 block text-xs text-gray-400">
                                  {formatPublicAttachmentSize(
                                    message.attachment_size,
                                  ) || "Tệp đính kèm"}
                                </span>
                              </span>

                              <span className="shrink-0 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-bold text-white">
                                Tải xuống
                              </span>
                            </a>
                          ) : null}
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
                      <div
                        className="absolute right-2 top-2 z-40"
                        data-public-message-menu
                      >
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpenMessageMenuId(
                              (current) =>
                                current === message.id
                                  ? null
                                  : message.id,
                            );
                          }}
                          aria-label="Tùy chọn tin nhắn"
                          aria-expanded={
                            openMessageMenuId === message.id
                          }
                          title="Tùy chọn"
                          className={`flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-[#2b2d31] pb-1 text-xl font-bold leading-none text-gray-300 shadow-lg transition hover:bg-[#1e1f22] hover:text-white ${
                            openMessageMenuId === message.id
                              ? "opacity-100"
                              : "opacity-100 md:opacity-0 md:group-hover:opacity-100"
                          }`}
                        >
                          …
                        </button>

                        {openMessageMenuId === message.id && (
                          <div className="absolute right-0 top-10 z-50 min-w-56 overflow-hidden rounded-xl border border-white/10 bg-[#1e1f22] py-1 shadow-2xl">
                            <button
                              type="button"
                              onClick={() => {
                                setReplyingTo(message);
                                setOpenMessageMenuId(null);
                              }}
                              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-white/10"
                            >
                              <span>↩️</span>
                              <span>Trả lời</span>
                            </button>

                            {isOwnMessage ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenMessageMenuId(null);
                                    beginEditing(message);
                                  }}
                                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-white/10"
                                >
                                  <span>✏️</span>
                                  <span>Sửa tin nhắn</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenMessageMenuId(null);
                                    void deleteMessage(message.id);
                                  }}
                                  disabled={isWorking}
                                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-red-300 hover:bg-red-500/15 disabled:opacity-50"
                                >
                                  <span>🗑️</span>
                                  <span>Xóa tin nhắn</span>
                                </button>
                              </>
                            ) : (
                              <>
                                {friendIds.has(message.user_id) ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenMessageMenuId(null);
                                      window.location.href = `/messages?user=${encodeURIComponent(
                                        message.user_id,
                                      )}`;
                                    }}
                                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-white/10"
                                  >
                                    <span>💬</span>
                                    <span>Nhắn tin riêng</span>
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void sendFriendRequestFromMessage(
                                        message.user_id,
                                        memberCards[message.user_id]
                                          ?.username ??
                                          message.username,
                                      )
                                    }
                                    disabled={
                                      workingMemberId ===
                                        message.user_id ||
                                      friendRequestSentIds.has(
                                        message.user_id,
                                      )
                                    }
                                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-white/10 disabled:opacity-50"
                                  >
                                    <span>➕</span>
                                    <span>
                                      {friendRequestSentIds.has(
                                        message.user_id,
                                      )
                                        ? "Đã gửi lời mời"
                                        : "Thêm bạn bè"}
                                    </span>
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() =>
                                    void toggleBlockPublicMember(
                                      message.user_id,
                                      memberCards[message.user_id]
                                        ?.username ??
                                        message.username,
                                    )
                                  }
                                  disabled={
                                    workingMemberId ===
                                    message.user_id
                                  }
                                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-orange-300 hover:bg-orange-500/15 disabled:opacity-50"
                                >
                                  <span>
                                    {blockedUserIds.has(
                                      message.user_id,
                                    )
                                      ? "🔓"
                                      : "🚫"}
                                  </span>
                                  <span>
                                    {blockedUserIds.has(
                                      message.user_id,
                                    )
                                      ? "Bỏ chặn"
                                      : "Chặn thành viên"}
                                  </span>
                                </button>

                                <div className="my-1 h-px bg-white/10" />

                                <button
                                  type="button"
                                  onClick={() =>
                                    openReportDialog(message)
                                  }
                                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-red-300 hover:bg-red-500/15"
                                >
                                  <span>🚩</span>
                                  <span>Báo cáo nội dung</span>
                                </button>
                              </>
                            )}
                          </div>
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

        <div className="shrink-0 px-3 pb-2 md:px-4">
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

          {attachmentFile && (
            <div className="mb-2 flex max-w-xl items-center gap-3 rounded-xl border border-white/10 bg-[#2b2d31] p-3">
              {attachmentPreview ? (
                <img
                  src={attachmentPreview}
                  alt="Ảnh sắp gửi"
                  className="h-20 w-20 rounded-xl object-cover"
                />
              ) : (
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/10 text-3xl">
                  {publicAttachmentIcon(
                    attachmentFile.type,
                    attachmentFile.name,
                  )}
                </span>
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {attachmentFile.name}
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  {formatPublicAttachmentSize(
                    attachmentFile.size,
                  )}
                </p>
              </div>

              <button
                type="button"
                onClick={clearAttachment}
                title="Bỏ tệp đã chọn"
                aria-label="Bỏ tệp đã chọn"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500/15 text-lg text-red-300 hover:bg-red-500/25"
              >
                ×
              </button>
            </div>
          )}

          <form onSubmit={sendMessage}>
            <div className="flex items-center rounded-lg bg-[#383a40] px-2 md:px-3">
              <input
                ref={documentInputRef}
                type="file"
                accept={PUBLIC_FILE_ACCEPT}
                onChange={chooseDocumentAttachment}
                className="hidden"
              />

              <input
                ref={imageInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={chooseImageAttachment}
                className="hidden"
              />

              <button
                type="button"
                onClick={() =>
                  documentInputRef.current?.click()
                }
                disabled={isChatSuspended || sending}
                aria-label="Gửi tệp"
                title={
                  isChatSuspended
                    ? "Tài khoản đang bị khóa chat"
                    : "Gửi PDF, Word, Excel, PowerPoint, ZIP hoặc TXT"
                }
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl text-gray-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                📎
              </button>

              <button
                type="button"
                onClick={() =>
                  imageInputRef.current?.click()
                }
                disabled={isChatSuspended || sending}
                aria-label="Gửi ảnh"
                title={
                  isChatSuspended
                    ? "Tài khoản đang bị khóa chat"
                    : "Gửi ảnh"
                }
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl text-gray-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                🖼️
              </button>

              <div className="relative flex shrink-0 items-center">
                <button
                  type="button"
                  onClick={() =>
                    setShowComposerEmojiPicker(
                      (current) => !current,
                    )
                  }
                  disabled={isChatSuspended}
                  aria-label="Chọn biểu tượng cảm xúc"
                  aria-expanded={showComposerEmojiPicker}
                  title="Biểu tượng cảm xúc"
                  className="flex h-10 w-10 items-center justify-center rounded-full text-xl text-gray-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  😊
                </button>

                {showComposerEmojiPicker && (
                  <div className="absolute bottom-12 left-0 z-50 w-72 rounded-2xl border border-white/10 bg-[#1e1f22] p-3 shadow-2xl">
                    <div className="mb-2 flex items-center justify-between">
                      <strong className="text-sm">
                        Biểu tượng cảm xúc
                      </strong>
                      <button
                        type="button"
                        onClick={() =>
                          setShowComposerEmojiPicker(false)
                        }
                        aria-label="Đóng bảng cảm xúc"
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-lg text-gray-300 hover:bg-white/15 hover:text-white"
                      >
                        ×
                      </button>
                    </div>

                    <div className="grid grid-cols-8 gap-1">
                      {composerEmojiChoices.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() =>
                            insertComposerEmoji(emoji)
                          }
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-xl hover:bg-white/10"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

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
                  isChatSuspended ||
                  (!messageInput.trim() &&
                    !attachmentFile)
                }
                className="ml-3 rounded bg-indigo-500 px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
              >
                {sending ? "Đang gửi..." : "Gửi"}
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* Bạn bè */}
      <aside
        className={`fixed inset-y-0 right-0 z-40 overflow-y-auto bg-[#2b2d31] transition-all duration-200 lg:static lg:translate-x-0 ${
          friendsSidebarCollapsed
            ? "w-[76px] px-2 py-3"
            : "w-[320px] p-4 lg:w-auto"
        } ${
          showMembers ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div
          className={`mb-3 flex items-center ${
            friendsSidebarCollapsed
              ? "flex-col gap-2"
              : "justify-between"
          }`}
        >
          {!friendsSidebarCollapsed && (
            <h2 className="text-xs font-bold uppercase text-gray-400">
              Bạn bè — {onlineUsers.length} online
            </h2>
          )}

          <div
            className={`flex items-center ${
              friendsSidebarCollapsed
                ? "flex-col gap-2"
                : "gap-2"
            }`}
          >
            <button
              type="button"
              onClick={toggleFriendsSidebar}
              title={
                friendsSidebarCollapsed
                  ? "Mở rộng danh sách bạn bè"
                  : "Thu gọn danh sách bạn bè"
              }
              aria-label={
                friendsSidebarCollapsed
                  ? "Mở rộng danh sách bạn bè"
                  : "Thu gọn danh sách bạn bè"
              }
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-lg text-gray-300 transition hover:bg-white/15 hover:text-white"
            >
              {friendsSidebarCollapsed ? "»" : "«"}
            </button>

            <button
              type="button"
              onClick={() => setShowMembers(false)}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-gray-400 lg:hidden"
              aria-label="Đóng danh sách bạn bè"
            >
              ✕
            </button>
          </div>
        </div>

        {friendsSidebarCollapsed ? (
          <>
            <div className="mb-4 flex justify-center">
              <FriendManager
                triggerVariant="compact-add"
                initialTab="add"
              />
            </div>

            <div className="space-y-2">
              {sidebarMembers.map((member) => {
                const isOnline = onlineUserIds.has(member.id);
                const statusText = isOnline
                  ? "Online"
                  : `Offline (${formatLastActive(
                      member.last_seen_at,
                      clock,
                    )})`;

                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => {
                      window.location.href =
                        member.id === userId
                          ? "/settings"
                          : `/messages?user=${encodeURIComponent(
                              member.id,
                            )}`;
                    }}
                    title={`${member.username} · ${statusText}`}
                    aria-label={`${member.username} · ${statusText}`}
                    className={`flex w-full justify-center rounded-xl p-1.5 transition hover:bg-white/10 ${
                      isOnline
                        ? "opacity-100"
                        : "opacity-60"
                    }`}
                  >
                    <div className="relative shrink-0">
                      {member.avatar_url ? (
                        <img
                          src={member.avatar_url}
                          alt={member.username}
                          className={`h-11 w-11 rounded-full object-cover ${
                            isOnline ? "" : "grayscale"
                          }`}
                        />
                      ) : (
                        <div
                          className={`flex h-11 w-11 items-center justify-center rounded-full bg-indigo-500 font-bold ${
                            isOnline ? "" : "grayscale"
                          }`}
                        >
                          {member.username
                            .charAt(0)
                            .toUpperCase()}
                        </div>
                      )}

                      <span
                        className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-[#2b2d31] ${
                          isOnline
                            ? "bg-green-500"
                            : "bg-gray-600"
                        }`}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="mb-4 rounded-2xl border border-white/10 bg-black/10 p-3">
              <FriendManager
                triggerVariant="sidebar"
                initialTab="add"
              />
              <p className="mt-2 px-1 text-center text-[11px] text-gray-500">
                Tìm bằng Gmail, tên hoặc ID #000000
              </p>
            </div>

            {sidebarMembers.map((member) => {
              const isOnline = onlineUserIds.has(member.id);

              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => {
                    window.location.href =
                      member.id === userId
                        ? "/settings"
                        : `/messages?user=${encodeURIComponent(
                            member.id,
                          )}`;
                  }}
                  className={`mb-1 flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition hover:bg-white/5 ${
                    isOnline
                      ? "text-gray-200"
                      : "text-gray-500 opacity-60"
                  }`}
                >
                  <div className="relative shrink-0">
                    {member.avatar_url ? (
                      <img
                        src={member.avatar_url}
                        alt={member.username}
                        className={`h-10 w-10 rounded-full object-cover ${
                          isOnline ? "" : "grayscale"
                        }`}
                      />
                    ) : (
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500 font-bold ${
                          isOnline ? "" : "grayscale"
                        }`}
                      >
                        {member.username
                          .charAt(0)
                          .toUpperCase()}
                      </div>
                    )}

                    <span
                      className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-[#2b2d31] ${
                        isOnline
                          ? "bg-green-500"
                          : "bg-gray-600"
                      }`}
                    />
                  </div>

                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-medium">
                        {member.username}
                      </span>
                      <span className="shrink-0 text-[10px] text-gray-500">
                        {formatPublicId(member.public_id)}
                      </span>
                      <MemberBadge role={member.role} />
                    </span>

                    <span
                      className={`mt-0.5 block truncate text-[11px] ${
                        isOnline
                          ? "text-green-400"
                          : "text-gray-500"
                      }`}
                    >
                      {isOnline
                        ? "Online"
                        : `Offline (${formatLastActive(
                            member.last_seen_at,
                            clock,
                          )})`}
                    </span>
                  </span>

                  <span className="shrink-0 text-[11px] text-gray-500">
                    {member.id === userId
                      ? "Bạn"
                      : "Nhắn tin"}
                  </span>
                </button>
              );
            })}
          </>
        )}
      </aside>

      {reportingMessage && (
        <div
          className="fixed inset-0 z-[180] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Báo cáo tin nhắn"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setReportingMessage(null);
            }
          }}
        >
          <section className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/10 bg-[#24262b] text-white shadow-2xl">
            <header className="flex items-start justify-between border-b border-white/10 p-5">
              <div>
                <h2 className="text-xl font-bold">
                  Báo cáo tin nhắn
                </h2>
                <p className="mt-1 text-sm text-gray-400">
                  Chọn lý do chính xác để quản trị viên xử lý nhanh hơn.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setReportingMessage(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xl hover:bg-white/15"
                aria-label="Đóng"
              >
                ×
              </button>
            </header>

            <div className="space-y-4 p-5">
              <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                <div className="flex items-center gap-2 text-sm">
                  <strong>
                    {memberCards[reportingMessage.user_id]
                      ?.username ?? reportingMessage.username}
                  </strong>
                  <MemberBadge
                    role={
                      memberCards[reportingMessage.user_id]
                        ?.role
                    }
                  />
                </div>

                <p className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-sm text-gray-300">
                  {reportingMessage.content ||
                    "[Tin nhắn chỉ có tệp đính kèm]"}
                </p>
              </div>

              <div className="space-y-2">
                {reportCategoryOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() =>
                      setReportCategory(option.id)
                    }
                    className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${
                      reportCategory === option.id
                        ? "border-red-400/50 bg-red-500/15"
                        : "border-white/10 bg-black/10 hover:bg-white/5"
                    }`}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-lg">
                      {option.icon}
                    </span>

                    <span className="min-w-0 flex-1">
                      <strong className="block text-sm">
                        {option.label}
                      </strong>
                      <span className="mt-0.5 block text-xs text-gray-400">
                        {option.description}
                      </span>
                    </span>

                    <span
                      className={`h-4 w-4 rounded-full border ${
                        reportCategory === option.id
                          ? "border-white bg-white"
                          : "border-gray-500"
                      }`}
                    />
                  </button>
                ))}
              </div>

              <div>
                <label
                  htmlFor="report-details"
                  className="mb-2 block text-sm font-bold"
                >
                  Mô tả thêm{" "}
                  <span className="font-normal text-gray-500">
                    (không bắt buộc)
                  </span>
                </label>
                <textarea
                  id="report-details"
                  value={reportDetails}
                  onChange={(event) =>
                    setReportDetails(event.target.value)
                  }
                  maxLength={500}
                  rows={3}
                  placeholder="Ví dụ: Tin nhắn có đường link đáng ngờ..."
                  className="w-full resize-none rounded-xl bg-[#1e1f22] px-4 py-3 outline-none ring-red-500 focus:ring-2"
                />
                <p className="mt-1 text-right text-xs text-gray-500">
                  {reportDetails.length}/500
                </p>
              </div>
            </div>

            <footer className="flex gap-3 border-t border-white/10 p-5">
              <button
                type="button"
                onClick={() => setReportingMessage(null)}
                className="flex-1 rounded-xl bg-white/10 px-4 py-3 font-bold hover:bg-white/15"
              >
                Hủy
              </button>

              <button
                type="button"
                onClick={() =>
                  void submitMessageReport()
                }
                disabled={submittingReport}
                className="flex-1 rounded-xl bg-red-600 px-4 py-3 font-bold hover:bg-red-500 disabled:opacity-50"
              >
                {submittingReport
                  ? "Đang gửi..."
                  : "Gửi báo cáo"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
