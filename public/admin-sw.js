// Service worker du back office : reçoit les notifications push (même page fermée) et ouvre /admin au toucher.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { /* texte brut */ }
  e.waitUntil(self.registration.showNotification(d.title || "Nouvelle demande", {
    body: d.body || "",
    tag: d.tag || "req",
    renotify: true,
    requireInteraction: true,
    vibrate: [400, 150, 400, 150, 800],
    icon: "/admin-icon-192.png",
    badge: "/admin-icon-192.png",
    data: { url: d.url || "/admin" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/admin";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.includes("/admin") && "focus" in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
