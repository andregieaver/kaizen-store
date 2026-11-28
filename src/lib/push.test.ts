import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

import { describe, expect, it, vi } from "vitest";

import { adminManifest, adminServiceWorker, ADMIN_OFFLINE_PATH } from "./admin-sw";
import { vapidEnv } from "./env";
import { deviceName, isPushEndpoint, newOrderPush } from "./push";
import { pushSubscriptionInput } from "./push-schema";

describe("the installable admin and its notifications (D361)", () => {
  it("takes only a push service's own https address, never anyone else's", () => {
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/QGx")).toBe(true);
    expect(isPushEndpoint("https://wns2-db5p.notify.windows.com/w/?token=x")).toBe(true);
    expect(isPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isPushEndpoint("https://evil.example/fcm.googleapis.com")).toBe(false);
    expect(isPushEndpoint("https://push.apple.com.evil.example/x")).toBe(false);
    expect(isPushEndpoint("https://.push.apple.com/x")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(isPushEndpoint("https://user:pw@fcm.googleapis.com/x")).toBe(false);
    expect(isPushEndpoint("https://169.254.169.254/latest")).toBe(false);
  });

  it("reads a browser's subscription and its device name", () => {
    const ok = pushSubscriptionInput.safeParse({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
      device: " Chrome · Mac ",
    });
    expect(ok.success && ok.data.device).toBe("Chrome · Mac");
    expect(pushSubscriptionInput.safeParse({ endpoint: "https://example.com/x", keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } }).success).toBe(false);
    expect(deviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36")).toBe("Chrome · Mac");
    expect(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari · iOS");
  });

  it("says a new order by its number and total only", () => {
    const push = newOrderPush({ number: "1042", total: "kr 499,00", store: "Karis Kaker", url: "https://x/admin/k/orders/1" }, { title: "Ny ordre {number}", body: "{total} · {store}" });
    expect(push).toEqual({ title: "Ny ordre 1042", body: "kr 499,00 · Karis Kaker", url: "https://x/admin/k/orders/1", tag: "order-1042" });
  });

  it("keeps only the offline page, answers page loads it cannot fetch, and opens only the admin on a press", () => {
    const sw = adminServiceWorker();
    expect(sw).toContain(JSON.stringify(ADMIN_OFFLINE_PATH));
    expect(sw).toContain('request.mode !== "navigate"');
    expect(sw).toContain('url.pathname.startsWith("/admin")');
    expect(sw).toContain("url.origin === self.location.origin");
    expect(sw).not.toMatch(/cache\.put/);
    expect(adminManifest(null)).toMatchObject({ start_url: "/admin", scope: "/admin/", display: "standalone" });
    expect(adminManifest({ url: "/i/512.png", smallUrl: "/i/64.png" }).icons).toContainEqual({ src: "/i/512.png", sizes: "512x512", type: "image/png", purpose: "any" });
  });

  it("offers notifications only with both VAPID keys, and refuses keys of the wrong shape", () => {
    expect(vapidEnv({})).toBeNull();
    expect(vapidEnv({ VAPID_PUBLIC_KEY: "B".repeat(87), VAPID_PRIVATE_KEY: "A".repeat(43) })).toEqual({ publicKey: "B".repeat(87), privateKey: "A".repeat(43), subject: "https://kaizenaflow.com" });
    expect(() => vapidEnv({ VAPID_PUBLIC_KEY: "short", VAPID_PRIVATE_KEY: "A".repeat(43) })).toThrow();
    expect(() => vapidEnv({ VAPID_PUBLIC_KEY: "B".repeat(87), VAPID_PRIVATE_KEY: "A".repeat(43), VAPID_SUBJECT: "http://x" })).toThrow();
  });
});

describe("web-push reads a device's address without url.parse() (patches/web-push.patch, incident 1d8e0e66)", () => {
  it("signs for the push service's origin and sends to its host and path, with no DEP0169", async () => {
    const require = createRequire(import.meta.url);
    const url = require("node:url") as typeof import("node:url");
    const https = require("node:https") as typeof import("node:https");
    const webpush = require("web-push") as typeof import("web-push");
    const parse = vi.spyOn(url, "parse");
    let sent: { hostname?: string | null; port?: unknown; path?: string | null } = {};
    const request = vi.spyOn(https, "request").mockImplementation(((options: typeof sent, done: (res: EventEmitter & { statusCode: number }) => void) => {
      sent = options;
      const req = new EventEmitter() as EventEmitter & { write: () => void; end: () => void; setTimeout: () => void };
      req.write = () => {};
      req.setTimeout = () => {};
      req.end = () => {
        const res = Object.assign(new EventEmitter(), { statusCode: 201, headers: {} });
        done(res);
        res.emit("end");
      };
      return req;
    }) as never);
    try {
      const keys = webpush.generateVAPIDKeys();
      const endpoint = "https://fcm.googleapis.com/fcm/send/abc?x=1";
      const vapidDetails = { subject: "mailto:ops@example.com", publicKey: keys.publicKey, privateKey: keys.privateKey };
      const details = webpush.generateRequestDetails({ endpoint, keys: { p256dh: "", auth: "" } }, null, { vapidDetails });
      const jwt = String(details.headers.Authorization).match(/t=([^,]+)/)?.[1] ?? "";
      expect(JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString()).aud).toBe("https://fcm.googleapis.com");
      await webpush.sendNotification({ endpoint, keys: { p256dh: "", auth: "" } }, null, { vapidDetails });
      expect(sent).toMatchObject({ hostname: "fcm.googleapis.com", path: "/fcm/send/abc?x=1" });
      expect(sent.port).toBeUndefined();
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
      request.mockRestore();
    }
  });
});
