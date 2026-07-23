"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
};

export default function InstallAppButton() {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia(
        "(display-mode: standalone)",
      ).matches ||
      (
        window.navigator as Navigator & {
          standalone?: boolean;
        }
      ).standalone === true;

    setInstalled(standalone);

    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(
        event as BeforeInstallPromptEvent,
      );
    }

    function handleInstalled() {
      setInstalled(true);
      setInstallPrompt(null);
    }

    window.addEventListener(
      "beforeinstallprompt",
      handleBeforeInstallPrompt,
    );
    window.addEventListener(
      "appinstalled",
      handleInstalled,
    );

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
      window.removeEventListener(
        "appinstalled",
        handleInstalled,
      );
    };
  }, []);

  async function installApp() {
    if (!installPrompt) return;

    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  if (installed) {
    return (
      <span className="rounded-md bg-green-500/15 px-4 py-2 text-sm font-semibold text-green-300">
        Đã cài trên thiết bị
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void installApp()}
      disabled={!installPrompt}
      className="rounded-md bg-indigo-500 px-4 py-2 font-semibold hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
      title={
        installPrompt
          ? "Cài ứng dụng"
          : "Nếu nút chưa sáng, hãy dùng biểu tượng Cài đặt trên thanh địa chỉ Chrome."
      }
    >
      Cài ứng dụng
    </button>
  );
}
