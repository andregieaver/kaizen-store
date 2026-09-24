import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { decryptSecret, parseKey } from "@/lib/secret-box";
import { accountStage, type PaymentModeName } from "@/lib/stripe-account";

import { audit, type Membership, type Role } from "./auth";
import { getStripeAccounts, type StripeAccount } from "./connect";
import { platformModes } from "./stripe";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/** The key that encrypts payment secrets, or null if the server lacks one. */
export function encryptionKey(): Buffer | null {
  return parseKey(process.env.SETTINGS_ENCRYPTION_KEY);
}

export type PaymentSettings = {
  stripe: { enabled: boolean; activeMode: PaymentModeName; orderInvoices: boolean };
  /** The store's own Stripe accounts (Connect), by mode. */
  accounts: Partial<Record<PaymentModeName, StripeAccount>>;
  /** The modes Kaizen can take payments in (its platform keys are set). */
  modes: PaymentModeName[];
};

export async function getPaymentSettings(store: Store): Promise<PaymentSettings> {
  const [[provider], accounts] = await Promise.all([
    db().execute<Row>(sql`
      select enabled, active_mode, order_invoices from commerce.payment_providers
      where store_id = ${store.id}::uuid and provider = 'stripe'
    `),
    getStripeAccounts(store.id),
  ]);
  return {
    stripe: {
      enabled: Boolean(provider?.enabled),
      activeMode: (provider?.active_mode ?? "test") as PaymentModeName,
      orderInvoices: Boolean(provider?.order_invoices),
    },
    accounts,
    modes: platformModes(),
  };
}

export type SaveResult = { ok: true; note?: string } | { ok: false; problems: string[] };

/** Turns payments on or off, chooses test or live, and whether orders get an invoice. */
export async function setStripeProvider(
  { account, store }: Membership,
  enabled: boolean,
  activeMode: PaymentModeName,
  orderInvoices: boolean,
): Promise<SaveResult> {
  // Test payments need no Stripe account of the store's own (decision D20).
  if (enabled && activeMode === "live") {
    const accounts = await getStripeAccounts(store.id);
    if (accountStage(accounts[activeMode] ?? null) !== "ready") {
      return {
        ok: false,
        problems: [`Finish setting up your ${activeMode === "live" ? "live" : "test"} Stripe account first.`],
      };
    }
  }
  await db().execute(sql`
    update commerce.payment_providers
       set enabled = ${enabled}, active_mode = ${activeMode}, order_invoices = ${orderInvoices},
           updated_at = now(), updated_by = ${account.id}::uuid
     where store_id = ${store.id}::uuid and provider = 'stripe'
  `);
  await audit(account.id, store.id, "payments.provider_updated", {
    provider: "stripe",
    enabled,
    activeMode,
    orderInvoices,
  });
  return { ok: true };
}

export type CheckoutAccount = {
  mode: PaymentModeName;
  /** The store's own Stripe account; null in test mode until Kaizen has set it up. */
  accountId: string | null;
  orderInvoices: boolean;
};

/**
 * The store's Stripe account to take a payment on, if payments are switched
 * on. Live payments need the store's own account, verified by Stripe. In test
 * mode payments are on even before the test account is ready (accountId
 * null): Kaizen sets that account up itself, with no details from the owner
 * (decision D20).
 */
export async function getCheckoutAccount(storeId: string): Promise<CheckoutAccount | null> {
  const [row] = await db().execute<Row>(sql`
    select p.active_mode, p.order_invoices, a.account_id
    from commerce.payment_providers p
    left join commerce.stripe_accounts a
      on a.store_id = p.store_id and a.mode = p.active_mode and a.card_payments = 'active'
    where p.store_id = ${storeId}::uuid and p.provider = 'stripe' and p.enabled
      and (p.active_mode = 'test' or a.account_id is not null)
  `);
  return row
    ? {
        mode: row.active_mode as PaymentModeName,
        accountId: row.account_id ? String(row.account_id) : null,
        orderInvoices: Boolean(row.order_invoices),
      }
    : null;
}

export type AuditEntry = {
  id: number;
  action: string;
  email: string | null;
  details: Record<string, unknown>;
  createdAt: string;
};

export async function recentAudit(storeId: string, limit = 20): Promise<AuditEntry[]> {
  const rows = await db().execute<Row>(sql`
    select a.id, a.action, acc.email, a.details, a.created_at
    from commerce.audit_log a
    left join commerce.accounts acc on acc.id = a.account_id
    where a.store_id = ${storeId}::uuid
    order by a.id desc
    limit ${limit}
  `);
  return rows.map((row) => ({
    id: Number(row.id),
    action: String(row.action),
    email: row.email ? String(row.email) : null,
    details: (row.details ?? {}) as Record<string, unknown>,
    createdAt: new Date(String(row.created_at)).toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export type StaffMember = {
  accountId: string;
  email: string;
  role: Role;
  signedInBefore: boolean;
  disabled: boolean;
};

export async function listStaff(storeId: string): Promise<StaffMember[]> {
  const rows = await db().execute<Row>(sql`
    select a.id, a.email, m.role, a.auth_user_id is not null as linked,
           (m.disabled_at is not null or a.disabled_at is not null) as disabled
    from commerce.store_members m
    join commerce.accounts a on a.id = m.account_id
    where m.store_id = ${storeId}::uuid
    order by disabled, m.role, lower(a.email)
  `);
  return rows.map((row) => ({
    accountId: String(row.id),
    email: String(row.email),
    role: row.role as Role,
    signedInBefore: Boolean(row.linked),
    disabled: Boolean(row.disabled),
  }));
}

/** Gives someone access to the store, creating their account if needed. */
export async function inviteStaff(
  { account, store }: Membership,
  email: string,
  role: Role,
): Promise<SaveResult> {
  const result = await db().transaction(async (tx) => {
    const [invitee] = await tx.execute<Row>(sql`
      insert into commerce.accounts (email) values (${email})
      on conflict ((lower(email))) do update set email = commerce.accounts.email
      returning id, disabled_at
    `);
    if (invitee.disabled_at) return "disabled" as const;

    const [existing] = await tx.execute<Row>(sql`
      select disabled_at from commerce.store_members
      where store_id = ${store.id}::uuid and account_id = ${String(invitee.id)}::uuid
    `);
    if (existing && !existing.disabled_at) return "member" as const;

    await tx.execute(sql`
      insert into commerce.store_members (store_id, account_id, role, invited_by)
      values (${store.id}::uuid, ${String(invitee.id)}::uuid, ${role}, ${account.id}::uuid)
      on conflict (store_id, account_id) do update set
        role = excluded.role, disabled_at = null, invited_by = excluded.invited_by
    `);
    return "invited" as const;
  });

  if (result === "member") return { ok: false, problems: [`${email} already has access.`] };
  if (result === "disabled") {
    return { ok: false, problems: [`${email} cannot be invited. Contact support.`] };
  }
  await audit(account.id, store.id, "staff.invited", { email, role });
  return { ok: true };
}

export async function disableStaff(
  { account, store }: Membership,
  accountId: string,
): Promise<SaveResult> {
  if (accountId === account.id) {
    return { ok: false, problems: ["You cannot remove your own access."] };
  }
  try {
    const [row] = await db().execute<Row>(sql`
      update commerce.store_members m set disabled_at = now()
      from commerce.accounts a
      where m.store_id = ${store.id}::uuid and m.account_id = ${accountId}::uuid
        and m.disabled_at is null and a.id = m.account_id
      returning a.email
    `);
    if (row) await audit(account.id, store.id, "staff.disabled", { email: String(row.email) });
    return { ok: true };
  } catch {
    return { ok: false, problems: ["The store must keep at least one active owner."] };
  }
}

/**
 * The store's own webhook signing secrets (test and live), decrypted: only
 * for payments started before Kaizen moved to Stripe Connect.
 */
export async function getWebhookSecrets(storeId: string): Promise<string[]> {
  const key = encryptionKey();
  if (!key) return [];
  const rows = await db().execute<Row>(sql`
    select webhook_secret_ciphertext from commerce.payment_credentials
    where store_id = ${storeId}::uuid and provider = 'stripe' and webhook_secret_ciphertext is not null
  `);
  return rows.map((row) => decryptSecret(String(row.webhook_secret_ciphertext), key));
}

/** The store's own Stripe secret keys, for sessions started before Connect. */
export async function getStripeSecrets(storeId: string): Promise<string[]> {
  const key = encryptionKey();
  if (!key) return [];
  const rows = await db().execute<Row>(sql`
    select secret_key_ciphertext from commerce.payment_credentials
    where store_id = ${storeId}::uuid and provider = 'stripe' and secret_key_ciphertext is not null
  `);
  return rows.map((row) => decryptSecret(String(row.secret_key_ciphertext), key));
}

export type ShippingSetting = {
  marketCode: string;
  currency: string;
  amountMinor: number | null;
  freeOverMinor: number | null;
};

/** Shipping per market: null amount where none is set yet. */
export async function getShippingSettings(store: Store): Promise<ShippingSetting[]> {
  const rows = await db().execute<Row>(sql`
    select market_code, amount_minor, free_over_minor from commerce.shipping_rates
    where store_id = ${store.id}::uuid
  `);
  const byMarket = new Map(rows.map((row) => [String(row.market_code), row]));
  return store.markets.map((market) => {
    const row = byMarket.get(market.code);
    return {
      marketCode: market.code,
      currency: market.currency,
      amountMinor: row ? Number(row.amount_minor) : null,
      freeOverMinor: row?.free_over_minor == null ? null : Number(row.free_over_minor),
    };
  });
}

export async function saveShippingSettings(
  { account, store }: Membership,
  rates: { marketCode: string; amountMinor: number; freeOverMinor: number | null }[],
): Promise<SaveResult> {
  const markets = new Map(store.markets.map((m) => [m.code, m]));
  for (const rate of rates) {
    const market = markets.get(rate.marketCode);
    if (!market) return { ok: false, problems: [`The store does not sell to ${rate.marketCode}.`] };
    await db().execute(sql`
      insert into commerce.shipping_rates (store_id, market_code, currency, amount_minor, free_over_minor)
      values (${store.id}::uuid, ${market.code}, ${market.currency}, ${rate.amountMinor}, ${rate.freeOverMinor})
      on conflict (store_id, market_code) do update set
        currency = excluded.currency, amount_minor = excluded.amount_minor,
        free_over_minor = excluded.free_over_minor, updated_at = now()
    `);
  }
  await audit(account.id, store.id, "shipping.updated", { rates });
  return { ok: true };
}
