/* Service worker do ID System Universe: recebe o push (celular e computador) e mostra a notificação. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const IS_APPLE = /iPhone|iPad|iPod/i.test(self.navigator.userAgent);

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "ID System Universe", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    (async () => {
      // Aba focada e visível: o pop-up dentro do app já avisou. (No iPhone/iPad o sistema exige sempre mostrar.)
      if (!IS_APPLE) {
        const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        if (wins.some((w) => w.visibilityState === "visible" && w.focused)) return;
      }
      await self.registration.showNotification(data.title || "ID System Universe", {
        body: data.body || "",
        tag: data.tag || undefined,
        renotify: Boolean(data.tag),
        icon: "/icons/icon-192.png",
        badge: "/icons/badge.png",
        data: { url: data.url || "/" },
        requireInteraction: data.kind === "approval",
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if ("focus" in w) {
          await w.focus();
          if ("navigate" in w) await w.navigate(url).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
