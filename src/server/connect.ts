import "server-only";

import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import Stripe from "stripe";

import { db } from "@/db/client";
import { decryptSecret, encryptSecret, parseKey } from "@/lib/secret-box";
import { accountStatus, requirementNotes, type AccountStatus, type PaymentModeName } from "@/lib/stripe-account";

import { audit, type Account, type Membership } from "./auth";
import type { SaveResult } from "./settings";
import { createPlatformWebhooks, platformStripe, type WebhookKind } from "./stripe";

type Row = Record<string, unknown>;

const encryptionKey = () => parseKey(process.env.SETTINGS_ENCRYPTION_KEY);

export type StripeAccount = AccountStatus & { mode: PaymentModeName; accountId: string };

const toAccount = (row: Row): StripeAccount => ({
  mode: row.mode as PaymentModeName,
  accountId: String(row.account_id),
  cardPayments: String(row.card_payments),
  requirementsDue: Boolean(row.requirements_due),
});

/** The store's connected Stripe accounts, by mode. */
export async function getStripeAccounts(
  storeId: string,
): Promise<Partial<Record<PaymentModeName, StripeAccount>>> {
  const rows = await db().execute<Row>(sql`
    select mode, account_id, card_payments, requirements_due from commerce.stripe_accounts
    where store_id = ${storeId}::uuid
  `);
  return Object.fromEntries(rows.map((row) => [row.mode, toAccount(row)]));
}

/** The store a connected account belongs to. */
export async function storeForAccount(
  mode: PaymentModeName,
  accountId: string,
): Promise<{ storeId: string; slug: string } | null> {
  const [row] = await db().execute<Row>(sql`
    select a.store_id, s.slug from commerce.stripe_accounts a
    join commerce.stores s on s.id = a.store_id
    where a.mode = ${mode} and a.account_id = ${accountId}
  `);
  return row ? { storeId: String(row.store_id), slug: String(row.slug) } : null;
}

const INCLUDE: Stripe.V2.Core.AccountRetrieveParams.Include[] = ["configuration.merchant", "requirements"];

function stripeProblem(error: unknown): string {
  return error instanceof Stripe.errors.StripeError ? error.message : "Stripe could not be reached.";
}

/**
 * Creates the store's own Stripe account for a mode, the way Stripe advises
 * for Shopify-like platforms: the store has the full Stripe Dashboard, pays
 * Stripe's fees itself, and Stripe carries negative balances. Payments are
 * direct charges on it (the store is the seller). Does nothing if the store
 * already has one.
 */
export async function createStripeAccount(
  { account, store }: Pick<Membership, "account" | "store">,
  mode: PaymentModeName,
  storeUrl: string,
): Promise<SaveResult> {
  // Test accounts are set up by Kaizen with Stripe's test values (D20).
  if (mode === "test") {
    const test = await ensureTestAccount(store.id, account.id, await requestIp());
    return test.ok ? { ok: true } : { ok: false, problems: [test.problem] };
  }
  const stripe = platformStripe(mode);
  if (!stripe) return { ok: false, problems: [`Payments in ${mode} mode are not available yet.`] };
  if ((await getStripeAccounts(store.id))[mode]) return { ok: true };

  const d = store.details;
  const currency = store.markets[0]?.currency.toLowerCase();
  let created: Stripe.V2.Core.Account;
  try {
    created = await stripe.v2.core.accounts.create(
      {
        display_name: store.name,
        contact_email: d.contactEmail ?? account.email,
        dashboard: "full",
        ...(d.country && {
          identity: {
            country: d.country.toLowerCase(),
            ...(d.legalName && { business_details: { registered_name: d.legalName } }),
          },
        }),
        configuration: {
          // Customer: so Kaizen can bill the store for its plan later.
          customer: {},
          merchant: { capabilities: requestedCapabilities() },
        },
        defaults: {
          ...(currency && { currency }),
          responsibilities: { fees_collector: "stripe", losses_collector: "stripe" },
          // Stripe only accepts a public address (not localhost).
          ...(storeUrl.startsWith("https://") && { profile: { business_url: storeUrl } }),
        },
        metadata: { store_id: store.id, store_slug: store.slug },
        include: INCLUDE,
      },
      // Two clicks, or a retry, must not create two accounts.
      { idempotencyKey: `kaizen-account-${store.id}-${mode}` },
    );
  } catch (error) {
    return { ok: false, problems: [stripeProblem(error)] };
  }

  const status = accountStatus(created);
  await db().execute(sql`
    insert into commerce.stripe_accounts
      (store_id, mode, account_id, card_payments, requirements_due, payment_methods_requested, created_by)
    values (${store.id}::uuid, ${mode}, ${created.id}, ${status.cardPayments}, ${status.requirementsDue},
            ${CAPABILITY_LIST}::text[], ${account.id}::uuid)
    on conflict (store_id, mode) do nothing
  `);
  await audit(account.id, store.id, "payments.stripe_account_created", { mode, accountId: created.id });
  return { ok: true };
}

/** Where the person making this request is, as the host reports it. */
export async function requestIp(): Promise<string> {
  try {
    return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
  } catch {
    return "127.0.0.1"; // Not in a request (scripts, tests).
  }
}

/**
 * The payment methods Kaizen asks Stripe to switch on for every store's
 * account (D23): cards (with Apple Pay and Google Pay), Klarna, Link and
 * MobilePay. Stripe offers each where it fits the shopper's country and
 * currency. Swish and Vipps follow once Stripe opens them to Kaizen.
 */
export const PAYMENT_CAPABILITIES = ["card_payments", "klarna_payments", "link_payments", "mobilepay_payments"] as const;

/** The same, as a Postgres array literal for queries. */
const CAPABILITY_LIST = `{${PAYMENT_CAPABILITIES.join(",")}}`;

const requestedCapabilities = () =>
  Object.fromEntries(PAYMENT_CAPABILITIES.map((capability) => [capability, { requested: true }])) as Record<
    (typeof PAYMENT_CAPABILITIES)[number],
    { requested: true }
  >;

/**
 * Stripe's test values that pass verification at once (docs.stripe.com/connect/testing):
 * a matching date of birth and address, a verified website, a Norwegian test
 * bank account whose payouts succeed.
 */
const TEST_IDENTITY = {
  dateOfBirth: { day: 1, month: 1, year: 1901 },
  address: { line1: "address_full_match", city: "Oslo", postal_code: "0150", country: "no" },
  website: "https://accessible.stripe.com",
  iban: "NO9386011117947",
  /** A business ID that matches at once; MobilePay asks for a Norwegian org number. */
  orgnr: "222222222",
} as const;

const testBusinessDetails = { id_numbers: [{ type: "no_orgnr" as const, value: TEST_IDENTITY.orgnr }] };

/**
 * The store's test Stripe account, set up by Kaizen with no questions to the
 * owner (decision D20): Kaizen fills in Stripe's test values and accepts the
 * service agreement, so test purchases land in the store's own test account
 * straight away. Stripe's real checks come only with the live account.
 * An older test account that waits for the owner's details is replaced.
 *
 * `ip` is where the owner is (the service agreement needs one); without it
 * (checkout) an account Kaizen made is only brought up to date, not created.
 */
export async function ensureTestAccount(
  storeId: string,
  actorId: string | null = null,
  ip: string | null = null,
): Promise<{ ok: true; accountId: string; ready: boolean } | { ok: false; problem: string }> {
  const stripe = platformStripe("test");
  if (!stripe) return { ok: false, problem: "Test payments are not available yet." };

  const [saved] = await db().execute<Row>(sql`
    select account_id, card_payments, managed_by_kaizen from commerce.stripe_accounts
    where store_id = ${storeId}::uuid and mode = 'test'
  `);
  if (saved?.card_payments === "active") return { ok: true, accountId: String(saved.account_id), ready: true };
  if (saved?.managed_by_kaizen) {
    // Ours: Stripe checks the test details within a minute or two.
    try {
      const existing = await stripe.v2.core.accounts.retrieve(String(saved.account_id), { include: INCLUDE });
      const status = await saveStatus(storeId, "test", existing);
      return { ok: true, accountId: existing.id, ready: status.cardPayments === "active" };
    } catch (error) {
      return { ok: false, problem: stripeProblem(error) };
    }
  }
  if (!ip) return { ok: false, problem: "The store's test account is not set up yet." };

  const [store] = await db().execute<Row>(sql`
    select s.id, s.slug, s.name, s.country, coalesce(s.contact_email, (
      select a.email from commerce.store_members m join commerce.accounts a on a.id = m.account_id
      where m.store_id = s.id and m.role = 'owner' and m.disabled_at is null order by m.created_at limit 1
    )) as email,
    (select m.currency from commerce.markets m where m.store_id = s.id and m.active
      order by (m.code = s.country) desc nulls last, m.created_at limit 1) as currency
    from commerce.stores s where s.id = ${storeId}::uuid
  `);
  if (!store) return { ok: false, problem: "Unknown store." };
  const email = store.email ? String(store.email) : "test@kaizenstore.cloud";
  // Admin pages opened together ask at the same time: the same minute and
  // place give the same request, which Stripe answers with one account.
  const minute = Math.floor(Date.now() / 60_000) * 60_000;

  let created: Stripe.V2.Core.Account;
  try {
    created = await stripe.v2.core.accounts.create(
      {
        display_name: `${String(store.name)} (test)`,
        contact_email: email,
        // Kaizen collects the (test) details, so there is no Stripe login.
        dashboard: "none",
        identity: {
          country: "no",
          entity_type: "individual",
          business_details: testBusinessDetails,
          individual: {
            given_name: "Kaizen",
            surname: "Test",
            email,
            phone: "+4722222222",
            date_of_birth: TEST_IDENTITY.dateOfBirth,
            address: TEST_IDENTITY.address,
          },
          attestations: {
            terms_of_service: {
              account: { date: new Date(minute).toISOString(), ip, user_agent: "Kaizen test setup" },
            },
          },
        },
        configuration: {
          customer: {},
          merchant: { mcc: "5999", capabilities: requestedCapabilities() },
        },
        defaults: {
          currency: String(store.currency ?? "NOK").toLowerCase(),
          responsibilities: { fees_collector: "application", losses_collector: "application" },
          profile: {
            business_url: TEST_IDENTITY.website,
            product_description: `Test store for ${String(store.name)} on Kaizen`,
          },
        },
        metadata: { store_id: storeId, store_slug: String(store.slug), kaizen_test_account: "true" },
        include: INCLUDE,
      },
      { idempotencyKey: `kaizen-test-account-${storeId}-${minute}-${ip}` },
    );
    await stripe.accounts.createExternalAccount(
      created.id,
      {
        external_account: {
          object: "bank_account",
          country: "NO",
          currency: "nok",
          account_number: TEST_IDENTITY.iban,
        },
      },
      { idempotencyKey: `kaizen-test-bank-${created.id}` },
    );
  } catch (error) {
    return { ok: false, problem: stripeProblem(error) };
  }

  const fresh = await stripe.v2.core.accounts.retrieve(created.id, { include: INCLUDE }).catch(() => created);
  const status = accountStatus(fresh);
  await db().execute(sql`
    insert into commerce.stripe_accounts
      (store_id, mode, account_id, card_payments, requirements_due, requirements, managed_by_kaizen,
       payment_methods_requested, created_by)
    values (${storeId}::uuid, 'test', ${created.id}, ${status.cardPayments}, ${status.requirementsDue},
            ${JSON.stringify(requirementNotes(fresh))}::jsonb, true,
            ${CAPABILITY_LIST}::text[], ${actorId}::uuid)
    on conflict (store_id, mode) do update set
      account_id = excluded.account_id, card_payments = excluded.card_payments,
      requirements_due = excluded.requirements_due, requirements = excluded.requirements,
      managed_by_kaizen = true, payment_methods_requested = excluded.payment_methods_requested,
      -- A new account has no domains registered and no display settings changed yet.
      payment_domains = '{}', payment_methods_shown = false, updated_at = now()
  `);
  const replaced = saved && saved.account_id !== created.id ? String(saved.account_id) : null;
  await audit(actorId, storeId, "payments.test_account_created", { accountId: created.id, replaced });
  return { ok: true, accountId: created.id, ready: status.cardPayments === "active" };
}

async function saveStatus(storeId: string, mode: PaymentModeName, account: Stripe.V2.Core.Account) {
  const status = accountStatus(account);
  await db().execute(sql`
    update commerce.stripe_accounts
       set card_payments = ${status.cardPayments}, requirements_due = ${status.requirementsDue},
           requirements = ${JSON.stringify(requirementNotes(account))}::jsonb, updated_at = now()
     where store_id = ${storeId}::uuid and mode = ${mode} and account_id = ${account.id}
  `);
  return status;
}

/**
 * Reads the account's state from Stripe and saves it. Null if the store has
 * no account in that mode or Stripe could not be asked.
 */
export async function refreshStripeAccount(
  storeId: string,
  mode: PaymentModeName,
): Promise<StripeAccount | null> {
  const stripe = platformStripe(mode);
  const saved = (await getStripeAccounts(storeId))[mode];
  if (!stripe || !saved) return null;
  let status: AccountStatus;
  try {
    status = await saveStatus(storeId, mode, await stripe.v2.core.accounts.retrieve(saved.accountId, { include: INCLUDE }));
  } catch {
    return null;
  }
  return { ...saved, ...status };
}

/**
 * A short-lived secret for Stripe's embedded components (onboarding, account
 * details, notices) for the store's account. Owners only: it opens the
 * account's business and bank details.
 */
export async function createAccountSession(
  storeId: string,
  mode: PaymentModeName,
): Promise<{ ok: true; clientSecret: string } | { ok: false; problem: string }> {
  const stripe = platformStripe(mode);
  const saved = (await getStripeAccounts(storeId))[mode];
  if (!stripe || !saved) return { ok: false, problem: "Set up your Stripe account first." };
  try {
    const session = await stripe.accountSessions.create({
      account: saved.accountId,
      components: {
        account_onboarding: { enabled: true },
        account_management: { enabled: true },
        notification_banner: { enabled: true },
      },
    });
    return { ok: true, clientSecret: session.client_secret };
  } catch (error) {
    return { ok: false, problem: stripeProblem(error) };
  }
}

// ---------------------------------------------------------------------------
// Platform: webhooks and fee
// ---------------------------------------------------------------------------

export type PlatformWebhook = { mode: PaymentModeName; kind: WebhookKind; url: string; updatedAt: string };

export async function listPlatformWebhooks(): Promise<PlatformWebhook[]> {
  const rows = await db().execute<Row>(sql`
    select mode, kind, url, updated_at from commerce.platform_webhooks where provider = 'stripe'
    order by mode, kind
  `);
  return rows.map((row) => ({
    mode: row.mode as PaymentModeName,
    kind: row.kind as WebhookKind,
    url: String(row.url),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }));
}

/** The signing secret for one of Kaizen's Connect webhooks, or null. */
export async function getPlatformWebhookSecret(mode: PaymentModeName, kind: WebhookKind): Promise<string | null> {
  const key = encryptionKey();
  if (!key) return null;
  const [row] = await db().execute<Row>(sql`
    select secret_ciphertext from commerce.platform_webhooks
    where provider = 'stripe' and mode = ${mode} and kind = ${kind}
  `);
  return row ? decryptSecret(String(row.secret_ciphertext), key) : null;
}

/** Creates Kaizen's webhooks in its Stripe account and saves their secrets. */
export async function connectPlatformWebhooks(
  account: Account,
  mode: PaymentModeName,
  origin: string,
): Promise<SaveResult> {
  const key = encryptionKey();
  if (!key) return { ok: false, problems: ["SETTINGS_ENCRYPTION_KEY is not set on the server."] };
  const created = await createPlatformWebhooks(mode, origin);
  if (!created.ok) return { ok: false, problems: [created.problem] };
  for (const hook of created.webhooks) {
    await db().execute(sql`
      insert into commerce.platform_webhooks (provider, mode, kind, endpoint_id, url, secret_ciphertext, updated_by)
      values ('stripe', ${mode}, ${hook.kind}, ${hook.endpointId}, ${hook.url},
              ${encryptSecret(hook.secret, key)}, ${account.id}::uuid)
      on conflict (provider, mode, kind) do update set
        endpoint_id = excluded.endpoint_id, url = excluded.url,
        secret_ciphertext = excluded.secret_ciphertext,
        updated_at = now(), updated_by = excluded.updated_by
    `);
  }
  await audit(account.id, null, "platform.stripe_webhooks_connected", { mode, origin });
  return { ok: true };
}

/** Kaizen's fee on each sale, in basis points. */
export async function getSaleFeeBps(): Promise<number> {
  const [row] = await db().execute<Row>(sql`select sale_fee_bps from commerce.platform_settings`);
  return Number(row?.sale_fee_bps ?? 0);
}

export async function setSaleFeeBps(account: Account, bps: number): Promise<SaveResult> {
  if (!Number.isInteger(bps) || bps < 0 || bps > 2000) {
    return { ok: false, problems: ["The fee must be between 0 and 20 %."] };
  }
  await db().execute(sql`
    update commerce.platform_settings set sale_fee_bps = ${bps}, updated_at = now(), updated_by = ${account.id}::uuid
  `);
  await audit(account.id, null, "platform.sale_fee_updated", { bps });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Kaizen's checkout page (decision D22)
// ---------------------------------------------------------------------------

export type CheckoutUi = "custom" | "hosted";

/** Where shoppers pay: Kaizen's own checkout page, or Stripe's page as a fallback. */
export async function getCheckoutUi(): Promise<CheckoutUi> {
  const [row] = await db().execute<Row>(sql`select checkout_ui from commerce.platform_settings`);
  return row?.checkout_ui === "hosted" ? "hosted" : "custom";
}

export async function setCheckoutUi(account: Account, ui: CheckoutUi): Promise<SaveResult> {
  await db().execute(sql`
    update commerce.platform_settings set checkout_ui = ${ui}, updated_at = now(), updated_by = ${account.id}::uuid
  `);
  await audit(account.id, null, "platform.checkout_ui_updated", { ui });
  return { ok: true };
}

/**
 * Registers the site's domain on the store's Stripe account, once, so Apple
 * Pay, Google Pay, Link and Klarna can show in Stripe's form on Kaizen's
 * checkout page (Stripe needs this per account for direct charges). A
 * failure only hides those methods; the checkout goes on.
 */
export async function ensurePaymentDomain(
  storeId: string,
  mode: PaymentModeName,
  accountId: string,
  domain: string,
): Promise<boolean> {
  const stripe = platformStripe(mode);
  if (!stripe || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return false;
  const [row] = await db().execute<Row>(sql`
    select ${domain} = any(payment_domains) as done from commerce.stripe_accounts
    where store_id = ${storeId}::uuid and mode = ${mode} and account_id = ${accountId}
  `);
  if (!row) return false;
  if (row.done) return true;
  try {
    await stripe.paymentMethodDomains.create({ domain_name: domain }, { stripeAccount: accountId });
  } catch {
    // Already registered (Stripe refuses a second time), or Stripe is away.
    const found = await stripe.paymentMethodDomains
      .list({ domain_name: domain, limit: 1 }, { stripeAccount: accountId })
      .catch(() => null);
    if (!found?.data.length) return false;
  }
  await db().execute(sql`
    update commerce.stripe_accounts set payment_domains = array_append(payment_domains, ${domain})
    where store_id = ${storeId}::uuid and mode = ${mode} and account_id = ${accountId}
      and not ${domain} = any(payment_domains)
  `);
  return true;
}

/** Shown to shoppers on Kaizen-made test accounts; owners of live accounts choose in their own Stripe Dashboard. */
const SHOWN_METHODS = ["card", "apple_pay", "google_pay", "klarna", "link", "mobilepay"] as const;

/**
 * Asks Stripe for any of Kaizen's payment methods that the store's accounts
 * do not have yet (accounts made before a method was added), and on the
 * test accounts Kaizen made, switches them on in the account's display
 * settings (which otherwise follow the platform's defaults). Runs in the
 * background; what Stripe refuses is tried again next time.
 */
export async function ensureStorePaymentMethods(storeId: string): Promise<void> {
  const rows = await db().execute<Row>(sql`
    select mode, account_id, payment_methods_requested, managed_by_kaizen, payment_methods_shown
    from commerce.stripe_accounts
    where store_id = ${storeId}::uuid
      and (not payment_methods_requested @> ${CAPABILITY_LIST}::text[]
           or (managed_by_kaizen and not payment_methods_shown))
  `);
  for (const row of rows) {
    const mode = row.mode as PaymentModeName;
    const accountId = String(row.account_id);
    const stripe = platformStripe(mode);
    if (!stripe) continue;
    const where = sql`store_id = ${storeId}::uuid and mode = ${mode} and account_id = ${accountId}`;

    const asked = new Set(row.payment_methods_requested as string[]);
    const missing = PAYMENT_CAPABILITIES.filter((capability) => !asked.has(capability));
    if (missing.length > 0) {
      const done = await stripe.v2.core.accounts
        .update(accountId, {
          configuration: {
            merchant: {
              capabilities: Object.fromEntries(missing.map((capability) => [capability, { requested: true }])),
            },
          },
        })
        .then(
          () => true,
          () => false,
        );
      if (done) {
        await db().execute(sql`
          update commerce.stripe_accounts set payment_methods_requested = ${CAPABILITY_LIST}::text[], updated_at = now()
          where ${where}
        `);
        await audit(null, storeId, "payments.methods_requested", { mode, capabilities: missing });
      }
    }

    if (row.managed_by_kaizen && !row.payment_methods_shown) {
      // Test accounts made before MobilePay lack the org number it asks for.
      await stripe.v2.core.accounts
        .update(accountId, { identity: { business_details: testBusinessDetails } })
        .catch(() => null);
      const shown = await showPaymentMethods(stripe, accountId);
      if (shown.length > 0) {
        await db().execute(sql`update commerce.stripe_accounts set payment_methods_shown = true where ${where}`);
        await audit(null, storeId, "payments.methods_shown", { mode, methods: shown });
      }
    }

    // Read the account back, so what Stripe still wants for the new methods is on record.
    const account = await stripe.v2.core.accounts.retrieve(accountId, { include: INCLUDE }).catch(() => null);
    if (account) await saveStatus(storeId, mode, account);
  }
}

/** Turns Kaizen's payment methods on in the account's default display settings; returns those it could. */
async function showPaymentMethods(stripe: Stripe, stripeAccount: string): Promise<string[]> {
  const configs = await stripe.paymentMethodConfigurations.list({ limit: 20 }, { stripeAccount }).catch(() => null);
  const config = configs?.data.find((c) => c.is_default) ?? configs?.data[0];
  if (!config) return [];
  const on = { display_preference: { preference: "on" as const } };
  try {
    await stripe.paymentMethodConfigurations.update(
      config.id,
      Object.fromEntries(SHOWN_METHODS.map((method) => [method, on])),
      { stripeAccount },
    );
    return [...SHOWN_METHODS];
  } catch {
    // One method may not be offered to this account: turn on the others one by one.
    const shown: string[] = [];
    for (const method of SHOWN_METHODS) {
      const ok = await stripe.paymentMethodConfigurations
        .update(config.id, { [method]: on }, { stripeAccount })
        .then(
          () => true,
          () => false,
        );
      if (ok) shown.push(method);
    }
    return shown;
  }
}
