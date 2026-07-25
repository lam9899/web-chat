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
import { getNotificationsEnabled } from "@/utils/notifications";
import { sendPushToUser } from "@/utils/push-notifications";
import FriendManager from "./friend-manager";
import MemberBadge, {
  formatPublicId,
  type MemberRole,
} from "@/components/member-badge";

const supabase = createClient();

type ProfileRow = {
  id: string;
  username: string;
  avatar_url: string | null;
  public_id: number;
  role: MemberRole;
  created_at: string;
  last_seen_at: string | null;
};

type GlobalPresenceMember = {
  user_id: string;
};

type GlobalPresenceWindow = Window &
  typeof globalThis & {
    __talkGlobalPresence?: GlobalPresenceMember[];
  };

const GLOBAL_PRESENCE_EVENT =
  "talk-global-presence-sync";


const PRIVATE_MESSAGE_MEDIA_BUCKET =
  "private-message-media";
const MAX_PRIVATE_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_PRIVATE_FILE_SIZE = 20 * 1024 * 1024;
const MAX_PRIVATE_VOICE_SIZE = 10 * 1024 * 1024;
const MAX_PRIVATE_VOICE_DURATION_SECONDS = 5 * 60;

const privateVoiceMimeCandidates = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
];

function supportedPrivateVoiceMimeType() {
  if (
    typeof MediaRecorder === "undefined" ||
    typeof MediaRecorder.isTypeSupported !== "function"
  ) {
    return "";
  }

  return (
    privateVoiceMimeCandidates.find((mimeType) =>
      MediaRecorder.isTypeSupported(mimeType),
    ) ?? ""
  );
}

function normalizePrivateVoiceMimeType(
  mimeType: string,
) {
  return mimeType.split(";")[0] || "audio/webm";
}

function privateVoiceExtension(mimeType: string) {
  const normalized =
    normalizePrivateVoiceMimeType(mimeType);

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

const allowedPrivateImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const allowedPrivateFileTypes = new Set([
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

const PRIVATE_FILE_ACCEPT = [
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

function privateImageExtension(file: File) {
  const extensionByType: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };

  return extensionByType[file.type] ?? "img";
}


function privateAttachmentExtension(file: File) {
  if (allowedPrivateImageTypes.has(file.type)) {
    return privateImageExtension(file);
  }

  if (isVoiceAttachment(file.type)) {
    return privateVoiceExtension(file.type);
  }

  const extensionFromName = file.name
    .split(".")
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  if (
    extensionFromName &&
    [
      "pdf",
      "doc",
      "docx",
      "xls",
      "xlsx",
      "ppt",
      "pptx",
      "zip",
      "txt",
    ].includes(extensionFromName)
  ) {
    return extensionFromName;
  }

  const extensionByType: Record<string, string> = {
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      "xlsx",
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      "pptx",
    "application/zip": "zip",
    "text/plain": "txt",
  };

  return extensionByType[file.type] ?? "file";
}

function isImageAttachment(
  attachmentType: string | null | undefined,
) {
  return Boolean(
    attachmentType?.startsWith("image/"),
  );
}

function formatAttachmentSize(
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

function attachmentIcon(
  attachmentType: string | null | undefined,
) {
  if (!attachmentType) return "📎";
  if (isVoiceAttachment(attachmentType)) return "🎤";
  if (attachmentType === "application/pdf") return "📕";
  if (
    attachmentType.includes("word") ||
    attachmentType === "application/msword"
  ) {
    return "📘";
  }
  if (
    attachmentType.includes("excel") ||
    attachmentType.includes("spreadsheet")
  ) {
    return "📗";
  }
  if (
    attachmentType.includes("powerpoint") ||
    attachmentType.includes("presentation")
  ) {
    return "📙";
  }
  if (attachmentType === "application/zip") return "🗜️";
  if (attachmentType === "text/plain") return "📄";

  return "📎";
}

function directMessagePreview(
  message: DirectMessageRow,
) {
  const content = message.content.trim();

  if (content) {
    return content.length > 90
      ? `${content.slice(0, 90)}…`
      : content;
  }

  if (isVoiceAttachment(message.attachment_type)) {
    return "Tin nhắn thoại";
  }

  if (isImageAttachment(message.attachment_type)) {
    return "Ảnh";
  }

  if (message.attachment_name) {
    return message.attachment_name;
  }

  return "Tin nhắn";
}

const DIRECT_REACTION_OPTIONS = [
  "👍",
  "❤️",
  "😂",
  "😮",
  "😢",
] as const;

function createPrivateMediaId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

async function addSignedImageUrl(
  message: DirectMessageRow,
): Promise<DirectMessageRow> {
  if (!message.attachment_path) {
    return {
      ...message,
      attachment_url: null,
    };
  }

  const { data, error } = await supabase.storage
    .from(PRIVATE_MESSAGE_MEDIA_BUCKET)
    .createSignedUrl(
      message.attachment_path,
      12 * 60 * 60,
    );

  return {
    ...message,
    attachment_url: error
      ? null
      : data?.signedUrl ?? null,
  };
}

async function addSignedImageUrls(
  rows: DirectMessageRow[],
) {
  return Promise.all(
    rows.map((message) =>
      addSignedImageUrl(message),
    ),
  );
}

type DirectMessageRow = {
  id: number;
  sender_id: string;
  receiver_id: string;
  content: string;
  created_at: string;
  edited_at: string | null;
  read_at: string | null;
  reply_to_id: number | null;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  attachment_size: number | null;
  attachment_url?: string | null;
};

type DirectMessageReactionRow = {
  id: number;
  message_id: number;
  user_id: string;
  emoji: string;
  created_at: string;
};

type ImageViewerState = {
  url: string;
  name: string;
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


type ChatColorId =
  | "indigo"
  | "blue"
  | "green"
  | "pink"
  | "orange"
  | "red";

type NotificationToneId =
  | "default"
  | "soft"
  | "bell"
  | "off";

type PrivateChatPreference = {
  chat_color: ChatColorId;
  notification_tone: NotificationToneId;
  notifications_enabled: boolean;
};

type PrivateChatPreferenceRow = PrivateChatPreference & {
  user_id: string;
  other_user_id: string;
  updated_at: string;
};

const defaultPrivateChatPreference: PrivateChatPreference = {
  chat_color: "indigo",
  notification_tone: "default",
  notifications_enabled: true,
};

const chatColorOptions: Array<{
  id: ChatColorId;
  label: string;
  hex: string;
  soft: string;
  border: string;
}> = [
  {
    id: "indigo",
    label: "Tím",
    hex: "#6366f1",
    soft: "rgba(99, 102, 241, 0.20)",
    border: "rgba(129, 140, 248, 0.38)",
  },
  {
    id: "blue",
    label: "Xanh dương",
    hex: "#0a7cff",
    soft: "rgba(10, 124, 255, 0.20)",
    border: "rgba(96, 165, 250, 0.40)",
  },
  {
    id: "green",
    label: "Xanh lá",
    hex: "#16a34a",
    soft: "rgba(22, 163, 74, 0.20)",
    border: "rgba(74, 222, 128, 0.38)",
  },
  {
    id: "pink",
    label: "Hồng",
    hex: "#db2777",
    soft: "rgba(219, 39, 119, 0.20)",
    border: "rgba(244, 114, 182, 0.40)",
  },
  {
    id: "orange",
    label: "Cam",
    hex: "#ea580c",
    soft: "rgba(234, 88, 12, 0.20)",
    border: "rgba(251, 146, 60, 0.40)",
  },
  {
    id: "red",
    label: "Đỏ",
    hex: "#dc2626",
    soft: "rgba(220, 38, 38, 0.20)",
    border: "rgba(248, 113, 113, 0.40)",
  },
];

const emojiOptions = [
  "😀",
  "😃",
  "😄",
  "😁",
  "😂",
  "🤣",
  "😊",
  "😍",
  "🥰",
  "😘",
  "😎",
  "🤔",
  "😢",
  "😭",
  "😡",
  "👍",
  "👎",
  "👏",
  "🙏",
  "💪",
  "❤️",
  "🧡",
  "💛",
  "💚",
  "💙",
  "💜",
  "🔥",
  "🎉",
  "✨",
  "✅",
  "❌",
  "💯",
  "🥳",
  "🤝",
  "👋",
  "🌹",
] as const;

const notificationToneOptions: Array<{
  id: NotificationToneId;
  label: string;
  description: string;
}> = [
  {
    id: "default",
    label: "Mặc định",
    description: "Hai tiếng ngắn, rõ ràng",
  },
  {
    id: "soft",
    label: "Nhẹ nhàng",
    description: "Âm thanh nhỏ và êm",
  },
  {
    id: "bell",
    label: "Chuông",
    description: "Ba nốt chuông nổi bật",
  },
  {
    id: "off",
    label: "Không có âm thanh",
    description: "Vẫn hiện thông báo nếu được bật",
  },
];

type BrowserWindowWithAudio = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

async function playPrivateChatTone(
  tone: NotificationToneId,
) {
  if (tone === "off" || typeof window === "undefined") {
    return;
  }

  const browserWindow =
    window as BrowserWindowWithAudio;
  const AudioContextConstructor =
    window.AudioContext ??
    browserWindow.webkitAudioContext;

  if (!AudioContextConstructor) return;

  const patterns: Record<
    Exclude<NotificationToneId, "off">,
    Array<{
      frequency: number;
      delay: number;
      duration: number;
      volume: number;
    }>
  > = {
    default: [
      {
        frequency: 720,
        delay: 0,
        duration: 0.10,
        volume: 0.10,
      },
      {
        frequency: 920,
        delay: 0.14,
        duration: 0.12,
        volume: 0.10,
      },
    ],
    soft: [
      {
        frequency: 540,
        delay: 0,
        duration: 0.16,
        volume: 0.055,
      },
      {
        frequency: 660,
        delay: 0.18,
        duration: 0.18,
        volume: 0.05,
      },
    ],
    bell: [
      {
        frequency: 660,
        delay: 0,
        duration: 0.13,
        volume: 0.09,
      },
      {
        frequency: 880,
        delay: 0.15,
        duration: 0.15,
        volume: 0.10,
      },
      {
        frequency: 1100,
        delay: 0.32,
        duration: 0.18,
        volume: 0.09,
      },
    ],
  };

  const context = new AudioContextConstructor();

  if (context.state === "suspended") {
    await context.resume();
  }

  const startAt = context.currentTime + 0.03;
  const selectedPattern = patterns[tone];

  selectedPattern.forEach((note) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const noteStart = startAt + note.delay;
    const noteEnd = noteStart + note.duration;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(
      note.frequency,
      noteStart,
    );

    gain.gain.setValueAtTime(0.0001, noteStart);
    gain.gain.exponentialRampToValueAtTime(
      note.volume,
      noteStart + 0.02,
    );
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      noteEnd,
    );

    oscillator.connect(gain);
    gain.connect(context.destination);

    oscillator.start(noteStart);
    oscillator.stop(noteEnd + 0.02);
  });

  const totalDuration = Math.max(
    ...selectedPattern.map(
      (note) => note.delay + note.duration,
    ),
  );

  window.setTimeout(() => {
    void context.close();
  }, Math.ceil((totalDuration + 0.15) * 1000));
}

function showPrivateMessageNotification({
  messageId,
  senderId,
  senderName,
  content,
}: {
  messageId: number;
  senderId: string;
  senderName: string;
  content: string;
}) {
  if (
    !getNotificationsEnabled() ||
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) {
    return;
  }

  const notification = new Notification(
    `Tin nhắn từ ${senderName}`,
    {
      body: content.trim() || "📎 Đã gửi một tệp",
      icon: "/icon.png",
      tag: `private-message-${messageId}`,
    },
  );

  notification.onclick = () => {
    window.focus();
    window.location.href = `/messages?user=${encodeURIComponent(
      senderId,
    )}`;
    notification.close();
  };
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

export default function MessagesPage() {
  const [currentUserId, setCurrentUserId] = useState("");
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [onlineFriendIds, setOnlineFriendIds] = useState<
    Set<string>
  >(new Set());
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
  const [
    openMessageMenuId,
    setOpenMessageMenuId,
  ] = useState<number | null>(null);
  const [
    openReactionPickerId,
    setOpenReactionPickerId,
  ] = useState<number | null>(null);
  const [replyingTo, setReplyingTo] =
    useState<DirectMessageRow | null>(null);
  const [
    directMessageReactions,
    setDirectMessageReactions,
  ] = useState<DirectMessageReactionRow[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] =
    useState(false);
  const [showAttachMenu, setShowAttachMenu] =
    useState(false);
  const [selectedImageFile, setSelectedImageFile] =
    useState<File | null>(null);
  const [
    selectedImagePreview,
    setSelectedImagePreview,
  ] = useState("");
  const [selectedDocumentFile, setSelectedDocumentFile] =
    useState<File | null>(null);
  const [selectedVoiceFile, setSelectedVoiceFile] =
    useState<File | null>(null);
  const [voicePreviewUrl, setVoicePreviewUrl] =
    useState("");
  const [voicePreviewDuration, setVoicePreviewDuration] =
    useState(0);
  const [isVoiceRecording, setIsVoiceRecording] =
    useState(false);
  const [voiceRecordingSeconds, setVoiceRecordingSeconds] =
    useState(0);
  const [imageViewer, setImageViewer] =
    useState<ImageViewerState | null>(null);

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
  const [
    privateChatPreferences,
    setPrivateChatPreferences,
  ] = useState<Record<string, PrivateChatPreference>>({});
  const [
    showPrivateChatSettings,
    setShowPrivateChatSettings,
  ] = useState(false);
  const [
    savingPrivateChatSettings,
    setSavingPrivateChatSettings,
  ] = useState(false);
  const [draftChatColor, setDraftChatColor] =
    useState<ChatColorId>("indigo");
  const [
    draftNotificationTone,
    setDraftNotificationTone,
  ] = useState<NotificationToneId>("default");
  const [
    draftNotificationsEnabled,
    setDraftNotificationsEnabled,
  ] = useState(true);

  const selectedProfileRef = useRef<ProfileRow | null>(null);
  const profilesRef = useRef<ProfileRow[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messageInputRef = useRef<HTMLInputElement | null>(
    null,
  );
  const imageInputRef = useRef<HTMLInputElement | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement | null>(
    null,
  );
  const mediaRecorderRef = useRef<MediaRecorder | null>(
    null,
  );
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceStartedAtRef = useRef(0);
  const discardVoiceRecordingRef = useRef(false);
  const privateChatPreferencesRef = useRef<
    Record<string, PrivateChatPreference>
  >({});

  useEffect(() => {
    selectedProfileRef.current = selectedProfile;
  }, [selectedProfile]);

  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);

  useEffect(() => {
    function applyPresence(
      members: GlobalPresenceMember[],
    ) {
      setOnlineFriendIds(
        new Set(
          members
            .map((member) => member.user_id)
            .filter(Boolean),
        ),
      );
    }

    const browserWindow =
      window as GlobalPresenceWindow;

    applyPresence(
      browserWindow.__talkGlobalPresence ?? [],
    );

    function handlePresence(event: Event) {
      applyPresence(
        (
          event as CustomEvent<
            GlobalPresenceMember[]
          >
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
  }, []);

  useEffect(() => {
    privateChatPreferencesRef.current =
      privateChatPreferences;
  }, [privateChatPreferences]);

  useEffect(() => {
    return () => {
      if (selectedImagePreview) {
        URL.revokeObjectURL(selectedImagePreview);
      }

      if (voicePreviewUrl) {
        URL.revokeObjectURL(voicePreviewUrl);
      }

      if (voiceTimerRef.current) {
        clearInterval(voiceTimerRef.current);
      }

      voiceStreamRef.current
        ?.getTracks()
        .forEach((track) => track.stop());
    };
  }, [selectedImagePreview, voicePreviewUrl]);

  useEffect(() => {
    function closeFloatingMenus(event: MouseEvent) {
      const target = event.target as HTMLElement | null;

      if (
        target?.closest("[data-message-menu]") ||
        target?.closest("[data-emoji-picker]") ||
        target?.closest("[data-direct-reaction-picker]")
      ) {
        return;
      }

      setOpenMessageMenuId(null);
      setOpenReactionPickerId(null);
      setShowEmojiPicker(false);
    }

    document.addEventListener(
      "mousedown",
      closeFloatingMenus,
    );

    return () => {
      document.removeEventListener(
        "mousedown",
        closeFloatingMenus,
      );
    };
  }, []);

  const selectedPrivateChatPreference = useMemo(
    () =>
      selectedProfile
        ? privateChatPreferences[selectedProfile.id] ??
          defaultPrivateChatPreference
        : defaultPrivateChatPreference,
    [privateChatPreferences, selectedProfile],
  );

  const activeChatColor = useMemo(
    () =>
      chatColorOptions.find(
        (color) =>
          color.id ===
          selectedPrivateChatPreference.chat_color,
      ) ?? chatColorOptions[0],
    [selectedPrivateChatPreference.chat_color],
  );

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
    const visibleProfiles = query
      ? profiles.filter((profile) =>
          profile.username
            .toLocaleLowerCase("vi")
            .includes(query),
        )
      : profiles;

    return [...visibleProfiles].sort(
      (firstProfile, secondProfile) => {
        const firstOnline = onlineFriendIds.has(
          firstProfile.id,
        );
        const secondOnline = onlineFriendIds.has(
          secondProfile.id,
        );

        if (firstOnline !== secondOnline) {
          return firstOnline ? -1 : 1;
        }

        return firstProfile.username.localeCompare(
          secondProfile.username,
          "vi",
        );
      },
    );
  }, [onlineFriendIds, profiles, searchQuery]);

  const directMessageById = useMemo(
    () =>
      new Map(
        messages.map((message) => [
          message.id,
          message,
        ]),
      ),
    [messages],
  );

  const reactionsByDirectMessage = useMemo(() => {
    const grouped = new Map<
      number,
      Map<string, { count: number; mine: boolean }>
    >();

    for (const reaction of directMessageReactions) {
      if (!grouped.has(reaction.message_id)) {
        grouped.set(reaction.message_id, new Map());
      }

      const messageReactions =
        grouped.get(reaction.message_id)!;
      const current =
        messageReactions.get(reaction.emoji) ?? {
          count: 0,
          mine: false,
        };

      messageReactions.set(reaction.emoji, {
        count: current.count + 1,
        mine:
          current.mine ||
          reaction.user_id === currentUserId,
      });
    }

    return grouped;
  }, [currentUserId, directMessageReactions]);

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
        {
          data: preferenceData,
          error: preferenceError,
        },
      ] = await Promise.all([
        supabase.rpc("get_my_friends"),
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
        supabase
          .from("private_chat_preferences")
          .select(
            "user_id, other_user_id, chat_color, notification_tone, notifications_enabled, updated_at",
          )
          .eq("user_id", user.id),
      ]);

      if (!active) return;

      if (profileError) {
        setErrorMessage(
          `Không thể tải danh sách thành viên: ${profileError.message}`,
        );
      } else {
        const loadedProfiles = (profileData ?? []) as ProfileRow[];
        profilesRef.current = loadedProfiles;
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

      if (!preferenceError) {
        const preferenceMap = (
          (preferenceData ?? []) as PrivateChatPreferenceRow[]
        ).reduce<Record<string, PrivateChatPreference>>(
          (current, preference) => {
            current[preference.other_user_id] = {
              chat_color: preference.chat_color,
              notification_tone:
                preference.notification_tone,
              notifications_enabled:
                preference.notifications_enabled,
            };
            return current;
          },
          {},
        );

        setPrivateChatPreferences(preferenceMap);
        privateChatPreferencesRef.current =
          preferenceMap;
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
          async (payload) => {
            if (!active) return;

            if (payload.eventType === "INSERT") {
              const newMessage =
                await addSignedImageUrl(
                  payload.new as DirectMessageRow,
                );
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
                const senderProfile =
                  profilesRef.current.find(
                    (profile) =>
                      profile.id === newMessage.sender_id,
                  );

                if (
                  document.visibilityState !== "visible" ||
                  !belongsToSelected
                ) {
                  const preference =
                    privateChatPreferencesRef.current[
                      newMessage.sender_id
                    ] ?? defaultPrivateChatPreference;

                  if (preference.notifications_enabled) {
                    void playPrivateChatTone(
                      preference.notification_tone,
                    );

                    showPrivateMessageNotification({
                      messageId: newMessage.id,
                      senderId: newMessage.sender_id,
                      senderName:
                        senderProfile?.username ??
                        "một thành viên",
                      content:
                        newMessage.content.trim() ||
                        (isVoiceAttachment(
                          newMessage.attachment_type,
                        )
                          ? "🎤 Đã gửi một tin nhắn thoại"
                          : isImageAttachment(
                                newMessage.attachment_type,
                              )
                            ? "📷 Đã gửi một ảnh"
                            : "📎 Đã gửi một tệp"),
                    });
                  }
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
                await addSignedImageUrl(
                  payload.new as DirectMessageRow,
                );

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

            const { data, error } = await supabase.rpc(
              "get_my_friends",
            );

            if (!active) return;

            if (error) {
              setErrorMessage(
                `Không thể cập nhật thành viên: ${error.message}`,
              );
              return;
            }

            const nextProfiles = (data ?? []) as ProfileRow[];
            profilesRef.current = nextProfiles;
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
            table: "friendships",
            filter: `user_id=eq.${user.id}`,
          },
          async () => {
            if (!active) return;

            const { data, error } = await supabase.rpc(
              "get_my_friends",
            );

            if (!active || error) return;

            const nextProfiles = (data ?? []) as ProfileRow[];
            profilesRef.current = nextProfiles;
            setProfiles(nextProfiles);

            const selectedId =
              selectedProfileRef.current?.id;

            if (selectedId) {
              const updatedSelected =
                nextProfiles.find(
                  (profile) => profile.id === selectedId,
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
            table: "private_chat_preferences",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            if (!active) return;

            if (
              payload.eventType === "INSERT" ||
              payload.eventType === "UPDATE"
            ) {
              const preference =
                payload.new as PrivateChatPreferenceRow;

              setPrivateChatPreferences((current) => {
                const next = {
                  ...current,
                  [preference.other_user_id]: {
                    chat_color: preference.chat_color,
                    notification_tone:
                      preference.notification_tone,
                    notifications_enabled:
                      preference.notifications_enabled,
                  },
                };

                privateChatPreferencesRef.current = next;
                return next;
              });
            }

            if (payload.eventType === "DELETE") {
              const preference =
                payload.old as Partial<PrivateChatPreferenceRow>;

              if (preference.other_user_id) {
                setPrivateChatPreferences((current) => {
                  const next = { ...current };
                  delete next[
                    preference.other_user_id as string
                  ];

                  privateChatPreferencesRef.current =
                    next;
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
      setDirectMessageReactions([]);
      setReplyingTo(null);
      return;
    }

    let active = true;
    const otherUserId = selectedProfile.id;

    async function loadConversation() {
      setMessagesLoading(true);
      setCallHistoryLoading(true);
      setMessages([]);
      setCallHistory([]);
      setDirectMessageReactions([]);
      setReplyingTo(null);
      setOpenReactionPickerId(null);
      setEditingId(null);
      setEditingContent("");
      setSelectedImageFile(null);
      setSelectedImagePreview("");
      setSelectedDocumentFile(null);
      setSelectedVoiceFile(null);
      setVoicePreviewUrl("");
      setVoicePreviewDuration(0);
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
            "id, sender_id, receiver_id, content, created_at, edited_at, read_at, reply_to_id, attachment_path, attachment_name, attachment_type, attachment_size",
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
        const loadedMessages =
          await addSignedImageUrls(
            (data ?? []) as DirectMessageRow[],
          );

        if (!active) return;
        setMessages(loadedMessages);

        const loadedMessageIds = loadedMessages.map(
          (message) => message.id,
        );

        if (loadedMessageIds.length > 0) {
          const {
            data: reactionData,
            error: reactionError,
          } = await supabase
            .from("direct_message_reactions")
            .select(
              "id, message_id, user_id, emoji, created_at",
            )
            .in("message_id", loadedMessageIds)
            .order("created_at", {
              ascending: true,
            });

          if (!active) return;

          if (reactionError) {
            setErrorMessage(
              `Không thể tải cảm xúc: ${reactionError.message}`,
            );
          } else {
            setDirectMessageReactions(
              (reactionData ??
                []) as DirectMessageReactionRow[],
            );
          }
        }

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
    if (
      !currentUserId ||
      !selectedProfile ||
      messages.length === 0
    ) {
      return;
    }

    const visibleMessageIds = new Set(
      messages.map((message) => message.id),
    );

    const reactionChannel = supabase
      .channel(
        `direct-reactions-${currentUserId}-${selectedProfile.id}`,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "direct_message_reactions",
        },
        (payload) => {
          if (
            payload.eventType === "INSERT" ||
            payload.eventType === "UPDATE"
          ) {
            const reaction =
              payload.new as DirectMessageReactionRow;

            if (
              !visibleMessageIds.has(
                reaction.message_id,
              )
            ) {
              return;
            }

            setDirectMessageReactions((current) => {
              const exists = current.some(
                (item) => item.id === reaction.id,
              );

              return exists
                ? current.map((item) =>
                    item.id === reaction.id
                      ? reaction
                      : item,
                  )
                : [...current, reaction];
            });
          }

          if (payload.eventType === "DELETE") {
            const deleted =
              payload.old as DirectMessageReactionRow;

            setDirectMessageReactions((current) =>
              current.filter(
                (item) => item.id !== deleted.id,
              ),
            );
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(reactionChannel);
    };
  }, [currentUserId, messages, selectedProfile]);

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
    setShowPrivateChatSettings(false);
    setOpenMessageMenuId(null);
    setOpenReactionPickerId(null);
    setReplyingTo(null);
    setShowEmojiPicker(false);
    setSelectedImageFile(null);
    setSelectedImagePreview("");
    setSelectedDocumentFile(null);
    setSelectedVoiceFile(null);
    setVoicePreviewUrl("");
    setVoicePreviewDuration(0);
    setMessageInput("");

    const nextUrl = `/messages?user=${encodeURIComponent(
      profile.id,
    )}`;

    window.history.replaceState(null, "", nextUrl);
  }

  function insertEmoji(emoji: string) {
    const input = messageInputRef.current;
    const start =
      input?.selectionStart ?? messageInput.length;
    const end = input?.selectionEnd ?? start;

    const nextMessage =
      messageInput.slice(0, start) +
      emoji +
      messageInput.slice(end);

    if (nextMessage.length > 2000) return;

    setMessageInput(nextMessage);
    setShowEmojiPicker(false);

    window.requestAnimationFrame(() => {
      const cursorPosition = start + emoji.length;
      input?.focus();
      input?.setSelectionRange(
        cursorPosition,
        cursorPosition,
      );
    });
  }

  function clearSelectedImage() {
    setSelectedImageFile(null);
    setSelectedImagePreview("");

    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }
  }

  function clearSelectedDocument() {
    setSelectedDocumentFile(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
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

  function clearSelectedVoice() {
    if (voicePreviewUrl) {
      URL.revokeObjectURL(voicePreviewUrl);
    }

    setSelectedVoiceFile(null);
    setVoicePreviewUrl("");
    setVoicePreviewDuration(0);
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
      isSuspended ||
      isSelectedBlocked
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
      clearSelectedImage();
      clearSelectedDocument();
      clearSelectedVoice();
      clearSelectedVoice();
      setShowAttachMenu(false);
      setShowEmojiPicker(false);
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
        supportedPrivateVoiceMimeType();
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
            MAX_PRIVATE_VOICE_DURATION_SECONDS,
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
          normalizePrivateVoiceMimeType(
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

        if (blob.size > MAX_PRIVATE_VOICE_SIZE) {
          setErrorMessage(
            "Tin nhắn thoại vượt quá giới hạn 10 MB.",
          );
          return;
        }

        const extension =
          privateVoiceExtension(recorderMimeType);
        const file = new File(
          [blob],
          `voice-${Date.now()}.${extension}`,
          {
            type: recorderMimeType,
          },
        );

        setSelectedVoiceFile(file);
        setVoicePreviewUrl(
          URL.createObjectURL(blob),
        );
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
            MAX_PRIVATE_VOICE_DURATION_SECONDS,
          ),
        );

        if (
          elapsed >=
            MAX_PRIVATE_VOICE_DURATION_SECONDS &&
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

  function selectPrivateFile(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) return;

    if (!allowedPrivateFileTypes.has(file.type)) {
      setErrorMessage(
        "Chỉ hỗ trợ PDF, Word, Excel, PowerPoint, ZIP hoặc TXT.",
      );
      return;
    }

    if (file.size > MAX_PRIVATE_FILE_SIZE) {
      setErrorMessage(
        "Tệp vượt quá giới hạn 20 MB.",
      );
      return;
    }

    if (isVoiceRecording) {
      cancelVoiceRecording();
    }

    clearSelectedImage();
    clearSelectedVoice();
    setErrorMessage("");
    setSelectedDocumentFile(file);
    setShowEmojiPicker(false);
  }

  function selectPrivateImage(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) return;

    if (!allowedPrivateImageTypes.has(file.type)) {
      setErrorMessage(
        "Chỉ hỗ trợ ảnh JPG, PNG, WEBP hoặc GIF.",
      );
      return;
    }

    if (file.size > MAX_PRIVATE_IMAGE_SIZE) {
      setErrorMessage(
        "Ảnh vượt quá giới hạn 5 MB.",
      );
      return;
    }

    if (isVoiceRecording) {
      cancelVoiceRecording();
    }

    clearSelectedDocument();
    clearSelectedVoice();
    setErrorMessage("");
    setSelectedImageFile(file);
    setSelectedImagePreview(
      URL.createObjectURL(file),
    );
    setShowEmojiPicker(false);
  }

  function scrollToDirectMessage(
    messageId: number,
  ) {
    document
      .getElementById(
        `direct-message-${messageId}`,
      )
      ?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
  }

  async function toggleDirectMessageReaction(
    messageId: number,
    emoji: string,
  ) {
    if (!currentUserId || isSuspended) return;

    const existing =
      directMessageReactions.find(
        (reaction) =>
          reaction.message_id === messageId &&
          reaction.user_id === currentUserId &&
          reaction.emoji === emoji,
      );

    setOpenReactionPickerId(null);
    setErrorMessage("");

    if (existing) {
      const { error } = await supabase
        .from("direct_message_reactions")
        .delete()
        .eq("id", existing.id);

      if (error) {
        setErrorMessage(
          `Không thể bỏ cảm xúc: ${error.message}`,
        );
        return;
      }

      setDirectMessageReactions((current) =>
        current.filter(
          (reaction) =>
            reaction.id !== existing.id,
        ),
      );
      return;
    }

    const { data, error } = await supabase
      .from("direct_message_reactions")
      .insert({
        message_id: messageId,
        user_id: currentUserId,
        emoji,
      })
      .select(
        "id, message_id, user_id, emoji, created_at",
      )
      .single();

    if (error) {
      setErrorMessage(
        `Không thể thả cảm xúc: ${error.message}`,
      );
      return;
    }

    const inserted =
      data as DirectMessageReactionRow;

    setDirectMessageReactions((current) =>
      current.some(
        (reaction) =>
          reaction.id === inserted.id,
      )
        ? current
        : [...current, inserted],
    );
  }

  async function sendMessage(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const content = messageInput.trim();
    const attachmentFile =
      selectedImageFile ??
      selectedDocumentFile ??
      selectedVoiceFile;

    if (
      (!content && !attachmentFile) ||
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

    let uploadedPath = "";

    if (attachmentFile) {
      const extension =
        privateAttachmentExtension(attachmentFile);

      uploadedPath = `${currentUserId}/${
        selectedProfile.id
      }/${Date.now()}-${createPrivateMediaId()}.${extension}`;

      const { error: uploadError } =
        await supabase.storage
          .from(PRIVATE_MESSAGE_MEDIA_BUCKET)
          .upload(uploadedPath, attachmentFile, {
            cacheControl: "3600",
            contentType: attachmentFile.type,
            upsert: false,
          });

      if (uploadError) {
        setErrorMessage(
          `Không thể tải tệp lên: ${uploadError.message}`,
        );
        setSending(false);
        return;
      }
    }

    const { error } = await supabase
      .from("direct_messages")
      .insert({
        sender_id: currentUserId,
        receiver_id: selectedProfile.id,
        content,
        reply_to_id: replyingTo?.id ?? null,
        attachment_path:
          uploadedPath || null,
        attachment_name:
          attachmentFile?.name ?? null,
        attachment_type:
          attachmentFile?.type ?? null,
        attachment_size:
          attachmentFile?.size ?? null,
      });

    // PUSH_NOTIFY_PRIVATE_MESSAGE
    if (!error) {
      const notificationBody =
        content ||
        (attachmentFile?.type.startsWith("audio/")
          ? "🎤 Đã gửi một tin nhắn thoại"
          : attachmentFile?.type.startsWith("image/")
            ? "🖼️ Đã gửi một ảnh"
            : attachmentFile
              ? "📎 Đã gửi một tệp"
              : "Bạn có một tin nhắn mới");

      void sendPushToUser({
        targetUserId: selectedProfile.id,
        type: "private_message",
        body: notificationBody,
      });
    }

    if (error) {
      if (uploadedPath) {
        await supabase.storage
          .from(PRIVATE_MESSAGE_MEDIA_BUCKET)
          .remove([uploadedPath]);
      }

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
      setReplyingTo(null);
      clearSelectedImage();
      clearSelectedDocument();
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

    // PUSH_NOTIFY_INCOMING_CALL
    void sendPushToUser({
      targetUserId: selectedProfile.id,
      type: "incoming_call",
      callId: createdCall.id,
      callType,
    });

    window.location.href = `/call/${createdCall.id}`;
  }

  function openPrivateChatSettings() {
    if (!selectedProfile) return;

    const preference =
      privateChatPreferences[selectedProfile.id] ??
      defaultPrivateChatPreference;

    setDraftChatColor(preference.chat_color);
    setDraftNotificationTone(
      preference.notification_tone,
    );
    setDraftNotificationsEnabled(
      preference.notifications_enabled,
    );
    setShowPrivateChatSettings(true);
  }

  async function previewNotificationTone() {
    if (!draftNotificationsEnabled) return;
    await playPrivateChatTone(draftNotificationTone);
  }

  async function savePrivateChatSettings() {
    if (
      !selectedProfile ||
      !currentUserId ||
      savingPrivateChatSettings
    ) {
      return;
    }

    setSavingPrivateChatSettings(true);
    setErrorMessage("");

    const nextPreference: PrivateChatPreference = {
      chat_color: draftChatColor,
      notification_tone: draftNotificationTone,
      notifications_enabled:
        draftNotificationsEnabled,
    };

    const { error } = await supabase
      .from("private_chat_preferences")
      .upsert(
        {
          user_id: currentUserId,
          other_user_id: selectedProfile.id,
          ...nextPreference,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id,other_user_id",
        },
      );

    if (error) {
      setErrorMessage(
        `Không thể lưu cài đặt tin nhắn riêng: ${error.message}`,
      );
      setSavingPrivateChatSettings(false);
      return;
    }

    setPrivateChatPreferences((current) => {
      const next = {
        ...current,
        [selectedProfile.id]: nextPreference,
      };

      privateChatPreferencesRef.current = next;
      return next;
    });

    setShowPrivateChatSettings(false);
    setSavingPrivateChatSettings(false);
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
    setOpenMessageMenuId(null);

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

    const messageToDelete = messages.find(
      (message) => message.id === messageId,
    );

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

      if (messageToDelete?.attachment_path) {
        const { error: removeError } =
          await supabase.storage
            .from(PRIVATE_MESSAGE_MEDIA_BUCKET)
            .remove([
              messageToDelete.attachment_path,
            ]);

        if (removeError) {
          setErrorMessage(
            "Tin nhắn đã được xóa nhưng ảnh chưa được dọn khỏi kho lưu trữ.",
          );
        }
      }
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
    <main className="grid h-screen overflow-hidden bg-[#313338] text-white md:grid-cols-[84px_320px_minmax(0,1fr)]">
      {/* Điều hướng ngoài cùng bên trái */}
      <nav className="hidden min-h-0 flex-col items-center border-r border-black/20 bg-[#1e1f22] px-2 py-3 md:flex">
        <button
          type="button"
          onClick={() => {
            window.location.href = "/";
          }}
          title="Mở Kênh chung"
          aria-label="Mở Kênh chung"
          className="group flex w-full flex-col items-center gap-1.5 rounded-2xl px-1 py-3 text-center text-gray-300 transition hover:bg-indigo-500 hover:text-white"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#313338] text-2xl font-black transition group-hover:rounded-xl group-hover:bg-white/15">
            #
          </span>
          <span className="text-[11px] font-bold leading-tight">
            Kênh chung
          </span>
        </button>
      </nav>

      {/* Danh sách bạn bè */}
      <aside
        className={`fixed inset-0 z-30 flex min-h-0 flex-col bg-[#2b2d31] transition-transform md:static md:translate-x-0 ${
          showContacts
            ? "translate-x-0"
            : "-translate-x-full"
        }`}
      >
        <header className="shrink-0 border-b border-black/20 p-4">
          <div className="flex items-start justify-between gap-3">
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
              Trò chuyện riêng tư với bạn bè
            </p>
            </div>

            <button
              type="button"
              onClick={() => {
                window.location.href = "/";
              }}
              title="Kênh chung"
              aria-label="Kênh chung"
              className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-white/10 px-3 text-sm font-bold hover:bg-white/15 md:hidden"
            >
              <span className="text-lg">#</span>
              <span>Kênh chung</span>
            </button>
          </div>

          <input
            value={searchQuery}
            onChange={(event) =>
              setSearchQuery(event.target.value)
            }
            placeholder="Tìm trong bạn bè..."
            className="mt-4 w-full rounded-xl border border-white/5 bg-[#1e1f22] px-4 py-3 outline-none ring-indigo-500 focus:ring-2"
          />

          <div className="mt-3 w-full">
            <FriendManager
              triggerVariant="sidebar"
              initialTab="add"
              onFriendsChanged={() => {
                window.location.reload();
              }}
            />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-2">
          {filteredProfiles.length === 0 ? (
            <p className="p-4 text-sm text-gray-400">
              Chưa có bạn bè. Bấm nút Thêm bạn bè ở phía trên để kết bạn.
            </p>
          ) : (
            filteredProfiles.map((profile) => {
              const isSelected =
                selectedProfile?.id === profile.id;
              const unread =
                unreadByUser[profile.id] ?? 0;
              const isOnline = onlineFriendIds.has(
                profile.id,
              );

              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => selectMember(profile)}
                  className={`mb-1.5 flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left transition ${
                    isSelected
                      ? "bg-white/10"
                      : "hover:bg-white/5"
                  } ${isOnline ? "" : "opacity-60"}`}
                >
                  <span className="relative shrink-0">
                    {profile.avatar_url ? (
                      <img
                        src={profile.avatar_url}
                        alt={profile.username}
                        className={`h-11 w-11 rounded-full object-cover ${
                          isOnline ? "" : "grayscale"
                        }`}
                      />
                    ) : (
                      <span
                        className={`flex h-11 w-11 items-center justify-center rounded-full bg-indigo-500 font-bold ${
                          isOnline ? "" : "grayscale"
                        }`}
                      >
                        {profile.username
                          .charAt(0)
                          .toUpperCase()}
                      </span>
                    )}

                    <span
                      className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-[#2b2d31] ${
                        isOnline ? "bg-green-500" : "bg-gray-600"
                      }`}
                    />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <MemberBadge role={profile.role} />
                      <span className="truncate font-semibold">
                        {profile.username}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-gray-500">
                      {formatPublicId(profile.public_id)}
                    </span>
                    <span
                      className={`mt-0.5 block truncate text-xs ${
                        isOnline
                          ? "text-green-400"
                          : "text-gray-500"
                      }`}
                    >
                      {isOnline
                        ? "Online"
                        : `Offline (${formatLastActive(
                            profile.last_seen_at,
                            clock,
                          )})`}
                    </span>
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
            <header
              className="flex h-[64px] shrink-0 items-center gap-3 border-b px-4 shadow"
              style={{
                borderBottomColor: activeChatColor.border,
              }}
            >
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
                  className={`h-10 w-10 rounded-full object-cover ${
                    onlineFriendIds.has(selectedProfile.id)
                      ? ""
                      : "grayscale opacity-60"
                  }`}
                />
              ) : (
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-full font-bold ${
                    onlineFriendIds.has(selectedProfile.id)
                      ? ""
                      : "grayscale opacity-60"
                  }`}
                  style={{
                    backgroundColor: activeChatColor.hex,
                  }}
                >
                  {selectedProfile.username
                    .charAt(0)
                    .toUpperCase()}
                </div>
              )}

              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                  <MemberBadge role={selectedProfile.role} />
                  <h2 className="truncate font-bold">
                    {selectedProfile.username}
                  </h2>
                  <span className="shrink-0 text-[10px] text-gray-500">
                    {formatPublicId(
                      selectedProfile.public_id,
                    )}
                  </span>
                </div>
                <p
                  className={`text-xs ${
                    onlineFriendIds.has(
                      selectedProfile.id,
                    )
                      ? "text-green-400"
                      : "text-gray-400"
                  }`}
                >
                  {onlineFriendIds.has(
                    selectedProfile.id,
                  )
                    ? "Online"
                    : `Offline (${formatLastActive(
                        selectedProfile.last_seen_at,
                        clock,
                      )})`}
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
                  className="rounded px-3 py-2 text-sm font-semibold transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                  style={{
                    backgroundColor: activeChatColor.hex,
                  }}
                >
                  {startingCallType === "video"
                    ? "..."
                    : "🎥"}
                </button>

                <button
                  type="button"
                  onClick={openPrivateChatSettings}
                  title="Cài đặt cuộc trò chuyện"
                  aria-label="Cài đặt cuộc trò chuyện"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white transition hover:bg-white/15"
                  style={{
                    boxShadow: `inset 0 0 0 1px ${activeChatColor.border}`,
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V20h-3v-.08a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7 15.4a1.7 1.7 0 0 0-1.56-1.03H5.3v-3h.14A1.7 1.7 0 0 0 7 10.34a1.7 1.7 0 0 0-.34-1.88L6.6 8.4l2.12-2.12.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 11.7 5.1V5h3v.1a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.03h.14v3h-.14A1.7 1.7 0 0 0 19.4 15Z" />
                  </svg>
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
                                    ? "rounded-br-md"
                                    : "rounded-bl-md border-white/10 bg-[#2b2d31]"
                              }`}
                              style={
                                outgoing && !incomingMissed
                                  ? {
                                      backgroundColor:
                                        activeChatColor.soft,
                                      borderColor:
                                        activeChatColor.border,
                                    }
                                  : undefined
                              }
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
                      const repliedMessage =
                        message.reply_to_id
                          ? directMessageById.get(
                              message.reply_to_id,
                            )
                          : null;
                      const messageReactions =
                        reactionsByDirectMessage.get(
                          message.id,
                        );

                      return (
                        <article
                          id={`direct-message-${message.id}`}
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
                                ? "rounded-br-md"
                                : "rounded-bl-md bg-[#2b2d31]"
                            }`}
                            style={
                              isMine
                                ? {
                                    backgroundColor:
                                      activeChatColor.hex,
                                  }
                                : undefined
                            }
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
                                {repliedMessage && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      scrollToDirectMessage(
                                        repliedMessage.id,
                                      )
                                    }
                                    className="mb-2 block w-full rounded-xl border-l-4 border-white/40 bg-black/15 px-3 py-2 text-left transition hover:bg-black/25"
                                    title="Đi tới tin nhắn được trả lời"
                                  >
                                    <span className="block text-[11px] font-bold text-white/70">
                                      Đang trả lời{" "}
                                      {repliedMessage.sender_id ===
                                      currentUserId
                                        ? "chính bạn"
                                        : selectedProfile.username}
                                    </span>
                                    <span className="mt-0.5 block truncate text-xs text-white/80">
                                      {directMessagePreview(
                                        repliedMessage,
                                      )}
                                    </span>
                                  </button>
                                )}

                                {message.attachment_url &&
                                isVoiceAttachment(
                                  message.attachment_type,
                                ) ? (
                                  <div className="min-w-[260px] rounded-xl border border-white/10 bg-black/15 p-3">
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
                                isImageAttachment(
                                  message.attachment_type,
                                ) ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setImageViewer({
                                        url:
                                          message.attachment_url ??
                                          "",
                                        name:
                                          message.attachment_name ??
                                          "Ảnh",
                                      })
                                    }
                                    className="block max-w-full overflow-hidden rounded-xl bg-black/15"
                                    title="Bấm để xem ảnh lớn"
                                  >
                                    <img
                                      src={message.attachment_url}
                                      alt={
                                        message.attachment_name ??
                                        "Ảnh trong tin nhắn"
                                      }
                                      className="max-h-96 w-auto max-w-full object-contain"
                                      loading="lazy"
                                    />
                                  </button>
                                ) : message.attachment_url &&
                                  message.attachment_path ? (
                                  <a
                                    href={message.attachment_url}
                                    download={
                                      message.attachment_name ??
                                      undefined
                                    }
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-black/15 p-3 transition hover:bg-black/25"
                                    title="Tải tệp xuống"
                                  >
                                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-2xl">
                                      {attachmentIcon(
                                        message.attachment_type,
                                      )}
                                    </span>

                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-sm font-semibold">
                                        {message.attachment_name ??
                                          "Tệp đính kèm"}
                                      </span>
                                      <span className="mt-0.5 block text-xs text-white/60">
                                        {formatAttachmentSize(
                                          message.attachment_size,
                                        ) || "Tệp đính kèm"}
                                      </span>
                                    </span>

                                    <span className="shrink-0 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-bold">
                                      Tải xuống
                                    </span>
                                  </a>
                                ) : message.attachment_path ? (
                                  <div className="rounded-xl bg-black/15 px-4 py-3 text-sm text-white/75">
                                    Không thể tải tệp. Hãy làm mới trang để thử lại.
                                  </div>
                                ) : null}

                                {message.content.trim() && (
                                  <p
                                    className={`whitespace-pre-wrap break-words ${
                                      message.attachment_path
                                        ? "mt-2"
                                        : ""
                                    }`}
                                  >
                                    {message.content}
                                  </p>
                                )}

                                <div
                                  className={`mt-1 text-[11px] ${
                                    isMine
                                      ? "text-white/75"
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

                            {!isEditing && (
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                {messageReactions &&
                                  Array.from(
                                    messageReactions.entries(),
                                  ).map(
                                    ([
                                      emoji,
                                      reaction,
                                    ]) => (
                                      <button
                                        key={emoji}
                                        type="button"
                                        onClick={() =>
                                          void toggleDirectMessageReaction(
                                            message.id,
                                            emoji,
                                          )
                                        }
                                        className={`rounded-full border px-2 py-0.5 text-xs transition ${
                                          reaction.mine
                                            ? "border-indigo-300/70 bg-indigo-500/25"
                                            : "border-white/10 bg-black/15 hover:bg-black/25"
                                        }`}
                                        title={
                                          reaction.mine
                                            ? "Bỏ cảm xúc"
                                            : "Thả cảm xúc"
                                        }
                                      >
                                        {emoji}{" "}
                                        {reaction.count}
                                      </button>
                                    ),
                                  )}

                                <button
                                  type="button"
                                  onClick={() => {
                                    setReplyingTo(message);
                                    setOpenReactionPickerId(
                                      null,
                                    );
                                    window.requestAnimationFrame(
                                      () =>
                                        messageInputRef.current?.focus(),
                                    );
                                  }}
                                  className="rounded-full bg-black/15 px-2 py-0.5 text-xs text-white/75 transition hover:bg-black/25 hover:text-white"
                                  title="Trả lời tin nhắn"
                                >
                                  ↩ Trả lời
                                </button>

                                <div
                                  className="relative"
                                  data-direct-reaction-picker
                                >
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setOpenReactionPickerId(
                                        (current) =>
                                          current === message.id
                                            ? null
                                            : message.id,
                                      )
                                    }
                                    className="rounded-full bg-black/15 px-2 py-0.5 text-xs text-white/75 transition hover:bg-black/25 hover:text-white"
                                    title="Thả cảm xúc"
                                  >
                                    😊
                                  </button>

                                  {openReactionPickerId ===
                                    message.id && (
                                    <div
                                      className={`absolute bottom-7 z-50 flex gap-1 rounded-full border border-white/10 bg-[#1e1f22] p-1.5 shadow-2xl ${
                                        isMine
                                          ? "right-0"
                                          : "left-0"
                                      }`}
                                    >
                                      {DIRECT_REACTION_OPTIONS.map(
                                        (emoji) => (
                                          <button
                                            key={emoji}
                                            type="button"
                                            onClick={() =>
                                              void toggleDirectMessageReaction(
                                                message.id,
                                                emoji,
                                              )
                                            }
                                            className="flex h-8 w-8 items-center justify-center rounded-full text-lg hover:bg-white/10"
                                          >
                                            {emoji}
                                          </button>
                                        ),
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {isMine && !isEditing && (
                              <div
                                className="absolute -right-3 -top-3 z-30"
                                data-message-menu
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
                                    openMessageMenuId ===
                                    message.id
                                  }
                                  title="Tùy chọn"
                                  className={`flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-[#1e1f22] pb-1 text-lg font-bold leading-none text-gray-300 shadow-lg transition hover:bg-[#111214] hover:text-white ${
                                    openMessageMenuId ===
                                    message.id
                                      ? "opacity-100"
                                      : "opacity-100 md:opacity-0 md:group-hover:opacity-100"
                                  }`}
                                >
                                  …
                                </button>

                                {openMessageMenuId ===
                                  message.id && (
                                  <div className="absolute right-0 top-8 z-40 min-w-32 overflow-hidden rounded-xl border border-white/10 bg-[#1e1f22] py-1 shadow-2xl">
                                    {message.content.trim() && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          beginEditing(message)
                                        }
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/10"
                                      >
                                        <span>✏️</span>
                                        <span>Sửa</span>
                                      </button>
                                    )}

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenMessageMenuId(
                                          null,
                                        );
                                        void deleteMessage(
                                          message.id,
                                        );
                                      }}
                                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-300 hover:bg-red-500/15"
                                    >
                                      <span>🗑️</span>
                                      <span>Xóa</span>
                                    </button>
                                  </div>
                                )}
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
              {replyingTo && (
                <div className="mb-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-[#2b2d31] p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-indigo-300">
                      Đang trả lời{" "}
                      {replyingTo.sender_id ===
                      currentUserId
                        ? "chính bạn"
                        : selectedProfile.username}
                    </p>
                    <p className="mt-1 truncate text-sm text-gray-300">
                      {directMessagePreview(
                        replyingTo,
                      )}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setReplyingTo(null)
                    }
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-lg text-gray-300 hover:bg-white/15 hover:text-white"
                    title="Hủy trả lời"
                    aria-label="Hủy trả lời"
                  >
                    ×
                  </button>
                </div>
              )}

              {isVoiceRecording && (
                <div className="mb-3 flex items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-3">
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

              {selectedVoiceFile && voicePreviewUrl && (
                <div className="mb-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-[#2b2d31] p-3">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-indigo-500/20">
                    <img
                      src="/icons/voice-mic.png"
                      alt=""
                      className="h-9 w-9 rounded-full object-cover"
                    />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      Tin nhắn thoại
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      {formatVoiceDuration(
                        voicePreviewDuration,
                      )} · {formatAttachmentSize(
                        selectedVoiceFile.size,
                      )}
                    </p>
                    <audio
                      controls
                      preload="metadata"
                      src={voicePreviewUrl}
                      className="mt-2 h-9 w-full max-w-md"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={clearSelectedVoice}
                    aria-label="Bỏ tin nhắn thoại"
                    title="Bỏ tin nhắn thoại"
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500/15 text-red-300 hover:bg-red-500/25"
                  >
                    ×
                  </button>
                </div>
              )}

              {selectedDocumentFile && (
                <div className="mb-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-[#2b2d31] p-3">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/10 text-3xl">
                    {attachmentIcon(
                      selectedDocumentFile.type,
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {selectedDocumentFile.name}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      {formatAttachmentSize(
                        selectedDocumentFile.size,
                      )}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={clearSelectedDocument}
                    aria-label="Bỏ tệp đã chọn"
                    title="Bỏ tệp"
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500/15 text-red-300 hover:bg-red-500/25"
                  >
                    ×
                  </button>
                </div>
              )}

              {selectedImagePreview && (
                <div className="mb-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-[#2b2d31] p-3">
                  <img
                    src={selectedImagePreview}
                    alt="Ảnh chuẩn bị gửi"
                    className="h-20 w-20 rounded-xl object-cover"
                  />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {selectedImageFile?.name}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      {selectedImageFile
                        ? `${(
                            selectedImageFile.size /
                            1024 /
                            1024
                          ).toFixed(2)} MB`
                        : ""}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={clearSelectedImage}
                    aria-label="Bỏ ảnh đã chọn"
                    title="Bỏ ảnh"
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500/15 text-red-300 hover:bg-red-500/25"
                  >
                    ×
                  </button>
                </div>
              )}

              <div className="flex items-center gap-1 rounded-xl bg-[#383a40] px-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={PRIVATE_FILE_ACCEPT}
                  onChange={selectPrivateFile}
                  className="hidden"
                />

                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={selectPrivateImage}
                  className="hidden"
                />

                <div className="relative flex shrink-0 items-center">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEmojiPicker(false);
                      setShowAttachMenu(
                        (current) => !current,
                      );
                    }}
                    disabled={
                      sending ||
                      isSuspended ||
                      isSelectedBlocked
                    }
                    aria-label="Thêm ảnh hoặc tệp"
                    aria-expanded={showAttachMenu}
                    title="Thêm"
                    className="flex h-10 w-10 items-center justify-center rounded-full text-2xl font-light transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    +
                  </button>

                  {showAttachMenu && (
                    <div className="absolute bottom-12 left-0 z-50 w-52 overflow-hidden rounded-2xl border border-white/10 bg-[#1e1f22] p-1.5 shadow-2xl">
                      <button
                        type="button"
                        onClick={() => {
                          setShowAttachMenu(false);
                          imageInputRef.current?.click();
                        }}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition hover:bg-white/10"
                      >
                        <span className="text-xl">🖼️</span>
                        <span>Gửi ảnh</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setShowAttachMenu(false);
                          fileInputRef.current?.click();
                        }}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition hover:bg-white/10"
                      >
                        <span className="text-xl">📎</span>
                        <span>Gửi file</span>
                      </button>
                    </div>
                  )}
                </div>

                <input
                  ref={messageInputRef}
                  value={messageInput}
                  onChange={(event) =>
                    setMessageInput(event.target.value)
                  }
                  onFocus={() => {
                    setOpenMessageMenuId(null);
                    setShowAttachMenu(false);
                  }}
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
                  className="min-w-0 flex-1 bg-transparent px-2 py-3 outline-none placeholder:text-gray-400 disabled:cursor-not-allowed"
                />

                <div
                  className="relative flex shrink-0 items-center"
                  data-emoji-picker
                >
                  <button
                    type="button"
                    onClick={() => {
                      setShowAttachMenu(false);
                      setShowEmojiPicker(
                        (current) => !current,
                      );
                    }}
                    disabled={
                      isSuspended || isSelectedBlocked
                    }
                    aria-label="Chọn biểu tượng cảm xúc"
                    aria-expanded={showEmojiPicker}
                    title="Biểu tượng cảm xúc"
                    className="flex h-10 w-10 items-center justify-center rounded-full text-xl transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    😊
                  </button>

                  {showEmojiPicker && (
                    <div className="absolute bottom-12 right-0 z-50 w-72 rounded-2xl border border-white/10 bg-[#1e1f22] p-3 shadow-2xl">
                      <div className="mb-2 flex items-center justify-between">
                        <strong className="text-sm">
                          Biểu tượng cảm xúc
                        </strong>
                        <button
                          type="button"
                          onClick={() =>
                            setShowEmojiPicker(false)
                          }
                          aria-label="Đóng bảng cảm xúc"
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-lg text-gray-300 hover:bg-white/15 hover:text-white"
                        >
                          ×
                        </button>
                      </div>

                      <div className="grid grid-cols-8 gap-1">
                        {emojiOptions.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() =>
                              insertEmoji(emoji)
                            }
                            className="flex aspect-square items-center justify-center rounded-lg text-xl transition hover:scale-110 hover:bg-white/10"
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
                    setShowAttachMenu(false);
                    setShowEmojiPicker(false);

                    if (isVoiceRecording) {
                      stopVoiceRecording();
                    } else {
                      void startVoiceRecording();
                    }
                  }}
                  disabled={
                    sending ||
                    isSuspended ||
                    isSelectedBlocked
                  }
                  aria-label={
                    isVoiceRecording
                      ? "Dừng ghi âm"
                      : "Ghi âm"
                  }
                  title={
                    isVoiceRecording
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
                    isSuspended ||
                    isSelectedBlocked ||
                    isVoiceRecording ||
                    !messageInput.trim() &&
                    !selectedImageFile &&
                    !selectedDocumentFile &&
                    !selectedVoiceFile
                  }
                  className="my-1.5 ml-1 rounded-lg px-4 py-2 text-sm font-semibold transition hover:brightness-110 disabled:opacity-50"
                  style={{
                    backgroundColor: activeChatColor.hex,
                  }}
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
                Chọn một người bạn ở danh sách bên trái để bắt đầu
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

      {imageViewer && (
        <div
          className="fixed inset-0 z-[190] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Xem ảnh"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setImageViewer(null);
            }
          }}
        >
          <section className="relative flex max-h-[92vh] max-w-[94vw] items-center justify-center">
            <img
              src={imageViewer.url}
              alt={imageViewer.name}
              className="max-h-[88vh] max-w-[92vw] rounded-2xl object-contain shadow-2xl"
            />

            <button
              type="button"
              onClick={() => setImageViewer(null)}
              aria-label="Đóng ảnh"
              className="absolute -right-3 -top-3 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-[#1e1f22] text-2xl text-white shadow-xl hover:bg-[#111214]"
            >
              ×
            </button>
          </section>
        </div>
      )}

      {showPrivateChatSettings && selectedProfile && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Cài đặt tin nhắn riêng"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowPrivateChatSettings(false);
            }
          }}
        >
          <section className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/10 bg-[#24262b] text-white shadow-2xl">
            <header className="flex items-center gap-3 border-b border-white/10 p-5">
              {selectedProfile.avatar_url ? (
                <img
                  src={selectedProfile.avatar_url}
                  alt={selectedProfile.username}
                  className="h-12 w-12 rounded-full object-cover"
                />
              ) : (
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold"
                  style={{
                    backgroundColor:
                      chatColorOptions.find(
                        (color) =>
                          color.id === draftChatColor,
                      )?.hex ?? activeChatColor.hex,
                  }}
                >
                  {selectedProfile.username
                    .charAt(0)
                    .toUpperCase()}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-bold">
                  Cài đặt cuộc trò chuyện
                </h2>
                <p className="truncate text-sm text-gray-400">
                  {selectedProfile.username}
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setShowPrivateChatSettings(false)
                }
                aria-label="Đóng"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xl text-gray-300 hover:bg-white/15 hover:text-white"
              >
                ×
              </button>
            </header>

            <div className="space-y-5 p-5">
              <section className="rounded-2xl bg-black/15 p-4">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-full text-lg"
                    style={{
                      backgroundColor:
                        chatColorOptions.find(
                          (color) =>
                            color.id === draftChatColor,
                        )?.soft,
                    }}
                  >
                    🎨
                  </div>
                  <div>
                    <h3 className="font-bold">
                      Màu đoạn chat
                    </h3>
                    <p className="text-xs text-gray-400">
                      Đổi màu tin nhắn của bạn trong cuộc trò chuyện này.
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-6 gap-3">
                  {chatColorOptions.map((color) => {
                    const selected =
                      draftChatColor === color.id;

                    return (
                      <button
                        key={color.id}
                        type="button"
                        onClick={() =>
                          setDraftChatColor(color.id)
                        }
                        title={color.label}
                        aria-label={`Chọn màu ${color.label}`}
                        className="relative aspect-square rounded-full transition hover:scale-105"
                        style={{
                          backgroundColor: color.hex,
                          boxShadow: selected
                            ? "0 0 0 3px #24262b, 0 0 0 5px #ffffff"
                            : "none",
                        }}
                      >
                        {selected && (
                          <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white">
                            ✓
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-2xl bg-black/15 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-lg">
                    🔔
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold">
                      Thông báo tin nhắn
                    </h3>
                    <p className="text-xs text-gray-400">
                      Chọn chuông riêng cho cuộc trò chuyện này.
                    </p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={
                      draftNotificationsEnabled
                    }
                    onClick={() =>
                      setDraftNotificationsEnabled(
                        (current) => !current,
                      )
                    }
                    className={`relative h-7 w-12 rounded-full transition ${
                      draftNotificationsEnabled
                        ? "bg-green-500"
                        : "bg-gray-600"
                    }`}
                  >
                    <span
                      className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${
                        draftNotificationsEnabled
                          ? "left-6"
                          : "left-1"
                      }`}
                    />
                  </button>
                </div>

                <div
                  className={`mt-4 space-y-2 ${
                    draftNotificationsEnabled
                      ? ""
                      : "pointer-events-none opacity-45"
                  }`}
                >
                  {notificationToneOptions.map((tone) => (
                    <button
                      key={tone.id}
                      type="button"
                      onClick={() =>
                        setDraftNotificationTone(tone.id)
                      }
                      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${
                        draftNotificationTone === tone.id
                          ? "border-white/30 bg-white/10"
                          : "border-white/5 bg-black/10 hover:bg-white/5"
                      }`}
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10">
                        {tone.id === "off" ? "🔕" : "🔔"}
                      </span>

                      <span className="min-w-0 flex-1">
                        <strong className="block text-sm">
                          {tone.label}
                        </strong>
                        <span className="block truncate text-xs text-gray-400">
                          {tone.description}
                        </span>
                      </span>

                      <span
                        className={`h-4 w-4 rounded-full border ${
                          draftNotificationTone === tone.id
                            ? "border-white bg-white"
                            : "border-gray-500"
                        }`}
                      />
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() =>
                      void previewNotificationTone()
                    }
                    disabled={
                      draftNotificationTone === "off"
                    }
                    className="mt-2 w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ▶ Nghe thử chuông
                  </button>
                </div>
              </section>

              <section className="rounded-2xl bg-black/15 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/15 text-lg">
                    🛡️
                  </div>
                  <div>
                    <h3 className="font-bold">
                      Quyền riêng tư
                    </h3>
                    <p className="text-xs text-gray-400">
                      Quản lý việc chặn thành viên trong cuộc trò chuyện này.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    void toggleBlockSelected()
                  }
                  disabled={
                    blockingUserId === selectedProfile.id
                  }
                  className={`mt-4 w-full rounded-xl px-4 py-3 text-sm font-bold transition disabled:opacity-50 ${
                    isSelectedBlocked
                      ? "bg-green-600 hover:bg-green-500"
                      : "bg-red-500/15 text-red-300 hover:bg-red-500/25"
                  }`}
                >
                  {blockingUserId === selectedProfile.id
                    ? "Đang xử lý..."
                    : isSelectedBlocked
                      ? `Bỏ chặn ${selectedProfile.username}`
                      : `Chặn ${selectedProfile.username}`}
                </button>
              </section>
            </div>

            <footer className="flex gap-3 border-t border-white/10 p-5">
              <button
                type="button"
                onClick={() =>
                  setShowPrivateChatSettings(false)
                }
                className="flex-1 rounded-xl bg-white/10 px-4 py-3 font-semibold hover:bg-white/15"
              >
                Hủy
              </button>

              <button
                type="button"
                onClick={() =>
                  void savePrivateChatSettings()
                }
                disabled={savingPrivateChatSettings}
                className="flex-1 rounded-xl px-4 py-3 font-bold text-white transition hover:brightness-110 disabled:opacity-50"
                style={{
                  backgroundColor:
                    chatColorOptions.find(
                      (color) =>
                        color.id === draftChatColor,
                    )?.hex ?? activeChatColor.hex,
                }}
              >
                {savingPrivateChatSettings
                  ? "Đang lưu..."
                  : "Lưu cài đặt"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
