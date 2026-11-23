import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));

const prefs = await import("./email-preferences");
const topics = await import("./marketing-topics");
const { sendEmail } = await import("./email");

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
let storeId = "";
let owner = "";
const token = (run + "p".repeat(43)).slice(0, 43);
const address = `prefs-${run}@example.com`;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`prf-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`prf-${run}`}, 'Test', null) as id`);
  storeId = String(created.id);
  const [acc] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid limit 1`);
  owner = String(acc.account_id);
  await db().execute(sql`
    insert into commerce.marketing_subscribers (store_id, email, locale, status, source, consent_text, consented_at, token)
    values (${storeId}::uuid, ${address}, 'nb-NO', 'subscribed', 'form', 'Ja takk', now(), ${token})
  `);
});

afterAll(async () => {
  await closeDb();
});

const marketing = (n: number) => sendEmail({
  storeId,
  kind: "marketing.broadcast",
  to: address,
  email: { subject: `Nytt ${n}`, html: "<p>Hei</p>", text: "Hei" },
  fromName: "Test",
  idempotencyKey: `prefs-test:${run}:${n}`,
});

/** The preference page (email plan M4.2, D882): a reader's topics, how often and a month's rest, by their link's token, held at send. */
describe("a reader's email preferences", () => {
  it("reads and saves the reader's topics and how often by their token, keeping each change with the words shown", async () => {
    const news = await topics.saveTopic(storeId, owner, null, { names: { "nb-NO": { name: "Nyheter" } } });
    const offers = await topics.saveTopic(storeId, owner, null, { names: { "nb-NO": { name: "Tilbud" } }, defaultOn: false });
    if (!news.ok || !offers.ok) throw new Error("not saved");
    expect(await prefs.preferencesByToken(storeId, "x".repeat(43))).toBeNull();
    const before = await prefs.preferencesByToken(storeId, token);
    expect(before).toMatchObject({ status: "subscribed", frequency: "all", restUntil: null });
    expect(before?.topics.map((t) => [t.names["nb-NO"].name, t.in])).toEqual([["Nyheter", true], ["Tilbud", false]]);
    expect(await prefs.savePreferences(storeId, token, { topicIds: [offers.id], frequency: "weekly", words: "Velg hva du vil få · Nyheter · Tilbud" })).toBe(true);
    const after = await prefs.preferencesByToken(storeId, token);
    expect(after?.frequency).toBe("weekly");
    expect(after?.topics.map((t) => t.in)).toEqual([false, true]);
    const [kept] = await db().execute<Row>(sql`select count(*)::int as n, min(words) as words from commerce.marketing_topic_choices where store_id = ${storeId}::uuid and source = 'preferences'`);
    expect(Number(kept.n)).toBe(2);
    expect(kept.words).toContain("Nyheter");
    // A frequency that is not one keeps the reader's.
    await prefs.savePreferences(storeId, token, { topicIds: [offers.id], frequency: "hourly", words: "" });
    expect((await prefs.preferencesByToken(storeId, token))?.frequency).toBe("weekly");
  });

  it("holds marketing email over the reader's limit, and all of it while they rest, never counting it as sent", async () => {
    expect(await marketing(1)).toBe("logged");
    // At most one in 7 days: the second waits.
    expect(await marketing(2)).toBe("suppressed");
    await prefs.savePreferences(storeId, token, { topicIds: [], frequency: "all", words: "" });
    expect(await marketing(3)).toBe("logged");
    expect(await prefs.setRest(storeId, token, true)).toBe(true);
    expect((await prefs.preferencesByToken(storeId, token))?.restUntil).not.toBeNull();
    expect(await marketing(4)).toBe("suppressed");
    expect(await prefs.setRest(storeId, token, false)).toBe(true);
    expect(await marketing(5)).toBe("logged");
  });

  it("shows the staff the reader's choices and the record of each, newest first", async () => {
    const [sub] = await db().execute<Row>(sql`select id from commerce.marketing_subscribers where store_id = ${storeId}::uuid and token = ${token}`);
    const choices = await topics.readerChoices(storeId, String(sub.id));
    expect(choices?.frequency).toBe("all");
    const rows = choices?.record.map((c) => [c.names["nb-NO"].name, c.optedIn, c.source]) ?? [];
    // The newest first; the two choices saved together share their moment, in no set order.
    expect(rows[0]).toEqual(["Tilbud", false, "preferences"]);
    expect(rows.slice(1)).toEqual(expect.arrayContaining([["Nyheter", false, "preferences"], ["Tilbud", true, "preferences"]]));
    expect(rows).toHaveLength(3);
    expect(await topics.readerChoices(storeId, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("changes nothing for a reader who left", async () => {
    await db().execute(sql`update commerce.marketing_subscribers set status = 'unsubscribed', unsubscribe_source = 'link' where store_id = ${storeId}::uuid and token = ${token}`);
    expect(await prefs.savePreferences(storeId, token, { topicIds: [], frequency: "monthly", words: "" })).toBe(false);
    expect(await prefs.setRest(storeId, token, true)).toBe(false);
  });
});
