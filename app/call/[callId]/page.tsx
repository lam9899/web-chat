"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  ControlBar,
  GridLayout,
  LiveKitRoom,
  MediaDeviceMenu,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { createClient } from "@/utils/supabase/client";

const supabase = createClient();

type CallSessionRow = {
  id: string;
  caller_id: string;
  receiver_id: string;
  call_type: "audio" | "video";
  room_name: string;
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
};

type ProfileRow = {
  id: string;
  username: string;
  avatar_url: string | null;
};

type ConnectionDetails = {
  server_url: string;
  participant_token: string;
};

type CompactCallStageProps = {
  callType: "audio" | "video";
  answeredAt: string | null;
  otherProfile: ProfileRow | null;
  ending: boolean;
  errorMessage: string;
  onEnd: () => void;
};

function CallTimer({
  answeredAt,
}: {
  answeredAt: string | null;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const startedAt = answeredAt
    ? new Date(answeredAt).getTime()
    : now;
  const totalSeconds = Math.max(
    0,
    Math.floor((now - startedAt) / 1000),
  );
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(
    (totalSeconds % 3600) / 60,
  );
  const seconds = totalSeconds % 60;

  return (
    <span className="font-mono text-xs tabular-nums text-gray-400">
      {hours > 0
        ? `${String(hours).padStart(2, "0")}:`
        : ""}
      {String(minutes).padStart(2, "0")}:
      {String(seconds).padStart(2, "0")}
    </span>
  );
}

function CompactCallStage({
  callType,
  answeredAt,
  otherProfile,
  ending,
  errorMessage,
  onEnd,
}: CompactCallStageProps) {
  const [speakerMuted, setSpeakerMuted] =
    useState(false);
  const [showDeviceSettings, setShowDeviceSettings] =
    useState(false);

  useEffect(() => {
    if (!showDeviceSettings) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShowDeviceSettings(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, [showDeviceSettings]);

  const tracks = useTracks([
    {
      source: Track.Source.Camera,
      withPlaceholder: true,
    },
    {
      source: Track.Source.ScreenShare,
      withPlaceholder: false,
    },
  ]);

  return (
    <div className="min-h-screen overflow-hidden bg-[#0d0e11] p-2 text-white sm:p-4">
      <div className="mx-auto flex h-[calc(100vh-16px)] w-full max-w-[1240px] flex-col gap-3 sm:h-[calc(100vh-32px)]">
        <header className="flex h-14 shrink-0 items-center gap-3 rounded-2xl border border-white/10 bg-[#18191d] px-4 shadow-lg">
          {otherProfile?.avatar_url ? (
            <img
              src={otherProfile.avatar_url}
              alt={otherProfile.username}
              className="h-9 w-9 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500 font-bold">
              {(otherProfile?.username ?? "T")
                .charAt(0)
                .toUpperCase()}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-bold sm:text-base">
              {otherProfile?.username ?? "Cuộc gọi"}
            </h1>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">
                {callType === "video"
                  ? "Cuộc gọi video"
                  : "Cuộc gọi thoại"}
              </span>
              <span className="h-1 w-1 rounded-full bg-green-400" />
              <CallTimer answeredAt={answeredAt} />
            </div>
          </div>

          <div className="hidden items-center gap-2 text-xs text-gray-400 sm:flex">
            <span className="h-2 w-2 rounded-full bg-green-400" />
            Đã kết nối
          </div>
        </header>

        <section className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-[#15161a] p-2 shadow-2xl sm:p-3">
          <GridLayout
            tracks={tracks}
            className="h-full w-full gap-2 sm:gap-3"
          >
            <ParticipantTile className="overflow-hidden rounded-xl border border-white/10 bg-[#202126] shadow-lg" />
          </GridLayout>
        </section>

        <footer className="relative z-40 shrink-0 overflow-visible">
          <div className="relative mx-auto flex w-fit max-w-full items-center justify-center gap-2 overflow-visible rounded-2xl border border-white/10 bg-[#1b1c21] p-2 shadow-2xl [&_.lk-button]:!h-11 [&_.lk-button]:!min-w-11 [&_.lk-button]:!rounded-xl [&_.lk-button]:!border-white/10 [&_.lk-button]:!bg-white/10 [&_.lk-button]:!px-3 [&_.lk-button]:!text-white [&_.lk-button:hover]:!bg-white/15 [&_.lk-button-group-menu]:!hidden [&_.lk-control-bar]:!gap-1 [&_.lk-control-bar]:!border-0 [&_.lk-control-bar]:!bg-transparent [&_.lk-control-bar]:!p-0">
            <ControlBar
              variation="minimal"
              saveUserChoices
              controls={{
                microphone: true,
                camera: true,
                screenShare: true,
                chat: false,
                leave: false,
              }}
            />

            <button
              type="button"
              onClick={() =>
                setSpeakerMuted((current) => !current)
              }
              title={
                speakerMuted
                  ? "Bật âm thanh loa"
                  : "Tắt âm thanh loa"
              }
              aria-label={
                speakerMuted
                  ? "Bật âm thanh loa"
                  : "Tắt âm thanh loa"
              }
              aria-pressed={speakerMuted}
              className={`flex h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border px-3 text-sm font-semibold text-white transition ${
                speakerMuted
                  ? "border-red-400/40 bg-red-500/20 hover:bg-red-500/30"
                  : "border-white/10 bg-white/10 hover:bg-white/15"
              }`}
            >
              <span className="text-base">
                {speakerMuted ? "🔇" : "🔊"}
              </span>
              <span className="ml-2 hidden sm:inline">
                {speakerMuted ? "Bật loa" : "Tắt loa"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setShowDeviceSettings(true)}
              title="Cài đặt thiết bị"
              aria-label="Mở cài đặt thiết bị"
              className="flex h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/10 px-3 text-sm font-semibold text-white transition hover:bg-white/15"
            >
              <span className="text-base">⚙️</span>
              <span className="ml-2 hidden sm:inline">
                Cài đặt
              </span>
            </button>

            <div className="hidden h-8 w-px shrink-0 bg-white/10 sm:block" />

            <button
              type="button"
              onClick={onEnd}
              disabled={ending}
              className="h-11 shrink-0 rounded-xl bg-red-600 px-4 text-sm font-bold text-white shadow-lg transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60 sm:px-5"
            >
              {ending ? "Đang kết thúc..." : "📵 Kết thúc"}
            </button>
          </div>

          <p className="mt-1 text-center text-[11px] text-gray-500">
            Mic, loa, camera và chia sẻ màn hình ở ngoài; chọn thiết bị trong Cài đặt.
          </p>
        </footer>

        {showDeviceSettings && (
          <div
            className="fixed inset-0 z-[250] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label="Cài đặt thiết bị cuộc gọi"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setShowDeviceSettings(false);
              }
            }}
          >
            <section className="w-full max-w-md overflow-visible rounded-2xl border border-white/10 bg-[#1b1c21] p-5 text-white shadow-2xl [&_.lk-button]:!flex [&_.lk-button]:!h-12 [&_.lk-button]:!w-full [&_.lk-button]:!items-center [&_.lk-button]:!justify-between [&_.lk-button]:!rounded-xl [&_.lk-button]:!border-white/10 [&_.lk-button]:!bg-white/10 [&_.lk-button]:!px-4 [&_.lk-button]:!text-left [&_.lk-button]:!text-white [&_.lk-button:hover]:!bg-white/15 [&_.lk-device-menu]:!z-[400] [&_.lk-device-menu]:!max-h-[45vh] [&_.lk-device-menu]:!overflow-y-auto">
              <header className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold">
                    Cài đặt thiết bị
                  </h2>
                  <p className="mt-1 text-sm text-gray-400">
                    Chọn mic, loa và camera dùng trong cuộc gọi.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setShowDeviceSettings(false)
                  }
                  aria-label="Đóng cài đặt"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-lg text-gray-300 hover:bg-white/15 hover:text-white"
                >
                  ×
                </button>
              </header>

              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-gray-400">
                    Microphone
                  </label>
                  <MediaDeviceMenu kind="audioinput">
                    🎙 Chọn microphone
                  </MediaDeviceMenu>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-gray-400">
                    Loa
                  </label>
                  <MediaDeviceMenu kind="audiooutput">
                    🔊 Chọn loa
                  </MediaDeviceMenu>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-gray-400">
                    Camera
                  </label>
                  <MediaDeviceMenu kind="videoinput">
                    📷 Chọn camera
                  </MediaDeviceMenu>
                </div>
              </div>

              <div className="mt-5 rounded-xl bg-black/20 px-3 py-3 text-xs leading-5 text-gray-400">
                Trình duyệt cần được cấp quyền micro và camera để hiển thị đầy đủ tên thiết bị.
              </div>

              <button
                type="button"
                onClick={() => setShowDeviceSettings(false)}
                className="mt-5 h-11 w-full rounded-xl bg-indigo-500 font-bold text-white hover:bg-indigo-400"
              >
                Xong
              </button>
            </section>
          </div>
        )}

        {errorMessage && (
          <div className="fixed bottom-24 left-1/2 z-[100] w-[min(90vw,520px)] -translate-x-1/2 rounded-xl bg-red-500/95 px-4 py-3 text-center text-sm text-white shadow-2xl">
            {errorMessage}
          </div>
        )}

        <RoomAudioRenderer muted={speakerMuted} />
      </div>
    </div>
  );
}

export default function CallPage() {
  const params = useParams();
  const callId =
    typeof params.callId === "string"
      ? params.callId
      : "";

  const [currentUserId, setCurrentUserId] =
    useState("");
  const [call, setCall] =
    useState<CallSessionRow | null>(null);
  const [otherProfile, setOtherProfile] =
    useState<ProfileRow | null>(null);
  const [connection, setConnection] =
    useState<ConnectionDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [ending, setEnding] = useState(false);
  const [errorMessage, setErrorMessage] =
    useState("");

  const endingRef = useRef(false);
  const activeCallRef =
    useRef<CallSessionRow | null>(null);
  const accessTokenRef = useRef("");

  useEffect(() => {
    activeCallRef.current = call;
  }, [call]);

  const isCaller =
    Boolean(call) &&
    currentUserId === call?.caller_id;

  const otherUserId = useMemo(() => {
    if (!call || !currentUserId) return "";

    return currentUserId === call.caller_id
      ? call.receiver_id
      : call.caller_id;
  }, [call, currentUserId]);

  useEffect(() => {
    if (!callId) return;

    let active = true;
    let callChannel:
      | ReturnType<typeof supabase.channel>
      | null = null;

    async function initialize() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        window.location.href = "/login";
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      accessTokenRef.current =
        session?.access_token ?? "";

      await supabase.rpc("cleanup_stale_calls");

      if (!active) return;

      setCurrentUserId(user.id);

      const { data, error } = await supabase
        .from("call_sessions")
        .select(
          "id, caller_id, receiver_id, call_type, room_name, status, created_at, answered_at, ended_at, updated_at",
        )
        .eq("id", callId)
        .maybeSingle();

      if (!active) return;

      if (error || !data) {
        setErrorMessage(
          error?.message ??
            "Không tìm thấy cuộc gọi.",
        );
        setLoading(false);
        return;
      }

      const loadedCall = data as CallSessionRow;
      setCall(loadedCall);

      const profileId =
        user.id === loadedCall.caller_id
          ? loadedCall.receiver_id
          : loadedCall.caller_id;

      const { data: profileData } = await supabase
        .from("profiles")
        .select("id, username, avatar_url")
        .eq("id", profileId)
        .maybeSingle();

      if (!active) return;

      setOtherProfile(profileData ?? null);

      callChannel = supabase
        .channel(`call-session-${callId}-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "call_sessions",
            filter: `id=eq.${callId}`,
          },
          (payload) => {
            if (!active) return;
            setCall(payload.new as CallSessionRow);
          },
        )
        .subscribe();

      setLoading(false);
    }

    void initialize();

    return () => {
      active = false;

      if (callChannel) {
        void supabase.removeChannel(callChannel);
      }
    };
  }, [callId]);

  useEffect(() => {
    if (
      !call ||
      !currentUserId ||
      !["ringing", "accepted"].includes(call.status)
    ) {
      return;
    }

    const heartbeatCallId = call.id;
    let active = true;

    async function sendHeartbeat() {
      const { data, error } = await supabase.rpc(
        "heartbeat_private_call",
        {
          p_call_id: heartbeatCallId,
        },
      );

      if (!active || error || !data) return;

      const updatedCall = (
        Array.isArray(data) ? data[0] : data
      ) as CallSessionRow | null;

      if (updatedCall) {
        setCall(updatedCall);
      }
    }

    void sendHeartbeat();

    const timer = window.setInterval(() => {
      void sendHeartbeat();
    }, 20_000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [call?.id, call?.status, currentUserId]);

  useEffect(() => {
    function endCallWhenLeaving() {
      const activeCall = activeCallRef.current;

      if (
        !activeCall ||
        !["ringing", "accepted"].includes(
          activeCall.status,
        ) ||
        endingRef.current
      ) {
        return;
      }

      const accessToken = accessTokenRef.current;

      if (!accessToken) return;

      endingRef.current = true;

      void fetch("/api/end-call", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          call_id: activeCall.id,
        }),
        keepalive: true,
      }).catch(() => {
        // Heartbeat + cleanup_stale_calls sẽ xử lý nếu
        // trình duyệt đóng trước khi request hoàn tất.
      });
    }

    window.addEventListener(
      "pagehide",
      endCallWhenLeaving,
    );
    window.addEventListener(
      "beforeunload",
      endCallWhenLeaving,
    );

    return () => {
      window.removeEventListener(
        "pagehide",
        endCallWhenLeaving,
      );
      window.removeEventListener(
        "beforeunload",
        endCallWhenLeaving,
      );
    };
  }, []);

  useEffect(() => {
    if (
      call?.status !== "accepted" ||
      connection ||
      !currentUserId
    ) {
      return;
    }

    let active = true;

    async function loadToken() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        window.location.href = "/login";
        return;
      }

      const response = await fetch(
        "/api/livekit-token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            call_id: callId,
          }),
        },
      );

      const data = (await response.json()) as
        | ConnectionDetails
        | { error?: string };

      if (!active) return;

      if (!response.ok) {
        setErrorMessage(
          "error" in data && data.error
            ? data.error
            : "Không thể kết nối máy chủ cuộc gọi.",
        );
        return;
      }

      setConnection(data as ConnectionDetails);
    }

    void loadToken();

    return () => {
      active = false;
    };
  }, [
    call?.status,
    callId,
    connection,
    currentUserId,
  ]);

  useEffect(() => {
    if (
      call?.status !== "declined" &&
      call?.status !== "ended" &&
      call?.status !== "missed"
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      window.location.href = otherUserId
        ? `/messages?user=${encodeURIComponent(
            otherUserId,
          )}`
        : "/messages";
    }, 1600);

    return () => {
      window.clearTimeout(timer);
    };
  }, [call?.status, otherUserId]);

  async function respond(
    response: "accepted" | "declined",
  ) {
    if (!call || working) return;

    setWorking(true);
    setErrorMessage("");

    const { data, error } = await supabase.rpc(
      "respond_private_call",
      {
        p_call_id: call.id,
        p_response: response,
      },
    );

    const result = Array.isArray(data) ? data[0] : data;

    if (error) {
      setErrorMessage(error.message);
      setWorking(false);
      return;
    }

    if (result) {
      setCall(result as CallSessionRow);
    }

    if (response === "declined") {
      window.location.href = otherUserId
        ? `/messages?user=${encodeURIComponent(
            otherUserId,
          )}`
        : "/messages";
    }

    setWorking(false);
  }

  async function finishCall() {
    if (!call || endingRef.current) return;

    endingRef.current = true;
    setEnding(true);
    setErrorMessage("");

    const { error } = await supabase.rpc(
      "end_private_call",
      {
        p_call_id: call.id,
      },
    );

    if (error) {
      endingRef.current = false;
      setEnding(false);
      setErrorMessage(
        `Không thể kết thúc cuộc gọi: ${error.message}`,
      );
      return;
    }

    window.location.href = otherUserId
      ? `/messages?user=${encodeURIComponent(
          otherUserId,
        )}`
      : "/messages";
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#111214] text-white">
        Đang tải cuộc gọi...
      </main>
    );
  }

  if (!call) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#111214] px-4 text-white">
        <section className="max-w-md rounded-xl bg-[#313338] p-6 text-center">
          <h1 className="text-2xl font-bold">
            Không thể mở cuộc gọi
          </h1>
          <p className="mt-3 text-red-300">
            {errorMessage}
          </p>
          <button
            type="button"
            onClick={() => {
              window.location.href = "/messages";
            }}
            className="mt-5 rounded-md bg-indigo-500 px-5 py-3 font-semibold"
          >
            Quay lại tin nhắn
          </button>
        </section>
      </main>
    );
  }

  if (call.status === "ringing") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#111214] px-4 text-white">
        <section className="w-full max-w-md rounded-2xl bg-[#313338] p-8 text-center shadow-2xl">
          {otherProfile?.avatar_url ? (
            <img
              src={otherProfile.avatar_url}
              alt={otherProfile.username}
              className="mx-auto h-28 w-28 rounded-full object-cover"
            />
          ) : (
            <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-full bg-indigo-500 text-5xl font-bold">
              {(otherProfile?.username ?? "T")
                .charAt(0)
                .toUpperCase()}
            </div>
          )}

          <h1 className="mt-5 text-2xl font-bold">
            {otherProfile?.username ?? "Thành viên"}
          </h1>

          <p className="mt-2 text-gray-400">
            {isCaller
              ? `Đang gọi ${
                  call.call_type === "video"
                    ? "video"
                    : "thoại"
                }...`
              : `${
                  call.call_type === "video"
                    ? "Cuộc gọi video"
                    : "Cuộc gọi thoại"
                } đến`}
          </p>

          {errorMessage && (
            <p className="mt-4 rounded-md bg-red-500/15 px-3 py-2 text-sm text-red-300">
              {errorMessage}
            </p>
          )}

          {isCaller ? (
            <button
              type="button"
              onClick={() => void finishCall()}
              disabled={ending}
              className="mt-7 rounded-xl bg-red-500 px-8 py-3 font-bold hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {ending
                ? "Đang kết thúc..."
                : "Hủy cuộc gọi"}
            </button>
          ) : (
            <div className="mt-7 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => void respond("declined")}
                disabled={working}
                className="rounded-xl bg-red-500 px-4 py-3 font-bold hover:bg-red-400 disabled:opacity-50"
              >
                Từ chối
              </button>

              <button
                type="button"
                onClick={() => void respond("accepted")}
                disabled={working}
                className="rounded-xl bg-green-600 px-4 py-3 font-bold hover:bg-green-500 disabled:opacity-50"
              >
                Trả lời
              </button>
            </div>
          )}
        </section>
      </main>
    );
  }

  if (
    call.status === "declined" ||
    call.status === "ended" ||
    call.status === "missed"
  ) {
    const message =
      call.status === "declined"
        ? "Cuộc gọi đã bị từ chối."
        : call.status === "missed"
          ? "Cuộc gọi bị nhỡ."
          : "Cuộc gọi đã kết thúc.";

    return (
      <main className="flex min-h-screen items-center justify-center bg-[#111214] text-white">
        <div className="text-center">
          <div className="text-6xl">📵</div>
          <h1 className="mt-4 text-2xl font-bold">
            {message}
          </h1>
          <p className="mt-2 text-gray-400">
            Đang quay lại tin nhắn...
          </p>
        </div>
      </main>
    );
  }

  if (!connection) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#111214] px-4 text-white">
        <div className="text-center">
          <div className="text-5xl">📡</div>
          <p className="mt-4">
            Đang kết nối cuộc gọi...
          </p>
          {errorMessage && (
            <p className="mt-3 text-red-300">
              {errorMessage}
            </p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="h-screen overflow-hidden bg-[#0d0e11]">
      <LiveKitRoom
        serverUrl={connection.server_url}
        token={connection.participant_token}
        connect
        audio
        video={call.call_type === "video"}
        onDisconnected={() => void finishCall()}
        data-lk-theme="default"
        style={{ height: "100vh" }}
      >
        <CompactCallStage
          callType={call.call_type}
          answeredAt={call.answered_at}
          otherProfile={otherProfile}
          ending={ending}
          errorMessage={errorMessage}
          onEnd={() => void finishCall()}
        />
      </LiveKitRoom>
    </main>
  );
}
