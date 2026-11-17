import { randomBytes, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { EVENT_KEEP_DAYS } from "@/lib/event-log";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const log = await import("./event-log");
const { newStore, pay, place } = await import("./inventory-test-support");

/**
 * The event log and its readers (ecosystem plan E3.1, D718) against a real database, and the events that were missing (E3.2), each queued
 * where its row changes or by the job that finds it: in the log, to an endpoint that chose it, and to a workflow on it.
 */

let store: Awaited<ReturnType<typeof newStore>>;
let pool: Pool;
const run = Date.now().toString(36);

beforeAll(async () => {
  store = await newStore("events");
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
}, 120_000);

/** The endpoints and workflows the tests make: gone with their deliveries and runs at the end, so no later file's runner sends them. */
const made: { endpoints: string[]; workflows: string[] } = { endpoints: [], workflows: [] };

afterAll(async () => {
  for (const id of made.endpoints) await db().execute(sql`delete from commerce.webhook_endpoints where store_id = ${store.storeId}::uuid and id = ${id}::uuid`);
  for (const id of made.workflows) await db().execute(sql`delete from commerce.workflows where store_id = ${store.storeId}::uuid and id = ${id}::uuid`);
  await db().execute(sql`delete from commerce.event_cursors where consumer like ${`test:%:${run}`}`);
  await pool.end();
  await closeDb();
});

const queue = (event: string, subject: string | null = null) =>
  db().execute(sql`select commerce.queue_integration_event(${store.storeId}::uuid, ${event}, ${subject}::uuid)`);

/** The store's events about a subject, in the log's order. */
async function loggedAbout(subjectId: string): Promise<string[]> {
  const rows = await db().execute<Row>(sql`
    select event from commerce.events where store_id = ${store.storeId}::uuid and subject_id = ${subjectId}::uuid order by tx, id
  `);
  return rows.map((r) => String(r.event));
}

describe("reading the log with a cursor (E3.1)", () => {
  it("starts a new reader at now, hands out events in order, a batch at a time, and holds them from a second runner", async () => {
    const reader = `test:order:${run}`;
    await queue("product.updated", randomUUID());
    const first = await log.readEventsAfter(reader, { storeId: store.storeId });
    // From now: what came before is not this reader's.
    expect(first.events).toEqual([]);
    expect(await log.advanceCursor(reader, first.lastId, first.claim!)).toBe(true);

    const subjects = [randomUUID(), randomUUID(), randomUUID()];
    for (const subject of subjects) await queue("order.paid", subject);
    const batch = await log.readEventsAfter(reader, { storeId: store.storeId, limit: 2 });
    expect(batch.events.map((e) => e.subjectId)).toEqual(subjects.slice(0, 2));
    expect(batch.events.every((e) => e.storeId === store.storeId && e.event === "order.paid")).toBe(true);
    expect(batch.lastId).toBe(batch.events[1].id);
    // A second runner of the same reader gets nothing while the first holds the cursor.
    expect(await log.readEventsAfter(reader, { storeId: store.storeId })).toEqual({ claim: null, events: [], lastId: null });
    expect(await log.advanceCursor(reader, batch.lastId, batch.claim!)).toBe(true);
    const rest = await log.readEventsAfter(reader, { storeId: store.storeId, limit: 2 });
    expect(rest.events.map((e) => e.subjectId)).toEqual(subjects.slice(2));
    expect(await log.advanceCursor(reader, rest.lastId, rest.claim!)).toBe(true);
    // Nothing new.
    const none = await log.readEventsAfter(reader, { storeId: store.storeId });
    expect(none.events).toEqual([]);
    await log.advanceCursor(reader, none.lastId, none.claim!);
  });

  it("takes only the events asked for, and moves past the rest without reading them again", async () => {
    const reader = `test:filter:${run}`;
    const start = await log.readEventsAfter(reader, { storeId: store.storeId });
    await log.advanceCursor(reader, start.lastId, start.claim!);
    const wanted = randomUUID();
    await queue("order.paid", randomUUID());
    await queue("deal.won", wanted);
    await queue("order.paid", randomUUID());
    const batch = await log.readEventsAfter(reader, { storeId: store.storeId, events: ["deal.won"] });
    expect(batch.events.map((e) => [e.event, e.subjectId])).toEqual([["deal.won", wanted]]);
    await log.advanceCursor(reader, batch.lastId, batch.claim!);
    const after = await log.readEventsAfter(reader, { storeId: store.storeId, events: ["deal.won"] });
    expect(after.events).toEqual([]);
    await log.advanceCursor(reader, after.lastId, after.claim!);
    // A reader may start at the oldest event kept instead.
    const fromStart = await log.readEventsAfter(`test:start:${run}`, { storeId: store.storeId, events: ["deal.won"], from: "start" });
    expect(fromStart.events.map((e) => e.subjectId)).toEqual([wanted]);
    await log.advanceCursor(`test:start:${run}`, fromStart.lastId, fromStart.claim!);
  });

  it("never skips an event whose transaction commits after a later one's: a transaction still running holds the reader back", async () => {
    const reader = `test:commit-order:${run}`;
    const start = await log.readEventsAfter(reader, { storeId: store.storeId });
    await log.advanceCursor(reader, start.lastId, start.claim!);
    const early = randomUUID();
    const late = randomUUID();
    const slow = await pool.connect();
    try {
      // The slow transaction writes first (its id is the lower) and commits last.
      await slow.query("begin");
      await slow.query("select commerce.queue_integration_event($1, 'order.paid', $2)", [store.storeId, early]);
      await queue("order.paid", late);
      const held = await log.readEventsAfter(reader, { storeId: store.storeId });
      expect(held.events).toEqual([]);
      await log.advanceCursor(reader, held.lastId, held.claim!);
      await slow.query("commit");
    } finally {
      slow.release();
    }
    const both = await log.readEventsAfter(reader, { storeId: store.storeId });
    expect(both.events.map((e) => e.subjectId)).toEqual([early, late]);
    await log.advanceCursor(reader, both.lastId, both.claim!);
  });

  it("hands a batch again when its runner's claim ran out or its handler failed, and the late runner cannot move the cursor", async () => {
    const reader = `test:claims:${run}`;
    const start = await log.readEventsAfter(reader, { storeId: store.storeId });
    await log.advanceCursor(reader, start.lastId, start.claim!);
    const subject = randomUUID();
    await queue("refund.created", subject);
    const slow = await log.readEventsAfter(reader, { storeId: store.storeId });
    expect(slow.events.map((e) => e.subjectId)).toEqual([subject]);
    // Its claim runs out (the runner died, or took too long): the next runner takes the same events.
    await db().execute(sql`update commerce.event_cursors set claimed_until = now() - interval '1 second' where consumer = ${reader}`);
    const next = await log.readEventsAfter(reader, { storeId: store.storeId });
    expect(next.events.map((e) => e.subjectId)).toEqual([subject]);
    expect(await log.advanceCursor(reader, slow.lastId, slow.claim!)).toBe(false);
    await log.releaseCursor(reader, next.claim!);
    // A handler that throws lets the claim go: the same events come again.
    await expect(log.consumeEvents(reader, { storeId: store.storeId }, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    const handled: string[] = [];
    expect(await log.consumeEvents(reader, { storeId: store.storeId }, async (events) => void handled.push(...events.map((e) => e.subjectId!)))).toEqual({ busy: false, handled: 1 });
    expect(handled).toEqual([subject]);
    expect((await log.consumeEvents(reader, { storeId: store.storeId }, async () => {})).handled).toBe(0);
    // Never back: an older event's id leaves the cursor where it is.
    const before = await db().execute<Row>(sql`select last_id::text as id from commerce.event_cursors where consumer = ${reader}`);
    const again = await log.readEventsAfter(reader, { storeId: store.storeId });
    await log.advanceCursor(reader, slow.events[0].id - 1, again.claim!);
    expect(await db().execute<Row>(sql`select last_id::text as id from commerce.event_cursors where consumer = ${reader}`)).toEqual(before);
  });

  it("refuses a reader's name or an event's name that is not one", async () => {
    await expect(log.readEventsAfter("Not a reader")).rejects.toThrow(/reader's name/);
    await expect(log.readEventsAfter(`test:bad:${run}`, { events: ["order.paid'; drop"] })).rejects.toThrow(/event's name/);
  });

  it("prunes events older than it keeps, and keeps the rest", async () => {
    // The log's first event, as the oldest is (an id below every other).
    const [old] = await db().execute<Row>(sql`
      insert into commerce.events (id, store_id, event, at) overriding system value
      values (-floor(random() * 1e12)::bigint - 1, ${store.storeId}::uuid, 'order.paid', now() - make_interval(days => ${EVENT_KEEP_DAYS + 1})) returning id
    `);
    const kept = randomUUID();
    await queue("order.paid", kept);
    expect(await log.pruneEvents()).toBeGreaterThanOrEqual(1);
    expect(await db().execute(sql`select 1 from commerce.events where id = ${String(old.id)}::bigint`)).toHaveLength(0);
    expect(await loggedAbout(kept)).toEqual(["order.paid"]);
  });
});

describe("the events that were missing (E3.2)", () => {
  /** An endpoint of the owner's that chose these topics, and a workflow on the first: what each event reaches. */
  async function listeners(topics: string[]): Promise<{ endpointId: string; workflowId: string }> {
    const [endpoint] = await db().execute<Row>(sql`
      insert into commerce.webhook_endpoints (store_id, name, url_encrypted, hint, secret_encrypted, topics)
      values (${store.storeId}::uuid, ${`Events ${topics[0]}`}, 'sealed', 'example.com/…', 'sealed', ${`{${topics.join(",")}}`}::text[])
      returning id
    `);
    const [flow] = await db().execute<Row>(sql`
      insert into commerce.workflows (store_id, name, trigger, actions, enabled, version, tested_version)
      values (${store.storeId}::uuid, ${`On ${topics[0]} ${run}`}, ${topics[0]}, '[{"kind":"email_staff","subject":"x","text":"y"}]', true, 1, 1)
      returning id
    `);
    made.endpoints.push(String(endpoint.id));
    made.workflows.push(String(flow.id));
    return { endpointId: String(endpoint.id), workflowId: String(flow.id) };
  }
  const delivered = async (endpointId: string, subjectId: string) =>
    (await db().execute<Row>(sql`select event from commerce.integration_deliveries where endpoint_id = ${endpointId}::uuid and subject_id = ${subjectId}::uuid order by created_at, event`)).map((r) => String(r.event));
  const runs = async (workflowId: string, subjectId: string) =>
    (await db().execute<Row>(sql`select 1 from commerce.workflow_runs where workflow_id = ${workflowId}::uuid and subject_id = ${subjectId}::uuid`)).length;

  it("a deal made, moved, won, opened again and lost; none for a deal moved in from Pipedrive", async () => {
    const deals = await import("./deals");
    const to = await listeners(["deal.won", "deal.created", "deal.stage_changed", "deal.lost"]);
    const [pipeline] = await deals.ensurePipeline(store.storeId, { name: "Sales", stages: [{ name: "New" }, { name: "Talking" }] });
    const [customer] = await db().execute<Row>(sql`
      insert into commerce.customers (store_id, email, name) values (${store.storeId}::uuid, ${`deal-${run}@example.com`}, 'Kari') returning id
    `);
    const made = await deals.createDeal(store.member, { title: `Events deal ${run}`, customerId: String(customer.id), pipelineId: pipeline.id, stageId: pipeline.stages[0].id });
    if (!made.ok) throw new Error(made.problems.join(" "));
    expect((await deals.moveDeal(store.member, made.id, pipeline.stages[1].id)).ok).toBe(true);
    expect((await deals.closeDeal(store.member, made.id, "won")).ok).toBe(true);
    expect((await deals.reopenDeal(store.member, made.id)).ok).toBe(true);
    expect((await deals.closeDeal(store.member, made.id, "lost", "Too dear")).ok).toBe(true);
    expect(await loggedAbout(made.id)).toEqual(["deal.created", "deal.stage_changed", "deal.won", "deal.lost"]);
    expect(await delivered(to.endpointId, made.id)).toEqual(["deal.created", "deal.stage_changed", "deal.won", "deal.lost"]);
    expect(await runs(to.workflowId, made.id)).toBe(1);

    const moved = await db().transaction(async (tx) => {
      await tx.execute(sql`select set_config('commerce.deal_importing', 'on', true)`);
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.deals (store_id, title, pipeline_id, stage_id, status, currency, closed_at, closed_via)
        values (${store.storeId}::uuid, 'Moved in', ${pipeline.id}::uuid, ${pipeline.stages[0].id}::uuid, 'won', 'NOK', now(), 'person') returning id
      `);
      return String(row.id);
    });
    expect(await loggedAbout(moved)).toEqual([]);
  });

  it("an address joining the email list and leaving it; none while it waits for its link, or when moved in from another shop", async () => {
    const list = await import("./marketing-subscribers");
    const to = await listeners(["subscriber.subscribed", "subscriber.unsubscribed"]);
    const join = (email: string, proof: "confirmed" | "link") =>
      list.joinList({ storeId: store.storeId, email, locale: "nb-NO", marketCode: "NO", source: "form", consentText: "Ja takk", proof });
    const joined = await join(`list-${run}@example.com`, "confirmed");
    expect(joined.status).toBe("subscribed");
    expect(await list.unsubscribeByStaff(store.storeId, store.accountId, joined.subscriberId)).toBe(true);
    expect(await loggedAbout(joined.subscriberId)).toEqual(["subscriber.subscribed", "subscriber.unsubscribed"]);
    expect(await delivered(to.endpointId, joined.subscriberId)).toEqual(["subscriber.subscribed", "subscriber.unsubscribed"]);
    expect(await runs(to.workflowId, joined.subscriberId)).toBe(1);

    const waiting = await join(`wait-${run}@example.com`, "link");
    expect(waiting.status).toBe("pending");
    expect(await loggedAbout(waiting.subscriberId)).toEqual([]);
    const moved = await list.addMovedSubscribers(store.storeId, "nb-NO", [{ email: `moved-${run}@example.com`, name: "", consentedAt: new Date().toISOString(), confirmed: true, consentText: "Shopify" }]);
    expect(await loggedAbout(moved.ids[0])).toEqual([]);
  });

  it("a support conversation ended and rated, again when the rating changes; the platform's desk into the log only", async () => {
    const support = await import("./support");
    const { systemDesk } = await import("./support-desk");
    const to = await listeners(["conversation.ended", "conversation.rated"]);
    const desk = systemDesk(store.storeId);
    const { conversation } = await support.openConversation(desk, { mode: (await support.ensureDesk(desk)).mode, locale: "nb-NO", market: "NO", pagePath: null, customerId: null });
    await support.transition(desk, conversation.id, "end", { kind: "customer" });
    expect(await support.setRating(desk, conversation.id, "bad", "Nobody answered")).toBe(true);
    expect(await support.setRating(desk, conversation.id, "good", null)).toBe(true);
    expect(await loggedAbout(conversation.id)).toEqual(["conversation.ended", "conversation.rated", "conversation.rated"]);
    // The endpoint's delivery not yet built is built with the rating as it is when it goes: one for both, as for every topic.
    expect(await delivered(to.endpointId, conversation.id)).toEqual(["conversation.ended", "conversation.rated"]);
    expect(await runs(to.workflowId, conversation.id)).toBe(1);

    const platform = systemDesk(null);
    const own = await support.openConversation(platform, { mode: (await support.ensureDesk(platform)).mode, locale: "en-IE", market: null, pagePath: null, customerId: null });
    await support.transition(platform, own.conversation.id, "end", { kind: "customer" });
    const rows = await db().execute<Row>(sql`select store_id, event from commerce.events where subject_id = ${own.conversation.id}::uuid`);
    expect(rows).toEqual([{ store_id: null, event: "conversation.ended" }]);
  });

  it("a buyer's review published, at once or when the store checks it; never twice, never for an imported one", async () => {
    const { hideReview, publishReview } = await import("./reviews-admin");
    const to = await listeners(["review.published"]);
    const order = await place(store.storeId, [["DEMO-MUG-WHITE", 1], ["DEMO-TOTE", 1]]);
    await pay(store.storeId, order, store.account);
    const review = async (line: number, status: "pending" | "published") =>
      db().transaction(async (tx) => {
        await tx.execute(sql`select set_config('kaizen.review_writer', 'author', true)`);
        const [made] = await tx.execute<Row>(sql`
          insert into commerce.product_reviews (store_id, product_id, variant_id, source, order_id, order_line_id, buyer_key, author_name, rating, title, body, locale, status)
          select ol.store_id, v.product_id, ol.variant_id, 'buyer', ol.order_id, ol.id, ${`c:${randomUUID()}`}, 'Kari', 4, 'Fin', 'Holder varmen.', 'nb-NO', ${status}
          from commerce.order_lines ol join commerce.product_variants v on v.id = ol.variant_id
          where ol.order_id = ${order.orderId}::uuid order by ol.id offset ${line} limit 1
          returning id
        `);
        return String(made.id);
      });
    const checked = await review(0, "pending");
    expect(await loggedAbout(checked)).toEqual(["review.created"]);
    expect((await publishReview(store.storeId, store.accountId, checked)).ok).toBe(true);
    expect(await loggedAbout(checked)).toEqual(["review.created", "review.published"]);
    expect(await delivered(to.endpointId, checked)).toEqual(["review.published"]);
    expect(await runs(to.workflowId, checked)).toBe(1);
    // Hidden and shown again is published again; saving it published as it was is nothing.
    expect((await hideReview(store.storeId, store.accountId, checked, "spam")).ok).toBe(true);
    expect((await publishReview(store.storeId, store.accountId, checked)).ok).toBe(true);
    expect(await loggedAbout(checked)).toEqual(["review.created", "review.published", "review.published"]);

    const atOnce = await review(1, "published");
    expect(await loggedAbout(atOnce)).toEqual(["review.created", "review.published"]);

    const imported = await db().transaction(async (tx) => {
      await tx.execute(sql`select set_config('kaizen.review_writer', 'import', true)`);
      const [made] = await tx.execute<Row>(sql`
        insert into commerce.product_reviews (store_id, product_id, source, imported_from, written_on, author_name, rating, locale, status)
        select store_id, product_id, 'import', 'Trustpilot', current_date, 'Ola', 5, 'nb-NO', 'published' from commerce.product_variants
        where store_id = ${store.storeId}::uuid and sku = 'DEMO-MUG-WHITE'
        returning id
      `);
      return String(made.id);
    });
    expect(await loggedAbout(imported)).toEqual([]);
  });

  it("a checkout abandoned once a cart, when its first reminder is due; not when it was bought since", async () => {
    const reminders = await import("./cart-reminders");
    const to = await listeners(["checkout.abandoned"]);
    await reminders.setCartRemindersEnabled(store.member, true);
    const left = async (email: string, ago: string) => {
      const [variant] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = 'DEMO-TOTE'`);
      const lines = [{ variantId: String(variant.id), sellingPlanId: null, title: "Tote", quantity: 2, unitPriceMinor: 19900 }];
      const [basket] = await db().execute<Row>(sql`
        insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
        values (${store.storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id
      `);
      const [row] = await db().execute<Row>(sql`
        insert into commerce.abandoned_checkouts (store_id, cart_id, email, market_code, locale, currency, lines, subtotal_minor, token, captured_at)
        values (${store.storeId}::uuid, ${String(basket.id)}::uuid, ${email}, 'NO', 'nb-NO', 'NOK', ${JSON.stringify(lines)}::jsonb, 39800,
          ${randomBytes(24).toString("base64url")}, now() - ${ago}::interval)
        returning id
      `);
      return String(row.id);
    };
    const cart = await left(`left-${run}@example.com`, "2 hours");
    await reminders.sendDueCartReminders();
    // Days on, the last reminder goes: the cart was abandoned once.
    await db().execute(sql`update commerce.abandoned_checkouts set captured_at = now() - interval '5 days' where id = ${cart}::uuid`);
    await reminders.sendDueCartReminders();
    const [row] = await db().execute<Row>(sql`select reminders_sent, abandoned_at is not null as abandoned from commerce.abandoned_checkouts where id = ${cart}::uuid`);
    expect(row).toEqual({ reminders_sent: 2, abandoned: true });
    expect(await loggedAbout(cart)).toEqual(["checkout.abandoned"]);
    expect(await delivered(to.endpointId, cart)).toEqual(["checkout.abandoned"]);
    expect(await runs(to.workflowId, cart)).toBe(1);

    // Not yet due: not abandoned.
    const fresh = await left(`fresh-${run}@example.com`, "1 minute");
    await reminders.sendDueCartReminders();
    expect(await loggedAbout(fresh)).toEqual([]);
  });
});
