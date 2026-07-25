"use client";

import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { createClient } from "@/utils/supabase/client";
import {
  removePushSubscription,
  savePushSubscription,
  urlBase64ToUint8Array,
} from "@/utils/push-notifications";

const supabase = createClient();

const PUSH_WORKER_URL = "/push/worker.js";
const PUSH_WORKER_SCOPE = "/push/";
const DISMISS_KEY = "talk-push-prompt-dismissed";

async function waitForWorkerActivation(
  registration: ServiceWorkerRegistration,
) {
  if (registration.active) return registration;

  const worker =
    registration.installing ?? registration.waiting;

  if (!worker) return registration;

  // Gán sang biến có kiểu chắc chắn để TypeScript giữ
  // trạng thái không-null bên trong callback checkState.
  const activationWorker: ServiceWorker = worker;

  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(resolve, 5000);

    function finish() {
      window.clearTimeout(timeout);
      activationWorker.removeEventListener(
        "statechange",
        checkState,
      );
      resolve();
    }

    function checkState() {
      if (activationWorker.state === "activated") {
        finish();
      }
    }

    activationWorker.addEventListener(
      "statechange",
      checkState,
    );
    checkState();
  });

  return registration;
}

async function getPushRegistration() {
  const registration =
    await navigator.serviceWorker.register(
      PUSH_WORKER_URL,
      {
        scope: PUSH_WORKER_SCOPE,
        updateViaCache: "none",
      },
    );

  return waitForWorkerActivation(registration);
}

export default function PushNotificationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [working, setWorking] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const registrationRef =
    useRef<ServiceWorkerRegistration | null>(null);
  const lastAccessTokenRef = useRef("");

  useEffect(() => {
    let active = true;

    async function initialize() {
      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session || !active) return;

      lastAccessTokenRef.current =
        session.access_token;

      try {
        const registration =
          await getPushRegistration();

        if (!active) return;

        registrationRef.current = registration;

        const subscription =
          await registration.pushManager.getSubscription();

        if (
          Notification.permission === "granted" &&
          subscription
        ) {
          await savePushSubscription(
            subscription,
            session.access_token,
          );
          return;
        }

        if (
          Notification.permission !== "denied" &&
          window.sessionStorage.getItem(DISMISS_KEY) !==
            "1"
        ) {
          setShowPrompt(true);
        }
      } catch (error) {
        console.warn(
          "Không thể khởi tạo Web Push:",
          error,
        );
      }
    }

    void initialize();

    const {
      data: { subscription: authSubscription },
    } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (session?.access_token) {
          lastAccessTokenRef.current =
            session.access_token;
        }

        if (event === "SIGNED_IN") {
          void initialize();
        }

        if (event === "SIGNED_OUT") {
          const previousToken =
            lastAccessTokenRef.current;

          void (async () => {
            try {
              const registration =
                registrationRef.current ??
                (await getPushRegistration());
              const subscription =
                await registration.pushManager.getSubscription();

              if (subscription) {
                await removePushSubscription(
                  subscription.endpoint,
                  previousToken,
                ).catch(() => undefined);

                await subscription.unsubscribe();
              }
            } finally {
              lastAccessTokenRef.current = "";
              setShowPrompt(false);
            }
          })();
        }
      },
    );

    return () => {
      active = false;
      authSubscription.unsubscribe();
    };
  }, []);

  async function enablePushNotifications() {
    if (working) return;

    setWorking(true);
    setErrorMessage("");

    try {
      const publicKey =
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

      if (!publicKey) {
        throw new Error(
          "Thiếu NEXT_PUBLIC_VAPID_PUBLIC_KEY.",
        );
      }

      const permission =
        await Notification.requestPermission();

      if (permission !== "granted") {
        throw new Error(
          "Bạn chưa cho phép trình duyệt gửi thông báo.",
        );
      }

      const registration =
        registrationRef.current ??
        (await getPushRegistration());

      registrationRef.current = registration;

      let subscription =
        await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription =
          await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey:
              urlBase64ToUint8Array(publicKey),
          });
      }

      await savePushSubscription(subscription);

      window.sessionStorage.removeItem(DISMISS_KEY);
      setShowPrompt(false);

      await registration.showNotification(
        "Đã bật thông báo",
        {
          body:
            "Bạn sẽ nhận thông báo tin nhắn, lời mời kết bạn và cuộc gọi mới.",
          icon: "/icon.png",
          badge: "/icon.png",
          tag: "push-enabled",
          data: {
            url: "/",
          },
        },
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Không thể bật thông báo.",
      );
    } finally {
      setWorking(false);
    }
  }

  function dismissPrompt() {
    window.sessionStorage.setItem(DISMISS_KEY, "1");
    setShowPrompt(false);
  }

  return (
    <>
      {children}

      {showPrompt && (
        <section className="fixed bottom-4 right-4 z-[150] w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-[#23252b] p-4 text-white shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-2xl">
              🔔
            </div>

            <div className="min-w-0 flex-1">
              <h2 className="font-bold">
                Bật thông báo
              </h2>
              <p className="mt-1 text-sm leading-5 text-gray-400">
                Nhận tin nhắn, lời mời kết bạn và cuộc gọi khi bạn đang ở trang khác hoặc đóng tab.
              </p>
            </div>
          </div>

          {errorMessage && (
            <p className="mt-3 rounded-xl bg-red-500/15 px-3 py-2 text-sm text-red-300">
              {errorMessage}
            </p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={dismissPrompt}
              disabled={working}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-white/10 disabled:opacity-50"
            >
              Để sau
            </button>

            <button
              type="button"
              onClick={() =>
                void enablePushNotifications()
              }
              disabled={working}
              className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-bold hover:bg-indigo-400 disabled:opacity-50"
            >
              {working
                ? "Đang bật..."
                : "Bật thông báo"}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
