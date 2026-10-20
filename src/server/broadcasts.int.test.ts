import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { BroadcastContent } from "@/lib/broadcasts";

vi.mock("server-only", () => ({}));

const bc = await import("./broadcasts");
const seg = await import("./segments");
const events = await import("./email-events");
const { eraseSubject } = await import("./privacy-erasure");
const { storeById } = await import("./shopper-emails");

type Row = Record<string, unknown>;

/**
 * Broadcasts (wave 5 unit C, D297, `docs/wave-5-marketing.md` 5.9): a send freezes only subscribed addresses and sends each once across runs;
 * an address unsubscribed since is skipped; a stop skips the rest; a schedule starts when due and goes back to a draft when it cannot; a hard
 * bounce and a complaint unsubscribe; the click route goes only to the content's links; one store never reaches another's; erasure removes the
 * recipients.
 */

const run = Date.now().toString(36);
let storeId: string;
let otherId: string;
let owner: string;
const people: Record<string, string> = {};

const content: BroadcastContent = {
  "nb-NO": {
    subject: "Høstnytt",
    preview: "",
    blocks: [
      { type: "heading", text: "Høsten er her" },
      { type: "button", text: "Se nyhetene", url: "/products" },
    ],
  },
  "en-GB": { subject: "Autumn news", preview: "", blocks: [{ type: "button", text: "Look", url: "https://example.com/look" }] },
};

async function makeStore(slug: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`${slug}-${run}`}, 'Test', null) as id`);
  const id = String(created.id);
  await db().execute(sql`update commerce.stores set status = 'active', locales = array['nb-NO', 'en-GB'] where id = ${id}::uuid`);
  return id;
}

async function subscriber(store: string, email: string, status: "subscribed" | "pending" | "unsubscribed", locale = "nb-NO"): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.marketing_subscribers (store_id, email, locale, market_code, status, source, consent_text, consented_at, unsubscribed_at,
      unsubscribe_source, confirm_hash, confirm_until, token)
    values (${store}::uuid, ${email}, ${locale}, 'NO', ${status === "pending" ? "pending" : "subscribed"}, 'account', 'Yes please', now(), null,
      null, ${status === "pending" ? randomBytes(32).toString("hex") : null},
      ${status === "pending" ? sql`now() + interval '7 days'` : sql`null`}, ${randomBytes(32).toString("base64url")})
    returning id
  `);
  // A subscriber starts pending or subscribed; one who left left later.
  if (status === "unsubscribed") {
    await db().execute(sql`update commerce.marketing_subscribers set status = 'unsubscribed', unsubscribe_source = 'link' where id = ${String(row.id)}::uuid`);
  }
  return String(row.id);
}

async function store() {
  const s = await storeById(storeId);
  if (!s) throw new Error("no store");
  return s;
}

async function draft(title: string, audience: "everyone" | "segment" = "everyone", segmentId: string | null = null): Promise<string> {
  const saved = await bc.saveBroadcast(await store(), owner, null, { title, audience, segmentId, content });
  if (!saved.ok) throw new Error(saved.problem);
  return saved.id;
}

const recipients = (id: string) =>
  db().execute<Row>(sql`select email, status, skip_reason from commerce.broadcast_recipients where broadcast_id = ${id}::uuid order by email`);
const statusOf = async (id: string) => String((await db().execute<Row>(sql`select status from commerce.broadcasts where id = ${id}::uuid`))[0].status);

beforeAll(async () => {
  storeId = await makeStore("bc");
  otherId = await makeStore("bc-other");
  const [m] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid limit 1`);
  owner = String(m.account_id);
  people.kari = `kari-${run}@example.com`;
  people.ola = `ola-${run}@example.com`;
  people.per = `per-${run}@example.com`;
  people.lise = `lise-${run}@example.com`;
  await subscriber(storeId, people.kari, "subscribed");
  await subscriber(storeId, people.ola, "subscribed", "en-GB");
  await subscriber(storeId, people.per, "pending");
  await subscriber(storeId, people.lise, "unsubscribed");
  await subscriber(otherId, `nils-${run}@example.com`, "subscribed");
  delete process.env.RESEND_API_KEY;
});

afterAll(async () => {
  await closeDb();
});

describe("a send", () => {
  it("freezes only the subscribed addresses, skips one that left since, and sends each once", async () => {
    const id = await draft("Everyone");
    const started = await bc.startBroadcast(storeId, owner, id);
    expect(started).toEqual({ ok: true, recipients: 2 });
    expect((await recipients(id)).map((r) => r.email)).toEqual([people.kari, people.ola].sort());
    await db().execute(sql`update commerce.marketing_subscribers set status = 'unsubscribed', unsubscribe_source = 'link' where store_id = ${storeId}::uuid and email = ${people.ola}`);

    const first = await bc.runBroadcasts({ only: id, pace: 0 });
    expect(first.sent).toBe(1);
    expect(first.skipped).toBe(1);
    expect(await statusOf(id)).toBe("sent");
    const [email] = await db().execute<Row>(sql`select status, html from commerce.email_messages where idempotency_key like ${`broadcast:${id}:%`}`);
    // No email settings here: kept only.
    expect(email.status).toBe("logged");
    expect(String(email.html)).toContain("/api/marketing/c/");
    expect(String(email.html)).toContain("/unsubscribe/");

    const again = await bc.runBroadcasts({ only: id, pace: 0 });
    expect(again.sent + again.skipped + again.failed).toBe(0);
    const report = await bc.broadcastReport(storeId, (await bc.getBroadcast(storeId, id))!);
    expect(report.counts).toMatchObject({ recipients: 2, logged: 1, skipped: 1, queued: 0, unsubscribed: 1 });
    // Words and audience are fixed now.
    expect(await bc.saveBroadcast(await store(), owner, id, { title: "Changed", audience: "everyone", segmentId: null, content })).toMatchObject({ ok: false });
    expect(await bc.deleteBroadcast(storeId, owner, id)).toBe(false);
    await db().execute(sql`update commerce.marketing_subscribers set status = 'subscribed', consented_at = now() where store_id = ${storeId}::uuid and email = ${people.ola}`);
  });

  it("hands batches to the email service with the unsubscribe headers, and an email already sent under its key is never sent again", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "shop@example.com";
    try {
      const id = await draft("Batched");
      await bc.startBroadcast(storeId, owner, id);
      const kari = (await db().execute<Row>(sql`select subscriber_id from commerce.broadcast_recipients where broadcast_id = ${id}::uuid and email = ${people.kari}`))[0];
      // Kari's email went out before (a batch whose answer was lost): kept as sent under her key.
      await db().execute(sql`
        insert into commerce.email_messages (store_id, kind, idempotency_key, to_address, subject, html, text, status)
        values (${storeId}::uuid, 'marketing.broadcast', ${`broadcast:${id}:${String(kari.subscriber_id)}`}, ${people.kari}, 's', 'h', 't', 'sent')
      `);
      const calls: { url: string; body: unknown[]; key: string | null }[] = [];
      const fetcher = (async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as unknown[];
        calls.push({ url, body, key: new Headers(init.headers).get("Idempotency-Key") });
        return new Response(JSON.stringify({ data: body.map((_, i) => ({ id: `re_${run}_${i}` })) }), { status: 200 });
      }) as unknown as typeof fetch;
      const result = await bc.runBroadcasts({ only: id, pace: 0, fetcher });
      expect(result.sent).toBe(2);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("https://api.resend.com/emails/batch");
      expect(calls[0].key).toMatch(/^batch-/);
      expect(calls[0].body).toHaveLength(1);
      const sent = calls[0].body[0] as { to: string[]; subject: string; headers: Record<string, string> };
      expect(sent.to).toEqual([people.ola]);
      expect(sent.subject).toBe("Autumn news");
      expect(sent.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      expect(sent.headers["List-Unsubscribe"]).toMatch(/\/api\/unsubscribe\//);
      const [ola] = await db().execute<Row>(sql`select status, provider_reference from commerce.email_messages where idempotency_key like ${`broadcast:${id}:%`} and to_address = ${people.ola}`);
      expect(ola).toMatchObject({ status: "sent", provider_reference: `re_${run}_0` });
    } finally {
      delete process.env.RESEND_API_KEY;
      delete process.env.EMAIL_FROM;
    }
  });

  it("goes to a segment's subscribed people only", async () => {
    const saved = await seg.saveSegment(storeId, owner, null, { name: `English ${run}`, rules: { match: "all", conditions: [{ kind: "language", codes: ["en"] }] } });
    if (!saved.ok) throw new Error(saved.problem);
    const id = await draft("English", "segment", saved.id);
    expect(await bc.startBroadcast(storeId, owner, id)).toEqual({ ok: true, recipients: 1 });
    expect((await recipients(id)).map((r) => r.email)).toEqual([people.ola]);
    const words = (await bc.getBroadcast(storeId, id))!.audienceWords;
    expect(words).toContain(`English ${run}`);
    await bc.stopBroadcast(storeId, owner, id);
  });

  it("stops: the addresses not yet sent are skipped", async () => {
    const id = await draft("Stopped");
    await bc.startBroadcast(storeId, owner, id);
    expect(await bc.stopBroadcast(storeId, owner, id)).toBe(true);
    expect(await statusOf(id)).toBe("cancelled");
    expect((await recipients(id)).every((r) => r.status === "skipped" && r.skip_reason === "stopped")).toBe(true);
    expect((await bc.runBroadcasts({ only: id, pace: 0 })).sent).toBe(0);
  });

  it("is refused when nothing is written in the main language", async () => {
    const saved = await bc.saveBroadcast(await store(), owner, null, { title: "Empty", audience: "everyone", segmentId: null, content: {} });
    if (!saved.ok) throw new Error(saved.problem);
    expect(await bc.startBroadcast(storeId, owner, saved.id)).toMatchObject({ ok: false });
  });
});

describe("a schedule", () => {
  it("starts when its time comes, and goes back to a draft with the reason when it cannot", async () => {
    const id = await draft("Later");
    expect(await bc.scheduleBroadcast(storeId, owner, id, new Date(Date.now() - 60_000))).toMatchObject({ ok: false });
    expect(await bc.scheduleBroadcast(storeId, owner, id, new Date(Date.now() + 3_600_000))).toMatchObject({ ok: true });
    await db().execute(sql`update commerce.broadcasts set scheduled_for = now() - interval '1 minute' where id = ${id}::uuid`);

    const saved = await seg.saveSegment(storeId, owner, null, { name: `Gone ${run}`, rules: { match: "all", conditions: [] } });
    if (!saved.ok) throw new Error(saved.problem);
    const failing = await draft("Later, gone", "segment", saved.id);
    await bc.scheduleBroadcast(storeId, owner, failing, new Date(Date.now() + 3_600_000));
    await db().execute(sql`update commerce.broadcasts set scheduled_for = now() - interval '1 minute' where id = ${failing}::uuid`);
    await seg.deleteSegment(storeId, owner, saved.id);

    await bc.runBroadcasts({ pace: 0, deadline: Date.now() + 20_000 });
    expect(["sending", "sent"]).toContain(await statusOf(id));
    const back = (await bc.getBroadcast(storeId, failing))!;
    expect(back.status).toBe("draft");
    expect(back.scheduleProblem).toMatch(/segment/);
  });
});

describe("bounces and complaints", () => {
  it("unsubscribe the address on a hard bounce or a complaint, never a soft bounce", async () => {
    const bounced = await subscriber(storeId, `bounce-${run}@example.com`, "subscribed");
    const soft = await subscriber(storeId, `soft-${run}@example.com`, "subscribed");
    const spam = await subscriber(storeId, `spam-${run}@example.com`, "subscribed");
    for (const [who, ref] of [["bounce", "hard"], ["soft", "soft"], ["spam", "spam"]] as const) {
      await db().execute(sql`
        insert into commerce.email_messages (store_id, kind, to_address, subject, html, text, status, provider_reference)
        values (${storeId}::uuid, 'marketing.broadcast', ${`${who}-${run}@example.com`}, 's', 'h', 't', 'sent', ${`${ref}-${run}`})
      `);
    }
    await events.applyEmailEvent({ type: "email.bounced", data: { email_id: `hard-${run}`, bounce: { type: "Permanent", message: "No such user" } } });
    await events.applyEmailEvent({ type: "email.bounced", data: { email_id: `soft-${run}`, bounce: { type: "Transient", message: "Mailbox full" } } });
    await events.applyEmailEvent({ type: "email.complained", data: { email_id: `spam-${run}` } });
    const rows = await db().execute<Row>(sql`select id, status, unsubscribe_source from commerce.marketing_subscribers where id in (${bounced}::uuid, ${soft}::uuid, ${spam}::uuid)`);
    const by = new Map(rows.map((r) => [String(r.id), r]));
    expect(by.get(bounced)).toMatchObject({ status: "unsubscribed", unsubscribe_source: "bounce" });
    expect(by.get(soft)).toMatchObject({ status: "subscribed" });
    expect(by.get(spam)).toMatchObject({ status: "unsubscribed", unsubscribe_source: "complaint" });
  });
});

describe("clicks", () => {
  it("count and go only to a link the broadcast has, under the market asked", async () => {
    const id = await draft("Clicks");
    expect(await bc.recordClick(id, "nb-NO.1", "no")).toBeNull();
    await bc.startBroadcast(storeId, owner, id);
    const target = await bc.recordClick(id, "nb-NO.1", "no");
    expect(target).toMatch(/\/products$/);
    expect(await bc.recordClick(id, "en-GB.0", "zz")).toBe("https://example.com/look");
    expect(await bc.recordClick(id, "nb-NO.0", "no")).toBeNull();
    expect(await bc.recordClick(id, "nb-NO.9", "no")).toBeNull();
    const report = await bc.broadcastReport(storeId, (await bc.getBroadcast(storeId, id))!);
    expect(report.links.map((l) => [l.key, l.clicks]).sort()).toEqual([["en-GB.0", 1], ["nb-NO.1", 1]]);
    await bc.stopBroadcast(storeId, owner, id);
  });
});

describe("stores", () => {
  it("never reach another's broadcasts or segments", async () => {
    const id = await draft("Mine");
    expect(await bc.getBroadcast(otherId, id)).toBeNull();
    expect(await bc.startBroadcast(otherId, owner, id)).toMatchObject({ ok: false });
    expect(await bc.deleteBroadcast(otherId, owner, id)).toBe(false);
    const theirs = await seg.saveSegment(otherId, owner, null, { name: `Theirs ${run}`, rules: { match: "all", conditions: [] } });
    if (!theirs.ok) throw new Error(theirs.problem);
    expect(await bc.saveBroadcast(await store(), owner, id, { title: "Mine", audience: "segment", segmentId: theirs.id, content })).toMatchObject({ ok: false });
    const other = await storeById(otherId);
    const otherDraft = await bc.saveBroadcast(other!, owner, null, { title: "Theirs", audience: "everyone", segmentId: null, content });
    if (!otherDraft.ok) throw new Error(otherDraft.problem);
    await bc.startBroadcast(otherId, owner, otherDraft.id);
    expect((await recipients(otherDraft.id)).map((r) => r.email)).toEqual([`nils-${run}@example.com`]);
  });
});

describe("erasure", () => {
  it("removes the broadcasts' recipients of the person", async () => {
    const email = `erase-${run}@example.com`;
    await subscriber(storeId, email, "subscribed");
    const id = await draft("Before erasure");
    await bc.startBroadcast(storeId, owner, id);
    expect((await recipients(id)).some((r) => r.email === email)).toBe(true);
    const erased = await eraseSubject(storeId, { email }, { channel: "staff", accountId: owner });
    expect(erased.ok).toBe(true);
    expect((await recipients(id)).some((r) => r.email === email)).toBe(false);
  });
});
