"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";

const supabase = createClient();

type AdminMessage = {
  id: number;
  user_id: string;
  username: string;
  content: string;
  channel: string;
  created_at: string;
  attachment_url: string | null;
  attachment_name: string | null;
  edited_at: string | null;
};

type SuspensionRow = {
  user_id: string;
  reason: string;
  suspended_until: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type ChannelRow = {
  slug: string;
  name: string;
  description: string;
  position: number;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
};

type ProfileRow = {
  id: string;
  username: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};


function slugifyChannelName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function isSuspensionActive(suspension: SuspensionRow) {
  return (
    suspension.suspended_until === null ||
    new Date(suspension.suspended_until).getTime() > Date.now()
  );
}

export default function AdminPage() {
  const [adminUserId, setAdminUserId] = useState("");
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [suspensions, setSuspensions] = useState<SuspensionRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedChannel, setSelectedChannel] = useState("all");
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [workingUserId, setWorkingUserId] = useState<string | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelDescription, setNewChannelDescription] =
    useState("");
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [deletingChannelSlug, setDeletingChannelSlug] =
    useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let realtimeChannel:
      | ReturnType<typeof supabase.channel>
      | null = null;

    async function initializeAdmin() {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        window.location.href = "/login";
        return;
      }

      const { data: roleData, error: roleError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!active) return;

      if (roleError || roleData?.role !== "admin") {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      setAdminUserId(user.id);

      const [
        { data: messageData, error: messageError },
        { data: suspensionData, error: suspensionError },
        { data: channelData, error: channelError },
        { data: profileData, error: profileError },
      ] = await Promise.all([
        supabase
          .from("messages")
          .select(
            "id, user_id, username, content, channel, created_at, attachment_url, attachment_name, edited_at",
          )
          .order("created_at", { ascending: false })
          .limit(300),
        supabase
          .from("user_suspensions")
          .select(
            "user_id, reason, suspended_until, created_by, created_at, updated_at",
          ),
        supabase
          .from("channels")
          .select(
            "slug, name, description, position, is_default, created_by, created_at",
          )
          .order("position", { ascending: true }),
        supabase
          .from("profiles")
          .select(
            "id, username, avatar_url, created_at, updated_at",
          )
          .order("username", { ascending: true }),
      ]);

      if (!active) return;

      if (messageError) {
        setErrorMessage(
          `Không thể tải tin nhắn: ${messageError.message}`,
        );
      } else {
        setMessages(messageData ?? []);
      }

      if (suspensionError) {
        setErrorMessage(
          `Không thể tải trạng thái khóa: ${suspensionError.message}`,
        );
      } else {
        setSuspensions(suspensionData ?? []);
      }

      if (channelError) {
        setErrorMessage(
          `Không thể tải danh sách kênh: ${channelError.message}`,
        );
      } else {
        setChannels(channelData ?? []);
      }

      if (profileError) {
        setErrorMessage(
          `Không thể tải danh sách thành viên: ${profileError.message}`,
        );
      } else {
        setProfiles(profileData ?? []);
      }

      realtimeChannel = supabase
        .channel(`admin-panel-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "messages",
          },
          (payload) => {
            if (!active) return;

            if (payload.eventType === "INSERT") {
              const newMessage = payload.new as AdminMessage;

              setMessages((current) => {
                if (
                  current.some(
                    (message) => message.id === newMessage.id,
                  )
                ) {
                  return current;
                }

                return [newMessage, ...current].slice(0, 300);
              });
            }

            if (payload.eventType === "UPDATE") {
              const updatedMessage = payload.new as AdminMessage;

              setMessages((current) =>
                current.map((message) =>
                  message.id === updatedMessage.id
                    ? updatedMessage
                    : message,
                ),
              );
            }

            if (payload.eventType === "DELETE") {
              const deletedMessage =
                payload.old as Partial<AdminMessage>;

              if (typeof deletedMessage.id === "number") {
                setMessages((current) =>
                  current.filter(
                    (message) =>
                      message.id !== deletedMessage.id,
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
            table: "user_suspensions",
          },
          (payload) => {
            if (!active) return;

            if (payload.eventType === "INSERT") {
              const newSuspension = payload.new as SuspensionRow;

              setSuspensions((current) => [
                ...current.filter(
                  (item) =>
                    item.user_id !== newSuspension.user_id,
                ),
                newSuspension,
              ]);
            }

            if (payload.eventType === "UPDATE") {
              const updatedSuspension =
                payload.new as SuspensionRow;

              setSuspensions((current) =>
                current.map((item) =>
                  item.user_id === updatedSuspension.user_id
                    ? updatedSuspension
                    : item,
                ),
              );
            }

            if (payload.eventType === "DELETE") {
              const deletedSuspension =
                payload.old as Partial<SuspensionRow>;

              if (deletedSuspension.user_id) {
                setSuspensions((current) =>
                  current.filter(
                    (item) =>
                      item.user_id !==
                      deletedSuspension.user_id,
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
            table: "channels",
          },
          async () => {
            if (!active) return;

            const { data, error } = await supabase
              .from("channels")
              .select(
                "slug, name, description, position, is_default, created_by, created_at",
              )
              .order("position", { ascending: true });

            if (!active) return;

            if (error) {
              setErrorMessage(
                `Không thể cập nhật danh sách kênh: ${error.message}`,
              );
            } else {
              setChannels(data ?? []);
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
              .order("username", { ascending: true });

            if (!active) return;

            if (error) {
              setErrorMessage(
                `Không thể cập nhật thành viên: ${error.message}`,
              );
            } else {
              setProfiles(data ?? []);
            }
          },
        )
        .subscribe();

      setLoading(false);
    }

    void initializeAdmin();

    return () => {
      active = false;

      if (realtimeChannel) {
        void supabase.removeChannel(realtimeChannel);
      }
    };
  }, []);

  const activeSuspensions = useMemo(() => {
    return new Map(
      suspensions
        .filter(isSuspensionActive)
        .map((suspension) => [
          suspension.user_id,
          suspension,
        ]),
    );
  }, [suspensions]);

  const filteredProfiles = useMemo(() => {
    const query = memberSearch
      .trim()
      .toLocaleLowerCase("vi");

    if (!query) return profiles;

    return profiles.filter((profile) =>
      profile.username
        .toLocaleLowerCase("vi")
        .includes(query),
    );
  }, [memberSearch, profiles]);

  const filteredMessages = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase("vi");

    return messages.filter((message) => {
      const channelMatches =
        selectedChannel === "all" ||
        message.channel === selectedChannel;

      if (!channelMatches) return false;
      if (!query) return true;

      return (
        message.username
          .toLocaleLowerCase("vi")
          .includes(query) ||
        message.content
          .toLocaleLowerCase("vi")
          .includes(query) ||
        message.channel
          .toLocaleLowerCase("vi")
          .includes(query)
      );
    });
  }, [messages, searchQuery, selectedChannel]);


  async function createChannel() {
    const cleanName = newChannelName.trim();
    const cleanDescription = newChannelDescription.trim();
    const slug = slugifyChannelName(cleanName);

    if (cleanName.length < 2) {
      setErrorMessage("Tên kênh phải có ít nhất 2 ký tự.");
      return;
    }

    if (slug.length < 2) {
      setErrorMessage("Không thể tạo slug hợp lệ từ tên kênh.");
      return;
    }

    setCreatingChannel(true);
    setErrorMessage("");

    const { error } = await supabase.rpc(
      "admin_create_channel",
      {
        p_slug: slug,
        p_name: cleanName,
        p_description: cleanDescription,
      },
    );

    if (error) {
      setErrorMessage(`Không thể tạo kênh: ${error.message}`);
    } else {
      const { data, error: reloadError } = await supabase
        .from("channels")
        .select(
          "slug, name, description, position, is_default, created_by, created_at",
        )
        .order("position", { ascending: true });

      if (reloadError) {
        setErrorMessage(
          `Đã tạo kênh nhưng không thể tải lại: ${reloadError.message}`,
        );
      } else {
        setChannels(data ?? []);
        setNewChannelName("");
        setNewChannelDescription("");
      }
    }

    setCreatingChannel(false);
  }

  async function deleteChannel(channel: ChannelRow) {
    if (channel.is_default || channel.slug === "chung") {
      window.alert("Không thể xóa kênh mặc định.");
      return;
    }

    const confirmed = window.confirm(
      `Xóa kênh #${channel.name}?\\n\\nTin nhắn trong kênh này sẽ được chuyển về #chung.`,
    );

    if (!confirmed || deletingChannelSlug !== null) return;

    setDeletingChannelSlug(channel.slug);
    setErrorMessage("");

    const { error } = await supabase.rpc(
      "admin_delete_channel",
      {
        p_slug: channel.slug,
      },
    );

    if (error) {
      setErrorMessage(`Không thể xóa kênh: ${error.message}`);
    } else {
      setChannels((current) =>
        current.filter(
          (currentChannel) =>
            currentChannel.slug !== channel.slug,
        ),
      );
    }

    setDeletingChannelSlug(null);
  }

  async function deleteMessage(message: AdminMessage) {
    const confirmed = window.confirm(
      `Xóa tin nhắn của ${message.username}?\n\n${
        message.content || "Ảnh đính kèm"
      }`,
    );

    if (!confirmed || deletingId !== null) return;

    setDeletingId(message.id);
    setErrorMessage("");

    const { error } = await supabase
      .from("messages")
      .delete()
      .eq("id", message.id);

    if (error) {
      setErrorMessage(`Không thể xóa tin nhắn: ${error.message}`);
    } else {
      setMessages((current) =>
        current.filter(
          (currentMessage) =>
            currentMessage.id !== message.id,
        ),
      );
    }

    setDeletingId(null);
  }

  async function suspendMember(
    userId: string,
    username: string,
  ) {
    if (userId === adminUserId) {
      window.alert("Không thể tự khóa tài khoản quản trị.");
      return;
    }

    const reasonInput = window.prompt(
      `Lý do khóa chat của ${username}:`,
      "Vi phạm nội quy",
    );

    if (reasonInput === null) return;

    const hoursInput = window.prompt(
      "Nhập số giờ khóa. Nhập 0 để khóa vĩnh viễn:",
      "24",
    );

    if (hoursInput === null) return;

    const hours = Number(hoursInput.replace(",", "."));

    if (!Number.isFinite(hours) || hours < 0) {
      window.alert("Số giờ không hợp lệ.");
      return;
    }

    const reason =
      reasonInput.trim() || "Vi phạm nội quy";
    const suspendedUntil =
      hours === 0
        ? null
        : new Date(
            Date.now() + hours * 60 * 60 * 1000,
          ).toISOString();

    setWorkingUserId(userId);
    setErrorMessage("");

    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("user_suspensions")
      .upsert(
        {
          user_id: userId,
          reason,
          suspended_until: suspendedUntil,
          created_by: adminUserId,
          updated_at: now,
        },
        {
          onConflict: "user_id",
        },
      )
      .select(
        "user_id, reason, suspended_until, created_by, created_at, updated_at",
      )
      .single();

    if (error) {
      setErrorMessage(
        `Không thể khóa thành viên: ${error.message}`,
      );
    } else {
      setSuspensions((current) => [
        ...current.filter(
          (item) => item.user_id !== userId,
        ),
        data,
      ]);
    }

    setWorkingUserId(null);
  }

  async function suspendUser(message: AdminMessage) {
    await suspendMember(
      message.user_id,
      message.username,
    );
  }

  async function unlockUser(userId: string) {
    if (workingUserId !== null) return;

    if (!window.confirm("Mở khóa chat cho thành viên này?")) {
      return;
    }

    setWorkingUserId(userId);
    setErrorMessage("");

    const { error } = await supabase
      .from("user_suspensions")
      .delete()
      .eq("user_id", userId);

    if (error) {
      setErrorMessage(
        `Không thể mở khóa thành viên: ${error.message}`,
      );
    } else {
      setSuspensions((current) =>
        current.filter((item) => item.user_id !== userId),
      );
    }

    setWorkingUserId(null);
  }

  function formatDate(dateString: string) {
    return new Date(dateString).toLocaleString("vi-VN", {
      dateStyle: "short",
      timeStyle: "short",
    });
  }

  function suspensionLabel(suspension: SuspensionRow) {
    if (suspension.suspended_until === null) {
      return "Khóa vĩnh viễn";
    }

    return `Khóa đến ${formatDate(
      suspension.suspended_until,
    )}`;
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#1e1f22] text-white">
        <p>Đang kiểm tra quyền quản trị...</p>
      </main>
    );
  }

  if (accessDenied) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#1e1f22] px-4 text-white">
        <section className="w-full max-w-md rounded-xl bg-[#313338] p-6 text-center shadow-xl">
          <h1 className="text-2xl font-bold">
            Không có quyền truy cập
          </h1>

          <p className="mt-3 text-gray-400">
            Trang này chỉ dành cho quản trị viên.
          </p>

          <button
            type="button"
            onClick={() => {
              window.location.href = "/";
            }}
            className="mt-6 rounded-md bg-indigo-500 px-5 py-3 font-semibold hover:bg-indigo-400"
          >
            Quay lại phòng chat
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#1e1f22] px-4 py-8 text-white">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-2 inline-flex rounded-full bg-red-500/15 px-3 py-1 text-xs font-bold uppercase text-red-300">
              Quản trị viên
            </div>

            <h1 className="text-3xl font-bold">
              Kiểm duyệt cộng đồng
            </h1>

            <p className="mt-1 text-sm text-gray-400">
              Xóa tin nhắn hoặc khóa quyền chat của thành viên.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                window.location.href = "/settings";
              }}
              className="rounded-md bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15"
            >
              Cài đặt
            </button>

            <button
              type="button"
              onClick={() => {
                window.location.href = "/";
              }}
              className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold hover:bg-indigo-400"
            >
              Phòng chat
            </button>
          </div>
        </header>

        {errorMessage && (
          <div className="mb-5 rounded-md bg-red-500/15 px-4 py-3 text-sm text-red-300">
            {errorMessage}
          </div>
        )}


        <section className="mb-5 rounded-xl bg-[#313338] p-5 shadow">
          <div className="mb-4">
            <h2 className="text-xl font-bold">
              Quản lý kênh văn bản
            </h2>

            <p className="mt-1 text-sm text-gray-400">
              Tạo kênh mới hoặc xóa kênh không còn sử dụng.
              Khi xóa, tin nhắn được chuyển về #chung.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-[240px_1fr_auto]">
            <input
              value={newChannelName}
              onChange={(event) =>
                setNewChannelName(event.target.value)
              }
              maxLength={40}
              placeholder="Tên kênh, ví dụ: game"
              className="rounded-md bg-[#1e1f22] px-4 py-3 outline-none ring-indigo-500 focus:ring-2"
            />

            <input
              value={newChannelDescription}
              onChange={(event) =>
                setNewChannelDescription(event.target.value)
              }
              maxLength={200}
              placeholder="Mô tả kênh"
              className="rounded-md bg-[#1e1f22] px-4 py-3 outline-none ring-indigo-500 focus:ring-2"
            />

            <button
              type="button"
              onClick={() => void createChannel()}
              disabled={
                creatingChannel ||
                newChannelName.trim().length < 2
              }
              className="rounded-md bg-indigo-500 px-5 py-3 font-semibold hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creatingChannel ? "Đang tạo..." : "Tạo kênh"}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {channels.map((channel) => (
              <div
                key={channel.slug}
                className="flex items-center overflow-hidden rounded-md border border-white/10 bg-[#1e1f22]"
              >
                <div className="px-3 py-2">
                  <div className="font-semibold">
                    #{channel.name}
                  </div>

                  {channel.description && (
                    <div className="max-w-64 truncate text-xs text-gray-500">
                      {channel.description}
                    </div>
                  )}
                </div>

                {channel.is_default ||
                channel.slug === "chung" ? (
                  <span className="mr-2 rounded bg-white/10 px-2 py-1 text-xs text-gray-400">
                    Mặc định
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      void deleteChannel(channel)
                    }
                    disabled={
                      deletingChannelSlug === channel.slug
                    }
                    className="self-stretch bg-red-500/15 px-3 text-xs font-semibold text-red-300 hover:bg-red-500/25 disabled:opacity-50"
                  >
                    {deletingChannelSlug === channel.slug
                      ? "..."
                      : "Xóa"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="mb-5 rounded-xl bg-[#313338] p-5 shadow">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-xl font-bold">
                Quản lý thành viên
              </h2>

              <p className="mt-1 text-sm text-gray-400">
                Tìm và khóa chat thành viên, kể cả khi họ chưa gửi tin nhắn.
              </p>
            </div>

            <input
              value={memberSearch}
              onChange={(event) =>
                setMemberSearch(event.target.value)
              }
              placeholder="Tìm tên thành viên..."
              className="w-full rounded-md bg-[#1e1f22] px-4 py-3 outline-none ring-indigo-500 focus:ring-2 md:max-w-sm"
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {filteredProfiles.map((profile) => {
              const suspension = activeSuspensions.get(
                profile.id,
              );
              const isWorking =
                workingUserId === profile.id;
              const isCurrentAdmin =
                profile.id === adminUserId;

              return (
                <article
                  key={profile.id}
                  className="flex items-center gap-3 rounded-lg bg-[#1e1f22] p-4"
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

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="truncate">
                        {profile.username}
                      </strong>

                      {isCurrentAdmin && (
                        <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-semibold text-red-300">
                          Admin
                        </span>
                      )}

                      {suspension && (
                        <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-xs font-semibold text-orange-300">
                          Đang bị khóa
                        </span>
                      )}
                    </div>

                    {suspension && (
                      <p className="mt-1 truncate text-xs text-orange-300">
                        {suspension.reason}
                      </p>
                    )}

                    <p className="mt-1 truncate text-xs text-gray-600">
                      {profile.id}
                    </p>
                  </div>

                  {suspension ? (
                    <button
                      type="button"
                      onClick={() =>
                        void unlockUser(profile.id)
                      }
                      disabled={isWorking}
                      className="shrink-0 rounded-md bg-green-600 px-3 py-2 text-sm font-semibold hover:bg-green-500 disabled:opacity-50"
                    >
                      {isWorking
                        ? "..."
                        : "Mở khóa"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        void suspendMember(
                          profile.id,
                          profile.username,
                        )
                      }
                      disabled={
                        isWorking || isCurrentAdmin
                      }
                      className="shrink-0 rounded-md bg-orange-500 px-3 py-2 text-sm font-semibold hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isWorking ? "..." : "Khóa chat"}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <section className="mb-5 grid gap-3 rounded-xl bg-[#313338] p-4 md:grid-cols-[1fr_220px_auto]">
          <input
            value={searchQuery}
            onChange={(event) =>
              setSearchQuery(event.target.value)
            }
            placeholder="Tìm theo tên hoặc nội dung..."
            className="rounded-md bg-[#1e1f22] px-4 py-3 outline-none ring-indigo-500 focus:ring-2"
          />

          <select
            value={selectedChannel}
            onChange={(event) =>
              setSelectedChannel(event.target.value)
            }
            className="rounded-md bg-[#1e1f22] px-4 py-3 outline-none"
          >
            <option value="all">Tất cả kênh</option>

            {channels.map((channel) => (
              <option
                key={channel.slug}
                value={channel.slug}
              >
                #{channel.name}
              </option>
            ))}
          </select>

          <div className="flex items-center rounded-md bg-[#1e1f22] px-4 text-sm text-gray-300">
            {filteredMessages.length} tin nhắn
          </div>
        </section>

        <section className="space-y-3">
          {filteredMessages.length === 0 ? (
            <div className="rounded-xl bg-[#313338] p-8 text-center text-gray-400">
              Không có tin nhắn phù hợp.
            </div>
          ) : (
            filteredMessages.map((message) => {
              const suspension = activeSuspensions.get(
                message.user_id,
              );
              const isWorking =
                workingUserId === message.user_id;

              return (
                <article
                  key={message.id}
                  className="rounded-xl bg-[#313338] p-5 shadow"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong>{message.username}</strong>

                        <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-gray-300">
                          #{message.channel}
                        </span>

                        <span className="text-xs text-gray-500">
                          {formatDate(message.created_at)}
                        </span>

                        {message.edited_at && (
                          <span className="text-xs text-gray-500">
                            Đã sửa
                          </span>
                        )}

                        {suspension && (
                          <span
                            title={suspension.reason}
                            className="rounded-full bg-orange-500/20 px-2 py-0.5 text-xs font-semibold text-orange-300"
                          >
                            {suspensionLabel(suspension)}
                          </span>
                        )}
                      </div>

                      {message.content && (
                        <p className="mt-3 whitespace-pre-wrap break-words text-gray-200">
                          {message.content}
                        </p>
                      )}

                      {message.attachment_url && (
                        <a
                          href={message.attachment_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 block"
                        >
                          <img
                            src={message.attachment_url}
                            alt={
                              message.attachment_name ??
                              "Ảnh đính kèm"
                            }
                            className="max-h-56 rounded-lg object-contain"
                          />
                        </a>
                      )}

                      {suspension && (
                        <p className="mt-3 text-sm text-orange-300">
                          Lý do: {suspension.reason}
                        </p>
                      )}

                      <p className="mt-3 break-all text-xs text-gray-600">
                        User ID: {message.user_id}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                      {suspension ? (
                        <button
                          type="button"
                          onClick={() =>
                            void unlockUser(message.user_id)
                          }
                          disabled={isWorking}
                          className="rounded-md bg-green-600 px-4 py-2 text-sm font-semibold hover:bg-green-500 disabled:opacity-50"
                        >
                          {isWorking
                            ? "Đang xử lý..."
                            : "Mở khóa"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            void suspendUser(message)
                          }
                          disabled={
                            isWorking ||
                            message.user_id === adminUserId
                          }
                          title={
                            message.user_id === adminUserId
                              ? "Không thể tự khóa admin"
                              : "Khóa quyền gửi tin nhắn"
                          }
                          className="rounded-md bg-orange-500 px-4 py-2 text-sm font-semibold hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {isWorking
                            ? "Đang xử lý..."
                            : "Khóa chat"}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          void deleteMessage(message)
                        }
                        disabled={deletingId === message.id}
                        className="rounded-md bg-red-500 px-4 py-2 text-sm font-semibold hover:bg-red-400 disabled:opacity-50"
                      >
                        {deletingId === message.id
                          ? "Đang xóa..."
                          : "Xóa tin"}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}
