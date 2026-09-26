import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { expect, test } from "@playwright/test";

import { scanSite } from "../src/lib/cookie-scan";

import { testDb } from "./db";

/**
 * The cookie scan (D58): a real browser finds what a site sets without a
 * choice and once everything is allowed, the site's own and others', and
 * the scheduler's route scans a store through the app.
 */

/** A small site: a cookie, storage and another host's frame at once; a tracker only with consent. */
function testSite(): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    const port = (server.address() as AddressInfo).port;
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    response.setHeader("Content-Type", "text/html");
    if (path === "/") {
      response.setHeader("Set-Cookie", ["session_id=1; Path=/", "pref=1; Path=/; Max-Age=864000"]);
      response.end(`<!doctype html>
        <a href="/about">About</a> <a href="/outside/x">Elsewhere</a> <a href="/api/x">API</a>
        <iframe src="http://127.0.0.1:${port}/frame"></iframe>
        <script>
          localStorage.setItem("seen", "1");
          if (document.cookie.includes("consent_test=")) {
            document.cookie = "tracker=1; path=/; max-age=7776000";
            localStorage.setItem("tracker_state", "1");
          }
        </script>`);
    } else if (path === "/about") {
      response.end(`<!doctype html><a href="/">Home</a><script>sessionStorage.setItem("tab", "1")</script>`);
    } else if (path === "/frame") {
      response.end(`<!doctype html><script>localStorage.setItem("widget", "1")</script>`);
    } else {
      response.statusCode = 404;
      response.end("Not found");
    }
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://localhost:${(server.address() as AddressInfo).port}` })),
  );
}

test("the scan finds cookies and storage before and after consent, the site's own and others'", async ({ browser }) => {
  const { server, origin } = await testSite();
  try {
    const { pages, items } = await scanSite(browser, {
      origin,
      starts: ["/"],
      within: (path) => !path.startsWith("/outside"),
      consent: { name: "consent_test", value: "1" },
      maxPages: 5,
    });
    expect(pages).toEqual(["/", "/about"]);
    const found = Object.fromEntries(items.map((item) => [`${item.kind}:${item.name}`, item]));
    expect(found["cookie:session_id"]).toMatchObject({ domain: "localhost", thirdParty: false, days: null, beforeConsent: true, page: "/" });
    expect(found["cookie:pref"]).toMatchObject({ days: 10, beforeConsent: true });
    expect(found["localStorage:seen"]).toMatchObject({ domain: "localhost", beforeConsent: true });
    expect(found["sessionStorage:tab"]).toMatchObject({ page: "/about", beforeConsent: true });
    expect(found["localStorage:widget"]).toMatchObject({ domain: "127.0.0.1", thirdParty: true, beforeConsent: true });
    expect(found["cookie:tracker"]).toMatchObject({ days: 90, beforeConsent: false });
    expect(found["localStorage:tracker_state"]).toMatchObject({ beforeConsent: false });
    expect(found["cookie:consent_test"]).toMatchObject({ beforeConsent: false });
  } finally {
    server.close();
  }
});

test("the scheduler's route runs a scan an owner asked for", async ({ request }) => {
  test.setTimeout(90_000);
  const sql = testDb();
  try {
    const [demo] = await sql`select id from commerce.stores where slug = 'demo'`;
    await sql`delete from commerce.cookie_scans where store_id = ${demo.id}`;
    const [queued] = await sql`insert into commerce.cookie_scans (store_id) values (${demo.id}) returning id`;

    expect((await request.post("/api/cron/cookie-scan")).status()).toBe(401);
    const response = await request.post("/api/cron/cookie-scan", {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? "e2e-cron-secret"}` },
    });
    expect(await response.json()).toEqual({ scan: queued.id });

    await expect
      .poll(async () => (await sql`select status from commerce.cookie_scans where id = ${queued.id}`)[0].status, {
        timeout: 60_000,
        intervals: [1_000],
      })
      .toBe("done");
    const [scan] = await sql`select pages, items from commerce.cookie_scans where id = ${queued.id}`;
    expect(scan.pages[0]).toBe("/s/demo/no");
    expect(scan.pages.length).toBeGreaterThan(1);
    expect(scan.pages.every((page: string) => page.startsWith("/s/demo/"))).toBe(true);
    // The demo store has no optional tools: nothing it sets needs consent.
    expect(scan.items.filter((item: { thirdParty: boolean }) => item.thirdParty)).toEqual([]);
  } finally {
    await sql.end();
  }
});
