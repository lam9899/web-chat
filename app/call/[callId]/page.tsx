"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  AudioConference,
  LiveKitRoom,
  VideoConference,
} from "@livekit/components-react";
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
    <main className="h-screen overflow-hidden bg-black">
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
        <div className="absolute left-4 top-4 z-50 rounded-lg bg-black/60 px-4 py-2 text-white backdrop-blur">
          <div className="font-bold">
            {otherProfile?.username ?? "Cuộc gọi"}
          </div>
          <div className="text-xs text-gray-300">
            {call.call_type === "video"
              ? "Gọi video"
              : "Gọi thoại"}
          </div>
        </div>

        <button
          type="button"
          onClick={() => void finishCall()}
          disabled={ending}
          className="fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 rounded-full bg-red-600 px-7 py-3 font-bold text-white shadow-2xl hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {ending
            ? "Đang kết thúc..."
            : "📵 Kết thúc cuộc gọi"}
        </button>

        {errorMessage && (
          <div className="fixed bottom-24 left-1/2 z-[100] w-[min(90vw,520px)] -translate-x-1/2 rounded-lg bg-red-500/90 px-4 py-3 text-center text-sm text-white shadow-xl">
            {errorMessage}
          </div>
        )}

        {call.call_type === "video" ? (
          <VideoConference />
        ) : (
          <AudioConference />
        )}
      </LiveKitRoom>
    </main>
  );
}
