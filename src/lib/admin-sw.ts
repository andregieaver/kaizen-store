/**
 * The admin's service worker (wave 9 unit H, D361), as the text `/admin/sw.js` serves: scoped to `/admin/`, it keeps only the offline page
 * (`/admin/offline`) and Kaizena Flow's default icon in Cache Storage (`kaizen-admin-shell-{version}`, never a signed-in page or any data), answers a
 * page load it cannot fetch with that page, shows a push's notification (title, body, tag) and opens its address on a press, only an
 * address of the admin on the same site. Pure text, so a test reads what it does.
 */

export const ADMIN_SW_VERSION = 1;
export const ADMIN_SHELL_CACHE = `kaizen-admin-shell-${ADMIN_SW_VERSION}`;
export const ADMIN_OFFLINE_PATH = "/admin/offline";

export function adminServiceWorker(): string {
  return `/* Kaizena Flow admin service worker, version ${ADMIN_SW_VERSION} (D361). */
const CACHE = ${JSON.stringify(ADMIN_SHELL_CACHE)};
const OFFLINE = ${JSON.stringify(ADMIN_OFFLINE_PATH)};
const SHELL = [OFFLINE, "/kaizen/favicon.ico"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("kaizen-admin-shell-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode !== "navigate") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/admin")) return;
  event.respondWith(fetch(request).catch(() => caches.match(OFFLINE).then((page) => page || Response.error())));
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = {};
  }
  const title = typeof data.title === "string" ? data.title.slice(0, 120) : "Kaizena Flow";
  const options = {
    body: typeof data.body === "string" ? data.body.slice(0, 240) : "",
    tag: typeof data.tag === "string" ? data.tag.slice(0, 60) : undefined,
    icon: "/kaizen/favicon.ico",
    data: { url: typeof data.url === "string" ? data.url : "/admin" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let target = "/admin";
  try {
    const url = new URL(event.notification.data && event.notification.data.url, self.location.origin);
    if (url.origin === self.location.origin && url.pathname.startsWith("/admin")) target = url.pathname + url.search;
  } catch (error) {
    target = "/admin";
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ("focus" in client && new URL(client.url).pathname === target) return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
`;
}

/** The admin's web app manifest (D361): installed, it opens the admin on its own, with Kaizena Flow's icon (D62) where one is set. */
export function adminManifest(favicon: { url: string; smallUrl: string } | null) {
  return {
    name: "Kaizena Flow",
    short_name: "Kaizena Flow",
    description: "Run your stores: orders, products, customers and your site.",
    id: "/admin",
    start_url: "/admin",
    scope: "/admin/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: favicon
      ? [
          { src: favicon.smallUrl, sizes: "64x64", type: "image/png" },
          { src: favicon.url, sizes: "512x512", type: "image/png", purpose: "any" },
        ]
      : [{ src: "/kaizen/favicon.ico", sizes: "48x48", type: "image/x-icon" }],
  };
}
