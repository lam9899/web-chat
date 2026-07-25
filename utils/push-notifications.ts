"use client";

import { createClient } from "@/utils/supabase/client";

const supabase = createClient();

export type PushEventType =
  | "private_message"
  | "incoming_call"
  | "friend_request";

type SendPushInput = {
  targetUserId: string;
  type: PushEventType;
  body?: string;
  callId?: string;
  callType?: "audio" | "video";
};

type SubscriptionPayload = {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

async function getAccessToken() {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return session?.access_token ?? "";
}

async function authorizedFetch(
  url: string,
  init: RequestInit,
  suppliedToken?: string,
) {
  const token = suppliedToken ?? (await getAccessToken());

  if (!token) {
    throw new Error("Bạn chưa đăng nhập.");
  }

  return fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
}

export function urlBase64ToUint8Array(
  base64String: string,
) {
  const padding = "=".repeat(
    (4 - (base64String.length % 4)) % 4,
  );
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);

  return Uint8Array.from(
    [...rawData].map((character) =>
      character.charCodeAt(0),
    ),
  );
}

export async function savePushSubscription(
  subscription: PushSubscription,
  suppliedToken?: string,
) {
  const json =
    subscription.toJSON() as SubscriptionPayload;

  if (
    !json.endpoint ||
    !json.keys?.p256dh ||
    !json.keys?.auth
  ) {
    throw new Error(
      "Trình duyệt không trả về đủ khóa đăng ký thông báo.",
    );
  }

  const response = await authorizedFetch(
    "/api/push/subscribe",
    {
      method: "POST",
      body: JSON.stringify(json),
    },
    suppliedToken,
  );

  const result = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;

  if (!response.ok) {
    throw new Error(
      result?.error ??
        "Không thể lưu thiết bị nhận thông báo.",
    );
  }
}

export async function removePushSubscription(
  endpoint: string,
  suppliedToken?: string,
) {
  if (!endpoint) return;

  const response = await authorizedFetch(
    "/api/push/subscribe",
    {
      method: "DELETE",
      body: JSON.stringify({ endpoint }),
    },
    suppliedToken,
  );

  if (!response.ok) {
    const result = (await response
      .json()
      .catch(() => null)) as
      | { error?: string }
      | null;

    throw new Error(
      result?.error ??
        "Không thể xóa thiết bị nhận thông báo.",
    );
  }
}

export async function sendPushToUser(
  input: SendPushInput,
) {
  try {
    const token = await getAccessToken();

    if (!token) return;

    await authorizedFetch(
      "/api/push/send",
      {
        method: "POST",
        keepalive: true,
        body: JSON.stringify(input),
      },
      token,
    );
  } catch (error) {
    console.warn("Không thể gửi Web Push:", error);
  }
}
