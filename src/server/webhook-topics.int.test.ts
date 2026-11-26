import { randomBytes, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { APP_EVENTS, EVENTS } from "@/lib/integrations";
import { PAYLOAD_VERSION } from "@/lib/webhook-signature";
import { WEBHOOK_TEST_DATA, WEBHOOK_TOPICS, webhookEnvelope } from "@/lib/webhook-topics";
import { z } from "zod";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const logged: { event: string; fields: Record<string, unknown> }[] = [];
vi.mock("./log", () => ({ log: (_level: string, event: string, fields: Record<string, unknown> = {}) => logged.push({ event, fields }) }));

const integrations = await import("./integrations");
const { markSent } = await import("./order-admin");
const { setArchived } = await import("./products");
const { newStore, pay, place, variantId } = await import("./inventory-test-support");

/**
 * The webhook topics' contracts (D438) against a real database: every topic's subject is made in a store (an order paid and sent, a
 * customer, a subscription, a return, a confirmed withdrawal, a product, a low stock crossing, a discount code, support waiting), its
 * payload built as an endpoint would be sent it, and parsed with the topic's schema; a test delivery's sample order too. No payload of
 * another shape is logged on the way.
 */

let store: Awaited<ReturnType<typeof newStore>>;
const subjects: Partial<Record<string, string | null>> = {};
const SKU = "DEMO-MUG-WHITE";

beforeAll(async () => {
  store = await newStore("topics");
  const order = await place(store.storeId, [[SKU, 2]]);
  await pay(store.storeId, order, store.account);
  const [line] = await db().execute<Row>(sql`select id from commerce.order_lines where order_id = ${order.orderId}::uuid order by id limit 1`);
  const sent = await markSent(store.storeId, order.orderId, { carrier: "posten", trackingNumber: "TOPIC1", trackingUrl: null }, store.accountId, null, { lines: null });
  if (!sent.ok) throw new Error(sent.reason);
  subjects.order = order.orderId;
  // D440: the parcel (fulfilment.*), a refund of the order (refund.created) and a draft order (quote.requested, draft.sent).
  subjects.fulfilment = sent.shipment.id;
  const [refund] = await db().execute<Row>(sql`
    insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status, kind)
    select p.store_id, p.id, 1000, 'Goodwill', ${`re_topics_${Date.now()}`}, 'succeeded', 'money' from commerce.payments p
    where p.store_id = ${store.storeId}::uuid and p.order_id = ${order.orderId}::uuid and p.status = 'captured' limit 1
    returning id
  `);
  subjects.refund = String(refund.id);
  const { createDraft } = await import("./draft-orders");
  const draft = await createDraft(store.storeId, { accountId: store.accountId, kind: "staff" });
  if (!draft.ok) throw new Error(draft.problem);
  subjects.draft = draft.draft.id;

  const [customer] = await db().execute<Row>(sql`
    insert into commerce.customers (store_id, email, name) values (${store.storeId}::uuid, ${`topics-${Date.now()}@example.com`}, 'Kari') returning id
  `);
  subjects.customer = String(customer.id);

  const run = Date.now().toString(36);
  const [subscription] = await db().execute<Row>(sql`
    insert into commerce.subscriptions (store_id, number, status, market_code, currency, locale, email, customer_id,
      interval, interval_count, subtotal_minor, shipping_minor, total_minor, tax_minor, first_order_id, manage_token, current_period_end)
    values (${store.storeId}::uuid, ${`S-${run}`}, 'active', 'NO', 'NOK', 'nb-NO', 'kari@example.com', ${subjects.customer}::uuid,
      'month', 1, 19900, 0, 19900, 3980, ${order.orderId}::uuid, ${`manage-${run}`}, now() + interval '1 month')
    returning id
  `);
  subjects.subscription = String(subscription.id);

  // A confirmed withdrawal as the database would hold it, written with the triggers off (its lines and steps are the withdrawals' own tests').
  subjects.withdrawal = await db().transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    const [made] = await tx.execute<Row>(sql`
      insert into commerce.withdrawal_requests (store_id, order_id, name, email, channel, locale, market_code, status, submitted_at, confirmed_at)
      values (${store.storeId}::uuid, ${order.orderId}::uuid, 'Kari', 'kari@example.com', 'web', 'nb-NO', 'NO', 'confirmed', now(), now())
      returning id
    `);
    return String(made.id);
  });

  // A return the shopper asked for, with its line (its refund is worked out later: none yet).
  const [ret] = await db().execute<Row>(sql`
    insert into commerce.returns (store_id, order_id, kind, number, status)
    values (${store.storeId}::uuid, ${order.orderId}::uuid, 'return', ${`${order.number}-R1`}, 'requested')
    returning id
  `);
  await db().execute(sql`
    insert into commerce.return_lines (store_id, return_id, order_line_id, quantity) values (${store.storeId}::uuid, ${String(ret.id)}::uuid, ${String(line.id)}::uuid, 1)
  `);
  subjects.return = String(ret.id);

  const variant = await variantId(store.storeId, SKU);
  const [product] = await db().execute<Row>(sql`select product_id from commerce.product_variants where id = ${variant}::uuid`);
  subjects.product = String(product.product_id);
  // A level set at or above the stock is a crossing at once (D370): the variant's stock alert.
  await db().execute(sql`update commerce.product_variants set low_stock_threshold = 100000 where id = ${variant}::uuid`);
  subjects.stock = variant;

  const [discount] = await db().execute<Row>(sql`
    insert into commerce.discount_codes (store_id, code, kind, amounts, starts_at) values (${store.storeId}::uuid, ${`TOPIC${run.toUpperCase()}`}, 'fixed', '{"NO": 5000}', now())
    returning id
  `);
  subjects.discount = String(discount.id);

  // Support waiting is about no one: only how many wait now.
  subjects.support = null;

  // D440: a variant's stock (inventory.updated) is about the variant.
  subjects.inventory = variant;
  // An erased customer is only an id (the account is gone); a gift card issued by hand; a buyer's review of the order's product.
  subjects.erasure = "00000000-0000-4000-8000-0000000000ee";
  const { issueGiftCard } = await import("./gift-cards-admin");
  const { getStore } = await import("./stores");
  const issued = await issueGiftCard((await getStore(store.slug))!, store.accountId, {
    currency: "NOK",
    amountMinor: 25_000,
    recipientEmail: null,
    recipientName: null,
    message: null,
    lang: "nb-NO",
    note: "Topics",
  });
  if (!issued.ok) throw new Error(issued.problem);
  subjects.gift_card = issued.cardId;
  subjects.review = await buyerReview(order.orderId);
  // An app removed from the store (D441 D2): its ended installation is what app.uninstalled and store.erase_requested are about.
  const [client] = await db().execute<Row>(sql`
    insert into commerce.oauth_clients (kind, client_id, name, redirect_uris, secret_hash)
    values ('app', ${`kfapp_topics${run}`}, 'Topics app', array['https://app.example/cb'], 'hash') returning id
  `);
  const [installation] = await db().execute<Row>(sql`
    insert into commerce.oauth_grants (account_id, client_id, store_ids, store_id, scopes, resource, access, revoked_at)
    values (${store.accountId}::uuid, ${String(client.id)}::uuid, array[${store.storeId}::uuid], ${store.storeId}::uuid, array['stores:read'], 'admin', 'change', now())
    returning id
  `);
  subjects.installation = String(installation.id);
  // D148 phase 15: a running A/B test of a page (experiment.answered), its version B given one more row so it differs and may start.
  const admin = await import("./experiment-admin");
  const page = (await admin.testablePages(store.storeId)).find((p) => p.kind === "page" || p.kind === "role")!;
  const account = { id: store.accountId, email: `topics-${run}@example.com`, name: "Topics", platformAdmin: false };
  const made = await admin.createExperiment(account, store.storeId, { name: "Topics test", pageId: page.id, goal: "cart" });
  if (!made.ok) throw new Error(made.problems.join(" "));
  const versionPage = (await admin.getExperiment(store.storeId, made.id))!.variants.find((v) => v.key === "b")!.pageId!;
  const [version] = await db().execute<Row>(sql`select published from commerce.pages where id = ${versionPage}::uuid`);
  const content = version.published as { rows: { id: string }[] };
  const changed = JSON.stringify({ ...content, rows: [...content.rows, { ...content.rows[0], id: randomUUID() }] });
  await db().execute(sql`update commerce.pages set draft = ${changed}::jsonb, published = ${changed}::jsonb where id = ${versionPage}::uuid`);
  const started = await admin.startExperiment(account, store.storeId, made.id);
  if (!started.ok) throw new Error(started.problems.join(" "));
  subjects.experiment = made.id;

  // D695 step 4: a deal's contract, sent (contract.sent, signed, declined): frozen as sending freezes it, without drawing a PDF.
  const deals = await import("./deals");
  const [pipeline] = await deals.ensurePipeline(store.storeId, { name: "Sales", stages: [{ name: "New" }] });
  const deal = await deals.createDeal(store.member, { title: "Topics deal", customerId: subjects.customer!, pipelineId: pipeline.id, stageId: pipeline.stages[0].id });
  if (!deal.ok) throw new Error(deal.problems.join(" "));
  const contract = await (await import("./contracts")).createContract(store.member, deal.id);
  if (!contract.ok) throw new Error(contract.problem);
  await db().execute(sql`
    update commerce.contracts set status = 'sent', sent_at = now(), sent_by = ${store.accountId}::uuid, expires_at = now() + interval '30 days',
      snapshot = blocks, pdf_path = 'contracts/topics.pdf', pdf_sha256 = ${"a".repeat(64)}
    where store_id = ${store.storeId}::uuid and id = ${contract.id}::uuid
  `);
  subjects.contract = contract.id;

  // Ecosystem plan E3.2 (D718): the deal itself (deal.*), an address on the list, a conversation that ended, a checkout left, and Work's
  // client and invoice (a draft: its payload is the same shape once sent).
  subjects.deal = deal.id;
  const { joinList } = await import("./marketing-subscribers");
  subjects.subscriber = (
    await joinList({ storeId: store.storeId, email: `list-${run}@example.com`, locale: "nb-NO", marketCode: "NO", source: "form", consentText: "Ja takk", proof: "confirmed" })
  ).subscriberId;
  const support = await import("./support");
  const desk = (await import("./support-desk")).systemDesk(store.storeId);
  const { conversation } = await support.openConversation(desk, { mode: (await support.ensureDesk(desk)).mode, locale: "nb-NO", market: "NO", pagePath: null, customerId: subjects.customer! });
  await support.transition(desk, conversation.id, "end", { kind: "customer" });
  await support.setRating(desk, conversation.id, "good", "Kjapt svar");
  subjects.conversation = conversation.id;
  const [basket] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values (${store.storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id
  `);
  const [left] = await db().execute<Row>(sql`
    insert into commerce.abandoned_checkouts (store_id, cart_id, order_id, email, market_code, locale, currency, lines, subtotal_minor, token, captured_at, abandoned_at)
    values (${store.storeId}::uuid, ${String(basket.id)}::uuid, ${order.orderId}::uuid, 'left@example.com', 'NO', 'nb-NO', 'NOK',
      ${JSON.stringify([{ variantId: variant, sellingPlanId: null, title: "Mug", quantity: 2, unitPriceMinor: 19900 }])}::jsonb, 39800,
      ${randomBytes(24).toString("base64url")}, now() - interval '2 hours', now())
    returning id
  `);
  subjects.checkout = String(left.id);
  const [workClient] = await db().execute<Row>(sql`
    insert into commerce.work_clients (store_id, name, legal_name, organisation_number, country, currency, billing_email)
    values (${store.storeId}::uuid, 'Fjord AS', 'Fjord AS', '912345678', 'NO', 'NOK', 'faktura@fjord.example') returning id
  `);
  subjects.work_client = String(workClient.id);
  const [invoice] = await db().execute<Row>(sql`
    insert into commerce.work_invoices (store_id, client_id, currency) values (${store.storeId}::uuid, ${String(workClient.id)}::uuid, 'NOK') returning id
  `);
  subjects.work_invoice = String(invoice.id);

  // A visitor's response to one of the store's forms (D705 F5).
  const [form] = await db().execute<Row>(sql`insert into commerce.forms (store_id, kind, name) values (${store.storeId}::uuid, 'message', 'Topics form') returning id`);
  const [response] = await db().execute<Row>(sql`
    insert into commerce.form_responses (form_id, answers, contact_email, path, locale, delivery)
    values (${String(form.id)}::uuid, '[{"label":"Message","value":"Hello"}]', 'kari@example.com', '/kontakt', 'nb', 'logged') returning id
  `);
  subjects.form_response = String(response.id);

  // Email plan M1.2 (D732): an email that bounced, a broadcast that finished, the sending guard's pause.
  const [email] = await db().execute<Row>(sql`
    insert into commerce.email_messages (store_id, kind, to_address, subject, html, text, status, error, order_id, sent_at)
    values (${store.storeId}::uuid, 'order.confirmation', 'Kari@Example.com', 'Your order', '<p>Secret words</p>', 'Secret words', 'bounced',
      'Permanent: mailbox does not exist', ${order.orderId}::uuid, now())
    returning id
  `);
  subjects.email = String(email.id);
  // A broadcast moves only draft, sending, sent (its table's own rule).
  const [broadcast] = await db().execute<Row>(sql`
    insert into commerce.broadcasts (store_id, title, audience, content) values (${store.storeId}::uuid, 'Autumn news', 'everyone', '{}'::jsonb) returning id
  `);
  await db().execute(sql`
    update commerce.broadcasts set status = 'sending', started_at = now(), audience_words = 'Everyone on the list', recipient_count = 3 where id = ${String(broadcast.id)}::uuid
  `);
  await db().execute(sql`update commerce.broadcasts set status = 'sent', finished_at = now() where id = ${String(broadcast.id)}::uuid`);
  subjects.broadcast = String(broadcast.id);
  const [pause] = await db().execute<Row>(sql`
    insert into commerce.sending_pauses (store_id, reason, counts) values (${store.storeId}::uuid, 'bounces', '{"sent":200,"bounced":12,"complained":0}')
    on conflict (store_id) do update set reason = excluded.reason returning id
  `);
  subjects.sending_pause = String(pause.id);

  // Ecosystem plan E5.1 (D757): a call about the deal, the decision to make a deal of the lead who sent the form, and a domain the watch
  // found failing.
  const [activity] = await db().execute<Row>(sql`
    insert into commerce.activities (store_id, kind, title, note, due_at, assignee_id, customer_id, deal_id, created_by)
    values (${store.storeId}::uuid, 'call', 'Ring about the order', 'Private note', now(), ${store.accountId}::uuid, ${subjects.customer}::uuid,
      ${deal.id}::uuid, ${store.accountId}::uuid)
    returning id
  `);
  subjects.activity = String(activity.id);
  const [decision] = await db().execute<Row>(sql`
    insert into commerce.lead_decisions (store_id, email, decision, deal_id, decided_by)
    values (${store.storeId}::uuid, 'kari@example.com', 'deal', ${deal.id}::uuid, ${store.accountId}::uuid)
    on conflict (store_id, email) do update set decision = excluded.decision, deal_id = excluded.deal_id, decided_at = now() returning id
  `);
  subjects.lead = String(decision.id);
  const [domain] = await db().execute<Row>(sql`
    insert into commerce.store_domains (store_id, hostname, token, status, is_primary)
    values (${store.storeId}::uuid, ${`topics-${run}.example`}, 'tok', 'active', true) returning id
  `);
  await db().execute(sql`
    update commerce.store_domains set checks = jsonb_build_object('watch', jsonb_build_object('at', now(), 'serving', 'certificate'))
    where store_id = ${store.storeId}::uuid and id = ${String(domain.id)}::uuid
  `);
  subjects.domain = String(domain.id);

  // Projects (D903 P5.2): a project from the deal, a list in it, and a task with private notes, given its person and ticked.
  const [project] = await db().execute<Row>(sql`
    insert into commerce.projects (store_id, name, status, deal_id, target_date, created_by)
    values (${store.storeId}::uuid, 'Shop fit-out', 'active', ${deal.id}::uuid, '2026-12-20', ${store.accountId}::uuid) returning id
  `);
  subjects.project = String(project.id);
  const [list] = await db().execute<Row>(sql`
    insert into commerce.checklists (store_id, title, primary_project_id, created_by)
    values (${store.storeId}::uuid, 'Fit-out steps', ${project.id}::uuid, ${store.accountId}::uuid) returning id
  `);
  subjects.checklist = String(list.id);
  const [task] = await db().execute<Row>(sql`
    insert into commerce.checklist_items (store_id, checklist_id, title, description, assigned_to, assigned_by, priority, due_at, done_at, created_by)
    values (${store.storeId}::uuid, ${list.id}::uuid, 'Book the electrician', 'Private task notes', ${store.accountId}::uuid, ${store.accountId}::uuid, 'high',
      now() + interval '2 days', now(), ${store.accountId}::uuid)
    returning id
  `);
  subjects.task = String(task.id);
}, 180_000);

afterAll(async () => {
  await closeDb();
});

const storeRef = () => ({ id: store.storeId, slug: store.slug, name: "Topics" });

/** A buyer's review of an order's first line, as the review form writes it (D301). */
async function buyerReview(orderId: string): Promise<string> {
  return db().transaction(async (tx) => {
    // The review form writes as its author (the table's own rule).
    await tx.execute(sql`select set_config('kaizen.review_writer', 'author', true)`);
    const [made] = await tx.execute<Row>(sql`
    insert into commerce.product_reviews (store_id, product_id, variant_id, source, order_id, order_line_id, buyer_key, author_name, rating, title, body, locale)
    select ol.store_id, v.product_id, ol.variant_id, 'buyer', ol.order_id, ol.id, ${`c:${randomUUID()}`}, 'Kari', 5, 'Lovely', 'Holds the heat.', 'nb-NO'
    from commerce.order_lines ol join commerce.product_variants v on v.id = ol.variant_id
    where ol.order_id = ${orderId}::uuid order by ol.id limit 1
    returning id
  `);
    return String(made.id);
  });
}

describe("every webhook topic's payload (D438)", () => {
  it("is built in its topic's shape, under the envelope an endpoint gets", async () => {
    expect(WEBHOOK_TOPICS.map((t) => t.id)).toEqual([...EVENTS, ...APP_EVENTS].map((e) => e.id));
    for (const topic of WEBHOOK_TOPICS) {
      const subjectId = subjects[topic.subject];
      expect(subjectId, `${topic.id}: no ${topic.subject} was made`).not.toBeUndefined();
      const payload = await integrations.endpointPayload(storeRef(), { id: "00000000-0000-4000-8000-000000000001", event: topic.id, subjectId: subjectId ?? null, createdAt: new Date().toISOString() });
      expect(payload, topic.id).not.toBeNull();
      const checked = webhookEnvelope(z.literal(topic.id), topic.data).safeParse(payload);
      if (!checked.success) throw new Error(`${topic.id}: ${checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      expect(checked.data.version).toBe(PAYLOAD_VERSION);
    }
    expect(logged.filter((l) => l.event === "webhooks.payload_shape")).toEqual([]);
  });

  it("sends the new subjects' facts and never a person's words or a secret (E3.2, D718)", async () => {
    const text = async (event: string, subject: string) => JSON.stringify(await integrations.subjectData(storeRef(), event, subject));
    const conversation = await text("conversation.rated", subjects.conversation!);
    expect(JSON.parse(conversation).conversation).toMatchObject({ status: "ended", rating: "good", ended_by: "customer", customer_id: subjects.customer });
    expect(conversation).not.toContain("Kjapt svar");
    const [left] = await db().execute<Row>(sql`select token from commerce.abandoned_checkouts where id = ${subjects.checkout!}::uuid`);
    const checkout = await text("checkout.abandoned", subjects.checkout!);
    expect(JSON.parse(checkout).checkout).toMatchObject({ subtotal: 398, lines: [{ sku: SKU, quantity: 2, unit_price: 199 }], recovered: false });
    expect(checkout).not.toContain(String(left.token));
    const email = await text("email.bounced", subjects.email!);
    expect(JSON.parse(email).email).toMatchObject({ kind: "order.confirmation", to: "kari@example.com", status: "bounced", reason: "Permanent: mailbox does not exist", order_id: subjects.order });
    expect(email).not.toContain("Secret words");
    expect(JSON.parse(await text("marketing.paused", subjects.sending_pause!)).sending_pause).toMatchObject({ reason: "bounces", sent: 200, bounced: 12 });
    const client = await text("work_client.created", subjects.work_client!);
    expect(client).not.toContain("faktura@fjord.example");
    const subscriber = JSON.parse(await text("subscriber.subscribed", subjects.subscriber!)).subscriber;
    expect(subscriber).toMatchObject({ status: "subscribed", source: "form" });
    expect(subscriber).not.toHaveProperty("token");
    const deal = JSON.parse(await text("deal.created", subjects.deal!)).deal;
    expect(deal).toMatchObject({ status: "open", stage: { name: "New", position: 0 }, customer_id: subjects.customer });
  });

  it("sends an activity, a lead and a domain as ids and facts: never a note, an address or what a lead wrote (E5.1, D757)", async () => {
    const text = async (event: string, subject: string) => JSON.stringify(await integrations.subjectData(storeRef(), event, subject));
    const activity = await text("activity.created", subjects.activity!);
    expect(JSON.parse(activity).activity).toMatchObject({ kind: "call", done_at: null, customer_id: subjects.customer, deal_id: subjects.deal, assignee_id: store.accountId });
    expect(JSON.parse(activity).activity.admin_url).toContain(`/deals/${subjects.deal}`);
    expect(activity).not.toContain("Private note");
    const lead = await text("lead.deal_made", subjects.lead!);
    expect(JSON.parse(lead).lead).toMatchObject({
      decision: "deal",
      deal_id: subjects.deal,
      customer_id: subjects.customer,
      requests: [{ kind: "question", source: "form", id: subjects.form_response }],
    });
    expect(lead).not.toContain("kari@example.com");
    expect(lead).not.toContain("Hello");
    // Projects (D903 P5.2): the team's titles and ids; never a task's notes.
    const taskText = await text("task.done", subjects.task!);
    expect(taskText).not.toContain("Private task notes");
    expect(JSON.parse(taskText).task).toMatchObject({ title: "Book the electrician", status: "done", priority: "high", list: { title: "Fit-out steps" } });
    expect(JSON.parse(await text("project.created", subjects.project!)).project).toMatchObject({ name: "Shop fit-out", status: "active", lists: 1, target_date: "2026-12-20" });
    expect(JSON.parse(await text("checklist.created", subjects.checklist!)).checklist).toMatchObject({ title: "Fit-out steps", open_tasks: 0, done_tasks: 1 });
    const domain = JSON.parse(await text("domain.failing", subjects.domain!)).domain;
    expect(domain).toMatchObject({ primary: true, serving: "certificate", language: null, market: null });
    expect(domain.admin_url).toContain("/settings/domains");
  });

  it("holds what was made: the parcel, the return's line, the stock crossing", async () => {
    const order = (await integrations.subjectData(storeRef(), "order.sent", subjects.order!))!.order as Row;
    expect(order.shipment).toMatchObject({ carrier: "Posten", tracking_number: "TOPIC1" });
    const ret = (await integrations.subjectData(storeRef(), "return.requested", subjects.return!))!.return as { lines: Row[] };
    expect(ret.lines).toEqual([expect.objectContaining({ sku: SKU, quantity: 1 })]);
    const stock = (await integrations.subjectData(storeRef(), "stock.low", subjects.stock!))!.stock as Row;
    expect(stock).toMatchObject({ sku: SKU, product_id: subjects.product });
  });

  it("sends a test with the latest paid order, or a sample with every field a real order has", async () => {
    const latest = await integrations.endpointPayload(storeRef(), { id: "00000000-0000-4000-8000-000000000002", event: "test", subjectId: null, createdAt: new Date().toISOString() });
    expect(WEBHOOK_TEST_DATA.safeParse(latest?.data).success).toBe(true);
    const empty = await newStore("topics-empty");
    const sample = await integrations.endpointPayload({ id: empty.storeId, slug: empty.slug, name: "Empty" }, { id: "00000000-0000-4000-8000-000000000003", event: "test", subjectId: null, createdAt: new Date().toISOString() });
    const checked = WEBHOOK_TEST_DATA.safeParse(sample?.data);
    if (!checked.success) throw new Error(checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    expect(checked.data.order.number).toBe("1001");
  });

  it("queues the catalogue's topics where they happen: a variant's stock once a minute, an archived product (D440)", async () => {
    const [endpoint] = await db().execute<Row>(sql`
      insert into commerce.webhook_endpoints (store_id, name, url_encrypted, hint, secret_encrypted, topics)
      values (${store.storeId}::uuid, 'Stock', 'x', 'example.com', 'x', array['inventory.updated', 'product.archived'])
      returning id
    `);
    const queued = async (event: string) =>
      db().execute<Row>(sql`
        select subject_id, next_attempt_at > now() as later, next_attempt_at = date_trunc('minute', next_attempt_at) as on_the_minute
        from commerce.integration_deliveries where endpoint_id = ${String(endpoint.id)}::uuid and event = ${event}
      `);
    const variant = subjects.inventory!;
    await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 1 where store_id = ${store.storeId}::uuid and variant_id = ${variant}::uuid`);
    await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 2 where store_id = ${store.storeId}::uuid and variant_id = ${variant}::uuid`);
    // Two moves within the minute: one delivery, waiting for the next whole minute, built then with the stock as it is.
    expect(await queued("inventory.updated")).toEqual([{ subject_id: variant, later: true, on_the_minute: true }]);
    const data = (await integrations.subjectData(storeRef(), "inventory.updated", variant))!.inventory as { on_hand: number; locations: { on_hand: number }[] };
    expect(data.on_hand).toBe(data.locations.reduce((sum, l) => sum + l.on_hand, 0));
    const store2 = (await import("./stores")).getStore;
    const shop = await store2(store.slug);
    expect(await setArchived(shop!, subjects.product!, true)).toBe(true);
    expect((await queued("product.archived")).map((r) => r.subject_id)).toEqual([subjects.product]);
    // Back on the site as it was (bringing it back makes a draft).
    await db().execute(sql`update commerce.products set status = 'active' where id = ${subjects.product!}::uuid`);
    await db().execute(sql`delete from commerce.webhook_endpoints where id = ${String(endpoint.id)}::uuid`);
  });

  it("queues the orders' topics where they happen (D440 C2)", async () => {
    const topics = ["order.created", "order.updated", "fulfilment.created", "fulfilment.updated", "refund.created", "return.updated", "quote.requested", "draft.sent"];
    const [endpoint] = await db().execute<Row>(sql`
      insert into commerce.webhook_endpoints (store_id, name, url_encrypted, hint, secret_encrypted, topics)
      values (${store.storeId}::uuid, 'Orders', 'x', 'example.com', 'x', ${`{${topics.join(",")}}`}::text[])
      returning id
    `);
    const queued = async () =>
      (await db().execute<Row>(sql`select event, subject_id from commerce.integration_deliveries where endpoint_id = ${String(endpoint.id)}::uuid order by created_at, event`)).map(
        (r) => `${String(r.event)} ${String(r.subject_id)}`,
      );
    const order = await place(store.storeId, [[SKU, 1]]);
    await pay(store.storeId, order, store.account);
    const sent = await markSent(store.storeId, order.orderId, { carrier: "posten", trackingNumber: "C2-1", trackingUrl: null }, store.accountId, null, { lines: null });
    if (!sent.ok) throw new Error(sent.reason);
    // The carrier's tracking of the parcel moves on (D238).
    await db().execute(sql`
      insert into commerce.shipment_tracking (store_id, shipment_id, order_id, carrier, phase) values (${store.storeId}::uuid, ${sent.shipment.id}::uuid, ${order.orderId}::uuid, 'posten', 'in_transit')
    `);
    const [refund] = await db().execute<Row>(sql`
      insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status, kind)
      select p.store_id, p.id, 500, 'Goodwill', ${`re_c2_${Date.now()}`}, 'succeeded', 'money' from commerce.payments p
      where p.store_id = ${store.storeId}::uuid and p.order_id = ${order.orderId}::uuid and p.status = 'captured' limit 1
      returning id
    `);
    // An edit applied (D174) sets the order's edited_at inside its own context.
    await db().transaction(async (tx) => {
      await tx.execute(sql`select set_config('kaizen.order_edit', ${order.orderId}, true)`);
      await tx.execute(sql`update commerce.orders set edited_at = now() where id = ${order.orderId}::uuid`);
    });
    await db().execute(sql`update commerce.returns set status = 'approved' where id = ${subjects.return!}::uuid`);
    const [quote] = await db().execute<Row>(sql`
      insert into commerce.draft_orders (store_id, number, market_code, market_slug, currency, locale, source, email)
      values (${store.storeId}::uuid, commerce.next_draft_number(${store.storeId}::uuid), 'NO', 'no', 'NOK', 'nb-NO', 'quote', 'asker@example.com')
      returning id
    `);
    // Sent: as `sendDraft()` leaves it, naming its order (the drafts' own tests send one through Stripe's test mode).
    await db().execute(sql`
      update commerce.draft_orders set status = 'sent', order_id = ${order.orderId}::uuid, sent_at = now(), expires_at = now() + interval '7 days' where id = ${String(quote.id)}::uuid
    `);
    expect(await queued()).toEqual(
      expect.arrayContaining([
        `order.created ${order.orderId}`,
        `order.updated ${order.orderId}`,
        `fulfilment.created ${sent.shipment.id}`,
        `fulfilment.updated ${sent.shipment.id}`,
        `refund.created ${String(refund.id)}`,
        `return.updated ${subjects.return}`,
        `quote.requested ${String(quote.id)}`,
        `draft.sent ${String(quote.id)}`,
      ]),
    );
    expect((await queued()).filter((q) => q.startsWith("order.created")).length).toBe(1);
    // Ended, so no other test's run of the expiry job finds a link of ours to expire.
    await db().execute(sql`update commerce.draft_orders set status = 'cancelled' where id = ${String(quote.id)}::uuid`);
    await db().execute(sql`delete from commerce.webhook_endpoints where id = ${String(endpoint.id)}::uuid`);
  });

  it("queues the customers' topics where they happen, and never a gift card's code (D440 C3)", async () => {
    const topics = ["customer.updated", "customer.erased", "subscription.renewed", "subscription.payment_failed", "gift_card.issued", "review.created"];
    const [endpoint] = await db().execute<Row>(sql`
      insert into commerce.webhook_endpoints (store_id, name, url_encrypted, hint, secret_encrypted, topics)
      values (${store.storeId}::uuid, 'People', 'x', 'example.com', 'x', ${`{${topics.join(",")}}`}::text[])
      returning id
    `);
    const queued = async () =>
      (await db().execute<Row>(sql`select event, subject_id from commerce.integration_deliveries where endpoint_id = ${String(endpoint.id)}::uuid order by created_at, event`)).map(
        (r) => `${String(r.event)} ${String(r.subject_id)}`,
      );
    await db().execute(sql`update commerce.customers set name = 'Kari Nordmann' where id = ${subjects.customer!}::uuid`);
    // A renewal paid (not the subscription's first order), then one that could not be charged.
    const renewal = await place(store.storeId, [[SKU, 1]]);
    await db().execute(sql`update commerce.orders set subscription_id = ${subjects.subscription!}::uuid where id = ${renewal.orderId}::uuid`);
    await pay(store.storeId, renewal, store.account);
    await db().execute(sql`update commerce.subscriptions set status = 'past_due' where id = ${subjects.subscription!}::uuid`);
    const { issueGiftCard } = await import("./gift-cards-admin");
    const { getStore } = await import("./stores");
    const card = await issueGiftCard((await getStore(store.slug))!, store.accountId, { currency: "NOK", amountMinor: 10_000, recipientEmail: null, recipientName: null, message: null, lang: "nb-NO", note: "C3" });
    if (!card.ok) throw new Error(card.problem);
    const review = await buyerReview(renewal.orderId);
    // An erasure queues the account's id in its own transaction (D162): here as `eraseSubject()` queues it.
    await db().execute(sql`select commerce.queue_integration_event(${store.storeId}::uuid, 'customer.erased', ${subjects.erasure!}::uuid)`);
    expect(await queued()).toEqual(
      expect.arrayContaining([
        `customer.updated ${subjects.customer}`,
        `subscription.renewed ${subjects.subscription}`,
        `subscription.payment_failed ${subjects.subscription}`,
        `gift_card.issued ${card.cardId}`,
        `review.created ${review}`,
        `customer.erased ${subjects.erasure}`,
      ]),
    );
    const payload = await integrations.endpointPayload(storeRef(), { id: "00000000-0000-4000-8000-000000000004", event: "gift_card.issued", subjectId: card.cardId, createdAt: new Date().toISOString() });
    expect(JSON.stringify(payload)).not.toContain(card.code.replace(/-/g, ""));
    expect(JSON.stringify(payload)).not.toContain(card.code);
    expect((await integrations.subjectData(storeRef(), "customer.erased", subjects.erasure!))).toEqual({ erasure: { customer_id: subjects.erasure } });
    await db().execute(sql`update commerce.subscriptions set status = 'active' where id = ${subjects.subscription!}::uuid`);
    await db().execute(sql`delete from commerce.webhook_endpoints where id = ${String(endpoint.id)}::uuid`);
  });

  it("logs a payload that is not its topic's shape, by where it differs and never a value", async () => {
    logged.length = 0;
    // A withdrawal that is not confirmed is no subject: nothing is built and nothing logged.
    expect(await integrations.subjectData(storeRef(), "withdrawal.received", "00000000-0000-4000-8000-000000000009")).toBeNull();
    await db().execute(sql`update commerce.discount_codes set amounts = '{"NO": "lots"}' where id = ${subjects.discount!}::uuid`);
    const drifted = await integrations.subjectData(storeRef(), "discount.created", subjects.discount!);
    expect(drifted).not.toBeNull();
    expect(logged).toEqual([{ event: "webhooks.payload_shape", fields: { storeId: store.storeId, topic: "discount.created", at: "discount.amounts.NO" } }]);
    expect(JSON.stringify(logged)).not.toContain("lots");
  });
});
