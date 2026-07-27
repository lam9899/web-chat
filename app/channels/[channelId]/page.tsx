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
import ChannelVoiceRoom from "../../channel-voice-room";
import {
  type ChannelMember,
  type ChannelMessage,
  type DynamicChannel,
  channelAvatarUrl,
  channelTypeLabel,
} from "../../channel-types";

const supabase = createClient();

type FriendRow = {
  id: string;
  username: string;
  avatar_url: string | null;
  public_id: number;
};

type PresencePayload = {
  user_id: string;
  username: string;
  avatar_url: string | null;
  joined_at: string;
};

export default function DynamicChannelPage() {
  const params = useParams<{ channelId: string }>();
  const router = useRouter();
  const channelId = params.channelId;

  const [channel, setChannel] = useState<DynamicChannel | null>(null);
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [onlineUserIds, setOnlineUserIds] =
    useState<Set<string>>(new Set());
  const [currentUserId, setCurrentUserId] = useState("");
  const [username, setUsername] = useState("Bạn");
  const [avatarUrl, setAvatarUrl] = useState("");

  const [messageInput, setMessageInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [working, setWorking] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editType, setEditType] =
    useState<"text" | "voice" | "both" | "game">("text");
  const [editVisibility, setEditVisibility] =
    useState<"public" | "private">("private");
  const [editLocked, setEditLocked] = useState(false);

  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const loadChannel = useCallback(async () => {
    const { data, error } = await supabase.rpc(
      "get_channel_detail",
      { p_channel_id: channelId },
    );

    if (error || !data?.[0]) {
      setChannel(null);
      setErrorMessage(
        error?.message ??
          "Kênh không tồn tại hoặc bạn chưa được mời.",
      );
      return;
    }

    const loaded = data[0] as DynamicChannel;

    // Kênh thuộc server thì mở trong giao diện server.
    if (loaded.server_id) {
      router.replace(
        `/servers/${loaded.server_id}?channel=${loaded.id}`,
      );
      return;
    }

    setChannel(loaded);
    setEditName(loaded.name);
    setEditDescription(loaded.description);
    setEditType(loaded.channel_type);
    setEditVisibility(loaded.visibility);
    setEditLocked(loaded.is_locked);
  }, [channelId, router]);

  const loadMembers = useCallback(async () => {
    const { data, error } = await supabase.rpc(
      "get_channel_members",
      { p_channel_id: channelId },
    );

    if (!error) setMembers((data ?? []) as ChannelMember[]);
  }, [channelId]);

  const loadMessages = useCallback(async () => {
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
  }, [channelId]);

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

      const [{ data: profile }, { data: friendRows }] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("username, avatar_url")
            .eq("id", user.id)
            .maybeSingle(),
          supabase.rpc("get_my_friends"),
        ]);

      if (!active) return;

      setUsername(profile?.username ?? "Bạn");
      setAvatarUrl(profile?.avatar_url ?? "");
      setFriends((friendRows ?? []) as FriendRow[]);

      await Promise.all([
        loadChannel(),
        loadMembers(),
        loadMessages(),
      ]);

      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [loadChannel, loadMembers, loadMessages, router]);

  useEffect(() => {
    if (!currentUserId || !channel) return;

    const presence = supabase.channel(
      `channel-presence:${channel.id}`,
      { config: { presence: { key: currentUserId } } },
    );

    function syncPresence() {
      const state = presence.presenceState<PresencePayload>();
      setOnlineUserIds(new Set(Object.keys(state)));
    }

    presence
      .on("presence", { event: "sync" }, syncPresence)
      .on("presence", { event: "join" }, syncPresence)
      .on("presence", { event: "leave" }, syncPresence)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await presence.track({
            user_id: currentUserId,
            username,
            avatar_url: avatarUrl || null,
            joined_at: new Date().toISOString(),
          });
        }
      });

    return () => {
      void presence.untrack();
      void supabase.removeChannel(presence);
    };
  }, [avatarUrl, channel, currentUserId, username]);

  useEffect(() => {
    if (!currentUserId) return;

    const realtime = supabase
      .channel(`channel-page-${channelId}-${currentUserId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "channels",
          filter: `id=eq.${channelId}`,
        },
        () => void loadChannel(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "channel_members",
          filter: `channel_id=eq.${channelId}`,
        },
        () => {
          void loadMembers();
          void loadChannel();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "channel_messages",
          filter: `channel_id=eq.${channelId}`,
        },
        () => {
          void loadMessages();
          void loadChannel();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(realtime);
    };
  }, [channelId, currentUserId, loadChannel, loadMembers, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const onlineMembers = useMemo(
    () => members.filter((member) => onlineUserIds.has(member.id)),
    [members, onlineUserIds],
  );

  const availableFriends = useMemo(() => {
    const memberIds = new Set(members.map((member) => member.id));
    return friends.filter((friend) => !memberIds.has(friend.id));
  }, [friends, members]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = messageInput.trim();
    if (!content || sending || !channel) return;

    setSending(true);
    setErrorMessage("");

    const { error } = await supabase.rpc("send_channel_message", {
      p_channel_id: channel.id,
      p_content: content,
    });

    if (error) setErrorMessage(error.message);
    else {
      setMessageInput("");
      await loadMessages();
    }

    setSending(false);
  }

  async function saveSettings() {
    if (!channel || working) return;
    setWorking(true);
    setErrorMessage("");

    const { error } = await supabase.rpc("update_channel", {
      p_channel_id: channel.id,
      p_name: editName,
      p_description: editDescription,
      p_channel_type: editType,
      p_visibility: editVisibility,
      p_is_locked: editLocked,
    });

    if (error) setErrorMessage(error.message);
    else {
      await loadChannel();
      setShowSettings(false);
    }

    setWorking(false);
  }

  async function changeAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file || !channel) return;

    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type)
    ) {
      setErrorMessage("Avatar chỉ hỗ trợ JPG, PNG hoặc WEBP.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setErrorMessage("Avatar tối đa 5 MB.");
      return;
    }

    setWorking(true);
    const ext =
      file.type === "image/png"
        ? "png"
        : file.type === "image/webp"
          ? "webp"
          : "jpg";
    const path = `${currentUserId}/${channel.id}/avatar-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("channel-avatars")
      .upload(path, file, {
        upsert: true,
        contentType: file.type,
      });

    if (uploadError) setErrorMessage(uploadError.message);
    else {
      const { error } = await supabase.rpc("set_channel_avatar", {
        p_channel_id: channel.id,
        p_avatar_path: path,
      });
      if (error) setErrorMessage(error.message);
      else await loadChannel();
    }

    setWorking(false);
  }

  async function inviteFriend(friendId: string) {
    if (!channel || working) return;
    setWorking(true);
    const { error } = await supabase.rpc("invite_to_channel", {
      p_channel_id: channel.id,
      p_receiver_id: friendId,
    });
    setErrorMessage(error ? error.message : "Đã gửi lời mời vào kênh.");
    setWorking(false);
  }

  async function removeMember(memberId: string) {
    if (!channel || working) return;
    if (!window.confirm("Xóa thành viên này khỏi kênh?")) return;

    setWorking(true);
    const { error } = await supabase.rpc("remove_channel_member", {
      p_channel_id: channel.id,
      p_member_id: memberId,
    });
    if (error) setErrorMessage(error.message);
    else await loadMembers();
    setWorking(false);
  }

  async function leaveChannel() {
    if (!channel || working) return;
    if (!window.confirm("Bạn muốn rời kênh này?")) return;

    setWorking(true);
    const { error } = await supabase.rpc("leave_channel", {
      p_channel_id: channel.id,
    });
    if (error) {
      setErrorMessage(error.message);
      setWorking(false);
      return;
    }
    router.push("/");
  }

  async function deleteChannel() {
    if (!channel || working) return;
    if (!window.confirm(`Xóa kênh "${channel.name}" và toàn bộ tin nhắn?`)) return;

    setWorking(true);
    const { error } = await supabase.rpc("delete_channel", {
      p_channel_id: channel.id,
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
        Đang tải kênh...
      </main>
    );
  }

  if (!channel) {
    return (
      <main className="flex h-screen items-center justify-center bg-[#313338] p-4 text-white">
        <section className="max-w-md rounded-3xl bg-[#2b2d31] p-7 text-center">
          <h1 className="text-2xl font-black">Không thể mở kênh</h1>
          <p className="mt-3 text-gray-400">{errorMessage}</p>
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

  const channelAvatar = channelAvatarUrl(
    supabase,
    channel.avatar_path,
  );
  const canText =
    channel.channel_type === "text" || channel.channel_type === "both";

  return (
    <main className="grid h-screen overflow-hidden bg-[#313338] text-white md:grid-cols-[84px_minmax(0,1fr)_280px]">
      <ChannelRail activeChannelId={channel.id} />

      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <header className="flex h-[72px] shrink-0 items-center gap-3 border-b border-black/20 px-4 shadow">
          {channelAvatar ? (
            <img
              src={channelAvatar}
              alt={channel.name}
              className="h-11 w-11 rounded-2xl object-cover"
            />
          ) : (
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-500/20 text-xl font-black text-indigo-200">
              {channel.channel_type === "voice"
                ? "🔊"
                : channel.name.charAt(0).toUpperCase()}
            </span>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-black">{channel.name}</h1>
              {channel.visibility === "private" && <span>🔒</span>}
              {channel.is_locked && <span>🔐</span>}
            </div>
            <p className="truncate text-xs text-gray-400">
              {channel.description || channelTypeLabel(channel.channel_type)}
            </p>
          </div>

          <span className="rounded-full bg-green-500/15 px-3 py-1 text-xs font-bold text-green-300">
            {onlineMembers.length} online
          </span>

          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-xl hover:bg-white/15"
            title="Cài đặt kênh"
          >
            ⚙️
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
          {errorMessage && (
            <p className="mb-4 rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-300">
              {errorMessage}
            </p>
          )}

          {/* CHANNEL_VOICE_LIVEKIT_STAGE2 */}
          {(channel.channel_type === "voice" ||
            channel.channel_type === "both") && (
            <ChannelVoiceRoom
              channelId={channel.id}
              channelName={channel.name}
              joinRequestId={
                channel.channel_type === "voice" ? 1 : 0
              }
              voiceOnly={
                channel.channel_type === "voice"
              }
            />
          )}

          {canText && (messages.length === 0 ? (
            <div className="flex min-h-[50vh] items-center justify-center text-center">
              <div>
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-indigo-500/15 text-3xl">
                  {channel.channel_type === "voice" ? "🔊" : "#"}
                </div>
                <h2 className="mt-4 text-2xl font-black">
                  Bắt đầu kênh {channel.name}
                </h2>
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
                      {message.sender_username.charAt(0).toUpperCase()}
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <MemberBadge role={message.sender_role} />
                      <strong>{message.sender_username}</strong>
                      <span className="text-[11px] text-gray-500">
                        {formatPublicId(message.sender_public_id)}
                      </span>
                      <time className="text-[11px] text-gray-500">
                        {new Date(message.created_at).toLocaleString("vi-VN", {
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
          ))}

          <div ref={messagesEndRef} />
        </div>

        {canText && (
          <form
            onSubmit={sendMessage}
            className="shrink-0 border-t border-black/20 p-3 md:p-4"
          >
            <div className="flex items-center gap-2 rounded-2xl bg-[#383a40] px-3">
              <input
                value={messageInput}
                onChange={(event) => setMessageInput(event.target.value)}
                disabled={
                  sending || (channel.is_locked && !channel.can_manage)
                }
                placeholder={
                  channel.is_locked && !channel.can_manage
                    ? "Kênh đang khóa gửi tin"
                    : `Nhắn tin trong ${channel.name}`
                }
                className="min-w-0 flex-1 bg-transparent py-4 outline-none placeholder:text-gray-500"
              />
              <button
                type="submit"
                disabled={
                  sending ||
                  !messageInput.trim() ||
                  (channel.is_locked && !channel.can_manage)
                }
                className="rounded-xl bg-indigo-500 px-4 py-2 font-black disabled:opacity-40"
              >
                {sending ? "..." : "Gửi"}
              </button>
            </div>
          </form>
        )}
      </section>

      <aside className="hidden min-h-0 overflow-y-auto bg-[#2b2d31] p-4 md:block">
        <h2 className="text-xs font-black uppercase text-gray-400">
          Thành viên — {members.length}
        </h2>
        {members.map((member) => (
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
              </span>
            </span>
          </div>
        ))}
      </aside>

      {showSettings && (
        <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <section className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-[#2b2d31] p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-black">Cài đặt kênh</h2>
                <p className="text-sm text-gray-400">
                  Avatar, thông tin và thành viên
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-2xl"
              >
                ×
              </button>
            </div>

            {channel.can_manage ? (
              <div className="mt-6 grid gap-6 md:grid-cols-[150px_minmax(0,1fr)]">
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    className="mx-auto flex h-28 w-28 items-center justify-center overflow-hidden rounded-3xl bg-[#1e1f22]"
                  >
                    {channelAvatar ? (
                      <img
                        src={channelAvatar}
                        alt={channel.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-4xl font-black">
                        {channel.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </button>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={changeAvatar}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    className="mt-3 text-sm font-bold text-indigo-300"
                  >
                    Đổi avatar
                  </button>
                </div>

                <div className="space-y-3">
                  <input
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    className="w-full rounded-xl bg-[#1e1f22] px-4 py-3"
                  />
                  <textarea
                    value={editDescription}
                    onChange={(event) =>
                      setEditDescription(event.target.value)
                    }
                    rows={3}
                    className="w-full resize-none rounded-xl bg-[#1e1f22] px-4 py-3"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <select
                      value={editType}
                      onChange={(event) =>
                        setEditType(
                          event.target.value as
                            | "text"
                            | "voice"
                            | "both"
                            | "game",
                        )
                      }
                      className="rounded-xl bg-[#1e1f22] px-4 py-3"
                    >
                      <option value="text">Văn bản</option>
                      <option value="voice">Thoại</option>
                      <option value="both">Cả hai</option>
                      <option value="game">Game</option>
                    </select>
                    <select
                      value={editVisibility}
                      onChange={(event) =>
                        setEditVisibility(
                          event.target.value as "public" | "private",
                        )
                      }
                      className="rounded-xl bg-[#1e1f22] px-4 py-3"
                    >
                      <option value="private">Kênh riêng</option>
                      <option value="public">Kênh chung</option>
                    </select>
                  </div>
                  <label className="flex items-center justify-between rounded-xl bg-[#1e1f22] px-4 py-3">
                    <span>Khóa gửi tin</span>
                    <input
                      type="checkbox"
                      checked={editLocked}
                      onChange={(event) => setEditLocked(event.target.checked)}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void saveSettings()}
                    className="w-full rounded-xl bg-indigo-500 px-4 py-3 font-black"
                  >
                    Lưu cài đặt
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-6 rounded-2xl bg-[#1e1f22] p-5 text-gray-300">
                Bạn là thành viên của kênh. Chỉ chủ kênh hoặc quản trị viên được sửa.
              </p>
            )}

            {channel.can_manage && channel.visibility === "private" && (
              <div className="mt-8 grid gap-6 md:grid-cols-2">
                <div>
                  <h3 className="font-black">Thành viên</h3>
                  <div className="mt-2 max-h-56 space-y-2 overflow-y-auto rounded-2xl bg-[#1e1f22] p-2">
                    {members.map((member) => (
                      <div
                        key={member.id}
                        className="flex items-center gap-3 rounded-xl p-2"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {member.username} · {member.channel_role}
                        </span>
                        {member.channel_role !== "owner" && (
                          <button
                            type="button"
                            onClick={() => void removeMember(member.id)}
                            className="rounded-lg bg-red-500/15 px-2 py-1 text-xs text-red-300"
                          >
                            Xóa
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="font-black">Mời bạn bè</h3>
                  <div className="mt-2 max-h-56 space-y-2 overflow-y-auto rounded-2xl bg-[#1e1f22] p-2">
                    {availableFriends.length === 0 ? (
                      <p className="p-4 text-center text-sm text-gray-400">
                        Không còn bạn bè để mời.
                      </p>
                    ) : (
                      availableFriends.map((friend) => (
                        <div
                          key={friend.id}
                          className="flex items-center gap-3 rounded-xl p-2"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {friend.username}
                          </span>
                          <button
                            type="button"
                            onClick={() => void inviteFriend(friend.id)}
                            className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-bold"
                          >
                            Mời
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="mt-8 border-t border-white/10 pt-5">
              {channel.owner_id !== currentUserId && (
                <button
                  type="button"
                  onClick={() => void leaveChannel()}
                  className="rounded-xl bg-yellow-500/15 px-5 py-3 font-bold text-yellow-300"
                >
                  Rời kênh
                </button>
              )}
              {channel.can_manage && !channel.is_system && (
                <button
                  type="button"
                  onClick={() => void deleteChannel()}
                  className="ml-3 rounded-xl bg-red-500/15 px-5 py-3 font-bold text-red-300"
                >
                  Xóa kênh
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
