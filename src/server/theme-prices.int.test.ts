import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { parseDesignDetails } from "@/lib/design-presets";
import { chargeToken } from "@/lib/theme-prices";

import type { Account } from "./auth";
import type { ThemeBillingStripe } from "./theme-prices";

vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));

const designs = await import("./design-presets");
const installs = await import("./theme-installs");
const prices = await import("./theme-prices");

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const one = async (query: ReturnType<typeof sql>) => (await db().execute<Row>(query))[0];

let admin: Account;
let owner: Account;
let premium: string;
let free: string;

const deps = { copyFile: async (bucket: string, _from: string, to: string) => `https://x.supabase.co/storage/v1/object/public/${bucket}/${to}`, installFonts: async () => ({ ok: true as const }) };

async function account(email: string, platformAdmin = false): Promise<Account> {
  const [row] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${email}, 'Person', ${platformAdmin}) returning id, email`);
  return { id: String(row.id), email: String(row.email), name: "Person", platformAdmin };
}

/** A store of the owner's in Norway (an approved request), not open yet. */
async function storeOf(slug: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${owner.email}, 'Owner', ${slug}) returning id`);
  const [{ id }] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${slug}, null) as id`);
  await db().execute(sql`update commerce.stores set country = 'NO', setup_completed_at = null where id = ${String(id)}::uuid`);
  return String(id);
}

async function theme(title: string): Promise<string> {
  const parsed = parseDesignDetails({ title, summary: "Exclusive." });
  if (!parsed.ok) throw new Error(parsed.problems.join(" "));
  const made = await designs.createDesign(admin, { origin: { kind: "scratch" }, details: parsed.details }, deps);
  if (!made.ok) throw new Error(made.problems.join(" "));
  expect(await designs.publishDesign(admin, made.id)).toMatchObject({ ok: true });
  return made.id;
}

const purchasesOf = async (store: string) =>
  db().execute<Row>(sql`select status, currency, amount_minor::int as amount_minor, stripe_invoice_id, collection, problem from commerce.theme_purchases where store_id = ${store}::uuid order by created_at`);

/** A stand-in for Kaizena Flow's Stripe account: invoices kept in memory, a card that pays when there is one. */
function fakeStripe(options: { card?: string | null; failCreate?: boolean } = {}) {
  const invoices = new Map<string, Record<string, unknown>>();
  const items: Record<string, unknown>[] = [];
  const calls: string[] = [];
  const stripe = {
    invoices: {
      create: async (params: Record<string, unknown>) => {
        calls.push("create");
        if (options.failCreate) throw new Error("Stripe is busy");
        const id = `in_${run}_${(n += 1)}`;
        const invoice = { id, status: "draft", ...params, total: 0, total_excluding_tax: 0, number: null, hosted_invoice_url: null };
        invoices.set(id, invoice);
        return invoice;
      },
      retrieve: async (id: string) => invoices.get(id),
      finalizeInvoice: async (id: string) => {
        calls.push("finalize");
        const invoice = invoices.get(id)!;
        const total = items.filter((item) => item.invoice === id).reduce((sum, item) => sum + Number(item.amount), 0);
        Object.assign(invoice, { status: "open", total, total_excluding_tax: total, number: `KF-${n}`, hosted_invoice_url: `https://invoice.stripe.com/${id}` });
        return invoice;
      },
      pay: async (id: string) => {
        calls.push("pay");
        return Object.assign(invoices.get(id)!, { status: "paid", status_transitions: { paid_at: Math.floor(Date.now() / 1000) } });
      },
    },
    invoiceItems: {
      create: async (params: Record<string, unknown>) => {
        calls.push("item");
        items.push(params);
        return params;
      },
      list: async ({ invoice }: { invoice: string }) => ({ data: items.filter((item) => item.invoice === invoice) }),
    },
    subscriptions: {
      retrieve: async () => ({ collection_method: options.card ? "charge_automatically" : "send_invoice", default_payment_method: options.card ?? null }),
    },
  };
  return { stripe: stripe as unknown as ThemeBillingStripe, invoices, items, calls };
}

/** Stripe's invoice ids are unique across every stand-in. */
let n = 0;

const billing = (fake: ReturnType<typeof fakeStripe>) => ({ mode: "test" as const, stripe: fake.stripe, taxRates: async () => ["txr_mva"], account: async () => "acct_store" });

beforeAll(async () => {
  admin = await account(`prices-admin-${run}@example.com`, true);
  owner = await account(`prices-owner-${run}@example.com`);
  premium = await theme(`Exclusive ${run}`);
  free = await theme(`Plain ${run}`);
  expect(await prices.setThemePrices(admin, premium, [{ currency: "NOK", amountMinor: 349000 }, { currency: "EUR", amountMinor: 29900 }])).toMatchObject({ ok: true });
});

afterAll(async () => {
  await closeDb();
});

describe("premium themes (D286)", () => {
  it("cost nothing to try, are owed when chosen before the store opens, and are invoiced and paid once it opens", async () => {
    const store = await storeOf(`premium-a-${run}`);
    expect(await prices.themeCharge(store, free)).toEqual({ kind: "free" });
    expect(await prices.themeCharge(store, premium)).toEqual({ kind: "at_opening", price: { currency: "NOK", amountMinor: 349000 } });
    // Adding it to the library is free.
    expect(await designs.installDesignPreset(store, premium, owner.id, deps)).toMatchObject({ ok: true });
    expect(await purchasesOf(store)).toHaveLength(0);
    // Applying it before the store opens: owed, nothing charged.
    expect(await designs.applyDesignPreset(store, premium, owner.id, deps)).toMatchObject({ ok: true });
    expect(await purchasesOf(store)).toMatchObject([{ status: "owed", currency: "NOK", amount_minor: 349000 }]);
    expect(await prices.themeCharge(store, premium)).toEqual({ kind: "owned", status: "owed" });
    const fake = fakeStripe();
    expect(await prices.chargeDueThemePurchases({ storeId: store }, billing(fake))).toEqual({ invoiced: 0, failed: 0 });

    // The store opens: due, then invoiced by invoice (no card on the plan), with VAT and one line, never twice.
    await db().execute(sql`update commerce.stores set setup_completed_at = now() where id = ${store}::uuid`);
    expect(await prices.chargeDueThemePurchases({ storeId: store }, billing(fake))).toEqual({ invoiced: 1, failed: 0 });
    expect(await prices.chargeDueThemePurchases({ storeId: store }, billing(fake))).toEqual({ invoiced: 0, failed: 0 });
    const [purchase] = await purchasesOf(store);
    expect(purchase).toMatchObject({ status: "invoiced", collection: "invoice", problem: null });
    const invoice = fake.invoices.get(String(purchase.stripe_invoice_id))!;
    expect(invoice).toMatchObject({ customer_account: "acct_store", currency: "nok", collection_method: "send_invoice", days_until_due: 14, default_tax_rates: ["txr_mva"], status: "open" });
    expect(fake.items).toEqual([expect.objectContaining({ invoice: invoice.id, amount: 349000, currency: "nok" })]);
    expect(fake.calls).not.toContain("pay");

    // Stripe says it is paid: the purchase is paid, and saying it again changes nothing.
    const event = { type: "invoice.paid", created: Math.floor(Date.now() / 1000), data: { object: { ...invoice, status: "paid", status_transitions: { paid_at: Math.floor(Date.now() / 1000) } } } } as unknown as Stripe.Event;
    expect(await prices.applyThemeInvoiceEvent("test", event)).toEqual({ handled: true, detail: "theme paid" });
    expect(await prices.applyThemeInvoiceEvent("test", event)).toEqual({ handled: true, detail: "theme paid" });
    expect((await purchasesOf(store))[0]).toMatchObject({ status: "paid" });
    expect(await prices.storeThemePurchases(store)).toMatchObject([{ presetId: premium, status: "paid", price: { currency: "NOK", amountMinor: 349000 }, invoiceUrl: `https://invoice.stripe.com/${invoice.id}` }]);
    // An invoice that is not a theme's is left alone.
    expect(await prices.applyThemeInvoiceEvent("test", { type: "invoice.paid", data: { object: { id: "in_other", metadata: {} } } } as unknown as Stripe.Event)).toEqual({ handled: false });
  });

  it("on an open store, refuse a premium theme until its price is agreed, then charge the plan's card at once", async () => {
    const store = await storeOf(`premium-b-${run}`);
    await db().execute(sql`update commerce.stores set setup_completed_at = now() where id = ${store}::uuid`);
    const charge = await prices.themeCharge(store, premium);
    expect(charge).toEqual({ kind: "now", price: { currency: "NOK", amountMinor: 349000 } });
    expect(await designs.applyDesignPreset(store, premium, owner.id, deps)).toEqual({ ok: false, problems: [prices.CHARGE_CHANGED] });
    expect(await designs.applyDesignPreset(store, premium, owner.id, deps, null, "NOK:1")).toEqual({ ok: false, problems: [prices.CHARGE_CHANGED] });
    expect(await purchasesOf(store)).toHaveLength(0);
    const applied = await designs.applyDesignPreset(store, premium, owner.id, deps, null, chargeToken({ currency: "NOK", amountMinor: 349000 }));
    expect(applied).toMatchObject({ ok: true });
    const fake = fakeStripe({ card: "pm_card" });
    // The store's plan is paid by card: charged at once.
    await db().execute(sql`
      insert into commerce.store_billing (store_id, subscription_id, mode, status) values (${store}::uuid, ${`sub_${run}`}, 'test', 'active')
      on conflict (store_id) do update set subscription_id = excluded.subscription_id, mode = excluded.mode, status = excluded.status
    `);
    expect(await prices.chargeDueThemePurchases({ storeId: store }, billing(fake))).toEqual({ invoiced: 1, failed: 0 });
    expect(fake.calls).toEqual(["create", "item", "finalize", "pay"]);
    expect([...fake.invoices.values()][0]).toMatchObject({ collection_method: "charge_automatically", default_payment_method: "pm_card" });
    expect((await purchasesOf(store))[0]).toMatchObject({ status: "paid", collection: "card" });

    // Switching away and back costs nothing more.
    const list = await installs.listInstalls(store);
    const custom = list.find((i) => i.presetId === null)!;
    expect(await installs.switchToInstall(store, custom.id, owner.id)).toMatchObject({ ok: true });
    const back = (await installs.listInstalls(store)).find((i) => i.presetId === premium)!;
    expect(await installs.switchToInstall(store, back.id, owner.id)).toMatchObject({ ok: true });
    expect(await purchasesOf(store)).toHaveLength(1);
  });

  it("try again later when Stripe fails, with the problem in words", async () => {
    const store = await storeOf(`premium-c-${run}`);
    expect(await designs.applyDesignPreset(store, premium, owner.id, deps)).toMatchObject({ ok: true });
    await db().execute(sql`update commerce.stores set setup_completed_at = now() where id = ${store}::uuid`);
    const failing = fakeStripe({ failCreate: true });
    expect(await prices.chargeDueThemePurchases({ storeId: store }, billing(failing))).toEqual({ invoiced: 0, failed: 1 });
    const [waiting] = await db().execute<Row>(sql`select status, problem, tries, next_try_at > now() as later from commerce.theme_purchases where store_id = ${store}::uuid`);
    expect(waiting).toMatchObject({ status: "due", problem: "Stripe could not be reached.", tries: 1, later: true });
    // Not tried again before its time.
    expect(await prices.chargeDueThemePurchases({ storeId: store }, billing(fakeStripe()))).toEqual({ invoiced: 0, failed: 0 });
    await db().execute(sql`update commerce.theme_purchases set next_try_at = now() - interval '1 second' where store_id = ${store}::uuid`);
    expect(await prices.chargeDueThemePurchases({ storeId: store }, billing(fakeStripe()))).toEqual({ invoiced: 1, failed: 0 });
  });

  it("give a theme its first price free to the stores that have it, and charge nobody not invoiced when it is made free again", async () => {
    const having = await storeOf(`premium-d-${run}`);
    const later = await theme(`Later priced ${run}`);
    expect(await designs.applyDesignPreset(having, later, owner.id, deps)).toMatchObject({ ok: true });
    expect(await prices.setThemePrices(admin, later, [{ currency: "NOK", amountMinor: 99000 }])).toMatchObject({ ok: true, granted: 1 });
    expect(await prices.themeCharge(having, later)).toEqual({ kind: "owned", status: "granted" });
    const owing = await storeOf(`premium-e-${run}`);
    expect(await designs.applyDesignPreset(owing, later, owner.id, deps)).toMatchObject({ ok: true });
    expect(await prices.setThemePrices(admin, later, [])).toMatchObject({ ok: true, cancelled: 1 });
    expect(await purchasesOf(owing)).toMatchObject([{ status: "cancelled" }]);
    expect(await prices.themeCharge(owing, later)).toEqual({ kind: "free" });
  });

  it("is given, never charged, when Kaizena Flow applies it to a store", async () => {
    const store = await storeOf(`premium-f-${run}`);
    await db().execute(sql`update commerce.stores set setup_completed_at = now() where id = ${store}::uuid`);
    expect(await designs.applyDesignPreset(store, premium, admin.id, deps, null, "grant")).toMatchObject({ ok: true });
    expect(await purchasesOf(store)).toMatchObject([{ status: "granted", amount_minor: 0 }]);
    const [audit] = await db().execute<Row>(sql`select details from commerce.audit_log where action = 'platform.theme_prices_set' and details->>'preset' = ${premium}`);
    expect(audit).toBeTruthy();
    expect(await one(sql`select count(*)::int as n from commerce.theme_prices where preset_id = ${premium}::uuid`)).toMatchObject({ n: 2 });
  });
});
