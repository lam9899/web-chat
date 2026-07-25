/* global self, clients */

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let payload = {};

      try {
        payload = event.data
          ? event.data.json()
          : {};
      } catch {
        payload = {
          title: "Talk Cùng Lâm DZ",
          body: event.data?.text() ?? "Bạn có thông báo mới.",
        };
      }

      const openClients = await clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      const hasVisibleWindow = openClients.some(
        (client) =>
          client.visibilityState === "visible",
      );

      if (
        hasVisibleWindow &&
        payload.suppressWhenVisible !== false
      ) {
        return;
      }

      await self.registration.showNotification(
        payload.title || "Talk Cùng Lâm DZ",
        {
          body:
            payload.body ||
            "Bạn có thông báo mới.",
          icon: payload.icon || "/icon.png",
          badge: payload.badge || "/icon.png",
          tag:
            payload.tag ||
            `talk-${Date.now()}`,
          renotify: Boolean(payload.renotify),
          requireInteraction: Boolean(
            payload.requireInteraction,
          ),
          silent: false,
          vibrate: payload.vibrate || [180, 80, 180],
          timestamp:
            payload.timestamp || Date.now(),
          data: {
            url: payload.url || "/",
            type: payload.type || "general",
          },
        },
      );
    })(),
  );
});

self.addEventListener(
  "notificationclick",
  (event) => {
    event.notification.close();

    event.waitUntil(
      (async () => {
        const targetUrl = new URL(
          event.notification.data?.url || "/",
          self.location.origin,
        ).href;

        const openClients = await clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });

        for (const client of openClients) {
          if (
            new URL(client.url).origin ===
            self.location.origin
          ) {
            if ("navigate" in client) {
              await client.navigate(targetUrl);
            }

            return client.focus();
          }
        }

        return clients.openWindow(targetUrl);
      })(),
    );
  },
);
