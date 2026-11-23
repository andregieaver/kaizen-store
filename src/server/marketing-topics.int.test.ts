import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));

const topics = await import("./marketing-topics");
const bc = await import("./broadcasts");
const { storeById } = await import("./shopper-emails");

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
let storeId = "";
let otherId = "";
let owner = "";
const subscribers: string[] = [];

async function makeStore(slug: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`${slug}-${run}`}, 'Test', null) as id`);
  return String(created.id);
}

/** How many of the store's subscribed readers are in a topic, by the one rule. */
async function inTopicCount(topic: { id: string; defaultOn: boolean }): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.marketing_subscribers s where s.store_id = ${storeId}::uuid and s.status = 'subscribed' and ${topics.inTopic(topic)}
  `);
  return Number(row.n);
}

beforeAll(async () => {
  storeId = await makeStore("tpc");
  otherId = await makeStore("tpc-other");
  const [acc] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid limit 1`);
  owner = String(acc.account_id);
  for (const n of [1, 2, 3]) {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.marketing_subscribers (store_id, email, locale, status, source, consent_text, consented_at, token)
      values (${storeId}::uuid, ${`r${n}-${run}@example.com`}, 'nb-NO', 'subscribed', 'form', 'Ja takk', now(), ${(run + String(n) + "t".repeat(43)).slice(0, 43)})
      returning id
    `);
    subscribers.push(String(row.id));
  }
});

afterAll(async () => {
  await closeDb();
});

/** Topics (email plan M4.2, D882): the store's own, a reader in one by their newest choice else its default, each choice kept. */
describe("email topics", () => {
  it("adds, renames, orders and archives a store's topics, audited, never another store's", async () => {
    expect(await topics.saveTopic(storeId, owner, null, { names: { "nb-NO": { name: " " } } })).toMatchObject({ ok: false, problem: "input" });
    const news = await topics.saveTopic(storeId, owner, null, { names: { "nb-NO": { name: "Nyheter", line: "Det nye fra oss" }, "en-GB": { name: "" } } });
    const offers = await topics.saveTopic(storeId, owner, null, { names: { "nb-NO": { name: "Tilbud" } }, defaultOn: false });
    if (!news.ok || !offers.ok) throw new Error("not saved");
    expect((await topics.listTopics(storeId)).map((t) => t.names["nb-NO"].name)).toEqual(["Nyheter", "Tilbud"]);
    expect((await topics.listTopics(storeId))[0].names).toEqual({ "nb-NO": { name: "Nyheter", line: "Det nye fra oss" } });
    expect(await topics.moveTopic(storeId, owner, offers.id, -1)).toBe(true);
    expect((await topics.listTopics(storeId)).map((t) => t.id)).toEqual([offers.id, news.id]);
    expect(await topics.saveTopic(otherId, owner, news.id, { names: { "nb-NO": { name: "Theirs" } } })).toMatchObject({ ok: false, problem: "unknown" });
    expect(await topics.listTopics(otherId)).toEqual([]);
    expect(await topics.archiveTopic(storeId, owner, offers.id, true)).toBe(true);
    expect((await topics.listTopics(storeId)).map((t) => t.id)).toEqual([news.id]);
    expect((await topics.listTopics(storeId, true)).length).toBe(2);
    expect(await topics.archiveTopic(storeId, owner, offers.id, false)).toBe(true);
    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action like 'marketing_topic.%'`);
    expect(Number(audited.n)).toBe(5);
  });

  it("puts a reader in a topic by their newest choice, else its default, and keeps only choices that change something", async () => {
    const [offers, news] = await topics.listTopics(storeId);
    expect(await inTopicCount(news)).toBe(3);
    expect(await inTopicCount(offers)).toBe(0);
    expect(await topics.recordChoices(storeId, subscribers[0], [{ topicId: news.id, optedIn: false }, { topicId: offers.id, optedIn: true }], "preferences", "Nyheter, Tilbud")).toBe(2);
    // The same again changes nothing, so nothing is kept.
    expect(await topics.recordChoices(storeId, subscribers[0], [{ topicId: news.id, optedIn: false }, { topicId: offers.id, optedIn: true }], "preferences", "Nyheter, Tilbud")).toBe(0);
    // A choice equal to the default, for a reader with none, is not a change either.
    expect(await topics.recordChoices(storeId, subscribers[1], [{ topicId: news.id, optedIn: true }], "preferences", "")).toBe(0);
    expect(await inTopicCount(news)).toBe(2);
    expect(await inTopicCount(offers)).toBe(1);
    // A topic of another store, or another store's reader, is never written.
    expect(await topics.recordChoices(otherId, subscribers[2], [{ topicId: news.id, optedIn: false }], "staff", "")).toBe(0);
    // Choosing again is a new row: the record keeps both.
    expect(await topics.recordChoices(storeId, subscribers[0], [{ topicId: news.id, optedIn: true }], "staff", "")).toBe(1);
    const [kept] = await db().execute<Row>(sql`select count(*)::int as n from commerce.marketing_topic_choices where subscriber_id = ${subscribers[0]}::uuid`);
    expect(Number(kept.n)).toBe(3);
    expect(await inTopicCount(news)).toBe(3);
    // The list's counts follow the same rule.
    const counts = await topics.topicCounts(storeId);
    expect(counts.get(news.id)).toBe(await inTopicCount(news));
    expect(counts.get(offers.id)).toBe(await inTopicCount(offers));
  });

  it("counts and saves a broadcast about a topic by the same rule, and refuses a topic of another store", async () => {
    const store = (await storeById(storeId))!;
    const [offers, news] = await topics.listTopics(storeId);
    expect(await bc.audienceCount(store, "everyone", null)).toEqual({ ok: true, people: 3 });
    expect(await bc.audienceCount(store, "everyone", null, offers.id)).toEqual({ ok: true, people: await inTopicCount(offers) });
    expect(await bc.audienceCount(store, "everyone", null, news.id)).toEqual({ ok: true, people: await inTopicCount(news) });
    const content = { "nb-NO": { subject: "Tilbud", preview: "", blocks: [{ type: "paragraph" as const, text: "Hei" }] } };
    const saved = await bc.saveBroadcast(store, owner, null, { title: "Om tilbud", audience: "everyone", segmentId: null, content, topicId: offers.id });
    if (!saved.ok) throw new Error(saved.problem);
    expect((await bc.getBroadcast(storeId, saved.id))?.topicId).toBe(offers.id);
    const other = (await storeById(otherId))!;
    expect(await bc.saveBroadcast(other, owner, null, { title: "x", audience: "everyone", segmentId: null, content, topicId: offers.id })).toEqual({ ok: false, problem: bc.TOPIC_GONE });
  });
});
