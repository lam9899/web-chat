"use client";

import { useEffect } from "react";

export default function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((error: unknown) => {
          console.error(
            "Không thể đăng ký service worker:",
            error,
          );
        });
    }
  }, []);

  return null;
}
