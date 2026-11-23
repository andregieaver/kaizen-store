import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";

/**
 * Use beyond the allowances (D880, D748 E11): AI-handled conversations and people counted across an account's stores, the cap that stops the
 * AI taking more, and the lines added once to the account's renewal invoice while Stripe holds it as a draft.
 */

type Row = Record<string, unknown>;

const fake = vi.hoisted(() => {
  const items: { params: Record<string, unknown>; key: string }[] = [];
  let invoice: Record<string, unknown> = {};
  const client = {
    invoices: { retrieve: async () => invoice },
    invoiceItems: {
      create: async (params: Record<string, unknown>, options: { idempotencyKey: string }) => {
        items.push({ params, key: options.idempotencyKey });
        return { id: `ii_${items.length}` };
      },
    },
  };
  return { client, items, setInvoice: (value: Record<string, unknown>) => (invoice = value) };
});

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));
vi.mock("./stripe", async (importActual) => ({ ...(await importActual<typeof import("./stripe")>()), platformStripe: () => fake.client }));

const extras = await import("./extras");
const billing = await import("./extras-billing");

const run = Date.now().toString(36);
let owner: Account;
let storeId: string;
let organisation: string;

beforeAll(async () => {
  await db().execute(sql`update commerce.platform_settings set extensions_launched_at = now() - interval '1 day'`);
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`extras-${run}@example.com`}, 'Owner', 'Extras') returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`extras-${run}`}, 'Extras', null) as id`);
  storeId = String(store.id);
  const [o] = await db().execute<Row>(sql`select a.id, a.email, s.organisation_id from commerce.accounts a, commerce.stores s where lower(a.email) = ${`extras-${run}@example.com`} and s.id = ${storeId}::uuid`);
  owner = { id: String(o.id), email: String(o.email), name: "Owner", platformAdmin: false } as Account;
  organisation = String(o.organisation_id);
  await db().execute(sql`update commerce.stores set modules = array_append(modules, 'work') where id = ${storeId}::uuid and not ('work' = any(modules))`);
  const [plan] = await db().execute<Row>(sql`insert into commerce.plans (name) values (${`Extras plan ${run}`}) returning id`);
  const [price] = await db().execute<Row>(sql`insert into commerce.plan_prices (plan_id, currency, interval, amount_minor) values (${String(plan.id)}::uuid, 'NOK', 'month', 30000) returning id`);
  await db().execute(sql`
    insert into commerce.organisation_billing (organisation_id, plan_id, price_id, mode, subscription_id, status, current_period_end)
    values (${organisation}::uuid, ${String(plan.id)}::uuid, ${String(price.id)}::uuid, 'test', ${`sub_extras_${run}`}, 'active', now() + interval '20 days')
    on conflict (organisation_id) do update set plan_id = excluded.plan_id, price_id = excluded.price_id, mode = 'test', status = 'active', current_period_end = excluded.current_period_end`);
  // The support desk and Work bought at their smallest size: 100 AI-handled conversations, three people.
  for (const extension of ["support_desk", "work"]) {
    await db().execute(sql`
      insert into commerce.organisation_extensions (organisation_id, extension_id, source, size_id)
      values (${organisation}::uuid, ${extension}, 'bought',
        (select id from commerce.extension_sizes where extension_id = ${extension} and active order by position limit 1))
      on conflict do nothing`);
  }
  // Four admins and an accountant beside the owner: five people in Work (the accountant is free), all six but the accountant in Deals.
  const [accountant] = await db().execute<Row>(sql`
    insert into commerce.store_roles (store_id, name, permissions, template) values (${storeId}::uuid, 'Accountant', array['settings:read', 'books:read', 'books:write'], 'accountant') returning id`);
  for (let i = 0; i < 5; i++) {
    const [a] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`extras-${run}-${i}@example.com`}, ${`Person ${i}`}) returning id`);
    await db().execute(sql`
      insert into commerce.store_members (store_id, account_id, role, role_id, kind)
      values (${storeId}::uuid, ${String(a.id)}::uuid, 'admin', ${i === 4 ? String(accountant.id) : null}::uuid, 'staff')`);
  }
  // 103 conversations the AI answered this period.
  await db().execute(sql`
    with c as (
      insert into commerce.support_conversations (store_id, source, handler, token_hash, locale)
      select ${storeId}::uuid, 'site', 'ai', md5(${run} || g::text), 'en' from generate_series(1, 103) g returning id
    )
    select count(*) from c, lateral commerce.support_add_message(c.id, 'ai', null, 'Hello') m`);
});

afterAll(async () => {
  await db().execute(sql`update commerce.platform_settings set extensions_launched_at = null`);
  await db().execute(sql`delete from commerce.organisation_extra_charges where organisation_id = ${organisation}::uuid`);
  await db().execute(sql`delete from commerce.organisation_extensions where organisation_id = ${organisation}::uuid`);
  await db().execute(sql`delete from commerce.organisation_billing where organisation_id = ${organisation}::uuid`);
  await closeDb();
});

describe("use beyond the allowances (D880)", () => {
  it("counts the AI-handled conversations and the people who can use each extension, across the account", async () => {
    expect(await extras.peopleOf(organisation, "work")).toBe(5);
    expect(await extras.peopleOf(organisation, "deals")).toBe(5);
    const from = new Date(Date.now() - 24 * 3600_000);
    const lines = await extras.extraLines(organisation, from, new Date(Date.now() + 60_000), "NOK");
    expect(lines).toEqual([
      { extensionId: "support_desk", unit: "ai_conversation", used: 103, included: 100, unitMinor: 400 },
      { extensionId: "work", unit: "person", used: 5, included: 3, unitMinor: 5000 },
    ]);
    // Deals is not the account's: it has no line. In another currency without prices, none at all.
    expect(await extras.extraLines(organisation, from, new Date(), "SEK")).toEqual([]);
  });

  it("shows the period so far, and stops the AI taking more once one more would pass the owner's cap", async () => {
    const now = await extras.accountExtrasNow(organisation);
    expect(now?.lines.map((l) => [l.extensionId, l.quantity, l.amountMinor])).toEqual([
      ["support_desk", 3, 1200],
      ["work", 2, 10000],
    ]);
    expect(await extras.aiRoomFor(storeId)).toBe(true);
    expect(await billing.saveExtrasCap(owner, organisation, -1)).toEqual({ ok: false, problems: ["Type an amount of 0 or more, or leave it empty for no cap."] });
    // 112 kr used of a 112 kr cap: one more conversation (4 kr) would pass it.
    expect(await billing.saveExtrasCap(owner, organisation, 11200)).toEqual({ ok: true });
    expect(await extras.aiRoomFor(storeId)).toBe(false);
    expect(await billing.saveExtrasCap(owner, organisation, null)).toEqual({ ok: true });
    expect(await extras.aiRoomFor(storeId)).toBe(true);
  });

  it("adds one line an extension to the renewal invoice while it is a draft, once, and nothing to another invoice", async () => {
    const start = Math.floor((Date.now() - 24 * 3600_000) / 1000);
    const invoice = {
      id: `in_${run}`,
      status: "draft",
      currency: "nok",
      customer_account: "acct_extras",
      billing_reason: "subscription_cycle",
      period_start: start,
      period_end: start + 25 * 3600,
      total: 30000,
      parent: { type: "subscription_details", subscription_details: { metadata: { kaizen_organisation_id: organisation } } },
    };
    fake.setInvoice(invoice);
    expect(await billing.billInvoiceExtras("test", invoice)).toEqual({ added: 2 });
    expect(fake.items.map((i) => [i.params.amount, i.params.description, i.key])).toEqual([
      [1200, "AI support desk: 3 AI-handled conversations beyond the 100 included", `kaizen-extra-in_${run}-support_desk`],
      [10000, "Work: 2 people beyond the 3 included", `kaizen-extra-in_${run}-work`],
    ]);
    expect(fake.items[0].params).toMatchObject({ customer_account: "acct_extras", invoice: `in_${run}`, currency: "nok" });
    // A retried event adds nothing.
    expect(await billing.billInvoiceExtras("test", invoice)).toEqual({ added: 0 });
    expect(fake.items).toHaveLength(2);
    const [kept] = await db().execute<Row>(sql`select count(*)::int as n from commerce.organisation_extra_charges where invoice_id = ${`in_${run}`}`);
    expect(kept.n).toBe(2);
    expect(await billing.billInvoiceExtras("test", { ...invoice, billing_reason: "subscription_update" })).toEqual({ added: 0, reason: "not_a_renewal" });
    fake.setInvoice({ ...invoice, status: "open" });
    expect(await billing.billInvoiceExtras("test", { ...invoice, id: `in_open_${run}` })).toEqual({ added: 0, reason: "not_draft" });
  });
});
