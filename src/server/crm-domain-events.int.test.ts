import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const { newStore } = await import("./inventory-test-support");
const activities = await import("./activities");
const leads = await import("./leads");
const deals = await import("./deals");
const { latestSubject } = await import("./workflow-subjects");

/**
 * The lead, activity and domain-problem events (ecosystem plan E5.1, D757) through the server, against a real database: each queued where
 * its row changes, in the log, to an owner's endpoint that chose it and to a workflow on it, and found by a workflow's *Test*.
 */

let store: Awaited<ReturnType<typeof newStore>>;
let member: Awaited<ReturnType<typeof newStore>>["member"];
const run = Date.now().toString(36);
const made: { endpoints: string[]; workflows: string[] } = { endpoints: [], workflows: [] };
const KINDS = { quote: "quote request", question: "question", chat: "chat", subscriber: "new subscriber" };

beforeAll(async () => {
  store = await newStore("e51-events");
  // Deals and leads are the feature `sales`'s.
  await db().execute(sql`update commerce.stores set features = array_append(features, 'sales') where id = ${store.storeId}::uuid and not ('sales' = any(features))`);
  member = { ...store.member, store: { ...store.member.store, features: [...store.member.store.features, "sales" as const] } };
  await deals.ensurePipeline(store.storeId, { name: "Sales", stages: [{ name: "New" }, { name: "Talking" }] });
}, 120_000);

afterAll(async () => {
  for (const id of made.endpoints) await db().execute(sql`delete from commerce.webhook_endpoints where store_id = ${store.storeId}::uuid and id = ${id}::uuid`);
  for (const id of made.workflows) await db().execute(sql`delete from commerce.workflows where store_id = ${store.storeId}::uuid and id = ${id}::uuid`);
  await closeDb();
});

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

const loggedAbout = async (subjectId: string) =>
  (await db().execute<Row>(sql`select event from commerce.events where store_id = ${store.storeId}::uuid and subject_id = ${subjectId}::uuid order by tx, id`)).map((r) =>
    String(r.event),
  );
const delivered = async (endpointId: string, subjectId: string) =>
  (await db().execute<Row>(sql`select event from commerce.integration_deliveries where endpoint_id = ${endpointId}::uuid and subject_id = ${subjectId}::uuid order by created_at, event`)).map(
    (r) => String(r.event),
  );
const runs = async (workflowId: string, subjectId: string) =>
  (await db().execute<Row>(sql`select 1 from commerce.workflow_runs where workflow_id = ${workflowId}::uuid and subject_id = ${subjectId}::uuid`)).length;

describe("the events E3.2 left (E5.1, D757)", () => {
  it("an activity added and done, through the activities' own functions; opened again is none", async () => {
    const to = await listeners(["activity.done", "activity.created"]);
    const [kari] = await db().execute<Row>(sql`
      insert into commerce.customers (store_id, email, name) values (${store.storeId}::uuid, ${`act-${run}@example.com`}, 'Kari') returning id
    `);
    const call = await activities.createActivity(member, { kind: "call", title: `Ring Kari ${run}`, dueOn: "2026-11-20", dueTime: "10:00", customerId: String(kari.id) });
    if (!call.ok) throw new Error(call.problems.join(" "));
    expect((await activities.setActivityDone(member, call.id, true)).ok).toBe(true);
    expect((await activities.setActivityDone(member, call.id, false)).ok).toBe(true);
    expect(await loggedAbout(call.id)).toEqual(["activity.created", "activity.done"]);
    expect(await delivered(to.endpointId, call.id)).toEqual(["activity.created", "activity.done"]);
    expect(await runs(to.workflowId, call.id)).toBe(1);
    // A workflow's *Test* runs on the latest of each: none done now, once it is opened again.
    expect(await latestSubject(store.storeId, "activity.created")).toBe(call.id);
    expect(await latestSubject(store.storeId, "activity.done")).toBeNull();
  });

  it("a lead dismissed, then made a deal of when they ask again: one event each, after the deal's own", async () => {
    const to = await listeners(["lead.deal_made", "lead.dismissed"]);
    const email = `lead-${run}@example.com`;
    const [form] = await db().execute<Row>(sql`insert into commerce.forms (store_id, kind, name) values (${store.storeId}::uuid, 'message', 'Contact') returning id`);
    const ask = (minutesAgo: number) =>
      db().execute<Row>(sql`
        insert into commerce.form_responses (form_id, answers, contact_email, path, locale, delivery, created_at)
        values (${String(form.id)}::uuid, ${JSON.stringify([{ label: "Message", value: "Green totes?" }])}::jsonb, ${email}, '/contact', 'nb', 'sent',
          now() - make_interval(mins => ${minutesAgo}))
        returning id
      `);
    await ask(10);
    expect(await leads.dismissLead(member, email)).toEqual({ ok: true, dealId: null });
    const [again] = await ask(0);
    const deal = await leads.makeLeadDeal(member, email, KINDS);
    if (!deal.ok) throw new Error(deal.problem);
    const [decision] = await db().execute<Row>(sql`select id from commerce.lead_decisions where store_id = ${store.storeId}::uuid and email = ${email}`);
    const id = String(decision.id);
    expect(await loggedAbout(id)).toEqual(["lead.dismissed", "lead.deal_made"]);
    expect(await loggedAbout(deal.dealId!)).toEqual(["deal.created"]);
    expect(await delivered(to.endpointId, id)).toEqual(["lead.dismissed", "lead.deal_made"]);
    expect(await runs(to.workflowId, id)).toBe(1);
    expect(await latestSubject(store.storeId, "lead.deal_made")).toBe(id);
    // What a receiver is sent: the deal, the customer it made and the requests as ids; never the address or the words.
    const { subjectData } = await import("./integrations");
    const data = await subjectData({ id: store.storeId, slug: store.slug, name: "E5.1" }, "lead.deal_made", id);
    expect(data?.lead).toMatchObject({ decision: "deal", deal_id: deal.dealId, requests: [{ kind: "question", source: "form", id: String(again.id) }, { kind: "question" }] });
    expect((data?.lead as Row).customer_id).toEqual(expect.any(String));
    expect(JSON.stringify(data)).not.toMatch(new RegExp(`${email}|Green totes`));
  });

  it("a domain the watch finds failing, then working again, once each, whatever it could not tell between", async () => {
    const to = await listeners(["domain.failing", "domain.recovered"]);
    const [domain] = await db().execute<Row>(sql`
      insert into commerce.store_domains (store_id, hostname, token, status, is_primary)
      values (${store.storeId}::uuid, ${`e51-${run}.example`}, 'tok', 'active', true) returning id
    `);
    const id = String(domain.id);
    // The watch's own write (`watchDomains()`): its answer replaces the last, the rest of the checks kept.
    const watch = (serving: string | null) =>
      db().execute(sql`
        update commerce.store_domains set checks = coalesce(checks, '{}'::jsonb) || jsonb_build_object('watch', ${JSON.stringify({ at: new Date().toISOString(), serving })}::jsonb)
        where id = ${id}::uuid and store_id = ${store.storeId}::uuid and status = 'active'
      `);
    for (const answer of ["ok", "elsewhere", null, "elsewhere", "certificate", null, "ok", "ok"]) await watch(answer);
    expect(await loggedAbout(id)).toEqual(["domain.failing", "domain.recovered"]);
    expect(await delivered(to.endpointId, id)).toEqual(["domain.failing", "domain.recovered"]);
    expect(await runs(to.workflowId, id)).toBe(1);
    expect(await latestSubject(store.storeId, "domain.recovered")).toBe(id);
    expect(await latestSubject(store.storeId, "domain.failing")).toBeNull();
  });
});
