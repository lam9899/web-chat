"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  ControlBar,
  GridLayout,
  LiveKitRoom,
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

        <footer className="shrink-0">
          <div className="mx-auto flex w-fit max-w-full items-center gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-[#1b1c21]/95 p-2 shadow-2xl backdrop-blur [&_.lk-button]:!h-11 [&_.lk-button]:!min-w-11 [&_.lk-button]:!rounded-xl [&_.lk-button]:!border-white/10 [&_.lk-button]:!bg-white/10 [&_.lk-button]:!px-3 [&_.lk-button]:!text-white [&_.lk-button:hover]:!bg-white/15 [&_.lk-control-bar]:!gap-1 [&_.lk-control-bar]:!border-0 [&_.lk-control-bar]:!bg-transparent [&_.lk-control-bar]:!p-0">
            <ControlBar
              variation="minimal"
              saveUserChoices
              controls={{
                microphone: true,
                camera: callType === "video",
                screenShare: callType === "video",
                chat: false,
                leave: false,
              }}
            />

            <div className="h-8 w-px shrink-0 bg-white/10" />

            <button
              type="button"
              onClick={onEnd}
              disabled={ending}
              className="h-11 shrink-0 rounded-xl bg-red-600 px-4 text-sm font-bold text-white shadow-lg hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60 sm:px-5"
            >
              {ending ? "Đang kết thúc..." : "📵 Kết thúc"}
            </button>
          </div>
        </footer>

        {errorMessage && (
          <div className="fixed bottom-24 left-1/2 z-[100] w-[min(90vw,520px)] -translate-x-1/2 rounded-xl bg-red-500/95 px-4 py-3 text-center text-sm text-white shadow-2xl">
            {errorMessage}
          </div>
        )}

        <RoomAudioRenderer />
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
