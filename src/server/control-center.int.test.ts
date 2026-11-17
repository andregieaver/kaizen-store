import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { attentionFor, totalSales } from "@/lib/control-center";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

const center = await import("./control-center");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let account: Account;
let storeId: string;
let variant: { id: string; sku: string };

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`center-${run}@example.com`}, 'Kari', 'Kaffe') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`center-${run}`}, 'Kaffe', null) as id`);
  storeId = String(store.id);
  const [row] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`center-${run}@example.com`}`);
  account = { id: String(row.id), email: String(row.email), name: "Kari", platformAdmin: false };
  const [v] = await db().execute<Row>(sql`
    select v.id, v.sku from commerce.product_variants v join commerce.products p on p.id = v.product_id
    where v.store_id = ${storeId}::uuid and v.active and v.delivery = 'physical' and p.status = 'active' order by v.sku limit 1
  `);
  variant = { id: String(v.id), sku: String(v.sku) };
  await db().execute(sql`update commerce.inventory_levels set on_hand = 1 where variant_id = ${variant.id}::uuid`);
});

afterAll(async () => {
  await closeDb();
});

/** An order of the store: paid or not, placed some days ago. */
async function order(n: number, status: "paid" | "pending_payment" | "fulfilled", daysAgo: number, total: number, captured = true) {
  const [o] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, tax_minor, total_minor,
      billing_address, shipping_address, placed_at)
    values (${storeId}::uuid, ${`${run}-${n}`}, 'NO', 'NOK', 'nb-NO', 'x@example.com', ${status}, ${total}, 0, 0, ${total},
      ${JSON.stringify({ name: "Ane" })}, ${JSON.stringify({ name: "Ane", line1: "Gata 1", postalCode: "0150", city: "Oslo", country: "NO" })},
      now() - make_interval(days => ${daysAgo}))
    returning id
  `);
  await db().execute(sql`
    insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code)
    values (${storeId}::uuid, ${String(o.id)}::uuid, ${variant.id}::uuid, ${variant.sku}, 'Kopp', 1, ${total}, ${total}, 0, 0.25, 'txcd_99999999')
  `);
  if (captured) {
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${storeId}::uuid, ${String(o.id)}::uuid, 'stripe', ${`cs_${run}_${n}`}, ${total}, 'NOK', 'captured')
    `);
  }
}

describe("the control center (D107)", () => {
  it("shows a new owner's store as not open yet, with nothing sold", async () => {
    const view = await center.controlCenter(account);
    expect(view.stores).toHaveLength(1);
    expect(view.stores[0]).toMatchObject({ slug: `center-${run}`, role: "owner", open: false, toSend: 0, sales: [] });
    expect(view.latest).toEqual([]);
    expect(attentionFor(view.stores).map((i) => i.action)).toContain("Finish setup");
  });

  it("counts the week's paid sales against the week before, orders to send, and stock running out, in code", async () => {
    await order(1, "paid", 1, 20_000);
    await order(2, "fulfilled", 3, 10_000);
    await order(3, "paid", 10, 5_000);
    // Unpaid checkouts are never sales.
    await order(4, "pending_payment", 1, 99_000, false);
    const view = await center.controlCenter(account);
    const store = view.stores[0];
    expect(store.sales).toEqual([{ currency: "NOK", week: 30_000, prior: 5_000, orders: 2, priorOrders: 1 }]);
    expect(totalSales(view.stores)[0].week).toBe(30_000);
    // Two paid orders with something to ship: the recent one and the older one.
    expect(store.toSend).toBe(2);
    expect(store.oldestToSend && Date.now() - Date.parse(store.oldestToSend) > 9 * 86_400_000).toBe(true);
    expect(store.lowStock).toBeGreaterThanOrEqual(1);
    expect(view.latest.map((o) => o.number)).toEqual([`${run}-1`, `${run}-2`, `${run}-3`]);
    const text = attentionFor(view.stores).map((i) => i.text).join("\n");
    expect(text).toContain("2 orders are waiting to be sent");
  });

  it("gives one store's own view, and nothing for a store the account is not in", async () => {
    expect((await center.controlCenter(account, `center-${run}`)).stores).toHaveLength(1);
    expect((await center.controlCenter(account, "no-such-store")).stores).toEqual([]);
    const stranger: Account = { ...account, id: "00000000-0000-4000-8000-000000000000" };
    expect((await center.controlCenter(stranger)).stores).toEqual([]);
  });

  it("counts open privacy requests past their clock or due this week, per store, as counts only (D162)", async () => {
    const insert = async (email: string, status: string, receivedAgo: number, dueIn: number) => {
      await db().execute(sql`
        insert into commerce.privacy_requests (store_id, kind, channel, status, subject_email, received_at, due_at, handled_by)
        values (${storeId}::uuid, 'erasure', 'staff', ${status}, ${email}, now() - make_interval(days => ${receivedAgo}),
          now() + make_interval(days => ${dueIn}), ${account.id}::uuid)
      `);
    };
    // Overdue, due in 3 days, due in 20 days (not flagged), and one answered (never flagged).
    await insert(`p1-${run}@example.com`, "open", 40, -9);
    await insert(`p2-${run}@example.com`, "open", 27, 3);
    await insert(`p3-${run}@example.com`, "open", 10, 20);
    await db().execute(sql`
      insert into commerce.privacy_requests (store_id, kind, channel, status, outcome, subject_email, received_at, due_at, completed_at, handled_by)
      values (${storeId}::uuid, 'export', 'staff', 'done', 'exported', ${`p4-${run}@example.com`}, now() - interval '50 days', now() - interval '20 days', now() - interval '30 days', ${account.id}::uuid)
    `);
    const view = await center.controlCenter(account);
    expect(view.stores[0].privacy).toEqual({ overdue: 1, dueSoon: 1 });
    const items = attentionFor(view.stores);
    expect(items.find((i) => i.text.includes("past the one-month deadline"))?.urgent).toBe(true);
    // Counts and ids only: nothing of the requests' emails reaches the figures.
    expect(JSON.stringify(view)).not.toContain(`p1-${run}`);
  });

  it("counts the books' documents that differ from Tripletex while their entry stands, those waiting more than a week (D478), and bills overdue or due within the week (D492)", async () => {
    const [book] = await db().execute<Row>(sql`
      insert into commerce.ledger_books (store_id, legal_name, country, currency, opened_on, opened_by)
      values (${storeId}::uuid, 'Kaffe AS', 'NO', 'NOK', current_date - 40, ${account.id}::uuid) returning id`);
    const bookId = String(book.id);
    await db().execute(sql`
      insert into commerce.ledger_accounts (store_id, book_id, number, name, standard, kind)
      select ${storeId}::uuid, ${bookId}::uuid, n, 'Account ' || n, n::text, k from (values (1500, 'asset'), (3000, 'income')) as a(n, k)`);
    const post = async (source: string) =>
      String((await db().execute<Row>(sql`
        select commerce.ledger_post(${bookId}::uuid, 'S', current_date - 30, 'Faktura', 'shop_invoice', ${source},
          '[{"account": 1500, "amount": 10000}, {"account": 3000, "amount": -10000}]'::jsonb, null) as id`))[0].id);
    const standing = await post(`a-${run}`);
    const reversed = await post(`b-${run}`);
    await db().execute(sql`select commerce.ledger_reverse(${reversed}::uuid, current_date - 29, 'Reversert', ${account.id}::uuid)`);
    expect(standing).toBeTruthy();
    // Two that differ, one of them reversed since; one waiting for ten days and one since today.
    await db().execute(sql`
      insert into commerce.ledger_comparisons (store_id, book_id, source_kind, source_id, state, differences, their_id, compared_at)
      values (${storeId}::uuid, ${bookId}::uuid, 'shop_invoice', ${`a-${run}`}, 'differs', '[]'::jsonb, 1, now()),
             (${storeId}::uuid, ${bookId}::uuid, 'shop_invoice', ${`b-${run}`}, 'differs', '[]'::jsonb, 2, now())`);
    await db().execute(sql`
      insert into commerce.ledger_waiting (store_id, book_id, source_kind, source_id, problem, since)
      values (${storeId}::uuid, ${bookId}::uuid, 'shop_payment', ${`p1-${run}`}, 'lines', now() - interval '10 days'),
             (${storeId}::uuid, ${bookId}::uuid, 'shop_payment', ${`p2-${run}`}, 'lines', now())`);
    // Bills (D492): one past its due day, one due within the week, one due later, and one past due but paid.
    const [supplier] = await db().execute<Row>(sql`insert into commerce.suppliers (store_id, name) values (${storeId}::uuid, ${`Telenor ${run}`}) returning id`);
    const bill = (due: string, paid: string | null) => sql`(${storeId}::uuid, ${bookId}::uuid, ${String(supplier.id)}::uuid, current_date - 20,
      commerce.store_day(${storeId}::uuid, now()) + ${due}::int, 10000, 'NOK', 'phone', 25, 'Telenor', ${standing}::uuid, ${paid}::uuid,
      case when ${paid}::uuid is null then null else current_date end)`;
    await db().execute(sql`
      insert into commerce.supplier_invoices (store_id, book_id, supplier_id, issued_on, due_on, total_minor, currency, kind, vat_rate, text, entry_id, paid_entry_id, paid_on)
      values ${bill("-3", null)}, ${bill("3", null)}, ${bill("30", null)}, ${bill("-5", standing)}`);
    const view = await center.controlCenter(account, `center-${run}`);
    expect(view.stores[0].books).toEqual({ differ: 1, waiting: 1, billsOverdue: 1, billsDue: 1 });
    expect(attentionFor(view.stores).filter((i) => i.href.endsWith("/settings/books")).map((i) => i.text)).toEqual([
      "Kaffe: 1 document in the books differs from Tripletex.",
      "Kaffe: 1 document has waited more than a week to be posted to the books.",
      "Kaffe: 1 bill is past its due date.",
      "Kaffe: 1 bill falls due within a week.",
    ]);
  });

  it("asks for no figures when there is no store, or for one the account has no request in", async () => {
    const { privacyAttention } = await import("./privacy-attention");
    expect((await privacyAttention([])).size).toBe(0);
    expect((await privacyAttention(["00000000-0000-4000-8000-000000000000"])).size).toBe(0);
  });
});

describe("the control center and stock (wave 3, D172)", () => {
  // A store of its own, so the stock above (set for the first test) does not change what is counted here.
  let stockAccount: Account;
  let stockStore: string;
  const variantOf: Record<string, string> = {};

  beforeAll(async () => {
    const email = `center-stock-${run}@example.com`;
    const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${email}, 'Siri', 'Stock') returning id`);
    const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`center-stock-${run}`}, 'Stock', null) as id`);
    stockStore = String(created.id);
    const [row] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${email}`);
    stockAccount = { id: String(row.id), email: String(row.email), name: "Siri", platformAdmin: false };
    for (const v of await db().execute<Row>(sql`select sku, id from commerce.product_variants where store_id = ${stockStore}::uuid`)) variantOf[String(v.sku)] = String(v.id);
    // Plenty of everything, then the cases.
    await db().execute(sql`update commerce.inventory_levels set on_hand = 50 where store_id = ${stockStore}::uuid`);
    const set = (sku: string, onHand: number) => db().execute(sql`update commerce.inventory_levels set on_hand = ${onHand} where variant_id = ${variantOf[sku]}::uuid`);
    await set("DEMO-MUG-WHITE", 0); // stops at zero: out
    await set("DEMO-THERMOS", -2); // keeps selling: not out, owed
    await set("DEMO-LAMP", 4); // own level 10: at or below it, and not in the fixed "3 or fewer"
    await set("DEMO-TOTE", 2); // no level of its own: running low by the fixed rule
    await db().execute(sql`update commerce.product_variants set low_stock_threshold = 10 where id = ${variantOf["DEMO-LAMP"]}::uuid`);
    // A closed location holding stock of the variant that is out: not for sale, so it is still out.
    const [closed] = await db().execute<Row>(sql`
      insert into commerce.inventory_locations (store_id, name, country, active) values (${stockStore}::uuid, 'Gammelt lager', 'NO', false) returning id
    `);
    await db().execute(sql`
      insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand) values (${stockStore}::uuid, ${variantOf["DEMO-MUG-WHITE"]}::uuid, ${String(closed.id)}::uuid, 100)
    `);
    // Units owed: paid and not sent, a sent order, and a copied one.
    let n = 0;
    const order = async (status: string, quantity: number, owed: number, copied = false) => {
      n += 1;
      const [o] = await db().execute<Row>(sql`
        insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, tax_minor, total_minor,
          billing_address, shipping_address, copied_from)
        values (${stockStore}::uuid, ${`${copied ? "C-" : ""}${run}-s${n}`}, 'NO', 'NOK', 'nb-NO', 'x@example.com', ${status}, 1000, 0, 0, 1000, '{}'::jsonb, '{}'::jsonb, ${copied ? crypto.randomUUID() : null})
        returning id
      `);
      const line = (runner: Pick<ReturnType<typeof db>, "execute">) =>
        runner.execute(sql`
          insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code, delivery,
            backorder_quantity, backorder_days)
          values (${stockStore}::uuid, ${String(o.id)}::uuid, ${variantOf["DEMO-THERMOS"]}::uuid, 'DEMO-THERMOS', 'Termokopp', ${quantity}, 1000, ${1000 * quantity}, 0, 0.25,
            'txcd_99999999', 'physical', ${owed}, 7)
        `);
      if (copied) {
        await db().transaction(async (tx) => {
          await tx.execute(sql`select set_config('commerce.copying', 'on', true)`);
          await line(tx);
        });
      } else await line(db());
    };
    await order("paid", 2, 2);
    await order("fulfilled", 3, 3);
    await order("paid", 4, 4, true);
  });

  it("counts what cannot be sold as out, and what the owner's own level or the fixed rule flags as running low", async () => {
    const [view] = (await center.controlCenter(stockAccount)).stores;
    // MUG-WHITE only: the thermos sells past zero, and the closed location's 100 do not count.
    expect(view.outOfStock).toBe(1);
    // The tote (2, no level) by the fixed rule; the lamp has a level of its own and is not counted twice, and the ones that are gone are out, not low.
    expect(view.lowStock).toBe(1);
    expect(view.belowLevel).toBe(1);
  });

  it("counts the units owed on paid orders not yet sent, never a sent or a copied one", async () => {
    const [view] = (await center.controlCenter(stockAccount)).stores;
    expect(view.owedUnits).toBe(2);
  });

  it("agrees with the Inventory page's own counts", async () => {
    const [view] = (await center.controlCenter(stockAccount)).stores;
    const { inventoryCounts } = await import("./inventory");
    const page = await inventoryCounts(stockStore);
    expect(view.owedUnits).toBe(page.owed);
    expect(view.belowLevel).toBe(page.low);
  });

  it("says it to the owner, with links that open the Inventory page filtered to it", async () => {
    const view = await center.controlCenter(stockAccount);
    const items = attentionFor(view.stores);
    const level = items.find((i) => i.text.includes("warning level you set"));
    expect(level).toMatchObject({ href: `/admin/center-stock-${run}/inventory?status=low`, action: "Open inventory" });
    expect(items.find((i) => i.text.includes("owed on backorder"))).toMatchObject({ href: `/admin/center-stock-${run}/inventory?status=backorder` });
    expect(items.find((i) => i.text.includes("out of stock"))).toBeDefined();
  });

  it("reads a warning level that was crossed by a sale: the lamp rises above its level and is no longer counted", async () => {
    await db().execute(sql`update commerce.inventory_levels set on_hand = 40 where variant_id = ${variantOf["DEMO-LAMP"]}::uuid`);
    expect((await center.controlCenter(stockAccount)).stores[0].belowLevel).toBe(0);
    await db().execute(sql`update commerce.inventory_levels set on_hand = 4 where variant_id = ${variantOf["DEMO-LAMP"]}::uuid`);
    expect((await center.controlCenter(stockAccount)).stores[0].belowLevel).toBe(1);
  });

  it("leaves the stock out for a member who may not open Products, as a figure that is missing and never as zero", async () => {
    const view = (await center.controlCenter(stockAccount)).stores[0];
    expect(view.hides).toBeUndefined();
    const hidden = attentionFor([{ ...view, hides: ["stock"] }]);
    expect(hidden.some((i) => i.text.includes("owed") || i.text.includes("warning level") || i.text.includes("out of stock"))).toBe(false);
  });
});

describe("the queues of ecosystem plan E2.1 (D713)", () => {
  // A store of its own with Deals on, its owner, and a member whose role reads orders only.
  let owner: Account;
  let staff: Account;
  let other: Account;
  let qStore: string;
  const slug = `center-queues-${run}`;
  let orderId: string;
  let disputeId: string;

  beforeAll(async () => {
    const email = `center-queues-${run}@example.com`;
    const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${email}, 'Ola', 'Kø') returning id`);
    const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Kø', null) as id`);
    qStore = String(created.id);
    await db().execute(sql`update commerce.stores set features = array_append(features, 'sales') where id = ${qStore}::uuid and not ('sales' = any(features))`);
    const [row] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${email}`);
    owner = { id: String(row.id), email: String(row.email), name: "Ola", platformAdmin: false };
    const member = async (label: string, permissions: string[]): Promise<Account> => {
      const [a] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`center-queues-${label}-${run}@example.com`}, ${label}) returning id, email`);
      const [role] = await db().execute<Row>(sql`
        insert into commerce.store_roles (store_id, name, permissions)
        values (${qStore}::uuid, ${label}, ${sql`array[${sql.join(permissions.map((k) => sql`${k}`), sql`, `)}]::text[]`}) returning id`);
      await db().execute(sql`insert into commerce.store_members (store_id, account_id, role, role_id) values (${qStore}::uuid, ${String(a.id)}::uuid, 'admin', ${String(role.id)}::uuid)`);
      return { id: String(a.id), email: String(a.email), name: label, platformAdmin: false };
    };
    staff = await member("Orders", ["orders:read"]);
    other = await member("Sales", ["customers:read", "customers:write"]);

    // Disputes (D288): one waiting for the store's answer, one answered from here, one under review and one won; only the first waits.
    const [o] = await db().execute<Row>(sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, tax_minor, total_minor,
        billing_address, shipping_address)
      values (${qStore}::uuid, ${`${run}-q1`}, 'NO', 'NOK', 'nb-NO', ${`buyer-${run}@example.com`}, 'paid', 10000, 0, 0, 10000, '{}'::jsonb, '{}'::jsonb)
      returning id`);
    orderId = String(o.id);
    const [p] = await db().execute<Row>(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${qStore}::uuid, ${orderId}::uuid, 'stripe', ${`cs_${run}_q1`}, 10000, 'NOK', 'captured') returning id`);
    const dispute = async (n: number, status: string, closed: boolean) =>
      String(
        (
          await db().execute<Row>(sql`
            insert into commerce.payment_disputes (store_id, order_id, payment_id, provider, provider_reference, amount_minor, currency, reason, status,
              evidence_due_by, opened_at, outcome, closed_at)
            values (${qStore}::uuid, ${orderId}::uuid, ${String(p.id)}::uuid, 'stripe', ${`dp_${run}_${n}`}, 10000, 'NOK', 'fraudulent', ${status},
              now() + interval '3 days', now(), ${closed ? "won" : null}, ${closed ? sql`now()` : sql`null`})
            returning id`)
        )[0].id,
      );
    disputeId = await dispute(1, "needs_response", false);
    const answered = await dispute(2, "needs_response", false);
    await db().execute(sql`
      insert into commerce.dispute_evidence (dispute_id, store_id, fields, submitted_at, submitted_by)
      values (${answered}::uuid, ${qStore}::uuid, '{}'::jsonb, now(), ${owner.id}::uuid)`);
    await dispute(3, "under_review", false);
    await dispute(4, "won", true);

    // Leads (D475): a question and a subscription from one person are one lead; a person dismissed after asking is none.
    const ask = (email: string) =>
      db().execute(sql`
        insert into commerce.form_submissions (store_id, block_id, kind, visitor, status, email, payload, path, locale)
        values (${qStore}::uuid, 'b1', 'message', 'v1', 'logged', ${email}, ${JSON.stringify({ name: "Kari", message: "Green totes?" })}::jsonb, '/contact', 'nb')`);
    await ask(`lead-${run}@example.com`);
    await db().execute(sql`
      insert into commerce.marketing_subscribers (store_id, email, locale, status, source, consent_text, consented_at, token)
      values (${qStore}::uuid, ${`lead-${run}@example.com`}, 'nb', 'subscribed', 'form', 'Yes.', now(), ${randomBytes(32).toString("base64url")})`);
    await ask(`gone-${run}@example.com`);
    await db().execute(sql`
      insert into commerce.lead_decisions (store_id, email, decision, decided_by, decided_at)
      values (${qStore}::uuid, ${`gone-${run}@example.com`}, 'dismissed', ${owner.id}::uuid, now() + interval '1 minute')`);

    // The AI manager's decisions (D309): the owner's own call kept for a yes, one the autopilot kept in another's name, a question of a
    // running plan; an expired call, another member's own call and a finished plan's question are not the owner's to decide.
    const conversation = async (account: Account, source: string) =>
      String(
        (
          await db().execute<Row>(sql`
            insert into commerce.assistant_conversations (store_id, account_id, title, source) values (${qStore}::uuid, ${account.id}::uuid, 'Kø', ${source}) returning id`)
        )[0].id,
      );
    const mine = await conversation(owner, "admin");
    const autopilot = await conversation(other, "autopilot");
    const theirs = await conversation(other, "admin");
    const approval = (conv: string, account: Account, expired = false) =>
      db().execute(sql`
        insert into commerce.assistant_approvals (store_id, conversation_id, account_id, tool, args, summary, category, expires_at)
        values (${qStore}::uuid, ${conv}::uuid, ${account.id}::uuid, 'send_broadcast', '{}'::jsonb, 'Send the newsletter', 'send',
          ${expired ? sql`now() - interval '1 hour'` : sql`now() + interval '7 days'`})`);
    await approval(mine, owner);
    await approval(mine, owner, true);
    await approval(autopilot, other);
    await approval(theirs, other);
    // A plan's steps are added while it is a draft; it then runs, and its question step asks (the plans' own rules).
    const plan = async (finished: boolean) => {
      const [made] = await db().execute<Row>(sql`
        insert into commerce.assistant_plans (store_id, account_id, conversation_id, title, status) values (${qStore}::uuid, ${other.id}::uuid, ${autopilot}::uuid, 'Launch', 'draft') returning id`);
      const planId = String(made.id);
      await db().execute(sql`
        insert into commerce.assistant_plan_steps (plan_id, store_id, position, key, title, kind, spec)
        values (${planId}::uuid, ${qStore}::uuid, 0, 's1', 'Which colour?', 'question', ${JSON.stringify({ kind: "question", text: "Which colour?" })}::jsonb)`);
      await db().execute(sql`update commerce.assistant_plans set status = 'running' where id = ${planId}::uuid`);
      await db().execute(sql`update commerce.assistant_plan_steps set status = 'asking', question = ${JSON.stringify({ text: "Which colour?", options: ["Blue", "Green"] })}::jsonb where plan_id = ${planId}::uuid`);
      if (finished) await db().execute(sql`update commerce.assistant_plans set status = 'done' where id = ${planId}::uuid`);
    };
    await plan(false);
    await plan(true);

    // Blog comments (D341): two held for a check, one shown.
    const [article] = await db().execute<Row>(sql`insert into commerce.pages (store_id, type, slug, draft) values (${qStore}::uuid, 'article', ${`a-${run}`}, '{}'::jsonb) returning id`);
    let comment = 0;
    for (const status of ["pending", "pending", "approved"]) {
      comment += 1;
      await db().execute(sql`
        insert into commerce.blog_comments (store_id, page_id, name, body, body_hash, locale, status)
        values (${qStore}::uuid, ${String(article.id)}::uuid, 'Kari', 'Nice', ${`h-${run}-${comment}`}, 'nb', ${status})`);
    }

    // Activities (D468), by the store's own day at noon, untimed: the owner's one from yesterday and one today; another's today; a done one
    // and one tomorrow, which wait on nobody today.
    const activity = (assignee: Account, days: number, done = false) =>
      db().execute(sql`
        insert into commerce.activities (store_id, kind, title, due_at, timed, assignee_id, created_by, done_at)
        select ${qStore}::uuid, 'task', 'Call back', ((commerce.store_day(s.id, now()) + ${days}::int)::timestamp + interval '12 hours') at time zone s.time_zone, false,
          ${assignee.id}::uuid, ${owner.id}::uuid, ${done ? sql`now()` : sql`null`}
        from commerce.stores s where s.id = ${qStore}::uuid`);
    await activity(owner, -1);
    await activity(owner, 0);
    await activity(other, 0);
    await activity(owner, 0, true);
    await activity(owner, 1);
  });

  it("counts each queue for the owner in SQL, as the pages that act on them count it", async () => {
    const [view] = (await center.controlCenter(owner, slug)).stores;
    expect(view.disputes).toEqual({ waiting: 1, dueBy: expect.any(String), only: { orderId, disputeId } });
    expect(view.aiDecisions).toBe(3);
    expect(view.leads).toBe(1);
    expect(view.activities).toEqual({ overdue: 1, today: 1 });
    expect(view.blogComments).toBe(2);
    const { leadsOf } = await import("./leads");
    expect(view.leads).toBe((await leadsOf(qStore)).length);
    const { autopilotOverview } = await import("./autopilot-overview");
    const { getStore } = await import("./stores");
    const store = (await getStore(slug))!;
    const page = await autopilotOverview({ account: owner, store });
    expect(view.aiDecisions).toBe(page.calls.length + page.questions.length);
  });

  it("says them on Home with the page that acts, the dispute first and urgent, with its days left", async () => {
    const items = attentionFor((await center.controlCenter(owner, slug)).stores);
    expect(items[0]).toMatchObject({ kind: "disputes", urgent: true, href: `/admin/${slug}/orders/${orderId}/dispute/${disputeId}`, action: "Answer" });
    expect(items[0].text).toBe("Kø: a customer's bank disputed a payment, and it needs your answer within 3 days.");
    const byKind = new Map(items.map((i) => [i.kind, i]));
    expect(byKind.get("ai_decisions")).toMatchObject({ href: `/admin/${slug}/assistant/autopilot`, text: "Kø: the AI manager is waiting for your decisions on 3 things." });
    expect(byKind.get("leads")).toMatchObject({ href: `/admin/${slug}/deals?view=leads` });
    expect(byKind.get("activities_overdue")).toMatchObject({ href: `/admin/${slug}?today=mine`, text: "Kø: 1 of your calls, meetings and tasks is overdue." });
    expect(byKind.get("activities_today")).toMatchObject({ href: `/admin/${slug}?today=mine` });
    expect(byKind.get("blog_comments")).toMatchObject({ href: `/admin/${slug}/articles/comments?status=pending` });
    // Counts and ids only: no person's address reaches the figures.
    expect(JSON.stringify(items)).not.toContain(`lead-${run}`);
  });

  it("counts for a member only what their keys open, and their own activities", async () => {
    const [orders] = (await center.controlCenter(staff, slug)).stores;
    expect(orders.disputes?.waiting).toBe(1);
    expect([orders.leads, orders.aiDecisions, orders.activities, orders.blogComments]).toEqual([undefined, undefined, undefined, undefined]);
    const [sales] = (await center.controlCenter(other, slug)).stores;
    expect(sales.disputes).toBeUndefined();
    expect(sales.leads).toBe(1);
    expect(sales.activities).toEqual({ overdue: 0, today: 1 });
    expect(sales.aiDecisions).toBeUndefined();
  });

  it("leaves leads and activities out while Deals is off", async () => {
    await db().execute(sql`update commerce.stores set features = array_remove(features, 'sales') where id = ${qStore}::uuid`);
    try {
      const [view] = (await center.controlCenter(owner, slug)).stores;
      expect(view.leads).toBeUndefined();
      expect(view.activities).toBeUndefined();
      expect(view.disputes?.waiting).toBe(1);
    } finally {
      await db().execute(sql`update commerce.stores set features = array_append(features, 'sales') where id = ${qStore}::uuid and not ('sales' = any(features))`);
    }
  });

  it("gives the store's own attention once for all its people, which the briefing takes as it is", async () => {
    const { getStore } = await import("./stores");
    const { storeAttention } = await import("./attention");
    const { briefingAttention, briefingFacts } = await import("./briefing");
    const store = (await getStore(slug))!;
    const now = new Date();
    const attention = await storeAttention(store, now);
    expect(attention.en.map((i) => i.kind)).toEqual(["disputes", "ai_decisions", "leads", "activities_overdue", "activities_today", "blog_comments"]);
    // The team's activities and only the autopilot's decisions: no one person's are the store's.
    expect(attention.en.find((i) => i.kind === "activities_today")).toMatchObject({
      text: "2 of the team's calls, meetings and tasks are due today.",
      href: `/admin/${slug}?today=team`,
      urgent: false,
    });
    expect(attention.en.find((i) => i.kind === "ai_decisions")?.text).toBe("The AI manager is waiting for your decisions on 2 things.");
    expect(attention.nb[0].text).toBe("En kundes bank har krevd en betaling tilbakeført, og den trenger svaret ditt innen 3 dager.");
    const facts = await briefingFacts(store, now);
    expect(briefingAttention(facts, "en")).toEqual(attention.en);
    expect(briefingAttention(facts, "nb")).toEqual(attention.nb);
  }, 60_000);
});
