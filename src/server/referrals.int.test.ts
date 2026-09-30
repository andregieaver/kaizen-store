import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { encryptSecret } from "@/lib/secret-box";

import type { Account } from "./auth";

type Row = Record<string, unknown>;

/** A stand-in for Kaizen's Stripe account: invoices and their items, recording what it is asked, failing when told to. */
const fake = vi.hoisted(() => {
  type Item = { id: string; amount: number; currency: string; description: string; metadata: Record<string, string>; invoice: string };
  const invoices = new Map<string, Record<string, unknown>>();
  const items: Item[] = [];
  const calls: { method: string; params: Record<string, unknown>; key?: string }[] = [];
  const keys = new Map<string, Item>();
  const fail = { create: false, list: false };
  let next = 0;
  const client = {
    invoices: {
      retrieve: async (id: string) => {
        calls.push({ method: "invoices.retrieve", params: { id } });
        const found = invoices.get(id);
        if (!found) throw new Error(`No such invoice: ${id}`);
        return found;
      },
    },
    invoiceItems: {
      list: async (params: Record<string, unknown>) => {
        calls.push({ method: "invoiceItems.list", params });
        if (fail.list) throw new Error("Stripe cannot be reached");
        return { data: items.filter((item) => item.invoice === params.invoice) };
      },
      create: async (params: Record<string, unknown>, options?: { idempotencyKey?: string }) => {
        calls.push({ method: "invoiceItems.create", params, key: options?.idempotencyKey });
        if (fail.create) throw new Error("Stripe said no");
        if (options?.idempotencyKey && keys.has(options.idempotencyKey)) return keys.get(options.idempotencyKey);
        const inv = invoices.get(String(params.invoice));
        // Only a draft takes a line, as Stripe.
        if (inv?.status !== "draft") throw new Error("This invoice can no longer be edited");
        const item: Item = {
          id: `ii_fake${++next}`,
          amount: Number(params.amount),
          currency: String(params.currency),
          description: String(params.description),
          metadata: params.metadata as Record<string, string>,
          invoice: String(params.invoice),
        };
        items.push(item);
        if (options?.idempotencyKey) keys.set(options.idempotencyKey, item);
        return item;
      },
    },
    webhookEndpoints: {
      retrieve: async (id: string) => ({ id, enabled_events: ["customer.subscription.updated"] }),
      update: async (id: string, params: Record<string, unknown>) => {
        calls.push({ method: "webhookEndpoints.update", params: { id, ...params } });
        return { id };
      },
    },
  };
  return { client, invoices, items, calls, fail, keys };
});

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));
vi.mock("./stripe", async (importActual) => ({
  ...(await importActual<typeof import("./stripe")>()),
  platformStripe: (mode: string) => (mode === "test" ? fake.client : null),
  platformModes: () => ["test"],
}));

const referrals = await import("./referrals");
const billing = await import("./referral-billing");
const platform = await import("./platform");
const managerTools = await import("./manager-tools");
const { POST: billingWebhook } = await import("@/app/api/stripe/billing/[mode]/route");
const { GET: referralLink } = await import("@/app/r/[code]/route");

const run = Date.now().toString(36);
/** Stripe's seconds, a moment ahead: a payment happens after the referral it counts for was made (which has milliseconds). */
const soon = () => Math.floor(Date.now() / 1000) + 2;
const secret = `whsec_referrals_${run}`;
const signer = new Stripe("sk_test_signing_only");
let admin: Account;
let counter = 0;
let eventNumber = 0;

const asAccount = (row: Row, platformAdmin = false): Account => ({
  id: String(row.id),
  email: String(row.email),
  name: null,
  platformAdmin,
});

async function program(over: { enabled?: boolean; bps?: number; months?: number; pending?: number } = {}) {
  await db().execute(sql`
    insert into commerce.referral_settings (id, enabled, commission_bps, months, pending_days, cookie_days)
    values (true, ${over.enabled ?? true}, ${over.bps ?? 1000}, ${over.months ?? 12}, ${over.pending ?? 30}, 30)
    on conflict (id) do update set enabled = excluded.enabled, commission_bps = excluded.commission_bps,
      months = excluded.months, pending_days = excluded.pending_days
  `);
}

/** An owner with a store of their own (a request approved, as in production), and Stripe's account for it. */
async function owner(label: string, code: string | null = null) {
  counter += 1;
  const email = `${label}-${counter}-${run}@example.com`;
  const slug = `${label}-${counter}-${run}`;
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name, referral_code) values (${email}, ${label}, ${`${label} shop`}, ${code}) returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${`${label} shop`}, ${admin.id}::uuid) as id
  `);
  const storeId = String(store.id);
  const [account] = await db().execute<Row>(sql`select id, email from commerce.accounts where lower(email) = ${email}`);
  const stripeAccount = `acct_${label}${counter}${run}`;
  await db().execute(sql`insert into commerce.stripe_accounts (store_id, mode, account_id) values (${storeId}::uuid, 'test', ${stripeAccount})`);
  return { storeId, slug, email, account: asAccount(account), stripeAccount, requestId: String(request.id) };
}

/** A referrer: an owner with a code. */
async function referrer(label = "ref") {
  const o = await owner(label);
  const made = await referrals.getOrCreateReferrer(o.account.id);
  return { ...o, code: made!.code };
}

const balance = (accountId: string, currency = "NOK") => referrals.referralBalances(accountId).then((all) => all.find((b) => b.currency === currency) ?? { currency, availableMinor: 0, pendingMinor: 0, pendingAt: null });

/** Makes everything earned so far usable (the ledger is immutable, but a test may pull the trigger). */
async function maturing(accountId: string) {
  await db().execute(sql`alter table commerce.referral_entries disable trigger referral_entries_immutable`);
  await db().execute(sql`
    update commerce.referral_entries set available_at = available_at - interval '60 days', created_at = created_at - interval '60 days' where account_id = ${accountId}::uuid
  `);
  await db().execute(sql`alter table commerce.referral_entries enable trigger referral_entries_immutable`);
}

type InvoiceOver = Record<string, unknown>;
let invoiceNumber = 0;
/** A plan invoice in Stripe for a store's account; `draft` until finalized. */
function invoice(customerAccount: string, over: InvoiceOver = {}) {
  invoiceNumber += 1;
  const id = `in_${run}_${invoiceNumber}`;
  const made = {
    id,
    number: `KZ-${String(invoiceNumber).padStart(4, "0")}`,
    status: "draft",
    currency: "nok",
    total: 43_625,
    subtotal: 34_900,
    total_excluding_tax: 34_900,
    subtotal_excluding_tax: 34_900,
    customer_account: customerAccount,
    billing_reason: "subscription_cycle",
    parent: { type: "subscription_details", subscription_details: { metadata: {} } },
    created: Math.floor(Date.now() / 1000),
    status_transitions: {},
    ...over,
  };
  fake.invoices.set(id, made);
  return made;
}

async function post(type: string, object: Record<string, unknown>) {
  eventNumber += 1;
  const body = JSON.stringify({ id: `evt_ref_${run}_${eventNumber}`, object: "event", type, created: soon(), data: { object } });
  return billingWebhook(
    new Request("http://localhost/api/stripe/billing/test", {
      method: "POST",
      headers: { "stripe-signature": signer.webhooks.generateTestHeaderString({ payload: body, secret }) },
      body,
    }),
    { params: Promise.resolve({ mode: "test" }) },
  );
}

const itemsOn = (invoiceId: string) => fake.items.filter((item) => item.invoice === invoiceId);
const entries = async (accountId: string) =>
  (await db().execute<Row>(sql`select kind, amount_minor, currency, invoice_ref from commerce.referral_entries where account_id = ${accountId}::uuid order by created_at, amount_minor desc`)).map((r) => ({
    kind: String(r.kind),
    amount: Number(r.amount_minor),
    currency: String(r.currency).trim(),
    invoice: r.invoice_ref ? String(r.invoice_ref) : null,
  }));
const emails = (to: string, kind: string) =>
  db().execute<Row>(sql`select subject, text from commerce.email_messages where to_address = ${to.toLowerCase()} and kind = ${kind}`);
const verified = async (accountId: string) => Boolean((await db().execute<Row>(sql`select commerce.referral_verify(${accountId}::uuid) as ok`))[0].ok);

beforeAll(async () => {
  process.env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const [account] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`ref-admin-${run}@example.com`}, 'Admin', true) returning id, email
  `);
  admin = asAccount(account, true);
  await db().execute(sql`
    insert into commerce.platform_webhooks (provider, mode, kind, endpoint_id, url, secret_ciphertext)
    values ('stripe', 'test', 'billing', 'we_billing_ref', 'https://kaizen.test/billing', ${encryptSecret(secret, Buffer.from(process.env.SETTINGS_ENCRYPTION_KEY, "base64"))})
    on conflict (provider, mode, kind) do update set secret_ciphertext = excluded.secret_ciphertext, endpoint_id = excluded.endpoint_id
  `);
  await program();
});

afterAll(async () => {
  // Requests still waiting would crowd other tests' lists of them.
  await db().execute(sql`delete from commerce.access_requests where status = 'pending' and email like ${`%${run}%@example.com`}`);
  await db().execute(sql`update commerce.referral_settings set enabled = false`);
  await closeDb();
});

describe("the referral code", () => {
  it("is made once for a store owner the first time, never for someone who owns no store, and is unique", async () => {
    const a = await owner("code");
    const first = await referrals.getOrCreateReferrer(a.account.id);
    const again = await referrals.getOrCreateReferrer(a.account.id);
    expect(first).toMatchObject({ accountId: a.account.id, blockedAt: null });
    expect(first!.code).toMatch(/^[a-z0-9]{6,16}$/);
    expect(again!.code).toBe(first!.code);

    const [nobody] = await db().execute<Row>(sql`insert into commerce.accounts (email) values (${`nobody-${run}@example.com`}) returning id`);
    expect(await referrals.getOrCreateReferrer(String(nobody.id))).toBeNull();
    // Staff are not owners.
    const [staff] = await db().execute<Row>(sql`insert into commerce.accounts (email) values (${`staff-${run}@example.com`}) returning id`);
    await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) values (${a.storeId}::uuid, ${String(staff.id)}::uuid, 'admin')`);
    expect(await referrals.getOrCreateReferrer(String(staff.id))).toBeNull();
  });

  it("is drawn again when another account already has it", async () => {
    const a = await owner("clash");
    const b = await owner("clash");
    const taken = (await referrals.getOrCreateReferrer(a.account.id))!.code;
    // The generator first gives the taken code, then another.
    const letters = "abcdefghjkmnpqrstuvwxyz23456789";
    const wanted = [...taken].map((c) => letters.indexOf(c));
    const other = [...taken].map((c) => (letters.indexOf(c) + 1) % letters.length);
    const digits = [...wanted, ...other];
    let i = 0;
    const made = await referrals.getOrCreateReferrer(b.account.id, () => (digits[i++ % digits.length] + 0.5) / letters.length);
    expect(made!.code).not.toBe(taken);
    expect(made!.code).toMatch(/^[a-z0-9]{8}$/);
  });
});

describe("the referral link and sign-up", () => {
  it("counts a visit by day, sets nothing, and leads to the sign-up form with the code", async () => {
    const r = await referrer("visit");
    const visit = (code: string) => referralLink(new Request(`https://kaizen.test/r/${code}`), { params: Promise.resolve({ code }) });
    const response = await visit(r.code);
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname + new URL(response.headers.get("location")!).search).toBe(`/sign-up?ref=${r.code}`);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    await visit(r.code.toUpperCase());
    // A code nobody has, or no code at all, leads to the plain form and counts nothing.
    for (const code of ["nosuchcode", "x", "bad code!"]) {
      const other = await visit(code);
      expect(new URL(other.headers.get("location")!).search).toBe("");
    }
    const [row] = await db().execute<Row>(sql`select sum(visits)::int as n, count(*)::int as days from commerce.referral_visits where code = ${r.code} and store_id is null`);
    expect(row).toMatchObject({ n: 2, days: 1 });
    // A blocked referrer's link counts nothing and gives no code.
    await referrals.setReferrerBlocked(admin, r.account.id, true, "testing");
    const blocked = await visit(r.code);
    expect(new URL(blocked.headers.get("location")!).search).toBe("");
    const [after] = await db().execute<Row>(sql`select sum(visits)::int as n from commerce.referral_visits where code = ${r.code}`);
    expect(after.n).toBe(2);
  });

  it("keeps a real code with the request, and drops any other without telling", async () => {
    const r = await referrer("signup");
    const ask = async (label: string, referralCode: string | null) => {
      counter += 1;
      const email = `${label}-${counter}-${run}@example.com`;
      await platform.createAccessRequest({ name: "Kari", email, storeName: "Shop", message: "", referralCode });
      const [row] = await db().execute<Row>(sql`select referral_code from commerce.access_requests where email = ${email}`);
      return row.referral_code as string | null;
    };
    expect(await ask("good", r.code)).toBe(r.code);
    expect(await ask("upper", r.code.toUpperCase())).toBe(r.code);
    expect(await ask("none", null)).toBeNull();
    expect(await ask("unknown", "nosuchcode")).toBeNull();
    expect(await ask("junk", "x'; drop table commerce.accounts;--")).toBeNull();
    await referrals.setReferrerBlocked(admin, r.account.id, true, "testing");
    expect(await ask("blocked", r.code)).toBeNull();
    await referrals.setReferrerBlocked(admin, r.account.id, false);
    expect(await ask("unblocked", r.code)).toBe(r.code);
  });

  it("does not let a second request from the same email change the code it came with", async () => {
    const a = await referrer("first");
    const b = await referrer("second");
    const email = `twice-${run}@example.com`;
    await platform.createAccessRequest({ name: "Kari", email, storeName: "Shop", message: "", referralCode: a.code });
    await platform.createAccessRequest({ name: "Kari", email, storeName: "Shop", message: "", referralCode: b.code });
    const rows = await db().execute<Row>(sql`select referral_code from commerce.access_requests where email = ${email}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].referral_code).toBe(a.code);
  });
});

describe("approving a request with a code", () => {
  it("makes the referral with the rate and months of the day, and emails the referrer once, about the store by name only", async () => {
    await program({ bps: 1500, months: 6 });
    const r = await referrer("approver");
    counter += 1;
    const email = `owner-${counter}-${run}@example.com`;
    await platform.createAccessRequest({ name: "Nora", email, storeName: "Noras Nøtter", message: "secret plans", referralCode: r.code });
    const [request] = await db().execute<Row>(sql`select id from commerce.access_requests where email = ${email}`);
    const slug = `noras-${run}`;
    const result = await platform.approveAccessRequest(admin, String(request.id), slug, "Noras Nøtter", "https://kaizen.test");
    expect(result).toMatchObject({ ok: true, slug });
    const [referral] = await db().execute<Row>(sql`select r.* from commerce.referrals r join commerce.stores s on s.id = r.store_id where s.slug = ${slug}`);
    expect(referral).toMatchObject({ referrer_account_id: r.account.id, commission_bps: 1500, months: 6, status: "active" });

    const sent = await emails(r.email, "referral.store_opened");
    expect(sent).toHaveLength(1);
    expect(String(sent[0].subject)).toBe("Noras Nøtter opened its store through your link");
    expect(String(sent[0].text)).toContain("15 %");
    expect(String(sent[0].text)).not.toContain(email);
    expect(String(sent[0].text)).not.toContain("secret plans");
    // Sending it again changes nothing.
    await referrals.notifyReferralOpened(String(referral.store_id));
    expect(await emails(r.email, "referral.store_opened")).toHaveLength(1);
    await program();
  });

  it("makes none, and sends nothing, for a referrer's own request", async () => {
    const r = await referrer("selfie");
    counter += 1;
    const slug = `selfie-${counter}-${run}`;
    await platform.createAccessRequest({ name: "Me", email: r.email, storeName: "Second shop", message: "", referralCode: r.code });
    const [request] = await db().execute<Row>(sql`select id from commerce.access_requests where email = ${r.email} and status = 'pending'`);
    expect(await platform.approveAccessRequest(admin, String(request.id), slug, "Second shop", "https://kaizen.test")).toMatchObject({ ok: true });
    const [none] = await db().execute<Row>(sql`select count(*)::int as n from commerce.referrals where referrer_account_id = ${r.account.id}::uuid`);
    expect(none.n).toBe(0);
    expect(await emails(r.email, "referral.store_opened")).toHaveLength(0);
  });
});

describe("the program's settings", () => {
  it("are changed by platform admins only, within limits, and audited", async () => {
    const someone = await owner("settings");
    const change = { enabled: true, commissionBps: 1250, months: 18, pendingDays: 14, cookieDays: 45 };
    expect(await referrals.saveReferralSettings(someone.account, change)).toEqual({ ok: false, problems: ["Only platform admins can change the referral program."] });
    expect(await referrals.saveReferralSettings(admin, { ...change, commissionBps: 6000 })).toMatchObject({ ok: false });
    expect(await referrals.saveReferralSettings(admin, { ...change, months: 0 })).toMatchObject({ ok: false });
    expect(await referrals.saveReferralSettings(admin, change)).toEqual({ ok: true });
    expect(await referrals.getReferralSettings()).toEqual(change);
    expect(await referrals.referralPublicSettings()).toEqual({ enabled: true, cookieDays: 45 });
    const [log] = await db().execute<Row>(sql`
      select details from commerce.audit_log where account_id = ${admin.id}::uuid and action = 'platform.referral_settings' order by id desc limit 1
    `);
    expect(log.details).toMatchObject({ after: change });
    await program();
  });
});

describe("a referred store's plan invoices", () => {
  it("earn the referrer commission on the amount without VAT when paid, once, pending until the days have passed", async () => {
    await program({ bps: 1000, months: 12, pending: 30 });
    const r = await referrer("paid");
    const referred = await owner("paidstore", r.code);
    const paid = invoice(referred.stripeAccount, { status: "paid", status_transitions: { paid_at: soon() } });

    expect((await post("invoice.paid", paid)).status).toBe(200);
    expect(await entries(r.account.id)).toEqual([{ kind: "earn", amount: 3490, currency: "NOK", invoice: null }]);
    expect(await balance(r.account.id)).toMatchObject({ availableMinor: 0, pendingMinor: 3490 });
    // Stripe sends an event again: nothing changes.
    await post("invoice.paid", paid);
    expect(await entries(r.account.id)).toHaveLength(1);
    // A manual invoice, or one with nothing to pay, earns nothing; nor does an unknown store.
    await post("invoice.paid", invoice(referred.stripeAccount, { billing_reason: "manual", parent: null, status: "paid" }));
    await post("invoice.paid", invoice(referred.stripeAccount, { status: "paid", total: 0, total_excluding_tax: 0 }));
    await post("invoice.paid", invoice("acct_nobody", { status: "paid" }));
    expect(await entries(r.account.id)).toHaveLength(1);
    // The next invoice, in euro, is its own currency's credit.
    await post("invoice.paid", invoice(referred.stripeAccount, { status: "paid", currency: "eur", total_excluding_tax: 2_900 }));
    expect(await balance(r.account.id, "EUR")).toMatchObject({ pendingMinor: 290 });
    expect(await balance(r.account.id, "NOK")).toMatchObject({ pendingMinor: 3490 });
    expect(await verified(r.account.id)).toBe(true);
  });

  it("earn nothing after the referral's months, for a void referral or a blocked referrer, and find the store by the subscription's mark too", async () => {
    await program();
    const r = await referrer("cases");
    const referred = await owner("casesstore", r.code);
    await referrals.setReferrerBlocked(admin, r.account.id, true, "testing");
    await post("invoice.paid", invoice(referred.stripeAccount, { status: "paid" }));
    await referrals.setReferrerBlocked(admin, r.account.id, false);
    const [referral] = await db().execute<Row>(sql`select id from commerce.referrals where store_id = ${referred.storeId}::uuid`);
    await referrals.setReferralVoid(admin, String(referral.id), true, "not genuine");
    await post("invoice.paid", invoice(referred.stripeAccount, { status: "paid" }));
    await referrals.setReferralVoid(admin, String(referral.id), false);
    await db().execute(sql`update commerce.referrals set created_at = now() - interval '13 months' where id = ${String(referral.id)}::uuid`);
    await post("invoice.paid", invoice(referred.stripeAccount, { status: "paid" }));
    expect(await entries(r.account.id)).toEqual([]);
    await db().execute(sql`update commerce.referrals set created_at = now() where id = ${String(referral.id)}::uuid`);
    // The store is found by the subscription's mark when Stripe's customer account is not one Kaizen knows.
    await post(
      "invoice.paid",
      invoice("acct_unknown", { status: "paid", parent: { type: "subscription_details", subscription_details: { metadata: { kaizen_store_id: referred.storeId } } } }),
    );
    expect(await entries(r.account.id)).toHaveLength(1);
  });

  it("take back the credited share of the commission when a credit note is made, never below zero", async () => {
    await program();
    const r = await referrer("note");
    const referred = await owner("notestore", r.code);
    const paid = invoice(referred.stripeAccount, { status: "paid" });
    await post("invoice.paid", paid);
    await maturing(r.account.id);
    expect(await balance(r.account.id)).toMatchObject({ availableMinor: 3490 });
    const note = (id: string, exTax: number) => post("credit_note.created", { id: `${id}_${run}`, invoice: paid.id, currency: "nok", total: Math.round(exTax * 1.25), total_excluding_tax: exTax });
    // A quarter of 34 900 is credited: a quarter of 3 490.
    await note("cn_1", 8_725);
    await note("cn_1", 8_725);
    expect(await balance(r.account.id)).toMatchObject({ availableMinor: 3490 - 872 });
    // The credit is used on an invoice, and then the rest of the fee is credited: only what is left goes.
    const own = invoice(r.stripeAccount);
    await post("invoice.created", own);
    const used = itemsOn(own.id as string)[0];
    expect(used.amount).toBe(-(3490 - 872));
    await note("cn_2", 26_175);
    expect((await balance(r.account.id)).availableMinor).toBe(0);
    expect(await verified(r.account.id)).toBe(true);
    expect((await entries(r.account.id)).filter((e) => e.kind === "reverse").map((e) => e.amount)).toEqual([-872]);
  });
});

describe("credit on a referrer's own draft invoice", () => {
  /** A referrer with `amount` NOK of usable credit, and the draft invoice of their own store. */
  async function withCredit(amount: number, over: { currency?: string } = {}) {
    const r = await referrer("credit");
    await referrals.adjustReferralCredit(admin, { accountId: r.account.id, currency: over.currency ?? "NOK", amountMinor: amount, reason: "to test" });
    return r;
  }

  it("puts the credit on it as one negative invoice item, once, however many times the event comes", async () => {
    const r = await withCredit(10_000);
    const draft = invoice(r.stripeAccount);
    const id = draft.id as string;
    expect((await post("invoice.created", draft)).status).toBe(200);
    expect(itemsOn(id)).toEqual([
      expect.objectContaining({ amount: -10_000, currency: "nok", description: "Referral credit", metadata: { kaizen_referral_credit: id, kaizen_referral_account: r.account.id } }),
    ]);
    expect(await balance(r.account.id)).toMatchObject({ availableMinor: 0 });
    expect(await entries(r.account.id)).toEqual([
      { kind: "adjust", amount: 10_000, currency: "NOK", invoice: null },
      { kind: "apply", amount: -10_000, currency: "NOK", invoice: id },
    ]);
    // Stripe retries the event, and sends it again: nothing is added or taken.
    await post("invoice.created", draft);
    await post("invoice.created", draft);
    expect(itemsOn(id)).toHaveLength(1);
    expect(await entries(r.account.id)).toHaveLength(2);
    // The referrer is told, once, in the invoice's currency.
    const told = await emails(r.email, "referral.credit_applied");
    expect(told).toHaveLength(1);
    expect(String(told[0].text)).toContain(String(draft.number));
    expect(await verified(r.account.id)).toBe(true);
  });

  it("takes at most the invoice's amount without VAT, so it is never negative, and keeps the rest", async () => {
    const r = await withCredit(50_000);
    const draft = invoice(r.stripeAccount, { total_excluding_tax: 34_900 });
    await post("invoice.created", draft);
    expect(itemsOn(draft.id as string).map((i) => i.amount)).toEqual([-34_900]);
    expect(await balance(r.account.id)).toMatchObject({ availableMinor: 15_100 });
  });

  it("puts nothing on an invoice in another currency, one with nothing to pay, a finalized one, or a blocked referrer's", async () => {
    const r = await withCredit(10_000);
    const before = fake.items.length;
    await post("invoice.created", invoice(r.stripeAccount, { currency: "eur" }));
    await post("invoice.created", invoice(r.stripeAccount, { total: 0, total_excluding_tax: 0 }));
    await post("invoice.created", invoice(r.stripeAccount, { status: "open" }));
    await post("invoice.created", invoice(r.stripeAccount, { billing_reason: "manual", parent: null }));
    await post("invoice.created", invoice("acct_not_a_store"));
    await referrals.setReferrerBlocked(admin, r.account.id, true, "testing");
    await post("invoice.created", invoice(r.stripeAccount));
    await referrals.setReferrerBlocked(admin, r.account.id, false);
    expect(fake.items.length).toBe(before);
    expect(await balance(r.account.id)).toMatchObject({ availableMinor: 10_000 });
    expect((await entries(r.account.id)).map((e) => e.kind)).toEqual(["adjust"]);
  });

  it("does not use credit still pending", async () => {
    await program({ pending: 30 });
    const r = await referrer("pending");
    const referred = await owner("pendingstore", r.code);
    await post("invoice.paid", invoice(referred.stripeAccount, { status: "paid" }));
    const own = invoice(r.stripeAccount);
    await post("invoice.created", own);
    expect(itemsOn(own.id as string)).toEqual([]);
    expect(await balance(r.account.id)).toMatchObject({ availableMinor: 0, pendingMinor: 3490 });
    await program();
  });

  it("does not leave the ledger saying credit was applied when Stripe refused the line, and applies it once on the retry", async () => {
    const r = await withCredit(10_000);
    const draft = invoice(r.stripeAccount);
    const id = draft.id as string;
    fake.fail.create = true;
    try {
      // Stripe answers 500 to the event, which makes it send it again.
      expect((await post("invoice.created", draft)).status).toBe(500);
    } finally {
      fake.fail.create = false;
    }
    expect(itemsOn(id)).toEqual([]);
    expect(await balance(r.account.id)).toMatchObject({ availableMinor: 10_000 });
    expect((await entries(r.account.id)).map((e) => e.kind)).toEqual(["adjust", "apply", "restore"]);
    expect(await emails(r.email, "referral.credit_applied")).toHaveLength(0);

    expect((await post("invoice.created", draft)).status).toBe(200);
    expect(itemsOn(id).map((i) => i.amount)).toEqual([-10_000]);
    expect(await balance(r.account.id)).toMatchObject({ availableMinor: 0 });
    expect((await entries(r.account.id)).map((e) => e.kind)).toEqual(["adjust", "apply", "restore", "apply"]);
    await post("invoice.created", draft);
    expect(itemsOn(id)).toHaveLength(1);
    expect(await verified(r.account.id)).toBe(true);
  });

  it("keeps the credit taken when Stripe cannot be asked whether the line arrived, and the retry finishes it without a second line", async () => {
    const r = await withCredit(10_000);
    const draft = invoice(r.stripeAccount);
    const id = draft.id as string;
    fake.fail.create = true;
    fake.fail.list = true;
    try {
      expect((await post("invoice.created", draft)).status).toBe(500);
    } finally {
      fake.fail.create = false;
      fake.fail.list = false;
    }
    // Neither the line nor a way to tell: the credit stays taken until the retry settles it.
    expect(itemsOn(id)).toEqual([]);
    expect((await entries(r.account.id)).map((e) => e.kind)).toEqual(["adjust", "apply"]);
    expect((await post("invoice.created", draft)).status).toBe(200);
    expect(itemsOn(id).map((i) => i.amount)).toEqual([-10_000]);
    expect((await entries(r.account.id)).map((e) => e.kind)).toEqual(["adjust", "apply"]);
    expect(await balance(r.account.id)).toMatchObject({ availableMinor: 0 });
  });

  it("gives the credit back when the invoice was finalized before the line could be added", async () => {
    const r = await withCredit(10_000);
    const draft = invoice(r.stripeAccount);
    fake.fail.create = true;
    fake.fail.list = true;
    try {
      await post("invoice.created", draft);
    } finally {
      fake.fail.create = false;
      fake.fail.list = false;
    }
    expect(await balance(r.account.id)).toMatchObject({ availableMinor: 0 });
    // Stripe finalizes the invoice before the retry: no line could be added, so the credit is not spent.
    fake.invoices.set(draft.id as string, { ...draft, status: "open" });
    expect((await post("invoice.created", draft)).status).toBe(200);
    expect(itemsOn(draft.id as string)).toEqual([]);
    expect(await balance(r.account.id)).toMatchObject({ availableMinor: 10_000 });
    // Finalized after the line was added: the credit stays spent.
    const done = invoice(r.stripeAccount);
    await post("invoice.created", done);
    fake.invoices.set(done.id as string, { ...done, status: "open" });
    await post("invoice.created", done);
    expect(itemsOn(done.id as string)).toHaveLength(1);
    expect(await balance(r.account.id)).toMatchObject({ availableMinor: 0 });
  });

  it("returns the credit when the invoice is voided or deleted, once, and lets a new invoice use it", async () => {
    const r = await withCredit(10_000);
    const draft = invoice(r.stripeAccount);
    await post("invoice.created", draft);
    expect(await balance(r.account.id)).toMatchObject({ availableMinor: 0 });
    expect((await post("invoice.voided", draft)).status).toBe(200);
    expect(await balance(r.account.id)).toMatchObject({ availableMinor: 10_000 });
    await post("invoice.voided", draft);
    await post("invoice.deleted", { id: draft.id, object: "invoice", deleted: true });
    expect(await balance(r.account.id)).toMatchObject({ availableMinor: 10_000 });
    expect((await entries(r.account.id)).map((e) => e.kind)).toEqual(["adjust", "apply", "restore"]);
    const next = invoice(r.stripeAccount);
    await post("invoice.created", next);
    expect(itemsOn(next.id as string).map((i) => i.amount)).toEqual([-10_000]);
    expect(await verified(r.account.id)).toBe(true);
  });

  it("uses the first owner of the billed store who has credit", async () => {
    const first = await owner("coowner");
    const second = await referrals.getOrCreateReferrer(first.account.id);
    expect(second).not.toBeNull();
    const [partner] = await db().execute<Row>(sql`insert into commerce.accounts (email) values (${`partner-${run}@example.com`}) returning id, email`);
    await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) values (${first.storeId}::uuid, ${String(partner.id)}::uuid, 'owner')`);
    await referrals.getOrCreateReferrer(String(partner.id));
    await referrals.adjustReferralCredit(admin, { accountId: String(partner.id), currency: "NOK", amountMinor: 4_000, reason: "partner" });
    const draft = invoice(first.stripeAccount);
    await post("invoice.created", draft);
    expect(itemsOn(draft.id as string).map((i) => [i.amount, i.metadata.kaizen_referral_account])).toEqual([[-4_000, String(partner.id)]]);
  });

  it("makes sure the billing webhook sends the invoice events", async () => {
    const added = await billing.ensureBillingEvents("test");
    expect(added).toEqual(expect.arrayContaining(["invoice.created", "invoice.paid", "invoice.voided", "invoice.deleted", "credit_note.created"]));
    const update = fake.calls.filter((c) => c.method === "webhookEndpoints.update").at(-1);
    expect(update?.params.enabled_events).toEqual(expect.arrayContaining(["customer.subscription.updated", "invoice.created"]));
  });

  it("refuses events that are not signed with the billing secret", async () => {
    const body = JSON.stringify({ id: "evt_forged", object: "event", type: "invoice.paid", created: 1, data: { object: {} } });
    const response = await billingWebhook(
      new Request("http://localhost/api/stripe/billing/test", {
        method: "POST",
        headers: { "stripe-signature": signer.webhooks.generateTestHeaderString({ payload: body, secret: "whsec_other" }) },
        body,
      }),
      { params: Promise.resolve({ mode: "test" }) },
    );
    expect(response.status).toBe(400);
  });
});

describe("the sale fee on a referred store's orders", () => {
  it("earns commission when the payment is captured and takes back the refunded share, in the payment's currency", async () => {
    await program({ bps: 1000, pending: 30 });
    const r = await referrer("sales");
    const referred = await owner("salesstore", r.code);
    const [order] = await db().execute<Row>(sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address)
      values (${referred.storeId}::uuid, ${`S-${run}`}, 'NO', 'NOK', 'nb-NO', 'shopper@example.com', 20000, 0, 0, 0, 20000, '{}', '{}') returning id
    `);
    const [payment] = await db().execute<Row>(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, kaizen_fee_minor)
      values (${referred.storeId}::uuid, ${String(order.id)}::uuid, 'stripe', ${`cs_${run}`}, 20000, 'NOK', 'pending', 400) returning id
    `);
    expect(await entries(r.account.id)).toEqual([]);
    await db().execute(sql`update commerce.payments set status = 'captured' where id = ${String(payment.id)}::uuid`);
    expect(await entries(r.account.id)).toEqual([{ kind: "earn", amount: 40, currency: "NOK", invoice: null }]);
    await maturing(r.account.id);
    await db().execute(sql`insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status) values (${referred.storeId}::uuid, ${String(payment.id)}::uuid, 5000, 'test', 'succeeded')`);
    expect(await balance(r.account.id)).toMatchObject({ availableMinor: 30 });
    // What the owner sees: the store by name, the commission it earned net of the refund, and nothing about its orders.
    const overview = await referrals.referrerOverview(r.account);
    expect(overview.stores).toEqual([expect.objectContaining({ storeName: `${referred.slug.split("-")[0]} shop`, status: "active", earned: [{ currency: "NOK", minor: 30 }] })]);
    const text = JSON.stringify(overview);
    for (const secret of [referred.email, "shopper@example.com", String(order.id), `S-${run}`]) expect(text).not.toContain(secret);
    await program();
  });
});

describe("the owner's and the platform's views", () => {
  it("give the owner their link, counts, stores, balances and history, and keep the program's terms", async () => {
    await program({ bps: 1000, months: 12, pending: 30 });
    const r = await referrer("view");
    await referrals.recordReferralVisit(r.code);
    await referrals.recordReferralVisit(r.code);
    const referred = await owner("viewstore", r.code);
    await platform.createAccessRequest({ name: "Pending", email: `pending-${run}-${counter}@example.com`, storeName: "P", message: "", referralCode: r.code });
    await post("invoice.paid", invoice(referred.stripeAccount, { status: "paid" }));
    const overview = await referrals.referrerOverview(r.account);
    expect(overview).toMatchObject({ enabled: true, code: r.code, blocked: false, visits: 2, settings: { commissionBps: 1000, months: 12, pendingDays: 30 } });
    // The store it came with (opened through the code) and the request still waiting.
    expect(overview.signedUp).toBe(2);
    expect(overview.stores).toHaveLength(1);
    expect(overview.stores[0].until.slice(0, 7)).toBe(new Date(new Date(overview.stores[0].since).setUTCMonth(new Date(overview.stores[0].since).getUTCMonth() + 12)).toISOString().slice(0, 7));
    expect(overview.balances).toEqual([{ currency: "NOK", availableMinor: 0, pendingMinor: 3490, pendingAt: expect.any(String) }]);
    expect(overview.entries).toEqual([expect.objectContaining({ kind: "earn", amountMinor: 3490, currency: "NOK", note: expect.stringContaining("shop: plan") })]);
  });

  it("make no code for an account when the program is off, but show the one it has", async () => {
    const r = await referrer("paused");
    const fresh = await owner("fresh");
    await program({ enabled: false });
    expect(await referrals.referrerOverview(fresh.account)).toMatchObject({ enabled: false, code: null });
    expect(await referrals.referrerOverview(r.account)).toMatchObject({ enabled: false, code: r.code });
    await program();
    expect((await referrals.referrerOverview(fresh.account)).code).toMatch(/^[a-z0-9]{8}$/);
    const nobody = await db().execute<Row>(sql`insert into commerce.accounts (email) values (${`solo-${run}@example.com`}) returning id`);
    expect(await referrals.referrerOverview({ id: String(nobody[0].id) })).toMatchObject({ code: null });
  });

  it("lets platform admins, and only them, block, void and adjust, each with a reason", async () => {
    const r = await referrer("admin");
    const other = await owner("notadmin");
    expect(await referrals.setReferrerBlocked(other.account, r.account.id, true, "because")).toMatchObject({ ok: false });
    expect(await referrals.setReferrerBlocked(admin, r.account.id, true, "")).toMatchObject({ ok: false });
    expect(await referrals.setReferrerBlocked(admin, r.account.id, true, "chargebacks")).toEqual({ ok: true });
    expect(await referrals.setReferrerBlocked(admin, r.account.id, true, "again")).toMatchObject({ ok: false });
    expect((await referrals.listReferrers()).find((x) => x.accountId === r.account.id)).toMatchObject({ blockedReason: "chargebacks", blockedAt: expect.any(String) });
    expect(await referrals.setReferrerBlocked(admin, r.account.id, false)).toEqual({ ok: true });
    expect(await referrals.setReferrerBlocked(admin, r.account.id, false)).toMatchObject({ ok: false });

    expect(await referrals.adjustReferralCredit(other.account, { accountId: r.account.id, currency: "NOK", amountMinor: 100, reason: "no" })).toMatchObject({ ok: false });
    expect(await referrals.adjustReferralCredit(admin, { accountId: r.account.id, currency: "NOK", amountMinor: 100, reason: "" })).toMatchObject({ ok: false });
    expect(await referrals.adjustReferralCredit(admin, { accountId: r.account.id, currency: "nok", amountMinor: 0, reason: "zero" })).toMatchObject({ ok: false });
    expect(await referrals.adjustReferralCredit(admin, { accountId: r.account.id, currency: "NOK", amountMinor: 5_000, reason: "goodwill" }, `key-1-${run}`)).toEqual({ ok: true });
    // The same submission twice counts once.
    await referrals.adjustReferralCredit(admin, { accountId: r.account.id, currency: "NOK", amountMinor: 5_000, reason: "goodwill" }, `key-1-${run}`);
    expect(await referrals.adjustReferralCredit(admin, { accountId: r.account.id, currency: "NOK", amountMinor: -2_000, reason: "mistake" })).toEqual({ ok: true });
    expect(await referrals.adjustReferralCredit(admin, { accountId: r.account.id, currency: "NOK", amountMinor: -9_000, reason: "too much" })).toEqual({ ok: false, problems: ["They do not have that much credit to remove."] });
    expect(await balance(r.account.id)).toMatchObject({ availableMinor: 3_000 });
    const overview = await referrals.referrerOverview(r.account);
    expect(overview.entries.map((e) => e.note)).toEqual(["mistake", "goodwill"]);
    const [log] = await db().execute<Row>(sql`select details from commerce.audit_log where action = 'platform.referral_credit_adjusted' order by id desc limit 1`);
    expect(log.details).toMatchObject({ reason: "mistake", amountMinor: -2_000 });
  });

  it("list referred stores with who referred them, and total per currency, never across", async () => {
    await program();
    const r = await referrer("totals");
    const referred = await owner("totalsstore", r.code);
    await post("invoice.paid", invoice(referred.stripeAccount, { status: "paid", total_excluding_tax: 10_000 }));
    await post("invoice.paid", invoice(referred.stripeAccount, { status: "paid", currency: "eur", total_excluding_tax: 20_000 }));
    const list = await referrals.listReferrals();
    const mine = list.find((x) => x.storeSlug === referred.slug);
    expect(mine).toMatchObject({ referrerEmail: r.email, status: "active", commissionBps: 1000, months: 12 });
    expect(mine!.earned).toEqual([
      { currency: "EUR", minor: 2_000 },
      { currency: "NOK", minor: 1_000 },
    ]);
    const totals = await referrals.referralTotals();
    expect(totals.referrers).toBeGreaterThan(0);
    expect(totals.earned.map((t) => t.currency)).toEqual(expect.arrayContaining(["EUR", "NOK"]));
    // A referral is voided with a reason, and put back.
    expect(await referrals.setReferralVoid(admin, mine!.id, true, "")).toMatchObject({ ok: false });
    expect(await referrals.setReferralVoid(admin, mine!.id, true, "self-referral")).toEqual({ ok: true });
    expect((await referrals.listReferrals()).find((x) => x.id === mine!.id)).toMatchObject({ status: "void", voidReason: "self-referral" });
    expect(await referrals.setReferralVoid(admin, mine!.id, false)).toEqual({ ok: true });
  });
});

describe("the AI manager's tools", () => {
  const ctx = (account: Account) =>
    ({ account, store: null, flags: {}, connection: null, navigate: () => {}, invalidate: () => {} }) as unknown as Parameters<typeof managerTools.runPlatformTool>[0];

  it("answer from the program's own data, and change it only for a platform admin", async () => {
    await program({ bps: 1000, months: 12, pending: 30 });
    const read = (await managerTools.runPlatformTool(ctx(admin), "get_referral_program", {})) as Record<string, unknown>;
    expect(read).toMatchObject({ on: true, commission: "10 %", months: 12, pending_days: 30, admin: "/admin/platform/referrals" });
    const changed = (await managerTools.runPlatformTool(ctx(admin), "set_referral_program", { percent: 7.5, months: 24 })) as { done: string };
    expect(changed.done).toContain("7.5 %");
    expect(await referrals.getReferralSettings()).toMatchObject({ enabled: true, commissionBps: 750, months: 24, pendingDays: 30 });
    const someone = await owner("tool");
    await expect(managerTools.runPlatformTool(ctx(someone.account), "set_referral_program", { percent: 1 })).rejects.toThrow("Only platform admins");
    await program();
  });

  it("tell an owner only about their own referrals", async () => {
    const r = await referrer("mine");
    const referred = await owner("minestore", r.code);
    await post("invoice.paid", invoice(referred.stripeAccount, { status: "paid" }));
    const answer = (await managerTools.runManagerTool(ctx(r.account), "get_my_referrals", {})) as Record<string, unknown>;
    expect(answer).toMatchObject({ program_on: true, code: r.code, visits: 0 });
    expect(String(answer.link)).toContain(`/r/${r.code}`);
    expect(JSON.stringify(answer)).not.toContain(referred.email);
    expect(answer.credit).toEqual([expect.objectContaining({ currency: "NOK", waiting: expect.stringContaining("34") })]);
    const none = await owner("noreferrals");
    await program({ enabled: false });
    expect(await managerTools.runManagerTool(ctx(none.account), "get_my_referrals", {})).toMatchObject({ program_on: false });
    await program();
  });
});
