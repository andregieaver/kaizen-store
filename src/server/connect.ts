import "server-only";

import { sql } from "drizzle-orm";
import Stripe from "stripe";

import { db } from "@/db/client";
import { decryptSecret, encryptSecret, parseKey } from "@/lib/secret-box";
import { accountStatus, type AccountStatus, type PaymentModeName } from "@/lib/stripe-account";

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
    const test = await ensureTestAccount(store.id, account.id);
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
          merchant: { capabilities: { card_payments: { requested: true } } },
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
    insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due, created_by)
    values (${store.id}::uuid, ${mode}, ${created.id}, ${status.cardPayments}, ${status.requirementsDue},
            ${account.id}::uuid)
    on conflict (store_id, mode) do nothing
  `);
  await audit(account.id, store.id, "payments.stripe_account_created", { mode, accountId: created.id });
  return { ok: true };
}

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
} as const;

/**
 * The store's test Stripe account, set up by Kaizen with no questions to the
 * owner (decision D20): Kaizen fills in Stripe's test values and accepts the
 * service agreement, so test purchases land in the store's own test account
 * straight away. Stripe's real checks come only with the live account.
 * An older test account that waits for the owner's details is replaced.
 */
export async function ensureTestAccount(
  storeId: string,
  actorId: string | null = null,
  ip = "127.0.0.1",
): Promise<{ ok: true; accountId: string; ready: boolean } | { ok: false; problem: string }> {
  const stripe = platformStripe("test");
  if (!stripe) return { ok: false, problem: "Test payments are not available yet." };

  const saved = (await getStripeAccounts(storeId)).test;
  if (saved?.cardPayments === "active") return { ok: true, accountId: saved.accountId, ready: true };
  if (saved) {
    try {
      const existing = await stripe.v2.core.accounts.retrieve(saved.accountId, { include: INCLUDE });
      if (existing.dashboard === "none") {
        // Ours, and Stripe is still checking the test details (seconds).
        const status = await saveStatus(storeId, "test", existing);
        return { ok: true, accountId: saved.accountId, ready: status.cardPayments === "active" };
      }
    } catch (error) {
      return { ok: false, problem: stripeProblem(error) };
    }
  }

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
              account: { date: new Date().toISOString(), ip, user_agent: "Kaizen test setup" },
            },
          },
        },
        configuration: {
          customer: {},
          merchant: { mcc: "5999", capabilities: { card_payments: { requested: true } } },
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
      { idempotencyKey: `kaizen-test-account-${storeId}` },
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
      { idempotencyKey: `kaizen-test-bank-${storeId}` },
    );
  } catch (error) {
    return { ok: false, problem: stripeProblem(error) };
  }

  const fresh = await stripe.v2.core.accounts.retrieve(created.id, { include: INCLUDE }).catch(() => created);
  const status = accountStatus(fresh);
  await db().execute(sql`
    insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due, created_by)
    values (${storeId}::uuid, 'test', ${created.id}, ${status.cardPayments}, ${status.requirementsDue},
            ${actorId}::uuid)
    on conflict (store_id, mode) do update set
      account_id = excluded.account_id, card_payments = excluded.card_payments,
      requirements_due = excluded.requirements_due, updated_at = now()
  `);
  await audit(actorId, storeId, "payments.test_account_created", { accountId: created.id, replaced: saved?.accountId ?? null });
  return { ok: true, accountId: created.id, ready: status.cardPayments === "active" };
}

async function saveStatus(storeId: string, mode: PaymentModeName, account: Stripe.V2.Core.Account) {
  const status = accountStatus(account);
  await db().execute(sql`
    update commerce.stripe_accounts
       set card_payments = ${status.cardPayments}, requirements_due = ${status.requirementsDue}, updated_at = now()
     where store_id = ${storeId}::uuid and mode = ${mode}
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
    status = accountStatus(await stripe.v2.core.accounts.retrieve(saved.accountId, { include: INCLUDE }));
  } catch {
    return null;
  }
  await db().execute(sql`
    update commerce.stripe_accounts
       set card_payments = ${status.cardPayments}, requirements_due = ${status.requirementsDue}, updated_at = now()
     where store_id = ${storeId}::uuid and mode = ${mode}
  `);
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
