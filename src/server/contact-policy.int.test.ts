import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { BroadcastContent } from "@/lib/broadcasts";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const au = await import("./automations");
const bc = await import("./broadcasts");
const policy = await import("./contact-policy");
const { storeById } = await import("./shopper-emails");

type Row = Record<string, unknown>;

/**
 * One contact policy across email and texts (email plan M1.5, D764), against a real database: a broadcast skips a person at the week's cap
 * (`cap`) or emailed too lately (`spacing`) and still reaches one who only got an order email; an automation email that would break it is
 * suppressed with its reason while a welcome always goes; quiet hours keep automation emails to the reader's daytime; the owner's policy is
 * read and saved, and a form's bad numbers are refused.
 */

const run = Date.now().toString(36);
const HOUR = 3_600_000;
let storeId: string;
let owner: string;

const content: BroadcastContent = { "nb-NO": { subject: "Nytt", preview: "", blocks: [{ type: "paragraph", text: "Hei" }] } };

async function subscriber(email: string, at = new Date()): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.marketing_subscribers (store_id, email, locale, market_code, status, source, consent_text, consented_at, token)
    values (${storeId}::uuid, ${email}, 'nb-NO', 'NO', 'subscribed', 'account', 'Yes please', ${at.toISOString()}::timestamptz, ${randomBytes(32).toString("base64url")})
    returning id
  `);
  return String(row.id);
}

/** An email that reached `to` `hoursAgo` hours ago, of `kind`. */
async function emailed(to: string, hoursAgo: number, kind = "marketing.broadcast"): Promise<void> {
  await db().execute(sql`
    insert into commerce.email_messages (store_id, kind, to_address, subject, html, text, status, created_at)
    values (${storeId}::uuid, ${kind}, ${to}, 'S', 'x', 'x', 'sent', now() - make_interval(hours => ${hoursAgo}))
  `);
}

const store = async () => {
  const s = await storeById(storeId);
  if (!s) throw new Error("no store");
  return s;
};

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`policy-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`policy-${run}`}, 'Test', null) as id`);
  storeId = String(created.id);
  await db().execute(sql`update commerce.stores set status = 'active', locales = array['nb-NO'] where id = ${storeId}::uuid`);
  const [m] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid limit 1`);
  owner = String(m.account_id);
  delete process.env.RESEND_API_KEY;
});

afterAll(async () => {
  await closeDb();
});

describe("the owner's policy", () => {
  it("is the default until saved, and refuses numbers out of range", async () => {
    expect(await policy.getContactPolicy(storeId)).toEqual({ perWeek: 3, spacingHours: 20, quietHours: true });
    expect(await policy.saveContactPolicy(storeId, owner, { perWeek: 0, spacingHours: 20, quietHours: "on" })).toMatchObject({ ok: false });
    expect(await policy.saveContactPolicy(storeId, owner, { perWeek: 3, spacingHours: 20, quietHours: "on" })).toMatchObject({ ok: true });
    expect(await policy.getContactPolicy(storeId)).toEqual({ perWeek: 3, spacingHours: 20, quietHours: true });
  });
});

describe("a broadcast", () => {
  it("skips a person at the week's cap or emailed too lately, and reaches one who got only an order email", async () => {
    const kari = `kari-${run}@example.com`;
    const ola = `ola-${run}@example.com`;
    const nils = `nils-${run}@example.com`;
    const eva = `eva-${run}@example.com`;
    for (const who of [kari, ola, nils, eva]) await subscriber(who, new Date(Date.now() - 30 * 24 * HOUR));
    for (const h of [30, 60, 90]) await emailed(kari, h);
    await emailed(ola, 2);
    await emailed(nils, 1, "order.confirmation");

    const saved = await bc.saveBroadcast(await store(), owner, null, { title: `Policy ${run}`, audience: "everyone", segmentId: null, content });
    if (!saved.ok) throw new Error(saved.problem);
    await bc.startBroadcast(storeId, owner, saved.id);
    await bc.runBroadcasts({ only: saved.id, deadline: Date.now() + 20_000 });
    const rows = await db().execute<Row>(sql`select email, status, skip_reason from commerce.broadcast_recipients where broadcast_id = ${saved.id}::uuid order by email`);
    const by = new Map(rows.map((r) => [String(r.email), [String(r.status), r.skip_reason]]));
    expect(by.get(kari)).toEqual(["skipped", "cap"]);
    expect(by.get(ola)).toEqual(["skipped", "spacing"]);
    expect(by.get(nils)?.[0]).toBe("sent");
    expect(by.get(eva)?.[0]).toBe("sent");
  });
});

describe("automation emails", () => {
  it("wait for the reader's daytime, and a welcome goes whatever came before", async () => {
    const s = await store();
    const savedWelcome = await au.saveAutomation(s, owner, "welcome", { delayDays: 0, content });
    if (!savedWelcome.ok) throw new Error(savedWelcome.problem);
    const on = await au.switchAutomation(s, owner, "welcome", true);
    if (!on.ok) throw new Error(on.problem);
    // Tomorrow, in Oslo: 03:00 is night, 11:00 is day (UTC+1 in November).
    const tomorrow = new Date(Date.now() + 24 * HOUR);
    const at = (utcHour: number) => new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), utcHour));
    const pia = `pia-${run}@example.com`;
    await subscriber(pia, new Date(at(1).getTime()));
    // Pia was emailed three times this week: a welcome still goes, as she just joined.
    for (const h of [5, 10, 15]) await emailed(pia, h);

    await au.runAutomations({ only: storeId, now: at(2) });
    const sent = () =>
      db().execute<Row>(sql`select x.outcome from commerce.automation_sends x join commerce.marketing_subscribers m on m.id = x.subscriber_id
        where x.store_id = ${storeId}::uuid and x.kind = 'welcome' and m.email = ${pia}`);
    expect(await sent()).toEqual([]);

    await au.runAutomations({ only: storeId, now: at(10) });
    expect((await sent()).map((r) => r.outcome)).toEqual(["logged"]);
  });

  it("other than a welcome are suppressed with their reason when they would break the policy", async () => {
    const tom = `tom-${run}@example.com`;
    const tomId = await subscriber(tom, new Date(Date.now() - 30 * 24 * HOUR));
    await emailed(tom, 1);
    // The policy as `sendOne()` applies it to a win-back email to Tom now.
    const [recent] = await policy.recentContacts(storeId, [{ email: tom, customerId: null }]);
    const { policyVerdict } = await import("@/lib/contact-policy");
    expect(policyVerdict(recent, new Date(), await policy.getContactPolicy(storeId), "normal")).toBe("spacing");
    // And the column that keeps the reason takes it, and only a known one.
    await db().execute(sql`
      insert into commerce.automation_sends (store_id, key, kind, subscriber_id, outcome, suppressed_reason)
      values (${storeId}::uuid, ${`win_back:${tomId}:${run}`}, 'win_back', ${tomId}::uuid, 'suppressed', 'spacing')
    `);
    await expect(
      db().execute(sql`
        insert into commerce.automation_sends (store_id, key, kind, subscriber_id, outcome, suppressed_reason)
        values (${storeId}::uuid, ${`win_back:${tomId}:x${run}`}, 'win_back', ${tomId}::uuid, 'suppressed', 'tired')
      `),
    ).rejects.toThrow();
  });
});
