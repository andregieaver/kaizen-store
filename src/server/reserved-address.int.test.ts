import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));

const { sendEmail } = await import("./email");
const bc = await import("./broadcasts");
const { storeById } = await import("./shopper-emails");

type Row = Record<string, unknown>;

/**
 * Reserved test addresses (D792): with sending set up, an email to `example.org` or `example.net` is kept whole as `logged` and never reaches
 * Resend, from `sendEmail()` and from a broadcast's batch alike, while a real address in the same batch is still sent.
 */

const run = Date.now().toString(36);
let storeId: string;
let owner: string;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`reserved-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`reserved-${run}`}, 'Test', null) as id`);
  storeId = String(created.id);
  await db().execute(sql`update commerce.stores set status = 'active', locales = array['en-GB'] where id = ${storeId}::uuid`);
  await db().execute(sql`insert into commerce.contact_policies (store_id, per_week, spacing_hours, quiet_hours) values (${storeId}::uuid, 14, 0, false)`);
  const [acc] = await db().execute<Row>(sql`select created_by from commerce.stores where id = ${storeId}::uuid`);
  owner = String(acc.created_by);
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_FROM = "shop@example.com";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  await closeDb();
});

describe("reserved test addresses (D792)", () => {
  it("sendEmail keeps the email whole as logged and never calls Resend", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: "re_x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const to = `ingrid-${run}@example.org`;
    const outcome = await sendEmail({
      storeId,
      kind: "order.confirmation",
      to,
      email: { subject: "Your order", html: "<p>Thanks</p>", text: "Thanks" },
      fromName: "Test",
      idempotencyKey: `reserved:${run}:one`,
    });
    expect(outcome).toBe("logged");
    expect(fetcher).not.toHaveBeenCalled();
    const [row] = await db().execute<Row>(sql`select to_address, subject, status, error, sent_at from commerce.email_messages where idempotency_key = ${`reserved:${run}:one`}`);
    expect(row).toMatchObject({ to_address: to, subject: "Your order", status: "logged", error: "not sent: a reserved test address", sent_at: null });
    // The same key is still a duplicate, as for any kept email.
    expect(await sendEmail({ storeId, kind: "order.confirmation", to, email: { subject: "s", html: "h", text: "t" }, fromName: "Test", idempotencyKey: `reserved:${run}:one` })).toBe("duplicate");
  });

  it("sendEmail still delivers a real address", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: `re_${run}` }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const outcome = await sendEmail({
      storeId,
      kind: "order.confirmation",
      to: `ola-${run}@example.com`,
      email: { subject: "Your order", html: "<p>Thanks</p>", text: "Thanks" },
      fromName: "Test",
      idempotencyKey: `reserved:${run}:two`,
    });
    expect(outcome).toBe("sent");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("a broadcast counts a reserved recipient as sent, keeps its email logged and hands only the real one to Resend", async () => {
    const add = async (email: string) => {
      await db().execute(sql`
        insert into commerce.marketing_subscribers (store_id, email, locale, market_code, status, source, consent_text, consented_at, token)
        values (${storeId}::uuid, ${email}, 'en-GB', 'NO', 'subscribed', 'account', 'Yes please', now(), ${randomBytes(32).toString("base64url")})
      `);
    };
    const demo = `kari-${run}@shop.example.net`;
    const real = `per-${run}@example.com`;
    await add(demo);
    await add(real);
    const store = await storeById(storeId);
    if (!store) throw new Error("no store");
    const saved = await bc.saveBroadcast(store, owner, null, {
      title: "News",
      audience: "everyone",
      segmentId: null,
      content: { "en-GB": { subject: "News", preview: "", blocks: [{ type: "heading", text: "Hello" }] } },
    });
    if (!saved.ok) throw new Error(saved.problem);
    expect(await bc.startBroadcast(storeId, owner, saved.id)).toEqual({ ok: true, recipients: 2 });

    const sentTo: string[][] = [];
    const fetcher = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { to: string[] }[];
      sentTo.push(...body.map((b) => b.to));
      return new Response(JSON.stringify({ data: body.map((_, i) => ({ id: `re_${run}_${i}` })) }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await bc.runBroadcasts({ only: saved.id, pace: 0, fetcher });
    expect(result.sent).toBe(2);
    expect(sentTo).toEqual([[real]]);
    const rows = await db().execute<Row>(sql`
      select to_address, status, error from commerce.email_messages where idempotency_key like ${`broadcast:${saved.id}:%`} order by to_address
    `);
    expect(rows).toEqual([
      { to_address: demo, status: "logged", error: "not sent: a reserved test address" },
      { to_address: real, status: "sent", error: null },
    ]);
  });
});
