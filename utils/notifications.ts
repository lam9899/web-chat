export const NOTIFICATIONS_ENABLED_KEY =
  "talkcunglamdz-notifications-enabled";
export const SOUND_ENABLED_KEY =
  "talkcunglamdz-sound-enabled";
const LAST_NOTIFIED_MESSAGE_KEY =
  "talkcunglamdz-last-notified-message";

type WebkitAudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

type PrivateMessageNotification = {
  messageId: number;
  senderId: string;
  senderName?: string;
  content?: string;
};

function isBrowser() {
  return typeof window !== "undefined";
}

export function supportsBrowserNotifications() {
  return isBrowser() && "Notification" in window;
}

export function getNotificationPermission():
  | NotificationPermission
  | "unsupported" {
  if (!supportsBrowserNotifications()) {
    return "unsupported";
  }

  return Notification.permission;
}

export function getNotificationsEnabled() {
  if (!isBrowser()) return false;

  return (
    supportsBrowserNotifications() &&
    Notification.permission === "granted" &&
    window.localStorage.getItem(
      NOTIFICATIONS_ENABLED_KEY,
    ) === "true"
  );
}

export function setNotificationsEnabled(enabled: boolean) {
  if (!isBrowser()) return;

  window.localStorage.setItem(
    NOTIFICATIONS_ENABLED_KEY,
    String(enabled),
  );
}

export function getSoundEnabled() {
  if (!isBrowser()) return false;

  return (
    window.localStorage.getItem(SOUND_ENABLED_KEY) ===
    "true"
  );
}

export function setSoundEnabled(enabled: boolean) {
  if (!isBrowser()) return;

  window.localStorage.setItem(
    SOUND_ENABLED_KEY,
    String(enabled),
  );
}

export async function requestNotificationPermission() {
  if (!supportsBrowserNotifications()) {
    return "unsupported" as const;
  }

  const permission =
    await Notification.requestPermission();

  setNotificationsEnabled(permission === "granted");
  return permission;
}

export async function playNotificationSound() {
  if (!isBrowser() || !getSoundEnabled()) return;

  try {
    const audioWindow = window as WebkitAudioWindow;
    const AudioContextClass =
      window.AudioContext ||
      audioWindow.webkitAudioContext;

    if (!AudioContextClass) return;

    const context = new AudioContextClass();

    if (context.state === "suspended") {
      await context.resume();
    }

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startTime = context.currentTime;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(660, startTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      880,
      startTime + 0.12,
    );

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(
      0.12,
      startTime + 0.02,
    );
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      startTime + 0.2,
    );

    oscillator.connect(gain);
    gain.connect(context.destination);

    oscillator.start(startTime);
    oscillator.stop(startTime + 0.2);

    window.setTimeout(() => {
      void context.close();
    }, 350);
  } catch {
    // Một số trình duyệt chặn âm thanh trước khi người dùng tương tác.
  }
}

export async function notifyPrivateMessage({
  messageId,
  senderId,
  senderName = "một thành viên",
  content = "Bạn có tin nhắn riêng mới.",
}: PrivateMessageNotification) {
  if (!isBrowser()) return;

  const notificationKey = String(messageId);

  if (
    window.localStorage.getItem(
      LAST_NOTIFIED_MESSAGE_KEY,
    ) === notificationKey
  ) {
    return;
  }

  window.localStorage.setItem(
    LAST_NOTIFIED_MESSAGE_KEY,
    notificationKey,
  );

  await playNotificationSound();

  if (!getNotificationsEnabled()) return;

  try {
    const cleanContent = content.trim();
    const notification = new Notification(
      `Tin nhắn từ ${senderName}`,
      {
        body:
          cleanContent.length > 0
            ? cleanContent.slice(0, 160)
            : "Bạn có tin nhắn riêng mới.",
        icon: "/icon.png",
        tag: `direct-message-${messageId}`,
      },
    );

    notification.onclick = () => {
      window.focus();
      window.location.href = `/messages?user=${encodeURIComponent(
        senderId,
      )}`;
      notification.close();
    };
  } catch {
    // Trên một số trình duyệt di động cần service worker để hiện thông báo.
  }
}
