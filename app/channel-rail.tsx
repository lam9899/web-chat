"use client";

import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import {
  type ChannelInvite,
  type DynamicChannel,
  type ServerInvitePreview,
  type ServerSummary,
  channelAvatarUrl,
  channelTypeLabel,
} from "./channel-types";

const supabase = createClient();
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

type OnlineUser = { user_id: string };
type PresenceWindow = Window &
  typeof globalThis & {
    __talkGlobalPresence?: OnlineUser[];
  };

type FriendRow = {
  id: string;
  username: string;
  avatar_url: string | null;
  public_id: number;
  role: "admin" | "moderator" | "member";
};

export default function ChannelRail({
  activeChannelId = null,
  activeServerId = null,
}: {
  activeChannelId?: string | null;
  activeServerId?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [channels, setChannels] = useState<DynamicChannel[]>([]);
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [invites, setInvites] = useState<ChannelInvite[]>([]);
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(
    new Set(),
  );
  const [currentUserId, setCurrentUserId] = useState("");
  const [currentRole, setCurrentRole] =
    useState<"admin" | "moderator" | "member">("member");

  const [showCreate, setShowCreate] = useState(false);
  const [showInvites, setShowInvites] = useState(false);
  const [showMobileRail, setShowMobileRail] =
    useState(false);
  const [working, setWorking] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [showAddMenu, setShowAddMenu] = useState(false);
  const [addTab, setAddTab] = useState<"server" | "join">("server");
  const [serverName, setServerName] = useState("");
  const [serverDescription, setServerDescription] = useState("");
  const [serverAvatarFile, setServerAvatarFile] =
    useState<File | null>(null);
  const [serverAvatarPreview, setServerAvatarPreview] = useState("");
  const serverAvatarInputRef = useRef<HTMLInputElement | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joinPreview, setJoinPreview] =
    useState<ServerInvitePreview | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [channelType, setChannelType] =
    useState<"text" | "voice" | "both">("text");
  const [visibility, setVisibility] =
    useState<"public" | "private">("private");
  const [selectedFriendIds, setSelectedFriendIds] =
    useState<Set<string>>(new Set());
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const canCreatePublic =
    currentRole === "admin" || currentRole === "moderator";

  const loadChannels = useCallback(async () => {
    const { data, error } = await supabase.rpc(
      "get_visible_channels",
    );

    if (error) {
      setErrorMessage(`Không thể tải kênh: ${error.message}`);
      return;
    }

    setChannels((data ?? []) as DynamicChannel[]);
  }, []);

  const loadInvites = useCallback(async () => {
    const { data } = await supabase.rpc("get_channel_invites");
    setInvites((data ?? []) as ChannelInvite[]);
  }, []);

  const loadServers = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_my_servers");

    // Nếu chưa chạy migration 21_servers.sql thì bỏ qua phần server.
    if (error) return;
    setServers((data ?? []) as ServerSummary[]);
  }, []);

  useEffect(() => {
    let active = true;

    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || !active) return;
      setCurrentUserId(user.id);

      const [{ data: roleRow }, { data: friendRows }] =
        await Promise.all([
          supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", user.id)
            .maybeSingle(),
          supabase.rpc("get_my_friends"),
        ]);

      if (!active) return;

      setCurrentRole(
        (roleRow?.role as
          | "admin"
          | "moderator"
          | "member") ?? "member",
      );
      setFriends((friendRows ?? []) as FriendRow[]);

      await Promise.all([
        loadChannels(),
        loadInvites(),
        loadServers(),
      ]);
    })();

    return () => {
      active = false;
    };
  }, [loadChannels, loadInvites, loadServers]);

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
    if (!currentUserId) return;

    const realtime = supabase
      .channel(`dynamic-rail-${currentUserId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "channels" },
        () => void loadChannels(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "channel_members",
        },
        () => void loadChannels(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "channel_invites",
        },
        () => {
          void loadChannels();
          void loadInvites();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "channel_messages",
        },
        () => void loadChannels(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "channel_read_states",
        },
        () => void loadChannels(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "servers" },
        () => void loadServers(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "server_members",
        },
        () => {
          void loadServers();
          void loadChannels();
        },
      )
      .subscribe();

    const timer = window.setInterval(() => {
      void loadChannels();
      void loadServers();
    }, 30_000);

    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(realtime);
    };
  }, [currentUserId, loadChannels, loadInvites, loadServers]);

  useEffect(() => {
    return () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    };
  }, [avatarPreview]);

  useEffect(() => {
    return () => {
      if (serverAvatarPreview)
        URL.revokeObjectURL(serverAvatarPreview);
    };
  }, [serverAvatarPreview]);

  const onlineCounts = useMemo(() => {
    const result = new Map<string, number>();

    for (const channel of channels) {
      result.set(
        channel.id,
        channel.visibility === "public"
          ? onlineUserIds.size
          : channel.member_ids.filter((id) =>
              onlineUserIds.has(id),
            ).length,
      );
    }

    return result;
  }, [channels, onlineUserIds]);

  const standaloneChannels = useMemo(
    () => channels.filter((channel) => !channel.server_id),
    [channels],
  );

  const serverUnreadCounts = useMemo(() => {
    const result = new Map<string, number>();

    for (const channel of channels) {
      if (!channel.server_id) continue;
      result.set(
        channel.server_id,
        (result.get(channel.server_id) ?? 0) +
          Number(channel.unread_count ?? 0),
      );
    }

    return result;
  }, [channels]);

  const serverOnlineCounts = useMemo(() => {
    const result = new Map<string, number>();

    for (const server of servers) {
      result.set(
        server.id,
        server.member_ids.filter((id) => onlineUserIds.has(id))
          .length,
      );
    }

    return result;
  }, [servers, onlineUserIds]);

  function resetServerForm() {
    setServerName("");
    setServerDescription("");
    setServerAvatarFile(null);
    if (serverAvatarPreview)
      URL.revokeObjectURL(serverAvatarPreview);
    setServerAvatarPreview("");
    setJoinCode("");
    setJoinPreview(null);
    setAddTab("server");
    setErrorMessage("");
  }

  function chooseServerAvatar(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;

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

    if (serverAvatarPreview)
      URL.revokeObjectURL(serverAvatarPreview);
    setServerAvatarFile(file);
    setServerAvatarPreview(URL.createObjectURL(file));
    setErrorMessage("");
  }

  async function createServer() {
    if (working) return;
    setWorking(true);
    setErrorMessage("");

    try {
      const { data, error } = await supabase.rpc(
        "create_server",
        {
          p_name: serverName,
          p_description: serverDescription,
        },
      );

      if (error) throw new Error(error.message);

      const serverId = data as string;

      if (serverAvatarFile) {
        const extension =
          serverAvatarFile.type === "image/png"
            ? "png"
            : serverAvatarFile.type === "image/webp"
              ? "webp"
              : "jpg";
        const path = `${currentUserId}/${serverId}/avatar-${Date.now()}.${extension}`;

        const { error: uploadError } = await supabase.storage
          .from("channel-avatars")
          .upload(path, serverAvatarFile, {
            upsert: true,
            contentType: serverAvatarFile.type,
            cacheControl: "3600",
          });

        if (uploadError) {
          await supabase.rpc("delete_server", {
            p_server_id: serverId,
          });
          throw new Error(uploadError.message);
        }

        const { error: avatarError } = await supabase.rpc(
          "set_server_avatar",
          {
            p_server_id: serverId,
            p_avatar_path: path,
          },
        );

        if (avatarError) {
          await supabase.storage
            .from("channel-avatars")
            .remove([path]);
          await supabase.rpc("delete_server", {
            p_server_id: serverId,
          });
          throw new Error(avatarError.message);
        }
      }

      setShowAddMenu(false);
      resetServerForm();
      await loadServers();
      setShowMobileRail(false);
      router.push(`/servers/${serverId}`);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Không thể tạo server.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function checkJoinCode() {
    if (working) return;
    const code = joinCode.trim();
    if (!code) return;

    setWorking(true);
    setErrorMessage("");
    setJoinPreview(null);

    const { data, error } = await supabase.rpc(
      "preview_server_invite",
      { p_code: code },
    );

    if (error) {
      setErrorMessage(error.message);
    } else if (!data?.[0]) {
      setErrorMessage("Mã mời không đúng hoặc đã bị đổi.");
    } else {
      setJoinPreview(data[0] as ServerInvitePreview);
    }

    setWorking(false);
  }

  async function joinServer() {
    if (working) return;
    setWorking(true);
    setErrorMessage("");

    const { data, error } = await supabase.rpc(
      "join_server_with_code",
      { p_code: joinCode.trim() },
    );

    if (error) {
      setErrorMessage(error.message);
      setWorking(false);
      return;
    }

    setShowAddMenu(false);
    resetServerForm();
    await loadServers();
    setWorking(false);
    setShowMobileRail(false);
    router.push(`/servers/${data as string}`);
  }

  function resetForm() {
    setName("");
    setDescription("");
    setChannelType("text");
    setVisibility("private");
    setSelectedFriendIds(new Set());
    setAvatarFile(null);
    setAvatarPreview("");
    setErrorMessage("");
  }

  function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;

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

    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    setErrorMessage("");
  }

  function toggleFriend(friendId: string) {
    setSelectedFriendIds((current) => {
      const next = new Set(current);
      if (next.has(friendId)) next.delete(friendId);
      else if (next.size < 24) next.add(friendId);
      return next;
    });
  }

  async function uploadAvatar(channelId: string, file: File) {
    const extension =
      file.type === "image/png"
        ? "png"
        : file.type === "image/webp"
          ? "webp"
          : "jpg";
    const path = `${currentUserId}/${channelId}/avatar-${Date.now()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("channel-avatars")
      .upload(path, file, {
        upsert: true,
        contentType: file.type,
        cacheControl: "3600",
      });

    if (uploadError) throw new Error(uploadError.message);

    const { error } = await supabase.rpc("set_channel_avatar", {
      p_channel_id: channelId,
      p_avatar_path: path,
    });

    if (error) throw new Error(error.message);
  }

  async function createChannel() {
    if (working) return;
    setWorking(true);
    setErrorMessage("");

    try {
      const { data, error } = await supabase.rpc(
        "create_channel",
        {
          p_name: name,
          p_description: description,
          p_channel_type: channelType,
          p_visibility: canCreatePublic
            ? visibility
            : "private",
          p_invited_user_ids: Array.from(selectedFriendIds),
        },
      );

      if (error) throw new Error(error.message);

      const channelId = data as string;
      if (avatarFile) await uploadAvatar(channelId, avatarFile);

      setShowCreate(false);
      resetForm();
      await loadChannels();
      router.push(`/channels/${channelId}`);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Không thể tạo kênh.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function respondInvite(
    inviteId: number,
    response: "accepted" | "declined",
  ) {
    if (working) return;
    setWorking(true);
    setErrorMessage("");

    const { data, error } = await supabase.rpc(
      "respond_channel_invite",
      { p_invite_id: inviteId, p_response: response },
    );

    if (error) setErrorMessage(error.message);
    else {
      await Promise.all([loadChannels(), loadInvites()]);
      if (response === "accepted" && data) {
        setShowInvites(false);
        router.push(`/channels/${data as string}`);
      }
    }

    setWorking(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowMobileRail(true)}
        title="Mở danh sách server và kênh"
        aria-label="Mở danh sách server và kênh"
        className="fixed bottom-4 left-4 z-[200] flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-[#1e1f22] text-xl font-black text-white shadow-2xl md:hidden"
      >
        ☰
      </button>

      {showMobileRail && (
        <button
          type="button"
          aria-label="Đóng danh sách server và kênh"
          onClick={() => setShowMobileRail(false)}
          className="fixed inset-0 z-[205] bg-black/65 backdrop-blur-sm md:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-[210] flex h-screen w-[84px] shrink-0 flex-col items-center gap-3 overflow-y-auto border-r border-black/20 bg-[#1e1f22] px-2 py-3 shadow-2xl transition-transform md:static md:z-auto md:translate-x-0 md:shadow-none ${
          showMobileRail
            ? "translate-x-0"
            : "-translate-x-full"
        }`}
      >
        <button
          type="button"
          onClick={() => {
            setShowMobileRail(false);
            router.push("/");
          }}
          title="Kênh chung"
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-xl font-black transition ${
            pathname === "/"
              ? "bg-indigo-500"
              : "bg-[#313338] hover:bg-indigo-500"
          }`}
        >
          T
        </button>

        <div className="h-px w-9 shrink-0 bg-white/10" />

        {servers.map((server) => {
          const avatar = channelAvatarUrl(
            supabase,
            server.avatar_path,
          );
          const online =
            serverOnlineCounts.get(server.id) ?? 0;
          const unread =
            serverUnreadCounts.get(server.id) ?? 0;

          return (
            <button
              key={server.id}
              type="button"
              onClick={() => {
                setShowMobileRail(false);
                router.push(`/servers/${server.id}`);
              }}
              title={`${server.name} · Server`}
              className={`relative flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl border-2 transition hover:rounded-xl ${
                activeServerId === server.id
                  ? "border-indigo-400 bg-indigo-500/20"
                  : "border-transparent bg-[#313338]"
              }`}
            >
              {avatar ? (
                <img
                  src={avatar}
                  alt={server.name}
                  className="h-11 w-11 rounded-[inherit] object-cover"
                />
              ) : (
                <span className="flex h-11 w-11 items-center justify-center rounded-[inherit] bg-emerald-500/20 font-black text-emerald-200">
                  {server.name.charAt(0).toUpperCase()}
                </span>
              )}

              {online > 0 && (
                <span className="absolute -bottom-1 -left-1 flex min-h-5 min-w-5 items-center justify-center rounded-full border-2 border-[#1e1f22] bg-green-500 px-1 text-[9px] font-black">
                  {online > 99 ? "99+" : online}
                </span>
              )}

              {unread > 0 && (
                <span className="absolute -bottom-1 -right-1 flex min-h-5 min-w-5 items-center justify-center rounded-full border-2 border-[#1e1f22] bg-red-500 px-1 text-[9px] font-black">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </button>
          );
        })}

        {servers.length > 0 && (
          <div className="h-px w-9 shrink-0 bg-white/10" />
        )}

        {standaloneChannels.map((channel) => {
          const avatar = channelAvatarUrl(
            supabase,
            channel.avatar_path,
          );
          const online = onlineCounts.get(channel.id) ?? 0;
          const unread = Number(channel.unread_count ?? 0);

          return (
            <button
              key={channel.id}
              type="button"
              onClick={() => {
                setShowMobileRail(false);
                router.push(`/channels/${channel.id}`);
              }}
              title={`${channel.name} · ${channelTypeLabel(
                channel.channel_type,
              )}`}
              className={`relative flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border-2 transition hover:rounded-2xl ${
                activeChannelId === channel.id
                  ? "border-indigo-400 bg-indigo-500/20"
                  : "border-transparent bg-[#313338]"
              }`}
            >
              {avatar ? (
                <img
                  src={avatar}
                  alt={channel.name}
                  className="h-11 w-11 rounded-[inherit] object-cover"
                />
              ) : (
                <span className="flex h-11 w-11 items-center justify-center rounded-[inherit] bg-indigo-500/20 font-black text-indigo-200">
                  {channel.channel_type === "voice"
                    ? "🔊"
                    : channel.name.charAt(0).toUpperCase()}
                </span>
              )}

              {channel.visibility === "private" && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#2b2d31] text-[9px]">
                  🔒
                </span>
              )}

              {online > 0 && (
                <span className="absolute -bottom-1 -left-1 flex min-h-5 min-w-5 items-center justify-center rounded-full border-2 border-[#1e1f22] bg-green-500 px-1 text-[9px] font-black">
                  {online > 99 ? "99+" : online}
                </span>
              )}

              {unread > 0 && (
                <span className="absolute -bottom-1 -right-1 flex min-h-5 min-w-5 items-center justify-center rounded-full border-2 border-[#1e1f22] bg-red-500 px-1 text-[9px] font-black">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => {
            setShowMobileRail(false);
            resetServerForm();
            setShowAddMenu(true);
          }}
          title="Tạo hoặc tham gia server"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#313338] text-3xl text-green-400 transition hover:rounded-2xl hover:bg-green-600 hover:text-white"
        >
          +
        </button>

        <button
          type="button"
          onClick={() => {
            setShowMobileRail(false);
            setShowInvites(true);
          }}
          title="Lời mời vào kênh"
          className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#313338] text-xl hover:bg-indigo-500"
        >
          🔔
          {invites.length > 0 && (
            <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1.5 text-[9px] font-black">
              {invites.length > 99 ? "99+" : invites.length}
            </span>
          )}
        </button>
      </aside>

      {showAddMenu && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <section className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-[#2b2d31] p-6 text-white shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black">
                  {addTab === "server"
                    ? "Tạo server mới"
                    : "Tham gia server"}
                </h2>
                <p className="mt-1 text-sm text-gray-400">
                  Server có kênh văn bản và kênh thoại riêng.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowAddMenu(false);
                  resetServerForm();
                }}
                aria-label="Đóng"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl bg-[#1e1f22] p-1.5">
              <button
                type="button"
                onClick={() => {
                  setAddTab("server");
                  setErrorMessage("");
                }}
                className={`rounded-xl px-3 py-2.5 text-sm font-black transition ${
                  addTab === "server"
                    ? "bg-indigo-500"
                    : "hover:bg-white/5"
                }`}
              >
                🏠 Tạo server
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddTab("join");
                  setErrorMessage("");
                }}
                className={`rounded-xl px-3 py-2.5 text-sm font-black transition ${
                  addTab === "join"
                    ? "bg-indigo-500"
                    : "hover:bg-white/5"
                }`}
              >
                🎟️ Nhập mã mời
              </button>
            </div>

            {errorMessage && (
              <p className="mt-4 rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-300">
                {errorMessage}
              </p>
            )}

            {addTab === "server" ? (
              <div className="mt-5 space-y-4">
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() =>
                      serverAvatarInputRef.current?.click()
                    }
                    className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed border-white/15 bg-[#1e1f22] text-[11px] text-gray-400"
                  >
                    {serverAvatarPreview ? (
                      <img
                        src={serverAvatarPreview}
                        alt="Avatar server"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      "Avatar"
                    )}
                  </button>
                  <input
                    ref={serverAvatarInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={chooseServerAvatar}
                    className="hidden"
                  />
                  <div className="min-w-0 flex-1 space-y-3">
                    <input
                      value={serverName}
                      onChange={(event) =>
                        setServerName(event.target.value)
                      }
                      maxLength={40}
                      placeholder="Tên server"
                      className="w-full rounded-xl bg-[#1e1f22] px-4 py-3 outline-none ring-indigo-500 focus:ring-2"
                    />
                    <textarea
                      value={serverDescription}
                      onChange={(event) =>
                        setServerDescription(event.target.value)
                      }
                      maxLength={300}
                      rows={2}
                      placeholder="Mô tả (không bắt buộc)"
                      className="w-full resize-none rounded-xl bg-[#1e1f22] px-4 py-3 outline-none ring-indigo-500 focus:ring-2"
                    />
                  </div>
                </div>

                <p className="rounded-xl bg-[#1e1f22] px-4 py-3 text-xs text-gray-400">
                  Server mới có sẵn kênh văn bản <strong>#chung</strong> và kênh thoại{" "}
                  <strong>🔊 Phòng thoại</strong>. Bạn có thể thêm kênh sau.
                </p>

                <button
                  type="button"
                  onClick={() => void createServer()}
                  disabled={
                    working || serverName.trim().length < 2
                  }
                  className="w-full rounded-xl bg-indigo-500 px-6 py-3.5 font-black disabled:opacity-50"
                >
                  {working ? "Đang tạo..." : "Tạo server"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowAddMenu(false);
                    resetForm();
                    setShowCreate(true);
                  }}
                  className="w-full rounded-xl px-4 py-2 text-xs font-semibold text-gray-400 hover:bg-white/5 hover:text-gray-200"
                >
                  Hoặc tạo kênh đơn lẻ kiểu cũ →
                </button>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                <div className="flex gap-2">
                  <input
                    value={joinCode}
                    onChange={(event) => {
                      setJoinCode(
                        event.target.value.toUpperCase(),
                      );
                      setJoinPreview(null);
                    }}
                    maxLength={12}
                    placeholder="Nhập mã mời, ví dụ: 7A3F9B2C4D6E"
                    className="min-w-0 flex-1 rounded-xl bg-[#1e1f22] px-4 py-3 font-mono text-lg tracking-widest outline-none ring-indigo-500 focus:ring-2"
                  />
                  <button
                    type="button"
                    onClick={() => void checkJoinCode()}
                    disabled={working || !joinCode.trim()}
                    className="shrink-0 rounded-xl bg-white/10 px-4 py-3 font-bold hover:bg-white/15 disabled:opacity-50"
                  >
                    Kiểm tra
                  </button>
                </div>

                {joinPreview && (
                  <div className="flex items-center gap-4 rounded-2xl bg-[#1e1f22] p-4">
                    {joinPreview.avatar_path ? (
                      <img
                        src={channelAvatarUrl(
                          supabase,
                          joinPreview.avatar_path,
                        )}
                        alt={joinPreview.name}
                        className="h-14 w-14 rounded-2xl object-cover"
                      />
                    ) : (
                      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/20 text-xl font-black text-emerald-200">
                        {joinPreview.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate">
                        {joinPreview.name}
                      </strong>
                      <p className="truncate text-xs text-gray-400">
                        {joinPreview.description || "Không có mô tả"}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {joinPreview.member_count}/
                        {joinPreview.max_members} thành viên
                      </p>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void joinServer()}
                  disabled={
                    working ||
                    !joinPreview ||
                    joinPreview.already_member
                  }
                  className="w-full rounded-xl bg-green-600 px-6 py-3.5 font-black disabled:opacity-50"
                >
                  {working
                    ? "Đang xử lý..."
                    : joinPreview?.already_member
                      ? "Bạn đã ở trong server này"
                      : "Tham gia server"}
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <section className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-[#2b2d31] p-6 text-white shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black">Tạo kênh mới</h2>
                <p className="mt-1 text-sm text-gray-400">
                  TV tạo kênh riêng; AD và QT tạo được cả kênh chung.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowCreate(false);
                  resetForm();
                }}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-2xl"
              >
                ×
              </button>
            </div>

            {errorMessage && (
              <p className="mt-4 rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-300">
                {errorMessage}
              </p>
            )}

            <div className="mt-6 grid gap-6 md:grid-cols-[150px_minmax(0,1fr)]">
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  className="mx-auto flex h-28 w-28 items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed border-white/15 bg-[#1e1f22] text-xs text-gray-400"
                >
                  {avatarPreview ? (
                    <img
                      src={avatarPreview}
                      alt="Avatar kênh"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    "Chọn avatar"
                  )}
                </button>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={chooseAvatar}
                  className="hidden"
                />
                <p className="mt-2 text-[11px] text-gray-500">
                  JPG/PNG/WEBP · 5 MB
                </p>
              </div>

              <div className="space-y-4">
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={40}
                  placeholder="Tên kênh"
                  className="w-full rounded-xl bg-[#1e1f22] px-4 py-3 outline-none ring-indigo-500 focus:ring-2"
                />
                <textarea
                  value={description}
                  onChange={(event) =>
                    setDescription(event.target.value)
                  }
                  maxLength={300}
                  rows={3}
                  placeholder="Mô tả kênh"
                  className="w-full resize-none rounded-xl bg-[#1e1f22] px-4 py-3 outline-none ring-indigo-500 focus:ring-2"
                />

                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ["text", "# Văn bản"],
                      ["voice", "🔊 Thoại"],
                      ["both", "💬 Cả hai"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setChannelType(value)}
                      className={`rounded-xl border px-2 py-3 text-sm font-bold ${
                        channelType === value
                          ? "border-indigo-400 bg-indigo-500/20"
                          : "border-white/10 bg-[#1e1f22]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setVisibility("private")}
                    className={`rounded-xl border p-3 text-left ${
                      visibility === "private"
                        ? "border-indigo-400 bg-indigo-500/20"
                        : "border-white/10"
                    }`}
                  >
                    <strong>🔒 Kênh riêng</strong>
                  </button>
                  {canCreatePublic && (
                    <button
                      type="button"
                      onClick={() => setVisibility("public")}
                      className={`rounded-xl border p-3 text-left ${
                        visibility === "public"
                          ? "border-indigo-400 bg-indigo-500/20"
                          : "border-white/10"
                      }`}
                    >
                      <strong>🌐 Kênh chung</strong>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {visibility === "private" && (
              <div className="mt-6">
                <div className="flex justify-between">
                  <strong>Mời bạn bè</strong>
                  <span className="text-xs text-gray-400">
                    {selectedFriendIds.size}/24
                  </span>
                </div>
                <div className="mt-2 max-h-52 space-y-1 overflow-y-auto rounded-2xl bg-[#1e1f22] p-2">
                  {friends.length === 0 ? (
                    <p className="p-4 text-center text-sm text-gray-400">
                      Chưa có bạn bè để mời.
                    </p>
                  ) : (
                    friends.map((friend) => {
                      const selected = selectedFriendIds.has(friend.id);
                      return (
                        <button
                          key={friend.id}
                          type="button"
                          onClick={() => toggleFriend(friend.id)}
                          className={`flex w-full items-center gap-3 rounded-xl p-2 text-left ${
                            selected ? "bg-indigo-500/20" : "hover:bg-white/5"
                          }`}
                        >
                          {friend.avatar_url ? (
                            <img
                              src={friend.avatar_url}
                              alt={friend.username}
                              className="h-9 w-9 rounded-full object-cover"
                            />
                          ) : (
                            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500 font-bold">
                              {friend.username.charAt(0).toUpperCase()}
                            </span>
                          )}
                          <span className="min-w-0 flex-1 truncate font-semibold">
                            {friend.username}
                          </span>
                          <span>{selected ? "✓" : ""}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowCreate(false);
                  resetForm();
                }}
                className="rounded-xl px-5 py-3 font-bold hover:bg-white/10"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => void createChannel()}
                disabled={working || name.trim().length < 2}
                className="rounded-xl bg-indigo-500 px-6 py-3 font-black disabled:opacity-50"
              >
                {working ? "Đang tạo..." : "Tạo kênh"}
              </button>
            </div>
          </section>
        </div>
      )}

      {showInvites && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/75 p-4">
          <section className="w-full max-w-lg rounded-3xl bg-[#2b2d31] p-6 text-white shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black">Lời mời vào kênh</h2>
                <p className="text-sm text-gray-400">
                  {invites.length} lời mời đang chờ
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowInvites(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xl"
              >
                ×
              </button>
            </div>

            <div className="mt-5 max-h-[60vh] space-y-3 overflow-y-auto">
              {invites.length === 0 ? (
                <p className="rounded-2xl bg-[#1e1f22] p-6 text-center text-gray-400">
                  Không có lời mời mới.
                </p>
              ) : (
                invites.map((invite) => (
                  <article
                    key={invite.invite_id}
                    className="rounded-2xl bg-[#1e1f22] p-4"
                  >
                    <strong>{invite.channel_name}</strong>
                    <p className="mt-1 text-sm text-gray-400">
                      {invite.sender_username} đã mời bạn
                    </p>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void respondInvite(invite.invite_id, "declined")
                        }
                        className="rounded-xl bg-white/10 px-3 py-2 font-bold"
                      >
                        Từ chối
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void respondInvite(invite.invite_id, "accepted")
                        }
                        className="rounded-xl bg-green-600 px-3 py-2 font-bold"
                      >
                        Tham gia
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
