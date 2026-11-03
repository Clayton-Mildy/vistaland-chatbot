// Shows the pushes the API sends (see api/src/notify/push.ts) and opens the dashboard on a click.
self.addEventListener("push", (event) => {
  let note = { title: "Moni", body: "", url: "/" };
  try {
    note = { ...note, ...event.data.json() };
  } catch {
    // an empty or non-JSON push still shows the default notice
  }
  event.waitUntil(self.registration.showNotification(note.title, { body: note.body, data: { url: note.url } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((open) => {
      const same = open.find((c) => new URL(c.url).origin === new URL(url, self.location.origin).origin);
      if (same) return same.focus().then(() => same.navigate(url)).catch(() => self.clients.openWindow(url));
      return self.clients.openWindow(url);
    })
  );
});
