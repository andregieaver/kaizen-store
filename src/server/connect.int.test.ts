import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { PAYMENT_CAPABILITIES } from "@/lib/payment-methods";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";

import type { Account, Membership } from "./auth";

type Row = Record<string, unknown>;

/**
 * Stripe Connect, how store owners get paid (`src/server/connect.ts`, code review 1.9, FH9): a store's own Stripe account made or
 * reused, its status read and copied, the account webhook that turns real payments on and off, the embedded onboarding's secret, the
 * site's domains for wallets, the payment methods and display settings, and the platform's own webhooks, fee and checkout page. Each
 * step is checked against what the database then holds, and the owner's buttons against who may press them.
 *
 * Stripe is a stand-in injected where every call reaches it (`platformStripe()` in `./stripe`): it keeps each account's state as
 * Stripe would, answers an idempotency key with the account it made before, and records every call. Nothing here reaches the network,
 * and no key is needed: the platform's key is left unset, so not even the real client could be built.
 */

vi.mock("server-only", () => ({}));

type Capability = { status: string; status_details?: { code: string; resolution: string }[] };
type Entry = { awaiting_action_from: "user" | "stripe"; description: string; minimum_deadline: { status: string }; errors?: { code: string }[] };
type Side = { capabilities: Record<string, Capability>; entries: Entry[] };
type Call = { method: string; args: unknown[] };
type CreateParams = { dashboard?: string; configuration?: { merchant?: { capabilities?: Record<string, unknown> } } };

/** The stand-in for Kaizena Flow's own Stripe account (the Connect platform), in both modes. */
const stripe = vi.hoisted(() => {
  const tag = Date.now().toString(36);
  let next = 0;
  const id = (prefix: string) => `${prefix}_cn${tag}x${++next}`;
  const calls: Call[] = [];
  /** Stripe's side of each account: what a retrieve answers. */
  const accounts = new Map<string, Side>();
  const byKey = new Map<string, string>();
  const domains = new Map<string, Set<string>>();
  /** A method's next call throws this, once. */
  const failNext = new Map<string, unknown>();
  /** Every secret Stripe handed out, so the log and the activity log can be searched for them. */
  const secrets: string[] = [];
  const refusedCapabilities = new Set<string>();
  const refusedMethods = new Set<string>();
  const refuseIdentity = { error: null as unknown };
  const configs = new Map<string, { id: string; is_default: boolean }[]>();
  let methodStates: Record<string, unknown> = {};
  const modes = new Set<string>(["test", "live"]);

  const answer = (method: string, args: unknown[]) => {
    calls.push({ method, args });
    if (failNext.has(method)) {
      const error = failNext.get(method);
      failNext.delete(method);
      throw error;
    }
  };
  const view = (accountId: string) => {
    const side = accounts.get(accountId);
    if (!side) throw new Error(`No such account: '${accountId}'`);
    return {
      id: accountId,
      object: "v2.core.account",
      configuration: { merchant: { capabilities: structuredClone(side.capabilities) } },
      requirements: { entries: structuredClone(side.entries) },
    };
  };
  const webhooks = {
    answer: null as null | { ok: false; problem: string },
  };

  const client = {
    v2: {
      core: {
        accounts: {
          create: async (params: CreateParams, options: { idempotencyKey: string }) => {
            answer("accounts.create", [params, options]);
            const known = byKey.get(options.idempotencyKey);
            if (known) return view(known);
            const accountId = id("acct");
            const requested = Object.keys(params.configuration?.merchant?.capabilities ?? {});
            accounts.set(accountId, {
              capabilities: Object.fromEntries(requested.map((capability) => [capability, { status: "pending" }])),
              // An account the owner runs (full Dashboard) waits for their details; one Kaizena Flow filled in is being checked.
              entries:
                params.dashboard === "full"
                  ? [{ awaiting_action_from: "user", description: "identity.individual.address", minimum_deadline: { status: "currently_due" } }]
                  : [],
            });
            byKey.set(options.idempotencyKey, accountId);
            return view(accountId);
          },
          retrieve: async (accountId: string, params: unknown) => {
            answer("accounts.retrieve", [accountId, params]);
            return view(accountId);
          },
          update: async (accountId: string, params: { identity?: unknown; configuration?: { merchant?: { capabilities?: Record<string, unknown> } } }) => {
            answer("accounts.update", [accountId, params]);
            if (params.identity && refuseIdentity.error) throw refuseIdentity.error;
            const asked = Object.keys(params.configuration?.merchant?.capabilities ?? {});
            if (asked.some((capability) => refusedCapabilities.has(capability))) throw new Error("A capability is not offered to this account.");
            const side = accounts.get(accountId);
            if (side) for (const capability of asked) side.capabilities[capability] ??= { status: "pending" };
            return view(accountId);
          },
        },
      },
    },
    accounts: {
      createExternalAccount: async (accountId: string, params: unknown, options: unknown) => {
        answer("accounts.createExternalAccount", [accountId, params, options]);
        return { id: id("ba"), object: "bank_account" };
      },
    },
    accountSessions: {
      create: async (params: { account: string }) => {
        answer("accountSessions.create", [params]);
        const secret = `${id("accs")}_secret_${tag}`;
        secrets.push(secret);
        return { object: "account_session", account: params.account, client_secret: secret };
      },
    },
    paymentMethodDomains: {
      create: async (params: { domain_name: string }, options: { stripeAccount: string }) => {
        answer("paymentMethodDomains.create", [params, options]);
        const known = domains.get(options.stripeAccount) ?? new Set<string>();
        if (known.has(params.domain_name)) throw new Error("This domain is already registered.");
        known.add(params.domain_name);
        domains.set(options.stripeAccount, known);
        return { id: id("pmd"), domain_name: params.domain_name };
      },
      list: async (params: { domain_name: string }, options: { stripeAccount: string }) => {
        answer("paymentMethodDomains.list", [params, options]);
        return { data: domains.get(options.stripeAccount)?.has(params.domain_name) ? [{ id: id("pmd"), domain_name: params.domain_name }] : [] };
      },
    },
    paymentMethodConfigurations: {
      list: async (params: unknown, options: { stripeAccount: string }) => {
        answer("pmc.list", [params, options]);
        return { data: configs.get(options.stripeAccount) ?? [] };
      },
      update: async (configId: string, params: Record<string, unknown>, options: { stripeAccount: string }) => {
        answer("pmc.update", [configId, params, options]);
        if (Object.keys(params).some((method) => refusedMethods.has(method))) throw new Error("A payment method is not offered to this account.");
        return { id: configId, ...structuredClone(methodStates) };
      },
    },
    /** Checked with Stripe's own code below: a signature is verified as in production. */
    parseEventNotification: (() => {
      throw new Error("set after the imports");
    }) as (body: string, signature: string, secret: string) => unknown,
  };

  return {
    tag,
    id,
    calls,
    accounts,
    domains,
    failNext,
    secrets,
    refusedCapabilities,
    refusedMethods,
    refuseIdentity,
    configs,
    setMethodStates: (states: Record<string, unknown>) => void (methodStates = states),
    modes,
    webhooks,
    client,
    callsOf: (method: string) => calls.filter((call) => call.method === method),
  };
});

vi.mock("./stripe", async (importActual) => ({
  ...(await importActual<typeof import("./stripe")>()),
  platformStripe: (mode: string) => (stripe.modes.has(mode) ? stripe.client : null),
  // The platform's three webhook endpoints, as Stripe answers their creation (`createPlatformWebhooks()` is Stripe's side of this).
  createPlatformWebhooks: async (mode: string, origin: string) => {
    stripe.calls.push({ method: "createPlatformWebhooks", args: [mode, origin] });
    if (stripe.webhooks.answer) return stripe.webhooks.answer;
    const hook = (kind: string, path: string) => {
      const secret = `whsec_${kind}_${mode}_${stripe.id("s")}`;
      stripe.secrets.push(secret);
      return { kind, endpointId: stripe.id(kind === "thin" ? "ed" : "we"), url: `${origin}${path}`, secret };
    };
    return {
      ok: true,
      webhooks: [
        hook("snapshot", `/api/stripe/connect/${mode}`),
        hook("thin", `/api/stripe/connect/${mode}/accounts`),
        hook("billing", `/api/stripe/billing/${mode}`),
      ],
    };
  },
}));
// No platform key at all: the stand-in above is the only Stripe there is.
vi.mock("./stripe-keys", () => ({
  platformModes: () => ["test", "live"],
  platformPublishableKey: (mode: string) => `pk_${mode}_connect`,
  platformSecretKey: () => null,
}));

const request = vi.hoisted(() => ({ ip: "203.0.113.7, 10.0.0.1", origin: "https://shop.kaizenaflow.test" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, has: () => false }),
  headers: async () => new Headers({ "x-forwarded-for": request.ip, origin: request.origin }),
}));

const next = vi.hoisted(() => ({ revalidated: [] as string[], updated: [] as string[], refreshed: 0, tags: [] as string[] }));
vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  updateTag: (tag: string) => void next.updated.push(tag),
  revalidateTag: (tag: string) => void next.revalidated.push(tag),
  refresh: () => void (next.refreshed += 1),
}));
vi.mock("./refresh", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./refresh")>()),
  refreshTag: (tag: string) => void next.tags.push(tag),
}));

/** Every line written through `log()`, as it would be written. */
const logs = vi.hoisted(() => [] as { level: string; event: string; fields: Record<string, unknown>; line: string }[]);
vi.mock("./log", async (importOriginal) => {
  const real = await importOriginal<typeof import("./log")>();
  return {
    ...real,
    log: (...args: Parameters<typeof real.log>) => {
      const [level, event, fields = {}, error] = args;
      logs.push({ level, event, fields, line: real.logLine(level, event, fields, error) });
    },
  };
});

/** Who is signed in. Their memberships are the database's own rows (`passMembership()`), so roles and stores are checked for real. */
const session = vi.hoisted(() => ({ account: null as Account | null }));
vi.mock("@/server/auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("./auth")>();
  const { notFound } = await import("next/navigation");
  const membership = async (storeSlug: string): Promise<Membership | null> =>
    session.account ? real.passMembership(storeSlug, session.account.id) : null;
  return {
    ...real,
    readSession: async () => null,
    getAccount: async () => session.account,
    requireAccount: async () => session.account ?? notFound(),
    getMembership: membership,
    requireMember: async (storeSlug: string) => (await membership(storeSlug)) ?? notFound(),
  };
});

const connect = await import("./connect");
const { POST: accountsWebhook } = await import("@/app/api/stripe/connect/[mode]/accounts/route");
const actions = await import("../app/admin/(gated)/actions");
const platformActions = await import("../app/admin/(gated)/platform/actions");
const { getStore } = await import("./stores");
const { setStripeProvider } = await import("./settings");
const { buyFacts } = await import("./buy-facts");

const signer = new Stripe("sk_test_signing_only");
stripe.client.parseEventNotification = (body, signature, secret) => signer.parseEventNotification(body, signature, secret);

const run = Date.now().toString(36);
const idle = { status: "idle" as const, messages: [] };
const thinSecrets = { test: `whsec_thin_test_${run}`, live: `whsec_thin_live_${run}` };
let key: Buffer;
const before = { encryptionKey: process.env.SETTINGS_ENCRYPTION_KEY, saleFeeBps: 0, checkoutUi: "custom" };

type Shop = { id: string; slug: string; owner: Account };
let shop: Shop;
let other: Shop;
let plain: Shop;
let press: Shop;
let methods: Shop;
let admin: Account;
let platformAdmin: Account;

async function makeShop(name: string): Promise<Shop> {
  const slug = `connect-${name}-${run}`;
  const email = `${slug}@example.com`;
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${email}, 'Kari', ${slug}) returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${`Connect ${name}`}, null) as id
  `);
  const id = String(store.id);
  await db().execute(sql`
    update commerce.stores set country = 'NO', legal_name = 'Kari Nordmann AS', contact_email = ${`orders-${slug}@example.com`}
    where id = ${id}::uuid
  `);
  const [account] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${email}`);
  return { id, slug, owner: { id: String(account.id), email, name: "Kari", platformAdmin: false } };
}

async function newAccount(name: string, platform = false): Promise<Account> {
  const email = `${name}-${run}@example.com`;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${email}, ${name}, ${platform}) returning id
  `);
  return { id: String(row.id), email, name, platformAdmin: platform };
}

const ownerOf = async (s: Shop): Promise<Membership> => ({ account: s.owner, store: (await getStore(s.slug))!, role: "owner" });

async function accountRow(storeId: string, mode: "test" | "live"): Promise<Row | undefined> {
  const [row] = await db().execute<Row>(sql`
    select account_id, card_payments, requirements_due, requirements, method_states, managed_by_kaizen, payment_methods_requested,
           payment_methods_shown, payment_domains, created_by
    from commerce.stripe_accounts where store_id = ${storeId}::uuid and mode = ${mode}
  `);
  return row;
}

async function audits(storeId: string | null, prefix: string): Promise<Row[]> {
  return db().execute<Row>(sql`
    select action, account_id, details from commerce.audit_log
    where store_id is not distinct from ${storeId}::uuid and action like ${`${prefix}%`}
    order by created_at, id
  `);
}

/** Stripe's account in the stand-in, as a test sets it: what Stripe would answer next. */
function stripeSays(accountId: string, side: Side): void {
  stripe.accounts.set(accountId, structuredClone(side));
}

const callsSince = (mark: number, method?: string) => stripe.calls.slice(mark).filter((call) => !method || call.method === method);

beforeAll(async () => {
  key = randomBytes(32);
  process.env.SETTINGS_ENCRYPTION_KEY = key.toString("base64");
  [shop, other, plain, press, methods] = await Promise.all(["shop", "other", "plain", "press", "methods"].map(makeShop));
  admin = await newAccount("connect-admin");
  await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) values (${shop.id}::uuid, ${admin.id}::uuid, 'admin')`);
  platformAdmin = await newAccount("connect-platform", true);
  const [settings] = await db().execute<Row>(sql`select sale_fee_bps, checkout_ui from commerce.platform_settings`);
  before.saleFeeBps = Number(settings.sale_fee_bps);
  before.checkoutUi = String(settings.checkout_ui);
});

afterAll(async () => {
  await db().execute(sql`update commerce.platform_settings set sale_fee_bps = ${before.saleFeeBps}, checkout_ui = ${before.checkoutUi}`);
  if (before.encryptionKey === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
  else process.env.SETTINGS_ENCRYPTION_KEY = before.encryptionKey;
  await closeDb();
});

describe("a store's own Stripe account (createStripeAccount)", () => {
  it("makes the live account the way Stripe advises for platforms like this one, and records it", async () => {
    const membership = await ownerOf(shop);
    const currency = membership.store.markets[0]?.currency.toLowerCase();
    const tags = next.tags.length;

    expect(await connect.createStripeAccount(membership, "live", "https://connect-shop.example")).toEqual({ ok: true });

    const [made] = stripe.callsOf("accounts.create");
    expect(made.args[0]).toMatchObject({
      display_name: "Connect shop",
      contact_email: `orders-${shop.slug}@example.com`,
      dashboard: "full",
      identity: { country: "no", business_details: { registered_name: "Kari Nordmann AS" } },
      configuration: {
        customer: {},
        merchant: {
          capabilities: {
            card_payments: { requested: true },
            klarna_payments: { requested: true },
            link_payments: { requested: true },
            mobilepay_payments: { requested: true },
          },
        },
      },
      defaults: {
        currency,
        responsibilities: { fees_collector: "stripe", losses_collector: "stripe" },
        profile: { business_url: "https://connect-shop.example" },
      },
      metadata: { store_id: shop.id, store_slug: shop.slug },
      include: connect.INCLUDE,
    });
    // Never a payment method list: stores choose their methods in their own Stripe Dashboard.
    expect(JSON.stringify(made.args[0])).not.toContain("payment_method_types");
    expect(made.args[1]).toEqual({ idempotencyKey: `kaizen-account-${shop.id}-live` });

    const row = await accountRow(shop.id, "live");
    expect(row).toMatchObject({
      account_id: expect.stringMatching(/^acct_/),
      // Stripe waits for the owner's details: no real payments yet.
      card_payments: "pending",
      requirements_due: true,
      managed_by_kaizen: false,
      payment_methods_requested: [...connect.BASE_CAPABILITIES],
      created_by: shop.owner.id,
    });
    expect(await connect.getStripeAccounts(shop.id)).toEqual({
      live: { mode: "live", accountId: row?.account_id, cardPayments: "pending", requirementsDue: true },
    });
    expect(await audits(shop.id, "payments.stripe_account_created")).toEqual([
      { action: "payments.stripe_account_created", account_id: shop.owner.id, details: { mode: "live", accountId: row?.account_id } },
    ]);
    // The checkout's cached facts read this row.
    expect(next.tags.slice(tags)).toContain(`buy:${shop.id}`);
  });

  it("reuses it: a second press asks Stripe nothing and changes nothing", async () => {
    const mark = stripe.calls.length;
    const row = await accountRow(shop.id, "live");
    expect(await connect.createStripeAccount(await ownerOf(shop), "live", "https://connect-shop.example")).toEqual({ ok: true });
    expect(callsSince(mark)).toEqual([]);
    expect(await accountRow(shop.id, "live")).toEqual(row);
  });

  it("makes one account at Stripe and one row when two presses arrive together", async () => {
    const membership = await ownerOf(other);
    const mark = stripe.calls.length;
    const results = await Promise.all([
      connect.createStripeAccount(membership, "live", "https://connect-other.example"),
      connect.createStripeAccount(membership, "live", "https://connect-other.example"),
    ]);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    // Both asked with the same idempotency key, so Stripe answered both with one account.
    const asked = callsSince(mark, "accounts.create");
    expect(asked).toHaveLength(2);
    expect(new Set(asked.map((call) => JSON.stringify(call.args[1])))).toEqual(new Set([JSON.stringify({ idempotencyKey: `kaizen-account-${other.id}-live` })]));
    const rows = await db().execute<Row>(sql`select account_id from commerce.stripe_accounts where store_id = ${other.id}::uuid`);
    expect(rows).toHaveLength(1);
    expect(stripe.accounts.has(String(rows[0].account_id))).toBe(true);
    // And the activity log says it was made once: the press whose row was already there records nothing.
    expect(await audits(other.id, "payments.stripe_account_created")).toEqual([
      { action: "payments.stripe_account_created", account_id: other.owner.id, details: { mode: "live", accountId: rows[0].account_id } },
    ]);
  });

  it("says what Stripe refused, or that Stripe could not be reached, and records nothing", async () => {
    const membership = await ownerOf(plain);
    stripe.failNext.set(
      "accounts.create",
      new Stripe.errors.StripeInvalidRequestError({ type: "invalid_request_error", message: "The business URL is not valid." }),
    );
    expect(await connect.createStripeAccount(membership, "live", "https://connect-plain.example")).toEqual({
      ok: false,
      problems: ["The business URL is not valid."],
    });
    stripe.failNext.set("accounts.create", new Error("socket hang up"));
    expect(await connect.createStripeAccount(membership, "live", "https://connect-plain.example")).toEqual({
      ok: false,
      problems: ["Stripe could not be reached."],
    });
    expect(await accountRow(plain.id, "live")).toBeUndefined();
    expect(await audits(plain.id, "payments.stripe_account_created")).toEqual([]);
  });

  it("refuses a mode the platform has no keys for, before asking Stripe", async () => {
    stripe.modes.delete("live");
    const mark = stripe.calls.length;
    try {
      expect(await connect.createStripeAccount(await ownerOf(plain), "live", "https://connect-plain.example")).toEqual({
        ok: false,
        problems: ["Payments in live mode are not available yet."],
      });
    } finally {
      stripe.modes.add("live");
    }
    expect(callsSince(mark)).toEqual([]);
  });

  it("leaves out a store address Stripe would refuse (not a public https one)", async () => {
    const mark = stripe.calls.length;
    expect(await connect.createStripeAccount(await ownerOf(plain), "live", "http://localhost:3000/s/connect-plain")).toEqual({ ok: true });
    const [made] = callsSince(mark, "accounts.create");
    expect(made.args[0]).not.toHaveProperty("defaults.profile");
    expect(await accountRow(plain.id, "live")).toMatchObject({ card_payments: "pending", created_by: plain.owner.id });
  });

  it("sets up the test account itself in test mode (D20), with Stripe's test values and the owner's address for the agreement", async () => {
    const mark = stripe.calls.length;
    expect(await connect.createStripeAccount(await ownerOf(shop), "test", "https://connect-shop.example")).toEqual({ ok: true });

    const [made] = callsSince(mark, "accounts.create");
    expect(made.args[0]).toMatchObject({
      dashboard: "none",
      identity: { country: "no", attestations: { terms_of_service: { account: { ip: "203.0.113.7" } } } },
      defaults: { responsibilities: { fees_collector: "application", losses_collector: "application" } },
      metadata: { store_id: shop.id, store_slug: shop.slug, kaizen_test_account: "true" },
    });
    // The same minute and place give the same request, which Stripe answers with one account.
    expect((made.args[1] as { idempotencyKey: string }).idempotencyKey).toMatch(new RegExp(`^kaizen-test-account-${shop.id}-\\d+-203\\.0\\.113\\.7$`));
    const row = await accountRow(shop.id, "test");
    const [bank] = callsSince(mark, "accounts.createExternalAccount");
    expect(bank.args).toEqual([
      row?.account_id,
      { external_account: expect.objectContaining({ object: "bank_account", country: "NO", currency: "nok" }) },
      { idempotencyKey: `kaizen-test-bank-${row?.account_id}` },
    ]);
    expect(row).toMatchObject({
      card_payments: "pending",
      requirements_due: false,
      managed_by_kaizen: true,
      payment_methods_requested: [...connect.BASE_CAPABILITIES],
      created_by: shop.owner.id,
    });
    expect(await audits(shop.id, "payments.test_account_created")).toEqual([
      { action: "payments.test_account_created", account_id: shop.owner.id, details: { accountId: row?.account_id, replaced: null } },
    ]);
  });
});

describe("the test account Kaizena Flow keeps (ensureTestAccount)", () => {
  it("answers at once for a test account that already takes payments", async () => {
    await db().execute(sql`update commerce.stripe_accounts set card_payments = 'active' where store_id = ${shop.id}::uuid and mode = 'test'`);
    const mark = stripe.calls.length;
    const row = await accountRow(shop.id, "test");
    expect(await connect.ensureTestAccount(shop.id)).toEqual({ ok: true, accountId: row?.account_id, ready: true });
    expect(callsSince(mark)).toEqual([]);
  });

  it("reads one of its own that is still being checked again, and says when it is ready", async () => {
    await db().execute(sql`update commerce.stripe_accounts set card_payments = 'pending' where store_id = ${shop.id}::uuid and mode = 'test'`);
    const accountId = String((await accountRow(shop.id, "test"))?.account_id);

    stripeSays(accountId, { capabilities: { card_payments: { status: "pending" } }, entries: [] });
    expect(await connect.ensureTestAccount(shop.id)).toEqual({ ok: true, accountId, ready: false });
    expect(await accountRow(shop.id, "test")).toMatchObject({ card_payments: "pending" });

    stripeSays(accountId, { capabilities: { card_payments: { status: "active" }, klarna_payments: { status: "active" } }, entries: [] });
    expect(await connect.ensureTestAccount(shop.id)).toEqual({ ok: true, accountId, ready: true });
    expect(await accountRow(shop.id, "test")).toMatchObject({
      card_payments: "active",
      requirements_due: false,
      method_states: { card_payments: { status: "active", reason: null }, klarna_payments: { status: "active", reason: null } },
    });
  });

  it("says Stripe could not be reached, and changes nothing", async () => {
    await db().execute(sql`update commerce.stripe_accounts set card_payments = 'pending' where store_id = ${shop.id}::uuid and mode = 'test'`);
    const row = await accountRow(shop.id, "test");
    stripe.failNext.set("accounts.retrieve", new Error("ETIMEDOUT"));
    expect(await connect.ensureTestAccount(shop.id)).toEqual({ ok: false, problem: "Stripe could not be reached." });
    expect(await accountRow(shop.id, "test")).toEqual(row);
    await db().execute(sql`update commerce.stripe_accounts set card_payments = 'active' where store_id = ${shop.id}::uuid and mode = 'test'`);
  });

  it("never makes one without the owner at hand (as at checkout)", async () => {
    const mark = stripe.calls.length;
    expect(await connect.ensureTestAccount(press.id)).toEqual({ ok: false, problem: "The store's test account is not set up yet." });
    expect(callsSince(mark)).toEqual([]);
    expect(await accountRow(press.id, "test")).toBeUndefined();
  });

  it("says so when the platform has no test keys", async () => {
    stripe.modes.delete("test");
    try {
      expect(await connect.ensureTestAccount(press.id, press.owner.id, "198.51.100.4")).toEqual({
        ok: false,
        problem: "Test payments are not available yet.",
      });
    } finally {
      stripe.modes.add("test");
    }
  });

  it("replaces an older test account that waits for the owner's details with one it fills in itself", async () => {
    const old = `acct_old${run}`;
    await db().execute(sql`
      insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due, payment_domains, payment_methods_shown)
      values (${plain.id}::uuid, 'test', ${old}, 'inactive', true, '{old.example}', true)
    `);
    const result = await connect.ensureTestAccount(plain.id, plain.owner.id, "198.51.100.4");
    expect(result).toMatchObject({ ok: true, ready: false });
    const row = await accountRow(plain.id, "test");
    expect(row?.account_id).not.toBe(old);
    expect(row).toMatchObject({
      account_id: result.ok ? result.accountId : null,
      managed_by_kaizen: true,
      // A new account has no domains registered and no display settings changed yet.
      payment_domains: [],
      payment_methods_shown: false,
    });
    expect((await audits(plain.id, "payments.test_account_created")).map((entry) => entry.details)).toEqual([
      { accountId: row?.account_id, replaced: old },
    ]);
  });
});

describe("reading an account's status (refreshStripeAccount)", () => {
  it("is null for a mode the store has no account in, without asking Stripe", async () => {
    const mark = stripe.calls.length;
    expect(await connect.refreshStripeAccount(press.id, "live")).toBeNull();
    expect(callsSince(mark)).toEqual([]);
  });

  it("copies what Stripe says: card payments, what is due, and why a method is not on", async () => {
    const accountId = String((await accountRow(plain.id, "live"))?.account_id);
    stripeSays(accountId, {
      capabilities: {
        card_payments: { status: "restricted", status_details: [{ code: "requirements_past_due", resolution: "provide_info" }] },
        mobilepay_payments: { status: "unsupported", status_details: [{ code: "unsupported_business", resolution: "contact_stripe" }] },
      },
      entries: [
        { awaiting_action_from: "user", description: "identity.individual.id_numbers", minimum_deadline: { status: "past_due" }, errors: [{ code: "invalid_value_other" }] },
        // Stripe's own review: nothing the owner can do, so not due from them.
        { awaiting_action_from: "stripe", description: "identity.business_details.registered_name", minimum_deadline: { status: "currently_due" } },
      ],
    });
    expect(await connect.refreshStripeAccount(plain.id, "live")).toEqual({ mode: "live", accountId, cardPayments: "restricted", requirementsDue: true });
    expect(await accountRow(plain.id, "live")).toMatchObject({
      card_payments: "restricted",
      requirements_due: true,
      requirements: [
        { item: "card_payments", from: "provide_info", status: "requirements_past_due", errors: [] },
        { item: "mobilepay_payments", from: "contact_stripe", status: "unsupported_business", errors: [] },
        { item: "identity.individual.id_numbers", from: "user", status: "past_due", errors: ["invalid_value_other"] },
        { item: "identity.business_details.registered_name", from: "stripe", status: "currently_due", errors: [] },
      ],
      method_states: {
        card_payments: { status: "restricted", reason: "requirements_past_due" },
        mobilepay_payments: { status: "unsupported", reason: "unsupported_business" },
      },
    });

    // Stripe's review alone is not the owner's to do.
    stripeSays(accountId, {
      capabilities: { card_payments: { status: "pending" } },
      entries: [{ awaiting_action_from: "stripe", description: "identity.business_details.registered_name", minimum_deadline: { status: "currently_due" } }],
    });
    expect(await connect.refreshStripeAccount(plain.id, "live")).toMatchObject({ cardPayments: "pending", requirementsDue: false });
  });

  it("is null when Stripe cannot be asked, keeps the row, and logs the store and mode", async () => {
    const row = await accountRow(plain.id, "live");
    const lines = logs.length;
    stripe.failNext.set("accounts.retrieve", new Error("ECONNRESET"));
    expect(await connect.refreshStripeAccount(plain.id, "live")).toBeNull();
    expect(await accountRow(plain.id, "live")).toEqual(row);
    expect(logs.slice(lines).map(({ level, event, fields }) => ({ level, event, fields }))).toEqual([
      { level: "warn", event: "connect.account_refresh_failed", fields: { storeId: plain.id, mode: "live" } },
    ]);
  });
});

describe("the account webhook (/api/stripe/connect/{mode}/accounts)", () => {
  let liveAccount: string;
  let otherAccount: string;
  let hostAccount: string;
  let hostId: string;
  let market: string;
  let n = 0;

  const thinEvent = (accountId: string, type = "v2.core.account[configuration.merchant].capability_status_updated") =>
    JSON.stringify({
      id: `evt_thin_${run}_${++n}`,
      object: "v2.core.event",
      type,
      created: new Date().toISOString(),
      related_object: { id: accountId, type: "v2.core.account", url: `/v2/core/accounts/${accountId}` },
    });
  const post = (mode: string, body: string, signature: string | null) =>
    accountsWebhook(
      new Request(`http://localhost/api/stripe/connect/${mode}/accounts`, {
        method: "POST",
        headers: signature === null ? {} : { "stripe-signature": signature },
        body,
      }),
      { params: Promise.resolve({ mode }) },
    );
  const signed = (mode: "test" | "live", body: string, secret = thinSecrets[mode]) =>
    post(mode, body, signer.webhooks.generateTestHeaderString({ payload: body, secret }));

  beforeAll(async () => {
    for (const mode of ["test", "live"] as const) {
      await db().execute(sql`
        insert into commerce.platform_webhooks (provider, mode, kind, endpoint_id, url, secret_ciphertext)
        values ('stripe', ${mode}, 'thin', ${`ed_thin_${mode}`}, 'https://kaizenaflow.test/hook', ${encryptSecret(thinSecrets[mode], key)})
        on conflict (provider, mode, kind) do update set secret_ciphertext = excluded.secret_ciphertext
      `);
    }
    liveAccount = String((await accountRow(shop.id, "live"))?.account_id);
    otherAccount = String((await accountRow(other.id, "live"))?.account_id);
    market = (await getStore(shop.slug))!.markets[0].code;

    // A host who rents out through the store (D71), with a live account of their own.
    const hostPerson = await newAccount("connect-host");
    const [host] = await db().execute<Row>(sql`
      insert into commerce.hosts (store_id, account_id, name) values (${shop.id}::uuid, ${hostPerson.id}::uuid, 'Fjellhytta') returning id
    `);
    hostId = String(host.id);
    hostAccount = `acct_host${run}`;
    await db().execute(sql`
      insert into commerce.host_stripe_accounts (host_id, store_id, mode, account_id, card_payments, requirements_due)
      values (${hostId}::uuid, ${shop.id}::uuid, 'live', ${hostAccount}, 'pending', true)
    `);
  });

  it("names the store an account belongs to: its own, or one of its hosts'", async () => {
    expect(await connect.storeForAccount("live", liveAccount)).toEqual({ storeId: shop.id, slug: shop.slug, hostId: null });
    expect(await connect.storeForAccount("live", hostAccount)).toEqual({ storeId: shop.id, slug: shop.slug, hostId });
    // An account is known in its own mode only.
    expect(await connect.storeForAccount("test", liveAccount)).toBeNull();
    expect(await connect.storeForAccount("live", "acct_nobody")).toBeNull();
  });

  it("turns real payments on when Stripe activates card payments on the store's account", async () => {
    const owner = await ownerOf(shop);
    expect(await setStripeProvider(owner, true, "live", false)).toEqual({
      ok: false,
      problems: ["Finish setting up your live Stripe account first."],
    });

    stripeSays(liveAccount, { capabilities: { card_payments: { status: "active" }, klarna_payments: { status: "pending" } }, entries: [] });
    const mark = stripe.calls.length;
    const tags = next.tags.length;
    const response = await signed("live", thinEvent(liveAccount));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    // The event only names the account: its state is read back from Stripe.
    expect(callsSince(mark).map((call) => [call.method, call.args[0]])).toEqual([["accounts.retrieve", liveAccount]]);
    expect(await accountRow(shop.id, "live")).toMatchObject({
      card_payments: "active",
      requirements_due: false,
      requirements: [{ item: "klarna_payments", from: "stripe", status: "pending", errors: [] }],
    });
    expect(next.revalidated).toContain(`store:${shop.slug}`);
    expect(next.tags.slice(tags)).toContain(`buy:${shop.id}`);

    // The owner can now switch real payments on, and checkout takes them on this account.
    expect(await setStripeProvider(owner, true, "live", false)).toEqual({ ok: true });
    expect(await buyFacts(shop.id, market)).toMatchObject({ paymentsRow: true, activeMode: "live", accountId: liveAccount });
  });

  it("does not refresh the checkout's facts for news that changes nothing they read", async () => {
    const tags = next.tags.length;
    expect((await signed("live", thinEvent(liveAccount, "v2.core.account[requirements].updated"))).status).toBe(200);
    expect(next.tags.slice(tags)).not.toContain(`buy:${shop.id}`);
  });

  it("turns them off when Stripe restricts the account and asks the owner for more", async () => {
    stripeSays(liveAccount, {
      capabilities: { card_payments: { status: "restricted", status_details: [{ code: "requirements_past_due", resolution: "provide_info" }] } },
      entries: [
        {
          awaiting_action_from: "user",
          description: "identity.individual.verification.document",
          minimum_deadline: { status: "past_due" },
          errors: [{ code: "verification_document_expired" }],
        },
      ],
    });
    const tags = next.tags.length;
    expect((await signed("live", thinEvent(liveAccount, "v2.core.account[requirements].updated"))).status).toBe(200);
    expect(await accountRow(shop.id, "live")).toMatchObject({ card_payments: "restricted", requirements_due: true });
    expect(next.tags.slice(tags)).toContain(`buy:${shop.id}`);
    expect(await buyFacts(shop.id, market)).toMatchObject({ paymentsRow: false, accountId: null });
    expect(await connect.getStripeAccounts(shop.id)).toMatchObject({ live: { cardPayments: "restricted", requirementsDue: true } });
  });

  it("changes only the store the account belongs to", async () => {
    const otherRow = await accountRow(other.id, "live");
    stripeSays(liveAccount, { capabilities: { card_payments: { status: "active" } }, entries: [] });
    expect((await signed("live", thinEvent(liveAccount))).status).toBe(200);
    expect(await accountRow(other.id, "live")).toEqual(otherRow);
    expect(stripe.callsOf("accounts.retrieve").some((call) => call.args[0] === otherAccount)).toBe(false);
  });

  it("refreshes a host's account in the host's row, never the store's own", async () => {
    const own = await accountRow(shop.id, "live");
    stripeSays(hostAccount, { capabilities: { card_payments: { status: "active" } }, entries: [] });
    expect((await signed("live", thinEvent(hostAccount))).status).toBe(200);
    const [row] = await db().execute<Row>(sql`
      select card_payments, requirements_due from commerce.host_stripe_accounts where host_id = ${hostId}::uuid and mode = 'live'
    `);
    expect(row).toEqual({ card_payments: "active", requirements_due: false });
    expect(await accountRow(shop.id, "live")).toEqual(own);
  });

  it("ignores an account of another mode or of no store here, without asking Stripe", async () => {
    const mark = stripe.calls.length;
    for (const [mode, accountId] of [["test", liveAccount], ["live", "acct_someone_else"]] as const) {
      const response = await signed(mode, thinEvent(accountId));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true, ignored: "not a Kaizena Flow store" });
    }
    expect(callsSince(mark)).toEqual([]);
  });

  it("refuses what Stripe did not sign, an unknown mode and a mode with no keys", async () => {
    const body = thinEvent(liveAccount);
    const row = await accountRow(shop.id, "live");
    expect((await post("live", body, null)).status).toBe(400);
    expect((await signed("live", body, "whsec_someone_else")).status).toBe(400);
    // The test mode's secret does not open the live endpoint.
    expect((await signed("live", body, thinSecrets.test)).status).toBe(400);
    // A body changed after Stripe signed it: another store's account put in its place.
    const signature = signer.webhooks.generateTestHeaderString({ payload: body, secret: thinSecrets.live });
    expect((await post("live", body.replace(liveAccount, otherAccount), signature)).status).toBe(400);
    expect((await post("sandbox", body, "t=1,v1=x")).status).toBe(404);
    stripe.modes.delete("live");
    try {
      expect((await signed("live", body)).status).toBe(400);
    } finally {
      stripe.modes.add("live");
    }
    expect(await accountRow(shop.id, "live")).toEqual(row);
  });

  it("answers 500 when Stripe cannot be read, so Stripe sends the event again", async () => {
    const row = await accountRow(shop.id, "live");
    const lines = logs.length;
    stripe.failNext.set("accounts.retrieve", new Error("ECONNRESET"));
    const response = await signed("live", thinEvent(liveAccount));
    expect(response.status).toBe(500);
    expect(await accountRow(shop.id, "live")).toEqual(row);
    expect(logs.slice(lines).map(({ event, fields }) => ({ event, fields }))).toEqual([
      { event: "connect.account_refresh_failed", fields: { storeId: shop.id, mode: "live" } },
    ]);
  });
});

describe("embedded onboarding (createAccountSession)", () => {
  it("asks for an account first", async () => {
    const mark = stripe.calls.length;
    expect(await connect.createAccountSession(press.id, "live")).toEqual({ ok: false, problem: "Set up your Stripe account first." });
    expect(callsSince(mark)).toEqual([]);
  });

  it("gives a short-lived secret for the store's own account, and keeps it nowhere", async () => {
    const accountId = String((await accountRow(shop.id, "live"))?.account_id);
    const mark = stripe.calls.length;
    const session = await connect.createAccountSession(shop.id, "live");
    expect(session).toEqual({ ok: true, clientSecret: stripe.secrets.at(-1) });
    expect(callsSince(mark, "accountSessions.create")[0].args[0]).toEqual({
      account: accountId,
      components: {
        account_onboarding: { enabled: true },
        account_management: { enabled: true },
        notification_banner: { enabled: true },
      },
    });
    const [stored] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.audit_log where store_id = ${shop.id}::uuid and details::text like ${`%${stripe.secrets.at(-1)}%`}
    `);
    expect(stored.n).toBe(0);
  });

  it("says what Stripe refused", async () => {
    stripe.failNext.set(
      "accountSessions.create",
      new Stripe.errors.StripePermissionError({ type: "invalid_request_error", message: "This account is not connected to your platform." }),
    );
    expect(await connect.createAccountSession(shop.id, "live")).toEqual({ ok: false, problem: "This account is not connected to your platform." });
  });
});

describe("the owner's buttons on the Payments page", () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) data.append(name, value);
    return data;
  };

  it("let the owner make their store's live account", async () => {
    session.account = press.owner;
    const mark = stripe.calls.length;
    expect(await actions.createStripeAccountAction(press.slug, idle, form({ mode: "live" }))).toEqual({ status: "ok", messages: [] });
    const [made] = callsSince(mark, "accounts.create");
    expect(made.args[0]).toMatchObject({ metadata: { store_id: press.id }, defaults: { profile: { business_url: expect.stringMatching(/^https:\/\//) } } });
    expect(await accountRow(press.id, "live")).toMatchObject({ created_by: press.owner.id });
    expect(await actions.createStripeAccountAction(press.slug, idle, form({ mode: "sandbox" }))).toEqual({ status: "error", messages: ["Unknown mode."] });
  });

  it("refuse a member who is not the owner, ask Stripe nothing, and note the refusal by ids", async () => {
    session.account = admin;
    const mark = stripe.calls.length;
    const lines = logs.length;
    const refused = { status: "error", messages: ["Only an owner can change this."] };
    expect(await actions.createStripeAccountAction(shop.slug, idle, form({ mode: "live" }))).toEqual(refused);
    expect(await actions.accountSessionAction(shop.slug, "live")).toEqual({ ok: false, problem: "Only an owner can change this." });
    await expect(actions.refreshStripeAccountAction(shop.slug, "live")).rejects.toThrow();
    expect(callsSince(mark)).toEqual([]);
    expect(logs.slice(lines).filter((line) => line.event === "auth.permission_refused").map((line) => line.fields)).toContainEqual({
      accountId: admin.id,
      storeId: shop.id,
      keys: "owner",
    });
    expect(await audits(shop.id, "staff.permission_refused")).toContainEqual(
      expect.objectContaining({ account_id: admin.id, details: { keys: "owner" } }),
    );
  });

  it("never reach another store's account, even for an owner", async () => {
    session.account = other.owner;
    const mark = stripe.calls.length;
    const row = await accountRow(shop.id, "live");
    expect(await actions.createStripeAccountAction(shop.slug, idle, form({ mode: "test" }))).toEqual({ status: "error", messages: ["Only an owner can change this."] });
    expect(await actions.accountSessionAction(shop.slug, "live")).toEqual({ ok: false, problem: "Only an owner can change this." });
    await expect(actions.refreshStripeAccountAction(shop.slug, "live")).rejects.toThrow();
    expect(callsSince(mark)).toEqual([]);
    expect(await accountRow(shop.id, "live")).toEqual(row);
  });

  it("give the owner the onboarding secret and read the account after onboarding", async () => {
    session.account = shop.owner;
    const session1 = await actions.accountSessionAction(shop.slug, "live");
    expect(session1).toEqual({ ok: true, clientSecret: stripe.secrets.at(-1) });
    const updated = next.updated.length;
    await actions.refreshStripeAccountAction(shop.slug, "live");
    // Whether the storefront can take payments may have changed.
    expect(next.updated.slice(updated)).toContain(`store:${shop.slug}`);
    session.account = null;
  });
});

describe("the site's domain on the paying account, for wallets (ensurePaymentDomain)", () => {
  const domain = `pay-${run}.kaizenaflow.test`;

  it("registers it once on the store's own account, and asks Stripe nothing the second time", async () => {
    const accountId = String((await accountRow(shop.id, "live"))?.account_id);
    const mark = stripe.calls.length;
    expect(await connect.ensurePaymentDomain(shop.id, "live", accountId, domain)).toBe(true);
    expect(callsSince(mark).map((call) => [call.method, ...call.args])).toEqual([
      ["paymentMethodDomains.create", { domain_name: domain }, { stripeAccount: accountId }],
    ]);
    expect((await accountRow(shop.id, "live"))?.payment_domains).toEqual([domain]);
    const again = stripe.calls.length;
    expect(await connect.ensurePaymentDomain(shop.id, "live", accountId, domain)).toBe(true);
    expect(callsSince(again)).toEqual([]);
  });

  it("refuses an address that is no public domain, another store's account, and a mode with no keys", async () => {
    const own = String((await accountRow(shop.id, "live"))?.account_id);
    const otherAccount = String((await accountRow(other.id, "live"))?.account_id);
    const mark = stripe.calls.length;
    expect(await connect.ensurePaymentDomain(shop.id, "live", own, "localhost")).toBe(false);
    expect(await connect.ensurePaymentDomain(shop.id, "live", own, "Shop.Example.com")).toBe(false);
    expect(await connect.ensurePaymentDomain(shop.id, "live", otherAccount, "steal.example.com")).toBe(false);
    expect(await connect.ensurePaymentDomain(shop.id, "test", own, "wrong-mode.example.com")).toBe(false);
    stripe.modes.delete("live");
    try {
      expect(await connect.ensurePaymentDomain(shop.id, "live", own, "no-keys.example.com")).toBe(false);
    } finally {
      stripe.modes.add("live");
    }
    expect(callsSince(mark)).toEqual([]);
    expect((await accountRow(other.id, "live"))?.payment_domains).toEqual([]);
  });

  it("records one Stripe already had, and not one Stripe neither took nor lists", async () => {
    const accountId = String((await accountRow(other.id, "live"))?.account_id);
    stripe.domains.set(accountId, new Set([`known-${run}.example.com`]));
    expect(await connect.ensurePaymentDomain(other.id, "live", accountId, `known-${run}.example.com`)).toBe(true);
    stripe.failNext.set("paymentMethodDomains.create", new Error("Stripe is away"));
    expect(await connect.ensurePaymentDomain(other.id, "live", accountId, `away-${run}.example.com`)).toBe(false);
    expect((await accountRow(other.id, "live"))?.payment_domains).toEqual([`known-${run}.example.com`]);
  });

  it("registers it on a host's account in the host's row (D71)", async () => {
    const hostAccount = `acct_host${run}`;
    expect(await connect.ensurePaymentDomain(shop.id, "live", hostAccount, domain)).toBe(true);
    const [row] = await db().execute<Row>(sql`select payment_domains from commerce.host_stripe_accounts where account_id = ${hostAccount}`);
    expect(row.payment_domains).toEqual([domain]);
    expect((await accountRow(shop.id, "live"))?.payment_domains).toEqual([domain]);
  });
});

describe("payment methods and their display settings (ensureStorePaymentMethods)", () => {
  const SHOWN = ["card", "apple_pay", "google_pay", "klarna", "link", "mobilepay"];
  let accountId: string;
  const missing = ["ideal_payments", "sepa_debit_payments"];

  beforeAll(async () => {
    accountId = `acct_methods${run}`;
    const asked = `{${PAYMENT_CAPABILITIES.filter((capability) => !missing.includes(capability)).join(",")}}`;
    await db().execute(sql`
      insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due, managed_by_kaizen, payment_methods_requested)
      values (${methods.id}::uuid, 'test', ${accountId}, 'active', false, true, ${asked}::text[])
    `);
    stripeSays(accountId, { capabilities: { card_payments: { status: "active" }, klarna_payments: { status: "active" } }, entries: [] });
  });

  it("asks for the methods an account lacks, keeps one Stripe does not offer as asked, and says which", async () => {
    stripe.refusedCapabilities.add("ideal_payments");
    try {
      await connect.ensureStorePaymentMethods(methods.id);
    } finally {
      stripe.refusedCapabilities.clear();
    }
    const asks = stripe
      .callsOf("accounts.update")
      .filter((call) => call.args[0] === accountId && "configuration" in (call.args[1] as object))
      .map((call) => Object.keys((call.args[1] as { configuration: { merchant: { capabilities: object } } }).configuration.merchant.capabilities));
    // Together first, then one at a time (D291).
    expect(asks).toEqual([missing, ["ideal_payments"], ["sepa_debit_payments"]]);
    const row = await accountRow(methods.id, "test");
    expect(row?.payment_methods_requested).toEqual([...PAYMENT_CAPABILITIES]);
    expect(await audits(methods.id, "payments.methods_requested")).toEqual([
      expect.objectContaining({ account_id: null, details: { mode: "test", capabilities: ["sepa_debit_payments"], refused: ["ideal_payments"] } }),
    ]);
    // No display settings at Stripe yet: tried again next time.
    expect(row?.payment_methods_shown).toBe(false);
    // Stripe's answer is read back and kept.
    expect(row?.method_states).toMatchObject({ klarna_payments: { status: "active" }, sepa_debit_payments: { status: "pending" } });
  });

  it("shows Kaizena Flow's methods in the account's default settings, and says which Stripe holds back and why", async () => {
    stripe.configs.set(accountId, [
      { id: "pmc_other", is_default: false },
      { id: "pmc_default", is_default: true },
    ]);
    stripe.setMethodStates({
      card: { available: true, display_preference: { value: "on", overridable: true } },
      klarna: { available: false, display_preference: { value: "on", overridable: true } },
      mobilepay: { available: false, display_preference: { value: "off", overridable: false } },
      link: { available: false, display_preference: { value: "off", overridable: true } },
    });
    const mark = stripe.calls.length;
    await connect.ensureStorePaymentMethods(methods.id);

    // The test org number MobilePay asks for, then the display settings.
    expect(callsSince(mark, "accounts.update").map((call) => call.args[1])).toEqual([
      { identity: { business_details: { id_numbers: [{ type: "no_orgnr", value: "222222222" }] } } },
    ]);
    const shown = callsSince(mark, "pmc.update");
    expect(shown).toHaveLength(1);
    expect(shown[0].args).toEqual([
      "pmc_default",
      Object.fromEntries(SHOWN.map((method) => [method, { display_preference: { preference: "on" } }])),
      { stripeAccount: accountId },
    ]);
    expect((await accountRow(methods.id, "test"))?.payment_methods_shown).toBe(true);
    expect((await audits(methods.id, "payments.methods_shown")).map((entry) => entry.details)).toEqual([
      {
        mode: "test",
        methods: SHOWN,
        held: { klarna: "capability not active", mobilepay: "blocked by platform default", link: "off" },
      },
    ]);
  });

  it("asks Stripe nothing once an account has every method and its settings", async () => {
    const mark = stripe.calls.length;
    await connect.ensureStorePaymentMethods(methods.id);
    expect(callsSince(mark)).toEqual([]);
  });

  it("turns methods on one at a time when Stripe refuses them together, and notes a refused org number", async () => {
    const replaced = String((await accountRow(plain.id, "test"))?.account_id);
    stripe.configs.set(replaced, [{ id: "pmc_plain", is_default: true }]);
    stripe.refusedMethods.add("mobilepay");
    stripe.refuseIdentity.error = new Stripe.errors.StripeInvalidRequestError({ type: "invalid_request_error", message: "The org number is not valid." });
    const mark = stripe.calls.length;
    try {
      await connect.ensureStorePaymentMethods(plain.id);
    } finally {
      stripe.refusedMethods.clear();
      stripe.refuseIdentity.error = null;
    }
    const shown = callsSince(mark, "pmc.update").filter((call) => call.args[0] === "pmc_plain");
    // All six together (refused), then each on its own.
    expect(shown.map((call) => Object.keys(call.args[1] as object))).toEqual([SHOWN, ...SHOWN.map((method) => [method])]);
    expect((await audits(plain.id, "payments.methods_shown")).map((entry) => entry.details)).toEqual([
      { mode: "test", methods: SHOWN.filter((method) => method !== "mobilepay"), held: {} },
    ]);
    expect((await audits(plain.id, "payments.test_details_refused")).map((entry) => entry.details)).toEqual([
      { mode: "test", problem: "The org number is not valid." },
    ]);
    expect((await accountRow(plain.id, "test"))?.payment_methods_shown).toBe(true);
  });

  it("never changes the display settings of a live account the owner runs", async () => {
    const live = String((await accountRow(other.id, "live"))?.account_id);
    const mark = stripe.calls.length;
    await connect.ensureStorePaymentMethods(other.id);
    expect(callsSince(mark).filter((call) => call.method.startsWith("pmc."))).toEqual([]);
    // The methods added since it was made are asked for.
    expect(callsSince(mark, "accounts.update").map((call) => call.args[0])).toEqual([live]);
    expect((await accountRow(other.id, "live"))?.payment_methods_requested).toEqual([...PAYMENT_CAPABILITIES]);
  });
});

describe("the platform's own Stripe settings", () => {
  it("connects the platform's webhooks, keeping their secrets encrypted, and the account webhook then checks with the new one", async () => {
    const mark = stripe.calls.length;
    expect(await connect.connectPlatformWebhooks(platformAdmin, "live", "https://kaizenaflow.test")).toEqual({ ok: true });
    expect(callsSince(mark).map((call) => [call.method, ...call.args])).toEqual([["createPlatformWebhooks", "live", "https://kaizenaflow.test"]]);

    const rows = await db().execute<Row>(sql`
      select kind, url, secret_ciphertext, updated_by from commerce.platform_webhooks where provider = 'stripe' and mode = 'live' order by kind
    `);
    expect(rows.map((row) => [row.kind, row.url, row.updated_by])).toEqual([
      ["billing", "https://kaizenaflow.test/api/stripe/billing/live", platformAdmin.id],
      ["snapshot", "https://kaizenaflow.test/api/stripe/connect/live", platformAdmin.id],
      ["thin", "https://kaizenaflow.test/api/stripe/connect/live/accounts", platformAdmin.id],
    ]);
    const thin = String(await connect.getPlatformWebhookSecret("live", "thin"));
    expect(thin).toMatch(/^whsec_thin_live_/);
    for (const row of rows) expect(stripe.secrets.some((secret) => String(row.secret_ciphertext).includes(secret))).toBe(false);
    expect(decryptSecret(String(rows.find((row) => row.kind === "thin")?.secret_ciphertext), key)).toBe(thin);
    expect((await connect.listPlatformWebhooks()).filter((hook) => hook.mode === "live").map((hook) => hook.kind)).toEqual(["billing", "snapshot", "thin"]);
    expect((await audits(null, "platform.stripe_webhooks_connected")).at(-1)).toEqual({
      action: "platform.stripe_webhooks_connected",
      account_id: platformAdmin.id,
      details: { mode: "live", origin: "https://kaizenaflow.test" },
    });

    // Stripe signs with the secret it just gave: the account webhook takes it, and no longer the old one.
    const accountId = String((await accountRow(shop.id, "live"))?.account_id);
    const body = JSON.stringify({
      id: `evt_new_secret_${run}`,
      object: "v2.core.event",
      type: "v2.core.account[requirements].updated",
      created: new Date().toISOString(),
      related_object: { id: accountId, type: "v2.core.account", url: `/v2/core/accounts/${accountId}` },
    });
    const call = (secret: string) =>
      accountsWebhook(
        new Request("http://localhost/api/stripe/connect/live/accounts", {
          method: "POST",
          headers: { "stripe-signature": signer.webhooks.generateTestHeaderString({ payload: body, secret }) },
          body,
        }),
        { params: Promise.resolve({ mode: "live" }) },
      );
    expect((await call(thin)).status).toBe(200);
    expect((await call(thinSecrets.live)).status).toBe(400);
  });

  it("refuses without the encryption key, and saves nothing when Stripe refuses", async () => {
    const thin = await connect.getPlatformWebhookSecret("live", "thin");
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    const mark = stripe.calls.length;
    try {
      expect(await connect.connectPlatformWebhooks(platformAdmin, "live", "https://kaizenaflow.test")).toEqual({
        ok: false,
        problems: ["SETTINGS_ENCRYPTION_KEY is not set on the server."],
      });
      expect(await connect.getPlatformWebhookSecret("live", "thin")).toBeNull();
    } finally {
      process.env.SETTINGS_ENCRYPTION_KEY = key.toString("base64");
    }
    expect(callsSince(mark)).toEqual([]);

    stripe.webhooks.answer = { ok: false, problem: "Invalid API Key provided." };
    try {
      expect(await connect.connectPlatformWebhooks(platformAdmin, "live", "https://kaizenaflow.test")).toEqual({
        ok: false,
        problems: ["Invalid API Key provided."],
      });
    } finally {
      stripe.webhooks.answer = null;
    }
    expect(await connect.getPlatformWebhookSecret("live", "thin")).toBe(thin);
  });

  it("keeps the platform's fee on each sale between 0 and 20 %", async () => {
    for (const bps of [-1, 2001, 1.5, Number.NaN]) {
      expect(await connect.setSaleFeeBps(platformAdmin, bps)).toEqual({ ok: false, problems: ["The fee must be between 0 and 20 %."] });
    }
    expect(await connect.getSaleFeeBps()).toBe(before.saleFeeBps);
    expect(await connect.setSaleFeeBps(platformAdmin, 2000)).toEqual({ ok: true });
    expect(await connect.getSaleFeeBps()).toBe(2000);
    expect(await connect.setSaleFeeBps(platformAdmin, 0)).toEqual({ ok: true });
    expect(await connect.getSaleFeeBps()).toBe(0);
    expect((await audits(null, "platform.sale_fee_updated")).slice(-2).map((entry) => [entry.account_id, entry.details])).toEqual([
      [platformAdmin.id, { bps: 2000 }],
      [platformAdmin.id, { bps: 0 }],
    ]);
  });

  it("switches where shoppers pay, and every store's checkout facts with it", async () => {
    const tags = next.tags.length;
    expect(await connect.setCheckoutUi(platformAdmin, "hosted")).toEqual({ ok: true });
    expect(await connect.getCheckoutUi()).toBe("hosted");
    expect(next.tags.slice(tags)).toEqual(["buy-platform"]);
    expect(await connect.setCheckoutUi(platformAdmin, "custom")).toEqual({ ok: true });
    expect(await connect.getCheckoutUi()).toBe("custom");
  });

  it("are a platform admin's alone", async () => {
    const data = new FormData();
    data.append("mode", "test");
    session.account = shop.owner;
    const mark = stripe.calls.length;
    await expect(platformActions.connectWebhooksAction(idle, data)).rejects.toThrow();
    await expect(platformActions.saveCheckoutUiAction(idle, data)).rejects.toThrow();
    expect(callsSince(mark)).toEqual([]);

    session.account = platformAdmin;
    expect(await platformActions.connectWebhooksAction(idle, data)).toEqual({ status: "ok", messages: ["Stripe sends test events to Kaizena Flow now."] });
    expect(callsSince(mark).map((call) => call.args)).toEqual([["test", request.origin]]);
    session.account = null;
  });
});

describe("what Stripe Connect writes down", () => {
  it("never puts a secret or a person's address in the log or the activity log", async () => {
    const said = [
      ...logs.map((entry) => entry.line),
      ...(await db().execute<Row>(sql`
        select details::text as details from commerce.audit_log
        where (store_id = any(${`{${[shop.id, other.id, plain.id, press.id, methods.id].join(",")}}`}::uuid[]) and action like 'payments.%')
           or action in ('platform.stripe_webhooks_connected', 'platform.sale_fee_updated', 'platform.checkout_ui_updated')
      `)).map((row) => String(row.details)),
    ].join("\n");
    expect(stripe.secrets.length).toBeGreaterThan(4);
    for (const secret of [...stripe.secrets, ...Object.values(thinSecrets), "sk_test", "sk_live", "@example.com"]) expect(said).not.toContain(secret);
  });
});
