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
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import MemberBadge, {
  formatPublicId,
} from "@/components/member-badge";
import ChannelRail from "../../channel-rail";
import ChannelVoiceRoom, {
  type VoiceParticipantSnapshot,
} from "../../channel-voice-room";
import {
  type ChannelMessage,
  type DynamicChannel,
  type ServerMember,
  type ServerSummary,
  channelAvatarUrl,
} from "../../channel-types";

const supabase = createClient();
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

type OnlineUser = { user_id: string };
type PresenceWindow = Window &
  typeof globalThis & {
    __talkGlobalPresence?: OnlineUser[];
  };

type VoiceParticipantsResponse = {
  channels?: Record<string, VoiceParticipantSnapshot[]>;
};

function formatLastActive(
  lastSeenAt: string | null | undefined,
  now: number | null,
) {
  if (!lastSeenAt) return "không rõ";
  if (now === null) return "đang cập nhật";

  const lastSeenTime = new Date(lastSeenAt).getTime();
  const difference = Math.max(0, now - lastSeenTime);
  const minutes = Math.floor(difference / 60_000);

  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày trước`;

  return new Date(lastSeenAt).toLocaleString("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function ServerPage() {
  const params = useParams<{ serverId: string }>();
  const router = useRouter();
  const serverId = params.serverId;

  const [server, setServer] = useState<ServerSummary | null>(null);
  const [channels, setChannels] = useState<DynamicChannel[]>([]);
  const [members, setMembers] = useState<ServerMember[]>([]);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [onlineUserIds, setOnlineUserIds] =
    useState<Set<string>>(new Set());
  const [
    voiceParticipantsByChannel,
    setVoiceParticipantsByChannel,
  ] = useState<Record<string, VoiceParticipantSnapshot[]>>({});
  const [currentUserId, setCurrentUserId] = useState("");
  const [clock, setClock] = useState<number | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<
    string | null
  >(null);
  const [voiceJoinRequestId, setVoiceJoinRequestId] =
    useState(0);

  const [messageInput, setMessageInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [working, setWorking] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [loadErrorMessage, setLoadErrorMessage] = useState("");
  const [showSidebar, setShowSidebar] = useState(false);

  const [showInvite, setShowInvite] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [showServerMenu, setShowServerMenu] = useState(false);
  const [showServerSettings, setShowServerSettings] =
    useState(false);
  const [editServerName, setEditServerName] = useState("");
  const [editServerDescription, setEditServerDescription] =
    useState("");

  const [showCreateChannel, setShowCreateChannel] =
    useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelType, setNewChannelType] =
    useState<"text" | "voice">("text");

  const [editChannel, setEditChannel] =
    useState<DynamicChannel | null>(null);
  const [editChannelName, setEditChannelName] = useState("");

  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const selectedChannelIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedChannelIdRef.current = selectedChannelId;
  }, [selectedChannelId]);

  const loadServer = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_my_servers");

    if (error) {
      setServer(null);
      setLoadErrorMessage(error.message);
      return;
    }

    const found = ((data ?? []) as ServerSummary[]).find(
      (item) => item.id === serverId,
    );

    setServer(found ?? null);

    if (!found) {
      setLoadErrorMessage(
        "Server không tồn tại hoặc bạn chưa tham gia. Hãy nhập mã mời để tham gia trước.",
      );
    }
  }, [serverId]);

  const loadChannels = useCallback(async () => {
    const { data, error } = await supabase.rpc(
      "get_visible_channels",
    );

    if (error) {
      setErrorMessage(`Không thể tải kênh: ${error.message}`);
      return;
    }

    setChannels(
      ((data ?? []) as DynamicChannel[]).filter(
        (channel) => channel.server_id === serverId,
      ),
    );
  }, [serverId]);

  const loadMembers = useCallback(async () => {
    const { data, error } = await supabase.rpc(
      "get_server_members",
      { p_server_id: serverId },
    );

    if (!error) setMembers((data ?? []) as ServerMember[]);
  }, [serverId]);

  const loadMessages = useCallback(
    async (channelId: string) => {
      const { data, error } = await supabase.rpc(
        "get_channel_messages",
        { p_channel_id: channelId, p_limit: 150 },
      );

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      const loaded = ((data ?? []) as ChannelMessage[]).reverse();
      setMessages(loaded);

      await supabase.rpc("mark_channel_read", {
        p_channel_id: channelId,
        p_message_id: loaded[loaded.length - 1]?.id ?? null,
      });

      void loadChannels();
    },
    [loadChannels],
  );

  // Đăng nhập + tải dữ liệu server.
  useEffect(() => {
    let active = true;

    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || !active) {
        router.push("/login");
        return;
      }

      setCurrentUserId(user.id);

      await Promise.all([
        loadServer(),
        loadChannels(),
        loadMembers(),
      ]);

      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [loadChannels, loadMembers, loadServer, router]);

  // Trạng thái online toàn hệ thống (do CallProvider phát).
  useEffect(() => {
    function syncPresence() {
      const presenceWindow = window as PresenceWindow;
      setOnlineUserIds(
        new Set(
          (presenceWindow.__talkGlobalPresence ?? []).map(
            (user) => user.user_id,
          ),
        ),
      );
    }

    syncPresence();
    window.addEventListener(
      "talk-global-presence-sync",
      syncPresence,
    );

    return () => {
      window.removeEventListener(
        "talk-global-presence-sync",
        syncPresence,
      );
    };
  }, []);

  useEffect(() => {
    const updateClock = () => setClock(Date.now());
    const initialTimer = window.setTimeout(updateClock, 0);
    const timer = window.setInterval(updateClock, 60_000);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, []);

  const textChannels = useMemo(
    () =>
      channels.filter(
        (channel) =>
          channel.channel_type === "text" ||
          channel.channel_type === "both",
      ),
    [channels],
  );

  const voiceChannels = useMemo(
    () =>
      channels.filter(
        (channel) => channel.channel_type === "voice",
      ),
    [channels],
  );

  const loadVoiceParticipants = useCallback(async () => {
    if (!currentUserId || voiceChannels.length === 0) {
      return;
    }

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
            channel_ids: voiceChannels.map(
              (channel) => channel.id,
            ),
          }),
        },
      );

      if (!response.ok) return;

      const result =
        (await response.json()) as VoiceParticipantsResponse;
      const incoming = result.channels ?? {};

      setVoiceParticipantsByChannel((current) => {
        const next: Record<
          string,
          VoiceParticipantSnapshot[]
        > = {};

        for (const channel of voiceChannels) {
          const fetched = incoming[channel.id] ?? [];
          const live = current[channel.id] ?? [];
          const liveByUserId = new Map(
            live.map((participant) => [
              participant.user_id,
              participant,
            ]),
          );

          next[channel.id] = fetched.map((participant) => {
            const liveParticipant = liveByUserId.get(
              participant.user_id,
            );

            return liveParticipant?.is_speaking
              ? {
                  ...participant,
                  is_speaking: true,
                  is_muted: liveParticipant.is_muted,
                }
              : participant;
          });
        }

        return next;
      });
    } catch {
      // Phòng chưa được tạo hoặc LiveKit tạm mất kết nối:
      // giữ danh sách cũ và thử lại ở lượt polling tiếp theo.
    }
  }, [currentUserId, voiceChannels]);

  useEffect(() => {
    if (!currentUserId || voiceChannels.length === 0) return;

    const initialTimer = window.setTimeout(
      () => void loadVoiceParticipants(),
      0,
    );
    const timer = window.setInterval(
      () => void loadVoiceParticipants(),
      8_000,
    );

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [
    currentUserId,
    loadVoiceParticipants,
    voiceChannels.length,
  ]);

  const handleVoiceParticipantsChange = useCallback(
    (
      channelId: string,
      participants: VoiceParticipantSnapshot[],
    ) => {
      setVoiceParticipantsByChannel((current) => ({
        ...current,
        [channelId]: participants,
      }));
    },
    [],
  );

  const selectedChannel = useMemo(
    () =>
      channels.find(
        (channel) => channel.id === selectedChannelId,
      ) ?? null,
    [channels, selectedChannelId],
  );

  // Chọn kênh mặc định (theo ?channel= hoặc kênh văn bản đầu tiên).
  useEffect(() => {
    if (loading || channels.length === 0) return;

    const stillValid = channels.some(
      (channel) => channel.id === selectedChannelIdRef.current,
    );

    if (stillValid) return;

    const requested = new URLSearchParams(
      window.location.search,
    ).get("channel");

    const requestedChannel = channels.find(
      (channel) => channel.id === requested,
    );

    const fallback =
      requestedChannel ??
      channels.find(
        (channel) => channel.channel_type !== "voice",
      ) ??
      channels[0];

    setSelectedChannelId(fallback?.id ?? null);
  }, [channels, loading]);

  // Tải tin nhắn khi đổi kênh văn bản.
  useEffect(() => {
    if (!selectedChannel) return;

    window.history.replaceState(
      null,
      "",
      `/servers/${serverId}?channel=${selectedChannel.id}`,
    );

    if (selectedChannel.channel_type === "voice") return;

    let active = true;

    void (async () => {
      setMessagesLoading(true);
      setMessages([]);
      await loadMessages(selectedChannel.id);
      if (active) setMessagesLoading(false);
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadMessages, selectedChannel?.id, serverId]);

  // Realtime cho server, kênh, thành viên và tin nhắn.
  useEffect(() => {
    if (!currentUserId) return;

    const realtime = supabase
      .channel(`server-page-${serverId}-${currentUserId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "servers",
          filter: `id=eq.${serverId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            router.push("/");
            return;
          }

          void loadServer();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "server_members",
          filter: `server_id=eq.${serverId}`,
        },
        () => {
          void loadMembers();
          void loadServer();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "channels",
          filter: `server_id=eq.${serverId}`,
        },
        () => void loadChannels(),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "channel_messages",
        },
        (payload) => {
          const changedChannelId = String(
            (payload.new as { channel_id?: string })
              .channel_id ?? "",
          );

          if (
            changedChannelId &&
            changedChannelId === selectedChannelIdRef.current
          ) {
            void loadMessages(changedChannelId);
          } else {
            void loadChannels();
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(realtime);
    };
  }, [
    currentUserId,
    loadChannels,
    loadMembers,
    loadMessages,
    loadServer,
    router,
    serverId,
  ]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages]);

  const sortedMembers = useMemo(
    () =>
      [...members].sort((first, second) => {
        const firstOnline = onlineUserIds.has(first.id);
        const secondOnline = onlineUserIds.has(second.id);
        if (firstOnline !== secondOnline) {
          return firstOnline ? -1 : 1;
        }
        return 0;
      }),
    [members, onlineUserIds],
  );

  const onlineMemberCount = useMemo(
    () =>
      members.filter((member) => onlineUserIds.has(member.id))
        .length,
    [members, onlineUserIds],
  );

  function selectChannel(channel: DynamicChannel) {
    setSelectedChannelId(channel.id);
    if (channel.channel_type === "voice") {
      setVoiceJoinRequestId((current) => current + 1);
    }
    setShowSidebar(false);
    setErrorMessage("");
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = messageInput.trim();
    if (!content || sending || !selectedChannel) return;

    setSending(true);
    setErrorMessage("");

    const { error } = await supabase.rpc(
      "send_channel_message",
      {
        p_channel_id: selectedChannel.id,
        p_content: content,
      },
    );

    if (error) setErrorMessage(error.message);
    else {
      setMessageInput("");
      await loadMessages(selectedChannel.id);
    }

    setSending(false);
  }

  async function createChannel() {
    if (working || !server) return;
    setWorking(true);
    setErrorMessage("");

    const { data, error } = await supabase.rpc(
      "create_server_channel",
      {
        p_server_id: server.id,
        p_name: newChannelName,
        p_channel_type: newChannelType,
      },
    );

    if (error) {
      setErrorMessage(error.message);
    } else {
      setShowCreateChannel(false);
      setNewChannelName("");
      setNewChannelType("text");
      await loadChannels();
      if (data) setSelectedChannelId(data as string);
    }

    setWorking(false);
  }

  async function saveChannelEdit() {
    if (working || !editChannel) return;
    setWorking(true);
    setErrorMessage("");

    const { error } = await supabase.rpc("update_channel", {
      p_channel_id: editChannel.id,
      p_name: editChannelName,
      p_description: editChannel.description,
      p_channel_type: editChannel.channel_type,
      p_visibility: editChannel.visibility,
      p_is_locked: editChannel.is_locked,
    });

    if (error) setErrorMessage(error.message);
    else {
      setEditChannel(null);
      await loadChannels();
    }

    setWorking(false);
  }

  async function deleteChannel() {
    if (working || !editChannel) return;
    if (
      !window.confirm(
        `Xóa kênh "${editChannel.name}" và toàn bộ tin nhắn trong đó?`,
      )
    ) {
      return;
    }

    setWorking(true);
    const { error } = await supabase.rpc("delete_channel", {
      p_channel_id: editChannel.id,
    });

    if (error) setErrorMessage(error.message);
    else {
      setEditChannel(null);
      await loadChannels();
    }

    setWorking(false);
  }

  async function copyInviteCode() {
    if (!server) return;

    try {
      await navigator.clipboard.writeText(server.invite_code);
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 2000);
    } catch {
      setErrorMessage(
        "Không thể tự sao chép. Hãy bôi đen mã và copy thủ công.",
      );
    }
  }

  async function regenerateInvite() {
    if (working || !server) return;
    if (
      !window.confirm(
        "Đổi mã mời mới? Mã cũ sẽ không dùng được nữa.",
      )
    ) {
      return;
    }

    setWorking(true);
    const { data, error } = await supabase.rpc(
      "regenerate_server_invite",
      { p_server_id: server.id },
    );

    if (error) setErrorMessage(error.message);
    else if (data) {
      setServer((current) =>
        current
          ? { ...current, invite_code: data as string }
          : current,
      );
    }

    setWorking(false);
  }

  function openServerSettings() {
    if (!server) return;
    setEditServerName(server.name);
    setEditServerDescription(server.description);
    setShowServerMenu(false);
    setShowServerSettings(true);
  }

  async function saveServerSettings() {
    if (working || !server) return;
    setWorking(true);
    setErrorMessage("");

    const { error } = await supabase.rpc("update_server", {
      p_server_id: server.id,
      p_name: editServerName,
      p_description: editServerDescription,
    });

    if (error) setErrorMessage(error.message);
    else {
      await loadServer();
      setShowServerSettings(false);
    }

    setWorking(false);
  }

  async function changeServerAvatar(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file || !server) return;

    if (
      !["image/jpeg", "image/png", "image/webp"].includes(
        file.type,
      )
    ) {
      setErrorMessage("Avatar chỉ hỗ trợ JPG, PNG hoặc WEBP.");
      return;
    }

    if (file.size > MAX_AVATAR_SIZE) {
      setErrorMessage("Avatar tối đa 5 MB.");
      return;
    }

    setWorking(true);
    const extension =
      file.type === "image/png"
        ? "png"
        : file.type === "image/webp"
          ? "webp"
          : "jpg";
    const path = `${currentUserId}/${server.id}/avatar-${Date.now()}.${extension}`;
    const previousAvatarPath = server.avatar_path;

    const { error: uploadError } = await supabase.storage
      .from("channel-avatars")
      .upload(path, file, {
        upsert: true,
        contentType: file.type,
      });

    if (uploadError) setErrorMessage(uploadError.message);
    else {
      const { error } = await supabase.rpc(
        "set_server_avatar",
        {
          p_server_id: server.id,
          p_avatar_path: path,
        },
      );
      if (error) setErrorMessage(error.message);
      else {
        if (
          previousAvatarPath &&
          previousAvatarPath !== path
        ) {
          const { error: removeError } =
            await supabase.storage
              .from("channel-avatars")
              .remove([previousAvatarPath]);

          if (removeError) {
            setErrorMessage(
              "Đã đổi avatar nhưng chưa dọn được ảnh cũ.",
            );
          }
        }

        await loadServer();
      }
    }

    setWorking(false);
  }

  async function removeMember(memberId: string) {
    if (working || !server) return;
    if (
      !window.confirm("Xóa thành viên này khỏi server?")
    ) {
      return;
    }

    setWorking(true);
    const { error } = await supabase.rpc(
      "remove_server_member",
      {
        p_server_id: server.id,
        p_member_id: memberId,
      },
    );

    if (error) setErrorMessage(error.message);
    else {
      await Promise.all([loadMembers(), loadServer()]);
    }

    setWorking(false);
  }

  async function toggleMemberRole(member: ServerMember) {
    if (working || !server) return;

    setWorking(true);
    const { error } = await supabase.rpc(
      "set_server_member_role",
      {
        p_server_id: server.id,
        p_member_id: member.id,
        p_role:
          member.server_role === "moderator"
            ? "member"
            : "moderator",
      },
    );

    if (error) setErrorMessage(error.message);
    else await loadMembers();

    setWorking(false);
  }

  async function leaveServer() {
    if (working || !server) return;
    if (!window.confirm("Bạn muốn rời server này?")) return;

    setWorking(true);
    const { error } = await supabase.rpc("leave_server", {
      p_server_id: server.id,
    });

    if (error) {
      setErrorMessage(error.message);
      setWorking(false);
      return;
    }

    router.push("/");
  }

  async function deleteServer() {
    if (working || !server) return;
    if (
      !window.confirm(
        `Xóa server "${server.name}" cùng toàn bộ kênh và tin nhắn?`,
      )
    ) {
      return;
    }

    setWorking(true);

    if (server.avatar_path) {
      const { error: avatarError } = await supabase.storage
        .from("channel-avatars")
        .remove([server.avatar_path]);

      if (avatarError) {
        setErrorMessage(
          `Không thể dọn avatar server: ${avatarError.message}`,
        );
        setWorking(false);
        return;
      }
    }

    const { error } = await supabase.rpc("delete_server", {
      p_server_id: server.id,
    });

    if (error) {
      setErrorMessage(error.message);
      setWorking(false);
      return;
    }

    router.push("/");
  }

  if (loading) {
    return (
      <main className="flex h-screen items-center justify-center bg-[#313338] text-white">
        Đang tải server...
      </main>
    );
  }

  if (!server) {
    return (
      <main className="flex h-screen items-center justify-center bg-[#313338] p-4 text-white">
        <section className="max-w-md rounded-3xl bg-[#2b2d31] p-7 text-center">
          <h1 className="text-2xl font-black">
            Không thể mở server
          </h1>
          <p className="mt-3 text-gray-400">
            {loadErrorMessage}
          </p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="mt-6 rounded-xl bg-indigo-500 px-5 py-3 font-bold"
          >
            Về Kênh chung
          </button>
        </section>
      </main>
    );
  }

  const serverAvatar = channelAvatarUrl(
    supabase,
    server.avatar_path,
  );
  const isOwner = server.owner_id === currentUserId;
  const isGlobalAdmin =
    members.find((member) => member.id === currentUserId)
      ?.role === "admin";
  const composerLocked =
    Boolean(selectedChannel?.is_locked) && !server.can_manage;

  return (
    <main className="grid h-screen overflow-hidden bg-[#313338] text-white md:grid-cols-[84px_260px_minmax(0,1fr)] lg:grid-cols-[84px_260px_minmax(0,1fr)_260px]">
      <ChannelRail activeServerId={server.id} />

      {/* Cột kênh của server */}
      <aside
        className={`fixed inset-0 z-30 flex min-h-0 flex-col bg-[#2b2d31] transition-transform md:static md:translate-x-0 ${
          showSidebar ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="relative shrink-0 border-b border-black/25">
          <button
            type="button"
            onClick={() => setShowServerMenu((open) => !open)}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-white/5"
          >
            {serverAvatar ? (
              <img
                src={serverAvatar}
                alt={server.name}
                className="h-9 w-9 rounded-xl object-cover"
              />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/20 font-black text-emerald-200">
                {server.name.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-black">
                {server.name}
              </span>
              <span className="block text-[11px] text-gray-400">
                {server.member_count} thành viên ·{" "}
                {onlineMemberCount} online
              </span>
            </span>
            <span className="text-xs text-gray-400">
              {showServerMenu ? "▲" : "▼"}
            </span>
          </button>

          {showServerMenu && (
            <div className="absolute inset-x-3 top-full z-40 mt-1 overflow-hidden rounded-2xl border border-white/10 bg-[#1e1f22] p-1.5 shadow-2xl">
              <button
                type="button"
                onClick={() => {
                  setShowServerMenu(false);
                  setShowInvite(true);
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-indigo-300 hover:bg-white/10"
              >
                <span>🎟️</span>
                <span>Mời bạn bè (mã mời)</span>
              </button>

              {server.can_manage && (
                <button
                  type="button"
                  onClick={openServerSettings}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-white/10"
                >
                  <span>⚙️</span>
                  <span>Cài đặt server</span>
                </button>
              )}

              {!isOwner && (
                <button
                  type="button"
                  onClick={() => {
                    setShowServerMenu(false);
                    void leaveServer();
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-yellow-300 hover:bg-yellow-500/10"
                >
                  <span>🚪</span>
                  <span>Rời server</span>
                </button>
              )}

              {isOwner && (
                <button
                  type="button"
                  onClick={() => {
                    setShowServerMenu(false);
                    void deleteServer();
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-red-300 hover:bg-red-500/10"
                >
                  <span>🗑️</span>
                  <span>Xóa server</span>
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[11px] font-black uppercase tracking-wide text-gray-400">
              Kênh văn bản
            </span>
            {server.can_manage && (
              <button
                type="button"
                onClick={() => {
                  setNewChannelType("text");
                  setNewChannelName("");
                  setShowCreateChannel(true);
                }}
                title="Tạo kênh văn bản"
                className="flex h-5 w-5 items-center justify-center rounded text-lg text-gray-400 hover:text-white"
              >
                +
              </button>
            )}
          </div>

          {textChannels.length === 0 && (
            <p className="px-2 py-1 text-xs text-gray-500">
              Chưa có kênh văn bản.
            </p>
          )}

          {textChannels.map((channel) => {
            const active = selectedChannelId === channel.id;
            const unread = Number(channel.unread_count ?? 0);

            return (
              <div
                key={channel.id}
                className={`group mb-0.5 flex items-center rounded-lg transition ${
                  active
                    ? "bg-white/10 text-white"
                    : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
                }`}
              >
                <button
                  type="button"
                  onClick={() => selectChannel(channel)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
                >
                  <span className="text-lg font-bold">#</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {channel.name}
                  </span>
                  {channel.is_locked && (
                    <span className="text-xs">🔐</span>
                  )}
                  {unread > 0 && !active && (
                    <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-black text-white">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </button>

                {server.can_manage && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditChannel(channel);
                      setEditChannelName(channel.name);
                    }}
                    title="Sửa kênh"
                    className="mr-1 hidden h-6 w-6 shrink-0 items-center justify-center rounded text-xs text-gray-400 hover:text-white group-hover:flex"
                  >
                    ⚙️
                  </button>
                )}
              </div>
            );
          })}

          <div className="mb-2 mt-5 flex items-center justify-between px-1">
            <span className="text-[11px] font-black uppercase tracking-wide text-gray-400">
              Kênh thoại
            </span>
            {server.can_manage && (
              <button
                type="button"
                onClick={() => {
                  setNewChannelType("voice");
                  setNewChannelName("");
                  setShowCreateChannel(true);
                }}
                title="Tạo kênh thoại"
                className="flex h-5 w-5 items-center justify-center rounded text-lg text-gray-400 hover:text-white"
              >
                +
              </button>
            )}
          </div>

          {voiceChannels.length === 0 && (
            <p className="px-2 py-1 text-xs text-gray-500">
              Chưa có kênh thoại.
            </p>
          )}

          {voiceChannels.map((channel) => {
            const active = selectedChannelId === channel.id;
            const voiceParticipants =
              voiceParticipantsByChannel[channel.id] ?? [];

            return (
              <div
                key={channel.id}
                className="mb-1"
              >
                <div
                  className={`group flex items-center rounded-lg transition ${
                    active
                      ? "bg-white/10 text-white"
                      : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => selectChannel(channel)}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
                  >
                    <span className="text-base">🔊</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {channel.name}
                    </span>
                    {voiceParticipants.length > 0 && (
                      <span className="rounded-full bg-green-500/15 px-1.5 py-0.5 text-[10px] font-black text-green-300">
                        {voiceParticipants.length}
                      </span>
                    )}
                  </button>

                  {server.can_manage && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditChannel(channel);
                        setEditChannelName(channel.name);
                      }}
                      title="Sửa kênh"
                      className="mr-1 hidden h-6 w-6 shrink-0 items-center justify-center rounded text-xs text-gray-400 hover:text-white group-hover:flex"
                    >
                      ⚙️
                    </button>
                  )}
                </div>

                {voiceParticipants.length > 0 && (
                  <div className="ml-5">
                    {voiceParticipants.map(
                      (participant, index) => (
                        <div
                          key={participant.user_id}
                          className="relative ml-3 flex min-h-10 items-center gap-2 py-1 text-gray-300"
                        >
                          <span
                            aria-hidden="true"
                            className={`absolute -left-3 top-0 w-2.5 border-l border-gray-600 ${
                              index ===
                              voiceParticipants.length - 1
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

                            <span
                              title={
                                participant.is_speaking
                                  ? "Đang nói"
                                  : "Đang trong phòng"
                              }
                              className={`absolute -bottom-0.5 -left-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#2b2d31] ${
                                participant.is_speaking
                                  ? "bg-green-400"
                                  : "bg-gray-300"
                              }`}
                            />
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
            );
          })}
        </div>

        <div className="shrink-0 border-t border-black/25 p-3 md:hidden">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm font-bold"
          >
            ← Về Kênh chung
          </button>
        </div>
      </aside>

      {/* Nội dung kênh đang chọn */}
      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <header className="flex h-[64px] shrink-0 items-center gap-3 border-b border-black/20 px-4 shadow">
          <button
            type="button"
            onClick={() => setShowSidebar(true)}
            className="rounded p-2 text-xl text-gray-300 md:hidden"
            aria-label="Mở danh sách kênh"
          >
            ☰
          </button>

          {selectedChannel ? (
            <>
              <span className="text-2xl font-black text-gray-400">
                {selectedChannel.channel_type === "voice"
                  ? "🔊"
                  : "#"}
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="truncate font-black">
                  {selectedChannel.name}
                </h1>
                <p className="truncate text-xs text-gray-400">
                  {server.name}
                </p>
              </div>
            </>
          ) : (
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-black">
                {server.name}
              </h1>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowInvite(true)}
            className="flex h-9 items-center gap-2 rounded-xl bg-indigo-500/20 px-3 text-sm font-bold text-indigo-200 transition hover:bg-indigo-500/30"
            title="Mời bạn bè vào server"
          >
            🎟️ <span className="hidden sm:inline">Mời</span>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
          {errorMessage && (
            <p className="mb-4 rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-300">
              {errorMessage}
            </p>
          )}

          {!selectedChannel ? (
            <div className="flex h-full items-center justify-center text-center text-gray-400">
              <div>
                <div className="text-5xl">📂</div>
                <p className="mt-3">
                  Server chưa có kênh nào.
                  {server.can_manage
                    ? " Hãy bấm + ở cột bên trái để tạo kênh."
                    : ""}
                </p>
              </div>
            </div>
          ) : selectedChannel.channel_type === "voice" ? (
            <ChannelVoiceRoom
              key={selectedChannel.id}
              channelId={selectedChannel.id}
              channelName={selectedChannel.name}
              voiceOnly
              joinRequestId={voiceJoinRequestId}
              onParticipantsChange={
                handleVoiceParticipantsChange
              }
            />
          ) : messagesLoading ? (
            <p className="text-sm text-gray-400">
              Đang tải tin nhắn...
            </p>
          ) : messages.length === 0 ? (
            <div className="flex min-h-[50vh] items-center justify-center text-center">
              <div>
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-indigo-500/15 text-3xl">
                  #
                </div>
                <h2 className="mt-4 text-2xl font-black">
                  Bắt đầu kênh {selectedChannel.name}
                </h2>
                <p className="mt-2 text-gray-400">
                  Đây là khởi đầu của kênh này trong server{" "}
                  {server.name}.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {messages.map((message) => (
                <article
                  key={message.id}
                  className="flex gap-3 rounded-xl px-2 py-2.5 hover:bg-black/10"
                >
                  {message.sender_avatar_url ? (
                    <img
                      src={message.sender_avatar_url}
                      alt={message.sender_username}
                      className="h-10 w-10 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-500 font-bold">
                      {message.sender_username
                        .charAt(0)
                        .toUpperCase()}
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <MemberBadge role={message.sender_role} />
                      <strong>{message.sender_username}</strong>
                      <span className="text-[11px] text-gray-500">
                        {formatPublicId(
                          message.sender_public_id,
                        )}
                      </span>
                      <time className="text-[11px] text-gray-500">
                        {new Date(
                          message.created_at,
                        ).toLocaleString("vi-VN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          day: "2-digit",
                          month: "2-digit",
                        })}
                      </time>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-gray-100">
                      {message.content}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {selectedChannel &&
          selectedChannel.channel_type !== "voice" && (
            <form
              onSubmit={sendMessage}
              className="shrink-0 border-t border-black/20 p-3 md:p-4"
            >
              <div className="flex items-center gap-2 rounded-2xl bg-[#383a40] px-3">
                <input
                  value={messageInput}
                  onChange={(event) =>
                    setMessageInput(event.target.value)
                  }
                  disabled={sending || composerLocked}
                  maxLength={4000}
                  placeholder={
                    composerLocked
                      ? "Kênh đang khóa gửi tin"
                      : `Nhắn tin trong #${selectedChannel.name}`
                  }
                  className="min-w-0 flex-1 bg-transparent py-4 outline-none placeholder:text-gray-500"
                />
                <button
                  type="submit"
                  disabled={
                    sending ||
                    !messageInput.trim() ||
                    composerLocked
                  }
                  className="rounded-xl bg-indigo-500 px-4 py-2 font-black disabled:opacity-40"
                >
                  {sending ? "..." : "Gửi"}
                </button>
              </div>
            </form>
          )}
      </section>

      {/* Danh sách thành viên server */}
      <aside className="hidden min-h-0 overflow-y-auto bg-[#2b2d31] p-4 lg:block">
        <h2 className="text-xs font-black uppercase text-gray-400">
          Thành viên — {members.length}
        </h2>
        {sortedMembers.map((member) => (
          <div
            key={member.id}
            className={`mt-2 flex items-center gap-3 rounded-xl p-2 ${
              onlineUserIds.has(member.id)
                ? "text-gray-200"
                : "text-gray-500 opacity-60"
            }`}
          >
            <span className="relative shrink-0">
              {member.avatar_url ? (
                <img
                  src={member.avatar_url}
                  alt={member.username}
                  className="h-9 w-9 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500 font-bold">
                  {member.username.charAt(0).toUpperCase()}
                </span>
              )}
              <span
                className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#2b2d31] ${
                  onlineUserIds.has(member.id)
                    ? "bg-green-500"
                    : "bg-gray-600"
                }`}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <MemberBadge role={member.role} />
                <span className="truncate text-sm font-semibold">
                  {member.username}
                </span>
              </span>
              <span className="block text-[10px] text-gray-500">
                {formatPublicId(member.public_id)}
                {member.server_role === "owner"
                  ? " · 👑 Chủ server"
                  : member.server_role === "moderator"
                    ? " · 🛡️ Quản lý"
                    : ""}
              </span>
              <span className="block truncate text-[10px] text-gray-500">
                {onlineUserIds.has(member.id)
                  ? "Đang online"
                  : `Offline (${formatLastActive(
                      member.last_seen_at,
                      clock,
                    )})`}
              </span>
            </span>
          </div>
        ))}
      </aside>

      {/* Modal mã mời */}
      {showInvite && (
        <div
          className="fixed inset-0 z-[230] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowInvite(false);
            }
          }}
        >
          <section className="w-full max-w-md rounded-3xl bg-[#2b2d31] p-6 text-white shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black">
                Mời vào {server.name}
              </h2>
              <button
                type="button"
                onClick={() => setShowInvite(false)}
                aria-label="Đóng"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xl"
              >
                ×
              </button>
            </div>

            <p className="mt-3 text-sm text-gray-400">
              Gửi mã này cho bạn bè. Họ bấm nút <strong>+</strong>{" "}
              ở cột trái, chọn <strong>Nhập mã mời</strong> và dán
              mã vào.
            </p>

            <div className="mt-5 flex items-center gap-2 rounded-2xl bg-[#1e1f22] p-3">
              <code className="min-w-0 flex-1 overflow-x-auto select-all text-center font-mono text-lg font-black tracking-[0.16em] text-emerald-300 sm:text-2xl sm:tracking-[0.22em]">
                {server.invite_code}
              </code>
              <button
                type="button"
                onClick={() => void copyInviteCode()}
                className="shrink-0 rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-black"
              >
                {inviteCopied ? "Đã chép ✓" : "Chép mã"}
              </button>
            </div>

            {server.can_manage && (
              <button
                type="button"
                onClick={() => void regenerateInvite()}
                disabled={working}
                className="mt-4 w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm font-bold text-gray-300 hover:bg-white/15 disabled:opacity-50"
              >
                🔄 Đổi mã mời mới (vô hiệu mã cũ)
              </button>
            )}
          </section>
        </div>
      )}

      {/* Modal tạo kênh */}
      {showCreateChannel && (
        <div
          className="fixed inset-0 z-[230] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowCreateChannel(false);
            }
          }}
        >
          <section className="w-full max-w-md rounded-3xl bg-[#2b2d31] p-6 text-white shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black">
                Tạo kênh trong {server.name}
              </h2>
              <button
                type="button"
                onClick={() => setShowCreateChannel(false)}
                aria-label="Đóng"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xl"
              >
                ×
              </button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setNewChannelType("text")}
                className={`rounded-xl border px-3 py-3 text-sm font-bold ${
                  newChannelType === "text"
                    ? "border-indigo-400 bg-indigo-500/20"
                    : "border-white/10 bg-[#1e1f22]"
                }`}
              >
                # Kênh văn bản
              </button>
              <button
                type="button"
                onClick={() => setNewChannelType("voice")}
                className={`rounded-xl border px-3 py-3 text-sm font-bold ${
                  newChannelType === "voice"
                    ? "border-indigo-400 bg-indigo-500/20"
                    : "border-white/10 bg-[#1e1f22]"
                }`}
              >
                🔊 Kênh thoại
              </button>
            </div>

            <input
              value={newChannelName}
              onChange={(event) =>
                setNewChannelName(event.target.value)
              }
              maxLength={40}
              placeholder={
                newChannelType === "voice"
                  ? "Tên kênh thoại, ví dụ: Phòng game"
                  : "Tên kênh, ví dụ: thông báo"
              }
              className="mt-4 w-full rounded-xl bg-[#1e1f22] px-4 py-3 outline-none ring-indigo-500 focus:ring-2"
            />

            <button
              type="button"
              onClick={() => void createChannel()}
              disabled={
                working || newChannelName.trim().length < 2
              }
              className="mt-5 w-full rounded-xl bg-indigo-500 px-6 py-3 font-black disabled:opacity-50"
            >
              {working ? "Đang tạo..." : "Tạo kênh"}
            </button>
          </section>
        </div>
      )}

      {/* Modal sửa / xóa kênh */}
      {editChannel && (
        <div
          className="fixed inset-0 z-[230] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setEditChannel(null);
            }
          }}
        >
          <section className="w-full max-w-md rounded-3xl bg-[#2b2d31] p-6 text-white shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black">
                {editChannel.channel_type === "voice"
                  ? "🔊"
                  : "#"}{" "}
                {editChannel.name}
              </h2>
              <button
                type="button"
                onClick={() => setEditChannel(null)}
                aria-label="Đóng"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xl"
              >
                ×
              </button>
            </div>

            <input
              value={editChannelName}
              onChange={(event) =>
                setEditChannelName(event.target.value)
              }
              maxLength={40}
              placeholder="Tên kênh"
              className="mt-5 w-full rounded-xl bg-[#1e1f22] px-4 py-3 outline-none ring-indigo-500 focus:ring-2"
            />

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => void deleteChannel()}
                disabled={working}
                className="rounded-xl bg-red-500/15 px-4 py-3 font-bold text-red-300 hover:bg-red-500/25 disabled:opacity-50"
              >
                Xóa kênh
              </button>
              <button
                type="button"
                onClick={() => void saveChannelEdit()}
                disabled={
                  working ||
                  editChannelName.trim().length < 2
                }
                className="flex-1 rounded-xl bg-indigo-500 px-4 py-3 font-black disabled:opacity-50"
              >
                {working ? "Đang lưu..." : "Lưu tên kênh"}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Modal cài đặt server */}
      {showServerSettings && (
        <div
          className="fixed inset-0 z-[230] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowServerSettings(false);
            }
          }}
        >
          <section className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-[#2b2d31] p-6 text-white shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-black">
                  Cài đặt server
                </h2>
                <p className="text-sm text-gray-400">
                  Avatar, thông tin và thành viên
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowServerSettings(false)}
                aria-label="Đóng"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="mt-6 grid gap-6 md:grid-cols-[140px_minmax(0,1fr)]">
              <div className="text-center">
                <button
                  type="button"
                  onClick={() =>
                    avatarInputRef.current?.click()
                  }
                  className="mx-auto flex h-28 w-28 items-center justify-center overflow-hidden rounded-3xl bg-[#1e1f22]"
                >
                  {serverAvatar ? (
                    <img
                      src={serverAvatar}
                      alt={server.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-4xl font-black">
                      {server.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                </button>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={changeServerAvatar}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() =>
                    avatarInputRef.current?.click()
                  }
                  className="mt-3 text-sm font-bold text-indigo-300"
                >
                  Đổi avatar
                </button>
              </div>

              <div className="space-y-3">
                <input
                  value={editServerName}
                  onChange={(event) =>
                    setEditServerName(event.target.value)
                  }
                  maxLength={40}
                  className="w-full rounded-xl bg-[#1e1f22] px-4 py-3"
                />
                <textarea
                  value={editServerDescription}
                  onChange={(event) =>
                    setEditServerDescription(event.target.value)
                  }
                  maxLength={300}
                  rows={3}
                  placeholder="Mô tả server"
                  className="w-full resize-none rounded-xl bg-[#1e1f22] px-4 py-3"
                />
                <button
                  type="button"
                  onClick={() => void saveServerSettings()}
                  disabled={
                    working ||
                    editServerName.trim().length < 2
                  }
                  className="w-full rounded-xl bg-indigo-500 px-4 py-3 font-black disabled:opacity-50"
                >
                  {working ? "Đang lưu..." : "Lưu cài đặt"}
                </button>
              </div>
            </div>

            <div className="mt-8">
              <h3 className="font-black">
                Thành viên — {members.length}
              </h3>
              <div className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-2xl bg-[#1e1f22] p-2">
                {members.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center gap-3 rounded-xl p-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <MemberBadge role={member.role} />
                        <span className="truncate text-sm font-semibold">
                          {member.username}
                        </span>
                      </div>
                      <p className="truncate text-[10px] text-gray-500">
                        {formatPublicId(member.public_id)}
                        {" · "}
                        {member.server_role === "owner"
                          ? "👑 Chủ server"
                          : member.server_role === "moderator"
                            ? "🛡️ Quản lý"
                            : "Thành viên"}
                      </p>
                      <p className="truncate text-[10px] text-gray-500">
                        {onlineUserIds.has(member.id)
                          ? "Đang online"
                          : `Offline (${formatLastActive(
                              member.last_seen_at,
                              clock,
                            )})`}
                      </p>
                    </div>

                    {member.server_role !== "owner" &&
                      (isOwner || isGlobalAdmin) && (
                        <button
                          type="button"
                          onClick={() =>
                            void toggleMemberRole(member)
                          }
                          disabled={working}
                          className="rounded-lg bg-white/10 px-2 py-1 text-xs font-bold hover:bg-white/15 disabled:opacity-50"
                        >
                          {member.server_role === "moderator"
                            ? "Bỏ quản lý"
                            : "Cho làm quản lý"}
                        </button>
                      )}

                    {member.server_role !== "owner" &&
                      member.id !== currentUserId &&
                      (isOwner ||
                        isGlobalAdmin ||
                        member.server_role === "member") && (
                        <button
                          type="button"
                          onClick={() =>
                            void removeMember(member.id)
                          }
                          disabled={working}
                          className="rounded-lg bg-red-500/15 px-2 py-1 text-xs text-red-300 hover:bg-red-500/25 disabled:opacity-50"
                        >
                          Xóa
                        </button>
                      )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
