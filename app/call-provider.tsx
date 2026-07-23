"use client";

import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { createClient } from "@/utils/supabase/client";
import {
  getNotificationsEnabled,
  playNotificationSound,
} from "@/utils/notifications";

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

type CallerProfile = {
  id: string;
  username: string;
  avatar_url: string | null;
};

export default function CallProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [incomingCall, setIncomingCall] =
    useState<CallSessionRow | null>(null);
  const [caller, setCaller] =
    useState<CallerProfile | null>(null);
  const [working, setWorking] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const lastNotifiedCallId = useRef("");

  useEffect(() => {
    let active = true;
    let callChannel:
      | ReturnType<typeof supabase.channel>
      | null = null;

    async function showIncomingCall(call: CallSessionRow) {
      if (
        call.status !== "ringing" ||
        new Date(call.created_at).getTime() <
          Date.now() - 90_000
      ) {
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("id, username, avatar_url")
        .eq("id", call.caller_id)
        .maybeSingle();

      if (!active) return;

      setIncomingCall(call);
      setCaller(data ?? null);

      if (
        lastNotifiedCallId.current !== call.id &&
        getNotificationsEnabled() &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        lastNotifiedCallId.current = call.id;

        const notification = new Notification(
          `${
            call.call_type === "video"
              ? "Cuộc gọi video"
              : "Cuộc gọi thoại"
          } từ ${data?.username ?? "một thành viên"}`,
          {
            body: "Mở Talk Cùng Lâm DZ để trả lời.",
            icon: "/icon.png",
            tag: `incoming-call-${call.id}`,
          },
        );

        notification.onclick = () => {
          window.focus();
          window.location.href = `/call/${call.id}`;
          notification.close();
        };
      }
    }

    async function initialize() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || !active) return;

      const { data: existingCall } = await supabase
        .from("call_sessions")
        .select(
          "id, caller_id, receiver_id, call_type, room_name, status, created_at, answered_at, ended_at, updated_at",
        )
        .eq("receiver_id", user.id)
        .eq("status", "ringing")
        .gte(
          "created_at",
          new Date(Date.now() - 90_000).toISOString(),
        )
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingCall) {
        await showIncomingCall(
          existingCall as CallSessionRow,
        );
      }

      callChannel = supabase
        .channel(`incoming-calls-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "call_sessions",
            filter: `receiver_id=eq.${user.id}`,
          },
          (payload) => {
            if (!active) return;

            if (
              payload.eventType === "INSERT" ||
              payload.eventType === "UPDATE"
            ) {
              const changedCall =
                payload.new as CallSessionRow;

              if (changedCall.status === "ringing") {
                void showIncomingCall(changedCall);
              } else if (
                incomingCall?.id === changedCall.id
              ) {
                setIncomingCall(null);
                setCaller(null);
              }
            }

            if (
              payload.eventType === "DELETE" &&
              incomingCall?.id ===
                (payload.old as Partial<CallSessionRow>).id
            ) {
              setIncomingCall(null);
              setCaller(null);
            }
          },
        )
        .subscribe();
    }

    void initialize();

    return () => {
      active = false;

      if (callChannel) {
        void supabase.removeChannel(callChannel);
      }
    };
  }, [incomingCall?.id]);

  useEffect(() => {
    if (!incomingCall) return;

    void playNotificationSound();

    const timer = window.setInterval(() => {
      void playNotificationSound();
    }, 3000);

    return () => {
      window.clearInterval(timer);
    };
  }, [incomingCall]);

  async function acceptCall() {
    if (!incomingCall || working) return;

    setWorking(true);
    setErrorMessage("");

    const { data, error } = await supabase.rpc(
      "respond_private_call",
      {
        p_call_id: incomingCall.id,
        p_response: "accepted",
      },
    );

    const result = Array.isArray(data) ? data[0] : data;

    if (error) {
      setErrorMessage(
        `Không thể nhận cuộc gọi: ${error.message}`,
      );
      setWorking(false);
      return;
    }

    if (result?.status !== "accepted") {
      setErrorMessage("Cuộc gọi đã hết hạn.");
      setIncomingCall(null);
      setCaller(null);
      setWorking(false);
      return;
    }

    window.location.href = `/call/${incomingCall.id}`;
  }

  async function declineCall() {
    if (!incomingCall || working) return;

    setWorking(true);
    setErrorMessage("");

    const { error } = await supabase.rpc(
      "respond_private_call",
      {
        p_call_id: incomingCall.id,
        p_response: "declined",
      },
    );

    if (error) {
      setErrorMessage(
        `Không thể từ chối cuộc gọi: ${error.message}`,
      );
      setWorking(false);
      return;
    }

    setIncomingCall(null);
    setCaller(null);
    setWorking(false);
  }

  return (
    <>
      {children}

      {incomingCall && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4">
          <section className="w-full max-w-sm rounded-2xl bg-[#313338] p-6 text-center text-white shadow-2xl">
            {caller?.avatar_url ? (
              <img
                src={caller.avatar_url}
                alt={caller.username}
                className="mx-auto h-24 w-24 rounded-full object-cover"
              />
            ) : (
              <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-indigo-500 text-4xl font-bold">
                {(caller?.username ?? "T")
                  .charAt(0)
                  .toUpperCase()}
              </div>
            )}

            <h2 className="mt-5 text-2xl font-bold">
              {caller?.username ?? "Thành viên"}
            </h2>

            <p className="mt-2 text-gray-400">
              {incomingCall.call_type === "video"
                ? "Đang gọi video cho bạn..."
                : "Đang gọi thoại cho bạn..."}
            </p>

            {errorMessage && (
              <p className="mt-3 rounded-md bg-red-500/15 px-3 py-2 text-sm text-red-300">
                {errorMessage}
              </p>
            )}

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => void declineCall()}
                disabled={working}
                className="rounded-xl bg-red-500 px-4 py-3 font-bold hover:bg-red-400 disabled:opacity-50"
              >
                Từ chối
              </button>

              <button
                type="button"
                onClick={() => void acceptCall()}
                disabled={working}
                className="rounded-xl bg-green-600 px-4 py-3 font-bold hover:bg-green-500 disabled:opacity-50"
              >
                {working ? "Đang xử lý..." : "Trả lời"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
