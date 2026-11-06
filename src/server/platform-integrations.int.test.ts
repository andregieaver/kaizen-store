import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
process.env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString("base64");

/**
 * The services, faked: every POST is kept, and answers 200 unless a queued answer names something in its body (other test files may
 * queue platform events of their own while these run).
 */
const sent: { url: string; body: Record<string, unknown> }[] = [];
const answers: { match: string; status: number }[] = [];
vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
  const body = String(init.body);
  sent.push({ url, body: JSON.parse(body) });
  const at = answers.findIndex((a) => body.includes(a.match));
  const status = at === -1 ? 200 : answers.splice(at, 1)[0].status;
  return new Response(status === 200 ? "ok" : "nope", { status });
});

const platform = await import("./platform-integrations");

/** A made-up Slack webhook, put together here so secret scanners do not take it for a real one. */
const SLACK = ["https://hooks.slack.com/services", "T0PLATFORM", "B0PLATFORM", "platformsecret1"].join("/");
const ZAP = "https://hooks.zapier.com/hooks/catch/7654321/platform/";
const run = Date.now().toString(36);
let admin: Account;

/** Sends what is due until the deliveries about `subject` are no longer waiting. Other tests' events may be queued too. */
async function sendAbout(subject: string) {
  for (let i = 0; i < 10; i++) {
    await platform.deliverPlatformDue(100);
    const [left] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.platform_integration_deliveries where subject_id = ${subject}::uuid and status = 'pending' and next_attempt_at <= now()
    `);
    if (Number(left.n) === 0) return;
  }
}
const about = (subject: string) => sent.filter((s) => JSON.stringify(s.body).includes(subject) || s.body.id === subject);

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`pi-admin-${run}@example.com`}, 'Admin', 'Admin') returning id
  `);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`pi-admin-${run}`}, 'Admin', null)`);
  const [account] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`pi-admin-${run}@example.com`}`);
  admin = { id: String(account.id), platformAdmin: true } as unknown as Account;
  await db().execute(sql`delete from commerce.platform_integrations`);
});

beforeEach(() => {
  sent.length = 0;
  answers.length = 0;
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.platform_integrations`);
  await closeDb();
});

describe("connecting a service for Kaizena Flow (D465)", () => {
  it("takes only the service's own address and at least one event, and keeps the address encrypted", async () => {
    expect(await platform.savePlatformIntegration(admin, "slack", { url: ZAP, events: ["store.created"], enabled: true })).toEqual({ ok: false, problem: "slack" });
    expect(await platform.savePlatformIntegration(admin, "slack", { url: "", events: ["store.created"], enabled: true })).toEqual({ ok: false, problem: "address" });
    expect(await platform.savePlatformIntegration(admin, "slack", { url: SLACK, events: ["order.paid"], enabled: true })).toEqual({ ok: false, problem: "events" });
    expect(
      await platform.savePlatformIntegration(admin, "slack", { url: SLACK, events: ["request.received", "store.created", "report.received", "order.paid"], enabled: true }),
    ).toEqual({ ok: true });
    const [row] = await db().execute<Row>(sql`select webhook_url_encrypted, webhook_hint, events from commerce.platform_integrations where provider = 'slack'`);
    expect(String(row.webhook_url_encrypted)).not.toContain("hooks.slack.com");
    expect(row.webhook_hint).toMatch(/^hooks\.slack\.com\/services\/…/);
    expect(row.events).toEqual(["request.received", "store.created", "report.received"]);
    // Saved again without an address: the old one stays.
    expect(await platform.savePlatformIntegration(admin, "slack", { url: "", events: ["request.received", "store.created", "report.received"], enabled: true })).toEqual({ ok: true });
    expect((await platform.getPlatformIntegration("slack"))?.hint).toBe(row.webhook_hint);
    expect(await platform.savePlatformIntegration(admin, "zapier", { url: ZAP, events: ["request.received"], enabled: true })).toEqual({ ok: true });
    expect((await platform.listPlatformIntegrations()).map((i) => i.provider)).toEqual(["slack", "zapier"]);
  });
});

describe("Kaizena Flow's events, sent", () => {
  it("gives Zapier a request's person, and Slack only their name", async () => {
    const [request] = await db().execute<Row>(sql`
      insert into commerce.access_requests (email, name, store_name, message) values (${`lead-${run}@example.com`}, 'Kari Lead', 'Kari Keramikk', 'Stoneware cups')
      returning id
    `);
    const id = String(request.id);
    await sendAbout(id);
    const mine = about(id);
    const zap = mine.find((s) => s.url === ZAP);
    const slack = sent.find((s) => s.url === SLACK && s.body.text === "New store request: Kari Keramikk");
    expect(zap?.body).toMatchObject({
      event: "request.received",
      platform: { name: "Kaizena Flow" },
      request: { id, store_name: "Kari Keramikk", name: "Kari Lead", email: `lead-${run}@example.com`, sells: "Stoneware cups" },
    });
    expect(slack?.body.text).toBe("New store request: Kari Keramikk");
    expect(JSON.stringify(slack?.body)).not.toContain(`lead-${run}@example.com`);
    const delivered = await db().execute<Row>(sql`select provider, status from commerce.platform_integration_deliveries where subject_id = ${id}::uuid order by provider`);
    expect(delivered).toEqual([
      { provider: "slack", status: "delivered" },
      { provider: "zapier", status: "delivered" },
    ]);
  });

  it("says a store was made when a request is approved", async () => {
    const [request] = await db().execute<Row>(sql`
      insert into commerce.access_requests (email, name, store_name) values (${`new-${run}@example.com`}, 'Nils', 'Nils Nett') returning id
    `);
    const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`pi-new-${run}`}, 'Nils Nett', null) as id`);
    const storeId = String(store.id);
    await sendAbout(storeId);
    // Slack's message names the store and links its page in the platform admin; the store's id is Zapier's and Make's.
    const slack = sent.find((s) => s.url === SLACK && s.body.text === "New store: Nils Nett");
    expect(slack?.body.text).toBe("New store: Nils Nett");
    expect(JSON.stringify(slack?.body)).toContain(`/admin/platform/stores/pi-new-${run}`);
  });

  it("tries again when the service fails, and stops when Slack's webhook is gone", async () => {
    const [request] = await db().execute<Row>(sql`
      insert into commerce.access_requests (email, name, store_name) values (${`retry-${run}@example.com`}, 'Rita', ${`Retry ${run}`}) returning id
    `);
    const id = String(request.id);
    await db().execute(sql`delete from commerce.platform_integration_deliveries where subject_id = ${id}::uuid and provider = 'zapier'`);
    answers.push({ match: `Retry ${run}`, status: 500 });
    await platform.deliverPlatformDue(100);
    const [waiting] = await db().execute<Row>(sql`select status, attempts, last_status from commerce.platform_integration_deliveries where subject_id = ${id}::uuid`);
    expect(waiting).toEqual({ status: "pending", attempts: 1, last_status: 500 });
    await db().execute(sql`update commerce.platform_integration_deliveries set next_attempt_at = now() where subject_id = ${id}::uuid`);
    answers.push({ match: `Retry ${run}`, status: 404 });
    await platform.deliverPlatformDue(100);
    const [gone] = await db().execute<Row>(sql`select status from commerce.platform_integration_deliveries where subject_id = ${id}::uuid`);
    expect(gone.status).toBe("failed");
  });

  it("sends a test at once, and lists it", async () => {
    expect((await platform.sendPlatformTest(admin, "slack")).ok).toBe(true);
    expect(sent.at(-1)?.body.text).toMatch(/^Test: New store: /);
    expect((await platform.listPlatformDeliveries("slack"))[0]).toMatchObject({ event: "test", status: "delivered" });
    expect(await platform.sendPlatformTest(admin, "make")).toEqual({ ok: false, status: null, error: null });
  });
});

describe("disconnecting", () => {
  it("forgets the address and drops what was waiting", async () => {
    const [request] = await db().execute<Row>(sql`
      insert into commerce.access_requests (email, name, store_name) values (${`gone-${run}@example.com`}, 'Gro', 'Gone') returning id
    `);
    expect(await platform.removePlatformIntegration(admin, "zapier")).toBe(true);
    const [row] = await db().execute<Row>(sql`
      select status, last_error from commerce.platform_integration_deliveries where subject_id = ${String(request.id)}::uuid and provider = 'zapier'
    `);
    expect(row).toEqual({ status: "failed", last_error: "Disconnected" });
    expect((await platform.listPlatformIntegrations()).map((i) => i.provider)).toEqual(["slack"]);
    const [audit] = await db().execute<Row>(sql`
      select area from commerce.audit_log where account_id = ${admin.id}::uuid and action = 'platform.integration_removed' order by created_at desc limit 1
    `);
    expect(audit.area).toBe("platform");
  });
});
