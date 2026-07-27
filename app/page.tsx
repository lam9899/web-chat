"use client";

import {
  ChangeEvent,
  FormEvent,
  useCallback,
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
import ChannelRail from "./channel-rail";
import ChannelVoiceRoom, {
  type VoiceParticipantSnapshot,
} from "./channel-voice-room";

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
  databaseId: string | null;
  id: string;
  label: string;
  description: string;
  visibility: "public" | "private";
  channelType: "text" | "voice" | "both";
  isLocked: boolean;
  isSystem: boolean;
  canManage: boolean;
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
    databaseId: null,
    id: "chung",
    label: "chung",
    description: "Kênh trò chuyện chung của cộng đồng",
    visibility: "public",
    channelType: "text",
    isLocked: false,
    isSystem: true,
    canManage: false,
  },
  {
    databaseId: null,
    id: "gioi-thieu",
    label: "giới-thiệu",
    description: "Giới thiệu bản thân và làm quen với mọi người",
    visibility: "public",
    channelType: "text",
    isLocked: false,
    isSystem: true,
    canManage: false,
  },
  {
    databaseId: null,
    id: "gop-y",
    label: "góp-ý",
    description: "Đóng góp ý kiến để cộng đồng tốt hơn",
    visibility: "public",
    channelType: "text",
    isLocked: false,
    isSystem: true,
    canManage: false,
  },
  {
    databaseId: null,
    id: "tro-chuyen",
    label: "trò-chuyện",
    description: "Trò chuyện tự do cùng các thành viên",
    visibility: "public",
    channelType: "text",
    isLocked: false,
    isSystem: true,
    canManage: false,
  },
];

function isProtectedMainChannel(channel: ChannelItem) {
  return channel.isSystem && channel.id === "chung";
}

const MAIN_VOICE_TAB_ID = "__main_voice_room__";

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
const MAX_VOICE_MESSAGE_SIZE = 10 * 1024 * 1024;
const MAX_VOICE_DURATION_SECONDS = 5 * 60;

const voiceMimeCandidates = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
];

function supportedVoiceMimeType() {
  if (
    typeof MediaRecorder === "undefined" ||
    typeof MediaRecorder.isTypeSupported !== "function"
  ) {
    return "";
  }

  return (
    voiceMimeCandidates.find((mimeType) =>
      MediaRecorder.isTypeSupported(mimeType),
    ) ?? ""
  );
}

function normalizeVoiceMimeType(mimeType: string) {
  return mimeType.split(";")[0] || "audio/webm";
}

function voiceFileExtension(mimeType: string) {
  const normalized = normalizeVoiceMimeType(mimeType);

  if (normalized === "audio/ogg") return "ogg";
  if (normalized === "audio/mp4") return "m4a";
  if (normalized === "audio/mpeg") return "mp3";
  if (normalized === "audio/wav") return "wav";

  return "webm";
}

function isVoiceAttachment(
  attachmentType: string | null | undefined,
) {
  return Boolean(attachmentType?.startsWith("audio/"));
}

function formatVoiceDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(
    remainingSeconds,
  ).padStart(2, "0")}`;
}

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
    isVoiceAttachment(attachmentType) ||
    name.endsWith(".webm") ||
    name.endsWith(".ogg") ||
    name.endsWith(".m4a") ||
    name.endsWith(".mp3") ||
    name.endsWith(".wav")
  ) {
    return "🎤";
  }

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
  const [openChannelMenuId, setOpenChannelMenuId] =
    useState<string | null>(null);
  const [editingChannel, setEditingChannel] =
    useState<ChannelItem | null>(null);
  const [deletingChannel, setDeletingChannel] =
    useState<ChannelItem | null>(null);
  const [managedChannelName, setManagedChannelName] =
    useState("");
  const [managedChannelDescription, setManagedChannelDescription] =
    useState("");
  const [channelManagementError, setChannelManagementError] =
    useState("");
  const [channelManagementWorking, setChannelManagementWorking] =
    useState(false);

  const [selectedChannel, setSelectedChannel] = useState("chung");
  const [openMainTabIds, setOpenMainTabIds] = useState<string[]>(
    ["chung"],
  );
  const [globalVoiceSelected, setGlobalVoiceSelected] =
    useState(false);
  const [globalVoiceJoinRequestId, setGlobalVoiceJoinRequestId] =
    useState(0);
  const [globalVoiceActive, setGlobalVoiceActive] =
    useState(false);
  const [globalVoiceParticipants, setGlobalVoiceParticipants] =
    useState<VoiceParticipantSnapshot[]>([]);
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
  const [
    showComposerAttachMenu,
    setShowComposerAttachMenu,
  ] = useState(false);
  const [isVoiceRecording, setIsVoiceRecording] =
    useState(false);
  const [voiceRecordingSeconds, setVoiceRecordingSeconds] =
    useState(0);
  const [voicePreviewUrl, setVoicePreviewUrl] =
    useState("");
  const [voicePreviewDuration, setVoicePreviewDuration] =
    useState(0);

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
  const mediaRecorderRef = useRef<MediaRecorder | null>(
    null,
  );
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceStartedAtRef = useRef(0);
  const discardVoiceRecordingRef = useRef(false);
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
    const timer = window.setTimeout(() => {
      setFriendsSidebarCollapsed(savedState === "1");
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    return () => {
      if (voiceTimerRef.current) {
        clearInterval(voiceTimerRef.current);
      }

      voiceStreamRef.current
        ?.getTracks()
        .forEach((track) => track.stop());

      if (voicePreviewUrl) {
        URL.revokeObjectURL(voicePreviewUrl);
      }
    };
  }, [voicePreviewUrl]);

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
      channels.find(
        (channel) => channel.id === selectedChannel,
      ) ?? null,
    [channels, selectedChannel],
  );

  const openMainTabs = useMemo(
    () =>
      openMainTabIds.flatMap((tabId) => {
        if (tabId === MAIN_VOICE_TAB_ID) {
          return [
            {
              id: MAIN_VOICE_TAB_ID,
              label: "Phòng trò chuyện",
              description:
                "Kênh thoại chung của Talk Cùng Lâm DZ",
              isVoice: true,
            },
          ];
        }

        const channel = channels.find(
          (item) => item.id === tabId,
        );
        return channel
          ? [
              {
                id: channel.id,
                label: channel.label,
                description: channel.description,
                isVoice: false,
              },
            ]
          : [];
      }),
    [channels, openMainTabIds],
  );

  const activeMainTabId =
    globalVoiceSelected &&
    openMainTabIds.includes(MAIN_VOICE_TAB_ID)
      ? MAIN_VOICE_TAB_ID
      : openMainTabIds.includes(selectedChannel)
        ? selectedChannel
        : null;

  const handleGlobalVoiceParticipants = useCallback(
    (
      channelId: string,
      participants: VoiceParticipantSnapshot[],
    ) => {
      if (channelId === "global") {
        setGlobalVoiceParticipants(participants);
      }
    },
    [],
  );

  useEffect(() => {
    if (!userId) return;

    let active = true;

    async function loadGlobalVoiceParticipants() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) return;

      try {
        const response = await fetch(
          "/api/channel-voice-participants",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              channel_ids: ["global"],
            }),
          },
        );

        if (!response.ok || !active) return;

        const result = (await response.json()) as {
          channels?: Record<
            string,
            VoiceParticipantSnapshot[]
          >;
        };

        setGlobalVoiceParticipants(
          result.channels?.global ?? [],
        );
      } catch {
        // LiveKit tạm mất kết nối: giữ danh sách hiện tại và thử lại.
      }
    }

    const initialTimer = window.setTimeout(
      () => void loadGlobalVoiceParticipants(),
      0,
    );
    const timer = window.setInterval(
      () => void loadGlobalVoiceParticipants(),
      8_000,
    );

    return () => {
      active = false;
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [userId]);

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


  const loadGlobalChannels = useCallback(async () => {
    const { data, error } = await supabase.rpc(
      "get_visible_channels",
    );

    if (error) {
      setErrorMessage(
        `Không thể tải danh sách kênh: ${error.message}`,
      );
      return;
    }

    const loadedChannels: ChannelItem[] = (
      (data ?? []) as Array<{
        id: string;
        slug: string;
        name: string;
        description: string | null;
        visibility: "public" | "private";
        channel_type: "text" | "voice" | "both";
        is_locked: boolean;
        is_system: boolean;
        can_manage: boolean;
        server_id: string | null;
      }>
    )
      .filter(
        (channel) =>
          channel.server_id === null &&
          channel.channel_type !== "voice",
      )
      .map((channel) => ({
        databaseId: channel.id,
        id: channel.slug,
        label: channel.name,
        description: channel.description ?? "",
        visibility: channel.visibility,
        channelType: channel.channel_type,
        isLocked: channel.is_locked,
        isSystem: channel.is_system,
        canManage: channel.can_manage,
      }));

    if (loadedChannels.length > 0) {
      setChannels(loadedChannels);
      setOpenMainTabIds((current) =>
        current.filter(
          (tabId) =>
            tabId === MAIN_VOICE_TAB_ID ||
            loadedChannels.some(
              (channel) => channel.id === tabId,
            ),
        ),
      );
    }
  }, []);

  // Tải đúng các kênh thuộc khu vực chính và đồng bộ theo thời gian thực.
  useEffect(() => {
    if (!userId) return;

    const initialTimer = window.setTimeout(
      () => void loadGlobalChannels(),
      0,
    );

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
          void loadGlobalChannels();
        },
      )
      .subscribe();

    return () => {
      window.clearTimeout(initialTimer);
      void supabase.removeChannel(channelListSubscription);
    };
  }, [loadGlobalChannels, userId]);

  useEffect(() => {
    if (
      channels.length > 0 &&
      !channels.some(
        (channel) => channel.id === selectedChannel,
      )
    ) {
      const timer = window.setTimeout(() => {
        const fallbackChannelId = channels[0].id;
        setSelectedChannel(fallbackChannelId);
        setOpenMainTabIds((current) =>
          current.includes(fallbackChannelId)
            ? current
            : [...current, fallbackChannelId],
        );
      }, 0);

      return () => window.clearTimeout(timer);
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
    setOpenMainTabIds((current) =>
      current.includes(channelId)
        ? current
        : [...current, channelId],
    );
    setSelectedChannel(channelId);
    setGlobalVoiceSelected(false);
    setShowChannels(false);
    setShowComposerEmojiPicker(false);
    setOpenChannelMenuId(null);
  }

  function selectMainVoiceChannel() {
    setOpenMainTabIds((current) =>
      current.includes(MAIN_VOICE_TAB_ID)
        ? current
        : [...current, MAIN_VOICE_TAB_ID],
    );
    setGlobalVoiceSelected(true);
    setGlobalVoiceActive(true);
    setGlobalVoiceJoinRequestId((current) => current + 1);
    setShowChannels(false);
  }

  function activateMainTab(tabId: string) {
    if (tabId === MAIN_VOICE_TAB_ID) {
      setGlobalVoiceSelected(true);
      if (!globalVoiceActive) {
        setGlobalVoiceActive(true);
        setGlobalVoiceJoinRequestId(
          (current) => current + 1,
        );
      }
      return;
    }

    selectChannel(tabId);
  }

  function closeMainTab(tabId: string) {
    const closedIndex = openMainTabIds.indexOf(tabId);
    if (closedIndex < 0) return;

    const nextOpenTabIds = openMainTabIds.filter(
      (openTabId) => openTabId !== tabId,
    );
    setOpenMainTabIds(nextOpenTabIds);

    if (activeMainTabId !== tabId) return;

    const nextTabId =
      nextOpenTabIds[
        Math.min(closedIndex, nextOpenTabIds.length - 1)
      ] ?? null;

    if (nextTabId === MAIN_VOICE_TAB_ID) {
      setGlobalVoiceSelected(true);
      if (!globalVoiceActive) {
        setGlobalVoiceActive(true);
        setGlobalVoiceJoinRequestId(
          (current) => current + 1,
        );
      }
    } else {
      setGlobalVoiceSelected(false);
      if (nextTabId) setSelectedChannel(nextTabId);
    }
  }

  function openEditChannel(channel: ChannelItem) {
    if (!channel.canManage || !channel.databaseId) return;

    setEditingChannel(channel);
    setManagedChannelName(channel.label);
    setManagedChannelDescription(channel.description);
    setChannelManagementError("");
    setOpenChannelMenuId(null);
  }

  async function saveChannelChanges() {
    if (
      !editingChannel?.databaseId ||
      channelManagementWorking
    ) {
      return;
    }

    const nextName = managedChannelName.trim();
    if (nextName.length < 2 || nextName.length > 40) {
      setChannelManagementError(
        "Tên kênh phải có từ 2 đến 40 ký tự.",
      );
      return;
    }

    setChannelManagementWorking(true);
    setChannelManagementError("");

    const { error } = await supabase.rpc("update_channel", {
      p_channel_id: editingChannel.databaseId,
      p_name: nextName,
      p_description: managedChannelDescription.trim(),
      p_channel_type: editingChannel.channelType,
      p_visibility: editingChannel.visibility,
      p_is_locked: editingChannel.isLocked,
    });

    if (error) {
      setChannelManagementError(error.message);
      setChannelManagementWorking(false);
      return;
    }

    setChannels((current) =>
      current.map((channel) =>
        channel.databaseId === editingChannel.databaseId
          ? {
              ...channel,
              label: nextName,
              description: managedChannelDescription.trim(),
            }
          : channel,
      ),
    );
    setEditingChannel(null);
    setChannelManagementWorking(false);
  }

  async function deleteManagedChannel() {
    if (
      !deletingChannel?.databaseId ||
      isProtectedMainChannel(deletingChannel) ||
      channelManagementWorking
    ) {
      return;
    }

    setChannelManagementWorking(true);
    setChannelManagementError("");

    const { error } = await supabase.rpc("delete_channel", {
      p_channel_id: deletingChannel.databaseId,
    });

    if (error) {
      setChannelManagementError(error.message);
      setChannelManagementWorking(false);
      return;
    }

    closeMainTab(deletingChannel.id);
    setChannels((current) =>
      current.filter(
        (channel) =>
          channel.databaseId !== deletingChannel.databaseId,
      ),
    );

    setDeletingChannel(null);
    setChannelManagementWorking(false);
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

    if (isVoiceRecording) {
      cancelVoiceRecording();
    }

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

    if (isVoiceRecording) {
      cancelVoiceRecording();
    }

    setPublicAttachment(file, "document");
  }

  function stopVoiceStream() {
    voiceStreamRef.current
      ?.getTracks()
      .forEach((track) => track.stop());
    voiceStreamRef.current = null;
  }

  function clearVoiceTimer() {
    if (voiceTimerRef.current) {
      clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
  }

  function clearAttachment() {
    if (attachmentPreview) {
      URL.revokeObjectURL(attachmentPreview);
    }

    if (voicePreviewUrl) {
      URL.revokeObjectURL(voicePreviewUrl);
    }

    setAttachmentFile(null);
    setAttachmentPreview("");
    setVoicePreviewUrl("");
    setVoicePreviewDuration(0);

    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }

    if (documentInputRef.current) {
      documentInputRef.current.value = "";
    }
  }

  function stopVoiceRecording() {
    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }

  function cancelVoiceRecording() {
    discardVoiceRecordingRef.current = true;

    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }

    clearVoiceTimer();
    stopVoiceStream();
    setIsVoiceRecording(false);
    setVoiceRecordingSeconds(0);
  }

  async function startVoiceRecording() {
    if (
      isVoiceRecording ||
      sending ||
      isChatSuspended
    ) {
      return;
    }

    if (
      typeof MediaRecorder === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setErrorMessage(
        "Trình duyệt này chưa hỗ trợ ghi âm. Hãy dùng Chrome, Edge hoặc Safari mới.",
      );
      return;
    }

    try {
      clearAttachment();
      setShowComposerAttachMenu(false);
      setShowComposerEmojiPicker(false);
      setErrorMessage("");

      const stream =
        await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

      voiceStreamRef.current = stream;
      voiceChunksRef.current = [];
      discardVoiceRecordingRef.current = false;
      voiceStartedAtRef.current = Date.now();

      const preferredMimeType =
        supportedVoiceMimeType();
      const recorder = preferredMimeType
        ? new MediaRecorder(stream, {
            mimeType: preferredMimeType,
            audioBitsPerSecond: 64000,
          })
        : new MediaRecorder(stream, {
            audioBitsPerSecond: 64000,
          });

      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          voiceChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setErrorMessage(
          "Không thể tiếp tục ghi âm. Hãy kiểm tra quyền microphone.",
        );
      };

      recorder.onstop = () => {
        clearVoiceTimer();
        stopVoiceStream();
        setIsVoiceRecording(false);

        const duration = Math.max(
          1,
          Math.min(
            MAX_VOICE_DURATION_SECONDS,
            Math.round(
              (Date.now() -
                voiceStartedAtRef.current) /
                1000,
            ),
          ),
        );

        setVoiceRecordingSeconds(0);

        if (discardVoiceRecordingRef.current) {
          discardVoiceRecordingRef.current = false;
          voiceChunksRef.current = [];
          return;
        }

        const recorderMimeType =
          normalizeVoiceMimeType(
            recorder.mimeType ||
              voiceChunksRef.current[0]?.type ||
              "audio/webm",
          );

        const blob = new Blob(
          voiceChunksRef.current,
          {
            type: recorderMimeType,
          },
        );

        voiceChunksRef.current = [];

        if (!blob.size) {
          setErrorMessage(
            "Không thu được âm thanh. Hãy thử lại và kiểm tra microphone.",
          );
          return;
        }

        if (blob.size > MAX_VOICE_MESSAGE_SIZE) {
          setErrorMessage(
            "Tin nhắn thoại vượt quá giới hạn 10 MB.",
          );
          return;
        }

        const extension =
          voiceFileExtension(recorderMimeType);
        const file = new File(
          [blob],
          `voice-${Date.now()}.${extension}`,
          {
            type: recorderMimeType,
          },
        );

        const previewUrl =
          URL.createObjectURL(blob);

        setAttachmentFile(file);
        setAttachmentPreview("");
        setVoicePreviewUrl(previewUrl);
        setVoicePreviewDuration(duration);
      };

      recorder.start(1000);
      setIsVoiceRecording(true);
      setVoiceRecordingSeconds(0);

      voiceTimerRef.current = setInterval(() => {
        const elapsed = Math.floor(
          (Date.now() -
            voiceStartedAtRef.current) /
            1000,
        );

        setVoiceRecordingSeconds(
          Math.min(
            elapsed,
            MAX_VOICE_DURATION_SECONDS,
          ),
        );

        if (
          elapsed >= MAX_VOICE_DURATION_SECONDS &&
          recorder.state !== "inactive"
        ) {
          recorder.stop();
        }
      }, 250);
    } catch (error) {
      stopVoiceStream();
      clearVoiceTimer();
      setIsVoiceRecording(false);

      const message =
        error instanceof Error
          ? error.message
          : "Không thể truy cập microphone.";

      setErrorMessage(
        `Không thể ghi âm: ${message}`,
      );
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
      {/* Kênh động ngoài cùng bên trái */}
      <ChannelRail />

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
          </div>

          <nav className="space-y-1">
            {channels.map((channel) => {
              const isSelected = channel.id === selectedChannel;
              const unread = unreadCounts[channel.id] ?? 0;

              return (
                <div
                  key={channel.id}
                  className={`relative flex w-full items-center rounded ${
                    isSelected
                      ? "bg-white/10 text-white"
                      : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => selectChannel(channel.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
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

                  {channel.canManage && (
                    <button
                      type="button"
                      onClick={() =>
                        setOpenChannelMenuId((current) =>
                          current === channel.id
                            ? null
                            : channel.id,
                        )
                      }
                      aria-label={`Quản lý kênh ${channel.label}`}
                      title="Sửa hoặc xóa kênh"
                      className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded text-lg font-black text-gray-400 hover:bg-white/10 hover:text-white"
                    >
                      ⋮
                    </button>
                  )}

                  {openChannelMenuId === channel.id && (
                    <div className="absolute right-1 top-9 z-30 w-40 rounded-xl border border-white/10 bg-[#111214] p-1.5 text-sm text-white shadow-2xl">
                      <button
                        type="button"
                        onClick={() => openEditChannel(channel)}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-indigo-500"
                      >
                        ✏️ Sửa kênh
                      </button>

                      {isProtectedMainChannel(channel) ? (
                        <p className="px-3 py-2 text-xs text-gray-500">
                          #chung mặc định không thể xóa
                        </p>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setDeletingChannel(channel);
                            setChannelManagementError("");
                            setOpenChannelMenuId(null);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-red-300 hover:bg-red-500 hover:text-white"
                        >
                          🗑️ Xóa kênh
                        </button>
                      )}
                    </div>
                  )}
                </div>
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

          <button
            type="button"
            onClick={selectMainVoiceChannel}
            className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left ${
              globalVoiceSelected
                ? "bg-white/10 text-white"
                : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
            }`}
          >
            <span>🔊</span>
            <span className="min-w-0 flex-1 truncate">
              Phòng trò chuyện
            </span>
            {globalVoiceParticipants.length > 0 && (
              <span className="rounded-full bg-green-500/15 px-1.5 py-0.5 text-[10px] font-black text-green-300">
                {globalVoiceParticipants.length}
              </span>
            )}
          </button>

          {globalVoiceParticipants.length > 0 && (
            <div className="ml-5">
              {globalVoiceParticipants.map(
                (participant, index) => (
                  <div
                    key={participant.user_id}
                    className="relative ml-3 flex min-h-10 items-center gap-2 py-1 text-gray-300"
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute -left-3 top-0 w-2.5 border-l border-gray-600 ${
                        index ===
                        globalVoiceParticipants.length - 1
                          ? "h-5 rounded-bl-md border-b"
                          : "h-full"
                      }`}
                    />

                    <span className="relative shrink-0">
                      {participant.avatar_url ? (
                        <img
                          src={participant.avatar_url}
                          alt={participant.username}
                          className={`h-7 w-7 rounded-full object-cover transition ${
                            participant.is_speaking
                              ? "ring-2 ring-green-400 ring-offset-1 ring-offset-[#2b2d31]"
                              : "ring-1 ring-white/10"
                          }`}
                        />
                      ) : (
                        <span
                          className={`flex h-7 w-7 items-center justify-center rounded-full bg-indigo-500 text-[11px] font-black ${
                            participant.is_speaking
                              ? "ring-2 ring-green-400 ring-offset-1 ring-offset-[#2b2d31]"
                              : "ring-1 ring-white/10"
                          }`}
                        >
                          {participant.username
                            .charAt(0)
                            .toUpperCase()}
                        </span>
                      )}
                    </span>

                    <span
                      className={`min-w-0 flex-1 truncate text-xs font-semibold ${
                        participant.is_speaking
                          ? "text-green-300"
                          : "text-gray-300"
                      }`}
                    >
                      {participant.username}
                    </span>

                    {participant.is_muted && (
                      <span
                        title="Đã tắt micro"
                        className="text-[10px] text-red-300"
                      >
                        🔇
                      </span>
                    )}
                  </div>
                ),
              )}
            </div>
          )}
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
              <MemberBadge role={memberRole} />
              <div className="truncate text-sm font-semibold">
                {username}
              </div>
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
        <header className="flex h-[58px] shrink-0 items-end gap-2 border-b border-black/30 bg-[#202225] px-2 pt-2 shadow">
          <button
            type="button"
            onClick={() => setShowChannels(true)}
            className="mb-1.5 rounded p-2 text-xl text-gray-300 md:hidden"
            aria-label="Mở danh sách kênh"
          >
            ☰
          </button>

          <div
            role="tablist"
            aria-label="Các kênh chính đang mở"
            className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto [scrollbar-width:thin]"
          >
            {openMainTabs.length === 0 && (
              <span className="mb-3 px-3 text-sm text-gray-500">
                Bấm một kênh bên trái để mở tab
              </span>
            )}

            {openMainTabs.map((tab) => {
              const active = activeMainTabId === tab.id;

              return (
                <div
                  key={tab.id}
                  role="tab"
                  aria-selected={active}
                  className={`group flex h-11 min-w-[132px] max-w-[220px] shrink-0 items-center overflow-hidden rounded-t-xl border border-b-0 transition ${
                    active
                      ? "border-black/20 bg-[#313338] text-white"
                      : "border-white/5 bg-[#2b2d31] text-gray-400 hover:bg-[#35373c] hover:text-gray-200"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => activateMainTab(tab.id)}
                    title={tab.label}
                    className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-3 text-left"
                  >
                    <span className="shrink-0 text-sm">
                      {tab.isVoice ? "🔊" : "#"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-bold">
                      {tab.label}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => closeMainTab(tab.id)}
                    aria-label={`Đóng tab ${tab.label}`}
                    title="Đóng tab"
                    className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lg text-gray-400 hover:bg-white/10 hover:text-white"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          {activeMainTabId &&
            activeMainTabId !== MAIN_VOICE_TAB_ID && (
            <input
              value={searchQuery}
              onChange={(event) =>
                setSearchQuery(event.target.value)
              }
              placeholder="Tìm tin nhắn"
              className="mb-1.5 hidden w-36 shrink-0 rounded bg-[#111214] px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-indigo-500 sm:block"
            />
          )}

          <button
            type="button"
            onClick={() => setShowMembers(true)}
            className="mb-1.5 rounded p-2 text-xl text-gray-300 lg:hidden"
            aria-label="Mở danh sách thành viên"
          >
            👥
          </button>
        </header>

        {globalVoiceActive && (
          <div
            className={`overflow-y-auto px-3 py-5 md:px-5 ${
              globalVoiceSelected
                ? "min-h-0 flex-1"
                : "max-h-[360px] shrink-0 border-b border-black/20"
            }`}
          >
            <ChannelVoiceRoom
              channelId="global"
              channelName="Phòng trò chuyện"
              voiceOnly
              joinRequestId={globalVoiceJoinRequestId}
              onParticipantsChange={
                handleGlobalVoiceParticipants
              }
              onLeave={() => {
                setGlobalVoiceActive(false);
                setGlobalVoiceSelected(false);
              }}
            />
          </div>
        )}

        {!globalVoiceSelected && !activeMainTabId && (
          <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-gray-400">
            <div>
              <div className="text-5xl">🗂️</div>
              <p className="mt-3">
                Chưa có tab nào đang mở. Hãy bấm một kênh ở cột
                bên trái.
              </p>
            </div>
          </div>
        )}

        {!globalVoiceSelected &&
          activeMainTabId &&
          activeChannel && (
          <>
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
                        <MemberBadge
                          role={memberCards[message.user_id]?.role}
                        />
                        <strong>
                          {memberCards[message.user_id]?.username ??
                            message.username}
                        </strong>
                        <span className="text-[11px] text-gray-500">
                          {formatPublicId(
                            memberCards[message.user_id]?.public_id,
                          )}
                        </span>
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

                          {message.attachment_url &&
                          isVoiceAttachment(
                            message.attachment_type,
                          ) ? (
                            <div className="mt-2 min-w-[260px] max-w-xl rounded-xl border border-white/10 bg-black/15 p-3">
                              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                                <img
                                  src="/icons/voice-mic.png"
                                  alt=""
                                  className="h-5 w-5 rounded-full object-cover"
                                />
                                <span>Tin nhắn thoại</span>
                              </div>
                              <audio
                                controls
                                preload="metadata"
                                src={message.attachment_url}
                                className="h-10 w-full max-w-md"
                              >
                                Trình duyệt không hỗ trợ phát âm thanh.
                              </audio>
                            </div>
                          ) : message.attachment_url &&
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

          {isVoiceRecording && (
            <div className="mb-2 flex max-w-xl items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
              <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-red-200">
                  Đang ghi âm
                </p>
                <p className="text-xs text-red-200/70">
                  {formatVoiceDuration(
                    voiceRecordingSeconds,
                  )} / 05:00
                </p>
              </div>
              <button
                type="button"
                onClick={stopVoiceRecording}
                className="rounded-lg bg-red-500 px-3 py-2 text-sm font-bold text-white hover:bg-red-400"
              >
                Dừng
              </button>
              <button
                type="button"
                onClick={cancelVoiceRecording}
                className="rounded-lg bg-white/10 px-3 py-2 text-sm font-bold text-gray-200 hover:bg-white/15"
              >
                Hủy
              </button>
            </div>
          )}

          {attachmentFile && (
            <div className="mb-2 flex max-w-xl items-center gap-3 rounded-xl border border-white/10 bg-[#2b2d31] p-3">
              {voicePreviewUrl ? (
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-indigo-500/20">
                  <img
                    src="/icons/voice-mic.png"
                    alt=""
                    className="h-9 w-9 rounded-full object-cover"
                  />
                </span>
              ) : attachmentPreview ? (
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
                  {voicePreviewUrl
                    ? "Tin nhắn thoại"
                    : attachmentFile.name}
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  {voicePreviewUrl
                    ? `${formatVoiceDuration(
                        voicePreviewDuration,
                      )} · ${formatPublicAttachmentSize(
                        attachmentFile.size,
                      )}`
                    : formatPublicAttachmentSize(
                        attachmentFile.size,
                      )}
                </p>
                {voicePreviewUrl && (
                  <audio
                    controls
                    preload="metadata"
                    src={voicePreviewUrl}
                    className="mt-2 h-9 w-full max-w-md"
                  />
                )}
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
            <div className="flex items-center gap-1 rounded-lg bg-[#383a40] px-2 md:px-3">
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

              <div className="relative flex shrink-0 items-center">
                <button
                  type="button"
                  onClick={() => {
                    setShowComposerEmojiPicker(false);
                    setShowComposerAttachMenu(
                      (current) => !current,
                    );
                  }}
                  disabled={isChatSuspended || sending}
                  aria-label="Thêm ảnh hoặc tệp"
                  aria-expanded={showComposerAttachMenu}
                  title="Thêm"
                  className="flex h-10 w-10 items-center justify-center rounded-full text-2xl font-light text-gray-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  +
                </button>

                {showComposerAttachMenu && (
                  <div className="absolute bottom-12 left-0 z-50 w-52 overflow-hidden rounded-2xl border border-white/10 bg-[#1e1f22] p-1.5 shadow-2xl">
                    <button
                      type="button"
                      onClick={() => {
                        setShowComposerAttachMenu(false);
                        imageInputRef.current?.click();
                      }}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-gray-100 transition hover:bg-white/10"
                    >
                      <span className="text-xl">🖼️</span>
                      <span>Gửi ảnh</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setShowComposerAttachMenu(false);
                        documentInputRef.current?.click();
                      }}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-gray-100 transition hover:bg-white/10"
                    >
                      <span className="text-xl">📎</span>
                      <span>Gửi file</span>
                    </button>
                  </div>
                )}
              </div>

              <input
                value={messageInput}
                onChange={handleMessageInput}
                onFocus={() =>
                  setShowComposerAttachMenu(false)
                }
                disabled={isChatSuspended}
                placeholder={
                  isChatSuspended
                    ? "Tài khoản đang bị khóa quyền chat"
                    : `Nhắn tin trong #${activeChannel.label}`
                }
                maxLength={2000}
                className="min-w-0 flex-1 bg-transparent px-2 py-3 outline-none placeholder:text-gray-400 disabled:cursor-not-allowed"
              />

              <div className="relative flex shrink-0 items-center">
                <button
                  type="button"
                  onClick={() => {
                    setShowComposerAttachMenu(false);
                    setShowComposerEmojiPicker(
                      (current) => !current,
                    );
                  }}
                  disabled={isChatSuspended}
                  aria-label="Chọn biểu tượng cảm xúc"
                  aria-expanded={showComposerEmojiPicker}
                  title="Biểu tượng cảm xúc"
                  className="flex h-10 w-10 items-center justify-center rounded-full text-xl text-gray-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  😊
                </button>

                {showComposerEmojiPicker && (
                  <div className="absolute bottom-12 right-0 z-50 w-72 rounded-2xl border border-white/10 bg-[#1e1f22] p-3 shadow-2xl">
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

              <button
                type="button"
                onClick={() => {
                  setShowComposerAttachMenu(false);
                  setShowComposerEmojiPicker(false);

                  if (isVoiceRecording) {
                    stopVoiceRecording();
                  } else {
                    void startVoiceRecording();
                  }
                }}
                disabled={isChatSuspended || sending}
                aria-label={
                  isVoiceRecording
                    ? "Dừng ghi âm"
                    : "Ghi âm"
                }
                title={
                  isChatSuspended
                    ? "Tài khoản đang bị khóa chat"
                    : isVoiceRecording
                      ? "Dừng ghi âm"
                      : "Ghi tin nhắn thoại"
                }
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  isVoiceRecording
                    ? "bg-red-500/20 text-red-300"
                    : "hover:bg-white/10"
                }`}
              >
                {isVoiceRecording ? (
                  <span className="text-lg">⏹️</span>
                ) : (
                  <img
                    src="/icons/voice-mic.png"
                    alt=""
                    className="h-7 w-7 rounded-full object-cover"
                  />
                )}
              </button>

              <button
                type="submit"
                disabled={
                  sending ||
                  messagesLoading ||
                  isChatSuspended ||
                  isVoiceRecording ||
                  (!messageInput.trim() &&
                    !attachmentFile)
                }
                className="ml-1 rounded-lg bg-indigo-500 px-3 py-1.5 text-sm font-semibold transition hover:brightness-110 disabled:opacity-50"
              >
                {sending ? "Đang gửi..." : "Gửi"}
              </button>
            </div>
          </form>
        </div>
          </>
        )}
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
                      <MemberBadge role={member.role} />
                      <span className="truncate font-medium">
                        {member.username}
                      </span>
                    </span>

                    <span className="mt-0.5 block truncate text-[10px] text-gray-500">
                      {formatPublicId(member.public_id)}
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

      {editingChannel && (
        <div
          className="fixed inset-0 z-[190] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`Sửa kênh ${editingChannel.label}`}
        >
          <section className="w-full max-w-md rounded-3xl border border-white/10 bg-[#24262b] p-6 text-white shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-black">
                  Sửa kênh văn bản
                </h2>
                <p className="mt-1 text-sm text-gray-400">
                  Thay đổi tên và mô tả của kênh chính.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingChannel(null);
                  setChannelManagementError("");
                }}
                disabled={channelManagementWorking}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xl disabled:opacity-50"
                aria-label="Đóng"
              >
                ×
              </button>
            </div>

            {channelManagementError && (
              <p className="mt-4 rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-300">
                {channelManagementError}
              </p>
            )}

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase text-gray-400">
                  Tên kênh
                </span>
                <div className="flex items-center rounded-xl bg-[#1e1f22] px-4 focus-within:ring-2 focus-within:ring-indigo-500">
                  <span className="text-xl text-gray-500">#</span>
                  <input
                    value={managedChannelName}
                    onChange={(event) =>
                      setManagedChannelName(event.target.value)
                    }
                    maxLength={40}
                    className="min-w-0 flex-1 bg-transparent px-2 py-3 outline-none"
                    autoFocus
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase text-gray-400">
                  Mô tả
                </span>
                <textarea
                  value={managedChannelDescription}
                  onChange={(event) =>
                    setManagedChannelDescription(
                      event.target.value,
                    )
                  }
                  maxLength={300}
                  rows={3}
                  placeholder="Mô tả kênh"
                  className="w-full resize-none rounded-xl bg-[#1e1f22] px-4 py-3 outline-none ring-indigo-500 focus:ring-2"
                />
              </label>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setEditingChannel(null);
                  setChannelManagementError("");
                }}
                disabled={channelManagementWorking}
                className="flex-1 rounded-xl bg-white/10 px-4 py-3 font-bold disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => void saveChannelChanges()}
                disabled={
                  channelManagementWorking ||
                  managedChannelName.trim().length < 2
                }
                className="flex-1 rounded-xl bg-indigo-500 px-4 py-3 font-black disabled:opacity-50"
              >
                {channelManagementWorking
                  ? "Đang lưu..."
                  : "Lưu thay đổi"}
              </button>
            </div>
          </section>
        </div>
      )}

      {deletingChannel && (
        <div
          className="fixed inset-0 z-[190] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`Xóa kênh ${deletingChannel.label}`}
        >
          <section className="w-full max-w-md rounded-3xl border border-red-400/20 bg-[#24262b] p-6 text-white shadow-2xl">
            <h2 className="text-xl font-black text-red-300">
              Xóa #{deletingChannel.label}?
            </h2>
            <p className="mt-3 text-sm leading-6 text-gray-300">
              Kênh và dữ liệu gắn với kênh sẽ bị xóa. Thao tác
              này không thể hoàn tác.
            </p>

            {channelManagementError && (
              <p className="mt-4 rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-300">
                {channelManagementError}
              </p>
            )}

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setDeletingChannel(null);
                  setChannelManagementError("");
                }}
                disabled={channelManagementWorking}
                className="flex-1 rounded-xl bg-white/10 px-4 py-3 font-bold disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => void deleteManagedChannel()}
                disabled={channelManagementWorking}
                className="flex-1 rounded-xl bg-red-600 px-4 py-3 font-black hover:bg-red-500 disabled:opacity-50"
              >
                {channelManagementWorking
                  ? "Đang xóa..."
                  : "Xóa kênh"}
              </button>
            </div>
          </section>
        </div>
      )}

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
