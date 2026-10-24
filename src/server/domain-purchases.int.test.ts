import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";
import type { DomainRegistrar } from "./registrars/types";
import type { ThemeBillingStripe } from "./theme-prices";

vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));

type Row = Record<string, unknown>;
const run = Date.now().toString(36);

/** A stand-in registrar: names under `.shop` are free unless listed as taken; orders complete on the second look. */
const taken = new Set<string>();
const calls: string[] = [];
const fakeRegistrar: DomainRegistrar = {
  id: "vercel",
  currency: "USD",
  supportedTlds: async () => ["shop", "com"],
  search: async (names) => names.map((domain) => ({ domain, available: !taken.has(domain), premium: false, years: 1, price: 11.25, renewalPrice: 38.39 })),
  price: async (_domain, years) => ({ years: years ?? 1, purchase: 11.25, renewal: 38.39, transfer: 59.99, currency: "USD" }),
  available: async (domain) => !taken.has(domain),
  contactSchema: async () => ({}),
  buy: async (domain) => {
    calls.push(`buy ${domain}`);
    return { orderId: `ord_${domain}` };
  },
  order: async (orderId) => ({ orderId, status: "completed", error: null }),
  renew: async (domain) => {
    calls.push(`renew ${domain}`);
    return { orderId: null };
  },
  setAutoRenew: async (domain, on) => void calls.push(`auto-renew ${domain} ${on}`),
  setNameservers: async () => {},
  authCode: async () => "SECRET-CODE",
  contactVerified: async () => true,
  domain: async () => ({ expiresAt: "2027-10-23T00:00:00.000Z", boughtAt: null, renews: true, nameservers: ["ns1.vercel-dns.com"] }),
  transferIn: async (domain, { authCode }) => {
    calls.push(`transfer ${domain} ${authCode}`);
    return { orderId: `tr_${domain}` };
  },
  transferStatus: async () => transfer,
};
/** Where the stand-in registrar's transfers stand. */
let transfer: { state: "done" | "waiting" | "new_code" | "ended"; status: string } = { state: "waiting", status: "pending_transfer" };

vi.mock("./registrars", () => ({
  REGISTRARS: { vercel: () => fakeRegistrar },
  supportedTlds: async () => new Map([["vercel", new Set(["shop", "com"])]]),
  registrarFor: async (domain: string) => (/\.(shop|com)$/.test(domain) ? fakeRegistrar : null),
  registrarById: (id: string) => (id === "vercel" ? fakeRegistrar : null),
  tldOf: (d: string) => d.split(".").slice(1).join("."),
  forgetSupportedTlds: () => {},
}));

process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
const purchases = await import("./domain-purchases");

let owner: Account;
let storeId: string;

async function account(email: string): Promise<Account> {
  const [row] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${email}, 'Kari Nordmann', false) returning id, email`);
  return { id: String(row.id), email: String(row.email), name: "Kari Nordmann", platformAdmin: false };
}

/** Stripe's invoice ids are unique across every stand-in. */
let n = 0;

/** Kaizena Flow's Stripe, kept in memory: invoices sent to pay, paid by the billing webhook's event, and credit notes recorded. */
function fakeStripe() {
  const invoices = new Map<string, Record<string, unknown>>();
  const items: Record<string, unknown>[] = [];
  const notes: Record<string, unknown>[] = [];
  const stripe = {
    invoices: {
      create: async (params: Record<string, unknown>) => {
        const id = `in_dom_${run}_${(n += 1)}`;
        const invoice = { id, status: "draft", ...params, number: null, hosted_invoice_url: null, amount_paid: 0 };
        invoices.set(id, invoice);
        return invoice;
      },
      retrieve: async (id: string) => ({ ...invoices.get(id), lines: { data: [{ id: `il_${id}` }] } }),
      finalizeInvoice: async (id: string) => Object.assign(invoices.get(id)!, { status: "open", number: `KF-D${n}`, hosted_invoice_url: `https://invoice.stripe.com/${id}` }),
      pay: async (id: string) => {
        const total = items.filter((i) => i.invoice === id).reduce((sum, i) => sum + Number(i.amount), 0);
        return Object.assign(invoices.get(id)!, { status: "paid", amount_paid: total, status_transitions: { paid_at: Math.floor(Date.now() / 1000) } });
      },
    },
    invoiceItems: {
      create: async (params: Record<string, unknown>) => (items.push(params), params),
      list: async ({ invoice }: { invoice: string }) => ({ data: items.filter((i) => i.invoice === invoice) }),
    },
    subscriptions: { retrieve: async () => ({ collection_method: "charge_automatically", default_payment_method: "pm_card" }) },
    creditNotes: { create: async (params: Record<string, unknown>) => (notes.push(params), params) },
  };
  return { stripe: stripe as unknown as ThemeBillingStripe & { creditNotes: never }, items, notes, invoices };
}

const connected: string[] = [];
const deps = (fake: ReturnType<typeof fakeStripe>, mode: "live" | "test" = "live") => ({
  mode,
  stripe: fake.stripe,
  taxRates: async () => [],
  account: async () => "acct_store",
  registrar: () => fakeRegistrar,
  connect: (async (_a: unknown, _s: string, hostname: string) => {
    connected.push(hostname);
    return { ok: true, domain: {} };
  }) as never,
});

const registrant = {
  kind: "company",
  firstName: "Kari",
  lastName: "Nordmann",
  companyName: "Nordisk Butikk AS",
  email: "kari@example.no",
  phone: "22 33 44 55",
  address1: "Storgata 1",
  city: "Oslo",
  postalCode: "0150",
  country: "NO",
};

/** Stripe says an invoice was paid, as the billing webhook hears it. */
async function paid(domain: string, fake: ReturnType<typeof fakeStripe>) {
  const [row] = await db().execute<Row>(sql`select id, stripe_invoice_id, amount_minor from commerce.domain_purchases where apex = ${domain} and status = 'invoiced'`);
  Object.assign(fake.invoices.get(String(row.stripe_invoice_id))!, { status: "paid", amount_paid: Number(row.amount_minor) });
  return purchases.applyDomainInvoiceEvent({
    type: "invoice.paid",
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: String(row.stripe_invoice_id), status: "paid", metadata: { kaizen_domain_purchase: String(row.id) }, status_transitions: { paid_at: Math.floor(Date.now() / 1000) } } },
  } as never);
}

const statusOf = async (domain: string) =>
  String((await db().execute<Row>(sql`select status from commerce.domain_purchases where apex = ${domain} order by created_at desc limit 1`))[0]?.status);

/** The registration path claims only purchases due a try: let the next look happen now. */
const dueNow = (domain: string) => db().execute(sql`update commerce.domain_purchases set next_try_at = null, claimed_until = null where apex = ${domain}`);

beforeAll(async () => {
  owner = await account(`domains-owner-${run}@example.com`);
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${owner.email}, 'Owner', ${`dom-${run}`}) returning id`);
  const [{ id }] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`dom-${run}`}, ${`dom-${run}`}, null) as id`);
  storeId = String(id);
  await db().execute(sql`update commerce.stores set country = 'NO' where id = ${storeId}::uuid`);
  // ECB rates the prices are converted with (units per EUR).
  await db().execute(sql`
    insert into commerce.ecb_reference_rates (rate_date, currency, rate) values ('2026-10-22', 'USD', 1.08), ('2026-10-22', 'NOK', 11.6)
    on conflict do nothing
  `);
});

afterAll(async () => {
  await closeDb();
});

describe("buying a domain (D315 4.4)", () => {
  it("is refused until buying is open for the store, and at any price but the one named", async () => {
    const domain = `nordisk-${run}.shop`;
    const closed = await purchases.startDomainPurchase(owner, storeId, { domain, years: 1, agreed: "NOK:16000", connect: true, registrant });
    expect(closed).toMatchObject({ ok: false, problems: ["Buying domains isn't open for this store yet."] });
    await db().execute(sql`update commerce.stores set domain_buying = true where id = ${storeId}::uuid`);
    const quote = await purchases.quoteDomain(storeId, domain, 1);
    expect(quote).toMatchObject({ ok: true, quote: { domain, currency: "NOK", years: 1 } });
    const wrong = await purchases.startDomainPurchase(owner, storeId, { domain, years: 1, agreed: "NOK:1", connect: true, registrant });
    expect(wrong.ok).toBe(false);
  });

  it("is invoiced, paid by the plan's card, registered, kept with its DNS zone, and connected", async () => {
    const domain = `nordisk-${run}.shop`;
    const quote = await purchases.quoteDomain(storeId, domain, 1);
    if (!quote.ok) throw new Error(quote.problems.join());
    const started = await purchases.startDomainPurchase(owner, storeId, { domain, years: 1, agreed: `NOK:${quote.quote.amountMinor}`, connect: true, registrant });
    expect(started).toMatchObject({ ok: true, purchase: { status: "quoted", currency: "NOK" } });
    // Two at once for the same name is refused.
    expect(await purchases.startDomainPurchase(owner, storeId, { domain, years: 1, agreed: `NOK:${quote.quote.amountMinor}`, connect: true, registrant })).toMatchObject({ ok: false });

    const fake = fakeStripe();
    expect(await purchases.chargeDomainPurchases({ storeId }, deps(fake))).toEqual({ invoiced: 1, failed: 0 });
    expect(await statusOf(domain)).toBe("invoiced");
    // Nothing is registered before it is paid.
    await purchases.registerPaidDomains({ storeId }, deps(fake));
    expect(calls).not.toContain(`buy ${domain}`);
    expect(await paid(domain, fake)).toEqual({ handled: true, detail: "domain paid" });
    expect(await statusOf(domain)).toBe("paid");
    expect(fake.items[0]).toMatchObject({ amount: quote.quote.amountMinor, currency: "nok" });

    await purchases.registerPaidDomains({ storeId }, deps(fake));
    expect(await statusOf(domain)).toBe("registering");
    expect(calls).toContain(`buy ${domain}`);
    await dueNow(domain);
    await purchases.registerPaidDomains({ storeId }, deps(fake));
    expect(await statusOf(domain)).toBe("done");
    const [reg] = await db().execute<Row>(sql`select status, renew, expires_at::text from commerce.domain_registrations where apex = ${domain}`);
    expect(reg).toMatchObject({ status: "active", renew: true });
    const [zone] = await db().execute<Row>(sql`select status from commerce.dns_zones where apex = ${domain}`);
    expect(zone).toMatchObject({ status: "active" });
    expect(connected).toContain(domain);
  });

  it("refunds a name taken before it could be registered", async () => {
    const domain = `taken-${run}.shop`;
    const quote = await purchases.quoteDomain(storeId, domain, 1);
    if (!quote.ok) throw new Error(quote.problems.join());
    await purchases.startDomainPurchase(owner, storeId, { domain, years: 1, agreed: `NOK:${quote.quote.amountMinor}`, connect: false, registrant });
    const fake = fakeStripe();
    await purchases.chargeDomainPurchases({ storeId }, deps(fake));
    await paid(domain, fake);
    taken.add(domain);
    await purchases.registerPaidDomains({ storeId }, deps(fake));
    expect(await statusOf(domain)).toBe("refunded");
    expect(fake.notes[0]).toMatchObject({ refund_amount: quote.quote.amountMinor });
  });

  it("registers nothing with a test payment, and refunds it saying so", async () => {
    const domain = `test-${run}.shop`;
    const quote = await purchases.quoteDomain(storeId, domain, 1);
    if (!quote.ok) throw new Error(quote.problems.join());
    await purchases.startDomainPurchase(owner, storeId, { domain, years: 1, agreed: `NOK:${quote.quote.amountMinor}`, connect: false, registrant });
    const fake = fakeStripe();
    await purchases.chargeDomainPurchases({ storeId }, deps(fake, "test"));
    await paid(domain, fake);
    await purchases.registerPaidDomains({ storeId }, deps(fake, "test"));
    expect(calls).not.toContain(`buy ${domain}`);
    const [row] = await db().execute<Row>(sql`select status, problem from commerce.domain_purchases where apex = ${domain}`);
    expect(row).toMatchObject({ status: "refunded" });
    expect(String(row.problem)).toMatch(/test payment/);
  });

  it("keeps purchases as made: never deleted, never backwards", async () => {
    const domain = `nordisk-${run}.shop`;
    await expect(db().execute(sql`delete from commerce.domain_purchases where apex = ${domain}`)).rejects.toThrow();
    await expect(db().execute(sql`update commerce.domain_purchases set status = 'paid' where apex = ${domain} and status = 'done'`)).rejects.toThrow();
    await expect(db().execute(sql`update commerce.domain_purchases set amount_minor = 1 where apex = ${domain}`)).rejects.toThrow();
  });
});

describe("renewal (D315 9.1)", () => {
  it("turns the registrar's auto-renew off with the owner's choice, and back on", async () => {
    const domain = `nordisk-${run}.shop`;
    expect(await purchases.setDomainRenewal(owner, storeId, domain, false, { registrar: () => fakeRegistrar })).toMatchObject({ ok: true, registration: { renew: false } });
    expect(calls).toContain(`auto-renew ${domain} false`);
    expect(await purchases.setDomainRenewal(owner, storeId, domain, true, { registrar: () => fakeRegistrar })).toMatchObject({ ok: true, registration: { renew: true } });
    expect(calls).toContain(`auto-renew ${domain} true`);
    expect(await purchases.setDomainRenewal(owner, storeId, "not-ours.shop", false)).toMatchObject({ ok: false });
  });

  it("invoices a renewal 30 days ahead, and renews once it is paid", async () => {
    const domain = `nordisk-${run}.shop`;
    await db().execute(sql`update commerce.domain_registrations set expires_at = now() + interval '20 days' where apex = ${domain}`);
    const fake = fakeStripe();
    const renewals = await purchases.runDomainRenewals({ registrar: () => fakeRegistrar });
    expect(renewals.quoted).toBeGreaterThanOrEqual(1);
    await purchases.chargeDomainPurchases({ storeId }, deps(fake));
    await paid(domain, fake);
    await purchases.registerPaidDomains({ storeId }, deps(fake));
    expect(calls).toContain(`renew ${domain}`);
    const [row] = await db().execute<Row>(sql`select status from commerce.domain_purchases where apex = ${domain} and kind = 'renew'`);
    expect(row).toMatchObject({ status: "done" });
  });
});

describe("moving a registration here (D315 8.5)", () => {
  it("is quoted at the transfer price, keeps the code only until it is handed over, and is followed until done", async () => {
    const domain = `elsewhere-${run}.com`;
    taken.add(domain);
    const quoted = await purchases.quoteTransfer(storeId, domain);
    if (!quoted.ok) throw new Error(quoted.problems.join());
    expect(await purchases.quoteTransfer(storeId, `free-${run}.com`)).toMatchObject({ ok: false });
    const code = `CODE-${run}-xyz`;
    const base = { domain, agreed: `${quoted.quote.currency}:${quoted.quote.amountMinor}`, connect: false, registrant };
    expect(await purchases.startDomainTransfer(owner, storeId, { ...base, authCode: "a b" })).toMatchObject({ ok: false });
    const started = await purchases.startDomainTransfer(owner, storeId, { ...base, authCode: code });
    expect(started).toMatchObject({ ok: true, purchase: { kind: "transfer", status: "quoted" } });
    // Kept encrypted: the code itself is in no column.
    const [row] = await db().execute<Row>(sql`select p::text as t, auth_code_box from commerce.domain_purchases p where apex = ${domain}`);
    expect(String(row.t)).not.toContain(code);
    expect(row.auth_code_box).not.toBeNull();

    const fake = fakeStripe();
    await purchases.chargeDomainPurchases({ storeId }, deps(fake));
    await paid(domain, fake);
    await purchases.registerPaidDomains({ storeId }, deps(fake));
    expect(calls).toContain(`transfer ${domain} ${code}`);
    const [after] = await db().execute<Row>(sql`select status, auth_code_box from commerce.domain_purchases where apex = ${domain}`);
    expect(after).toMatchObject({ status: "registering", auth_code_box: null });
    await dueNow(domain);
    await purchases.registerPaidDomains({ storeId }, deps(fake));
    expect(await statusOf(domain)).toBe("registering");
    transfer = { state: "done", status: "completed" };
    await dueNow(domain);
    await purchases.registerPaidDomains({ storeId }, deps(fake));
    expect(await statusOf(domain)).toBe("done");
    const [reg] = await db().execute<Row>(sql`select status from commerce.domain_registrations where apex = ${domain}`);
    expect(reg).toMatchObject({ status: "active" });
    // Its DNS stays where it is: moving it here is its own step.
    const zones = await db().execute<Row>(sql`select 1 from commerce.dns_zones where apex = ${domain}`);
    expect(zones).toHaveLength(0);
  });

  it("refunds a transfer the current registrar refuses", async () => {
    const domain = `refused-${run}.com`;
    taken.add(domain);
    const quoted = await purchases.quoteTransfer(storeId, domain);
    if (!quoted.ok) throw new Error(quoted.problems.join());
    await purchases.startDomainTransfer(owner, storeId, { domain, agreed: `${quoted.quote.currency}:${quoted.quote.amountMinor}`, connect: false, registrant, authCode: "OLD-CODE-1" });
    const fake = fakeStripe();
    await purchases.chargeDomainPurchases({ storeId }, deps(fake));
    await paid(domain, fake);
    transfer = { state: "new_code", status: "pending_new_auth_code" };
    await purchases.registerPaidDomains({ storeId }, deps(fake));
    await dueNow(domain);
    await purchases.registerPaidDomains({ storeId }, deps(fake));
    expect(["failed", "refunded"]).toContain(await statusOf(domain));
    expect(fake.notes).toHaveLength(1);
  });
});

describe("domains held by an account (D317)", () => {
  const holderDeps = (fake: ReturnType<typeof fakeStripe>) => ({
    ...deps(fake),
    taxRates: async (country: string | null) => (country === "NO" ? ["txr_mva"] : []),
    customer: async () => "cus_holder",
    serveHolding: async () => true,
  });
  const person = { ...registrant, kind: "person", companyName: undefined };
  const holder = () => ({ kind: "account" as const, accountId: owner.id });
  const setPublic = (on: boolean) => db().execute(sql`update commerce.platform_settings set domains_public = ${on}`);

  it("is refused until Kaizena Flow sells domains on their own, and to consumers outside Norway", async () => {
    const domain = `alone-${run}.shop`;
    const q = await purchases.quoteDomain(holder(), domain, 1, { country: "NO" });
    if (!q.ok) throw new Error(q.problems.join());
    const input = { domain, years: 1, agreed: `NOK:${q.quote.amountMinor}`, connect: true, registrant: person, buyer: { kind: "consumer" as const, country: "NO" }, consent: { given: true, lang: "nb" as const } };
    await setPublic(false);
    expect(await purchases.startDomainPurchase(owner, holder(), input)).toMatchObject({ ok: false });
    await setPublic(true);
    expect(await purchases.startDomainPurchase(owner, holder(), { ...input, buyer: { kind: "consumer", country: "SE" } })).toMatchObject({ ok: false });
    expect(await purchases.startDomainPurchase(owner, holder(), { ...input, consent: { given: false, lang: "nb" } })).toMatchObject({ ok: false });
  });

  it("is invoiced to the account with Norwegian MVA for a Norwegian consumer, registered to the account, and used by no store", async () => {
    const domain = `alone-${run}.shop`;
    const q = await purchases.quoteDomain(holder(), domain, 1, { country: "NO" });
    if (!q.ok) throw new Error(q.problems.join());
    const started = await purchases.startDomainPurchase(owner, holder(), {
      domain, years: 1, agreed: `NOK:${q.quote.amountMinor}`, connect: true, registrant: person,
      buyer: { kind: "consumer", country: "NO" }, consent: { given: true, lang: "nb" },
    });
    if (!started.ok) throw new Error(started.problems.join());
    const [row] = await db().execute<Row>(sql`select store_id, account_id, buyer, vat_kind, consent_at, consent_text, connect from commerce.domain_purchases where id = ${started.purchase.id}::uuid`);
    expect(row).toMatchObject({ store_id: null, account_id: owner.id, buyer: "consumer", vat_kind: "mva", connect: false });
    expect(row.consent_at).not.toBeNull();
    expect(String(row.consent_text)).toMatch(/angreretten/);

    const fake = fakeStripe();
    expect(await purchases.chargeDomainPurchases({ purchaseId: started.purchase.id }, holderDeps(fake))).toEqual({ invoiced: 1, failed: 0 });
    const invoice = [...fake.invoices.values()].at(-1)!;
    expect(invoice).toMatchObject({ customer: "cus_holder", collection_method: "send_invoice", default_tax_rates: ["txr_mva"] });
    expect(invoice.customer_account).toBeUndefined();
    await paid(domain, fake);
    await purchases.registerPaidDomains({}, holderDeps(fake));
    await dueNow(domain);
    await purchases.registerPaidDomains({}, holderDeps(fake));
    expect(await statusOf(domain)).toBe("done");
    const [reg] = await db().execute<Row>(sql`select store_id, account_id from commerce.domain_registrations where apex = ${domain}`);
    expect(reg).toMatchObject({ store_id: null, account_id: owner.id });
    const [zone] = await db().execute<Row>(sql`select store_id, account_id from commerce.dns_zones where apex = ${domain}`);
    expect(zone).toMatchObject({ store_id: null, account_id: owner.id });
    expect(connected).not.toContain(domain);
  });

  it("reverse-charges an EU business with a VAT number VIES confirms, and holds one VIES can't confirm for a person", async () => {
    const buyer = { kind: "business" as const, country: "DE", vatNumber: "DE123456789" };
    const company = { ...registrant, country: "DE", postalCode: "10115", city: "Berlin" };
    for (const [name, vies, review] of [[`berlin-${run}.shop`, "valid", null], [`munich-${run}.shop`, "unavailable", "risk"]] as const) {
      const q = await purchases.quoteDomain(holder(), name, 1, { country: "DE" });
      if (!q.ok) throw new Error(q.problems.join());
      expect(q.quote.currency).toBe("EUR");
      const started = await purchases.startDomainPurchase(owner, holder(), { domain: name, years: 1, agreed: `EUR:${q.quote.amountMinor}`, connect: false, registrant: company, buyer }, { vies: async () => ({ status: vies }) });
      if (!started.ok) throw new Error(started.problems.join());
      const [row] = await db().execute<Row>(sql`select vat_kind, vat_number, review from commerce.domain_purchases where id = ${started.purchase.id}::uuid`);
      expect(row).toMatchObject({ vat_kind: "reverse_charge", vat_number: "DE123456789", review });
    }
    expect(
      await purchases.startDomainPurchase(owner, holder(), { domain: `hamburg-${run}.shop`, years: 1, agreed: "EUR:1", connect: false, registrant: company, buyer }, { vies: async () => ({ status: "invalid" }) }),
    ).toMatchObject({ ok: false });
    const fake = fakeStripe();
    await purchases.chargeDomainPurchases({}, holderDeps(fake));
    const invoice = [...fake.invoices.values()].find((i) => (i.metadata as Record<string, string>).kaizen_account_id === owner.id && i.currency === "eur")!;
    expect(invoice.default_tax_rates).toBeUndefined();
    expect(invoice.custom_fields).toEqual(expect.arrayContaining([{ name: "VAT", value: "Reverse charge" }]));
  });

  it("waits for a person's yes before registering a name that looks like a bank's or a brand's", async () => {
    const domain = `paypal-help-${run}.shop`;
    const q = await purchases.quoteDomain(holder(), domain, 1, { country: "NO" });
    if (!q.ok) throw new Error(q.problems.join());
    const started = await purchases.startDomainPurchase(owner, holder(), {
      domain, years: 1, agreed: `NOK:${q.quote.amountMinor}`, connect: false, registrant: person, buyer: { kind: "consumer", country: "NO" }, consent: { given: true, lang: "en" },
    });
    if (!started.ok) throw new Error(started.problems.join());
    expect(started.purchase.inReview).toBe(true);
    const fake = fakeStripe();
    await purchases.chargeDomainPurchases({ purchaseId: started.purchase.id }, holderDeps(fake));
    await paid(domain, fake);
    await purchases.registerPaidDomains({}, holderDeps(fake));
    expect(calls).not.toContain(`buy ${domain}`);
    await db().execute(sql`update commerce.domain_purchases set review_outcome = 'approved', reviewed_at = now() where id = ${started.purchase.id}::uuid`);
    await dueNow(domain);
    await purchases.registerPaidDomains({}, holderDeps(fake));
    expect(calls).toContain(`buy ${domain}`);
    await setPublic(false);
  });

  it("is linked to one of the holder's stores and back; a store's own domain stays billed to it", async () => {
    const { heldDomains, linkDomain, unlinkDomain } = await import("./domain-account");
    const domain = `alone-${run}.shop`;
    const held = await heldDomains(owner.id);
    expect(held.find((d) => d.apex === domain)).toMatchObject({ store: null, billable: true });
    expect(held.find((d) => d.apex === `nordisk-${run}.shop`)).toMatchObject({ store: { id: storeId }, billable: false });
    const linked = await linkDomain(owner, domain, storeId, { connect: (async () => ({ ok: true, domain: {} })) as never });
    expect(linked).toEqual({ ok: true, connected: true });
    const [reg] = await db().execute<Row>(sql`select store_id from commerce.domain_registrations where apex = ${domain}`);
    expect(reg.store_id).toBe(storeId);
    expect(await unlinkDomain(owner, domain)).toEqual({ ok: true });
    expect(await unlinkDomain(owner, `nordisk-${run}.shop`)).toMatchObject({ ok: false });
    expect(await linkDomain(owner, domain, "00000000-0000-0000-0000-000000000000")).toMatchObject({ ok: false });
    const stranger = await account(`stranger-${run}@example.com`);
    expect(await linkDomain(stranger, domain, storeId)).toMatchObject({ ok: false });
  });
});

describe("people without a store (D317 phase 2)", () => {
  it("starts an account for a new email only, signs a domain account in, and answers a review", async () => {
    const { startDomainAccount } = await import("./domain-account");
    const { canSignIn } = await import("./auth");
    const { decideReview } = await import("./domain-admin");
    const email = `Holder-${run}@Example.com`;
    expect(await canSignIn(email)).toBe(false);
    expect(await startDomainAccount(email, `v-${run}`)).toBe(true);
    expect(await startDomainAccount(email, `v-${run}`)).toBe(true);
    const rows = await db().execute<Row>(sql`select origin from commerce.accounts where lower(email) = lower(${email})`);
    expect(rows).toEqual([{ origin: "domain" }]);
    expect(await canSignIn(email)).toBe(true);
    // An existing account is never changed.
    await startDomainAccount(owner.email, `v-${run}`);
    const [kept] = await db().execute<Row>(sql`select origin from commerce.accounts where id = ${owner.id}::uuid`);
    expect(kept.origin).toBe("store");
    // The limit per visitor.
    let last = true;
    for (let i = 0; i < 6; i++) last = await startDomainAccount(`spam-${i}-${run}@example.com`, `spammer-${run}`);
    expect(last).toBe(false);

    const [p] = await db().execute<Row>(sql`select id from commerce.domain_purchases where apex = ${`munich-${run}.shop`}`);
    expect(await decideReview(owner, String(p.id), false)).toEqual({ ok: true });
    expect(await statusOf(`munich-${run}.shop`)).toBe("void");
    expect(await decideReview(owner, String(p.id), true)).toMatchObject({ ok: false });
  });

  it("answers a held domain no store uses with its holding page or the holder's redirect (D317 8)", async () => {
    const { holdingFor, setHolding } = await import("./holding");
    const domain = `alone-${run}.shop`;
    expect(await holdingFor(`www.${domain}`)).toEqual({ kind: "page", apex: domain, lang: "nb" });
    expect(await setHolding(owner, domain, "redirect", "https://example.com/")).toEqual({ ok: true });
    expect(await holdingFor(domain)).toEqual({ kind: "redirect", to: "https://example.com/" });
    expect(await setHolding(owner, domain, "redirect", `https://${domain}/`)).toMatchObject({ ok: false });
    expect(await setHolding(owner, `nordisk-${run}.shop`, "off", "")).toEqual({ ok: true });
    // A domain a store uses answers as the store's, never as held.
    expect(await holdingFor(`nordisk-${run}.shop`)).toBeNull();
    const stranger = await account(`holding-stranger-${run}@example.com`);
    expect(await setHolding(stranger, domain, "off", "")).toMatchObject({ ok: false });
  });
});

describe("the way to a store (D317 phase 4)", () => {
  it("asks for a store with the domain on it, and approving the request gives the domain to the new store", async () => {
    const { createAccessRequest, approveAccessRequest } = await import("./platform");
    const { domainLeads } = await import("./domain-admin");
    const domain = `alone-${run}.shop`;
    const before = await domainLeads();
    expect(before.domainsAlone).toBeGreaterThanOrEqual(1);
    await createAccessRequest({ name: "Kari", email: owner.email, storeName: "Alone", message: "", domain });
    const [request] = await db().execute<Row>(sql`select id, domain from commerce.access_requests where lower(email) = lower(${owner.email}) and status = 'pending'`);
    expect(request.domain).toBe(domain);
    const admin = { ...owner, platformAdmin: true };
    const result = await approveAccessRequest(admin, String(request.id), `alone-${run}`, "Alone", "https://kaizenaflow.test");
    if (!result.ok) throw new Error(result.problems.join());
    expect(result.domain).toMatchObject({ name: domain });
    const [reg] = await db().execute<Row>(sql`select store_id from commerce.domain_registrations where apex = ${domain}`);
    expect(reg.store_id).toBe(result.storeId);
  });
});

describe("the holder's emails (D315 9.1, D317)", () => {
  it("says a registration is done, and reminds of a renewal switched off once per step", async () => {
    const { sendRenewalReminders } = await import("./domain-emails");
    const domain = `alone-${run}.shop`;
    const [registered] = await db().execute<Row>(sql`
      select m.kind from commerce.email_messages m join commerce.domain_purchases p on m.idempotency_key = 'domain-registered:' || p.id
       where p.apex = ${domain} and p.kind = 'register'
    `);
    expect(registered).toMatchObject({ kind: "domain.registered" });
    await db().execute(sql`update commerce.domain_registrations set expires_at = now() + interval '10 days', renew = false where apex = ${domain}`);
    await sendRenewalReminders();
    await sendRenewalReminders();
    const reminders = await db().execute<Row>(sql`
      select m.kind from commerce.email_messages m join commerce.domain_registrations r on m.idempotency_key like 'domain-reminder:' || r.id || ':%'
       where r.apex = ${domain}
    `);
    expect(reminders).toEqual([{ kind: "domain.renewal_stopping" }]);
  });
});
