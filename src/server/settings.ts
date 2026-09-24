import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  isKnownMethod,
  validateStripeCredentials,
  type PaymentModeName,
  type StripeCredentialInput,
} from "@/lib/payment-methods";
import { decryptSecret, encryptSecret, parseKey, secretHint } from "@/lib/secret-box";

import { connectWebhook } from "./stripe";

import { audit, type Membership, type Role } from "./auth";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/** The key that encrypts payment secrets, or null if the server lacks one. */
export function encryptionKey(): Buffer | null {
  return parseKey(process.env.SETTINGS_ENCRYPTION_KEY);
}

export type CredentialStatus = {
  mode: PaymentModeName;
  publishableKey: string | null;
  secretKeyHint: string | null;
  webhookSecretHint: string | null;
  updatedAt: string | null;
};

export type PaymentSettings = {
  stripe: { enabled: boolean; activeMode: PaymentModeName };
  credentials: Record<PaymentModeName, CredentialStatus>;
  /** Enabled methods per market code. */
  methods: Record<string, Set<string>>;
  encryptionKeyConfigured: boolean;
};

export async function getPaymentSettings(store: Store): Promise<PaymentSettings> {
  const [[provider], credentials, methods] = await Promise.all([
    db().execute<Row>(sql`
      select enabled, active_mode from commerce.payment_providers
      where store_id = ${store.id}::uuid and provider = 'stripe'
    `),
    db().execute<Row>(sql`
      select mode, publishable_key, secret_key_hint, webhook_secret_hint, updated_at
      from commerce.payment_credentials
      where store_id = ${store.id}::uuid and provider = 'stripe'
    `),
    db().execute<Row>(sql`
      select market_code, method from commerce.payment_methods
      where store_id = ${store.id}::uuid and enabled
    `),
  ]);

  const status = (mode: PaymentModeName): CredentialStatus => {
    const row = credentials.find((c) => c.mode === mode);
    return {
      mode,
      publishableKey: row?.publishable_key ? String(row.publishable_key) : null,
      secretKeyHint: row?.secret_key_hint ? String(row.secret_key_hint) : null,
      webhookSecretHint: row?.webhook_secret_hint ? String(row.webhook_secret_hint) : null,
      updatedAt: row?.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
    };
  };

  const enabled: Record<string, Set<string>> = Object.fromEntries(
    store.markets.map((market) => [market.code, new Set<string>()]),
  );
  for (const row of methods) enabled[String(row.market_code)]?.add(String(row.method));

  return {
    stripe: {
      enabled: Boolean(provider?.enabled),
      activeMode: (provider?.active_mode ?? "test") as PaymentModeName,
    },
    credentials: { test: status("test"), live: status("live") },
    methods: enabled,
    encryptionKeyConfigured: encryptionKey() !== null,
  };
}

export type SaveResult = { ok: true; note?: string } | { ok: false; problems: string[] };

/** Saves Stripe credentials for one mode. Empty fields keep their saved value. */
export async function saveStripeCredentials(
  { account, store }: Membership,
  mode: PaymentModeName,
  input: StripeCredentialInput,
  origin: string,
): Promise<SaveResult> {
  const problems = validateStripeCredentials(mode, input);
  const key = encryptionKey();
  if ((input.secretKey || input.webhookSecret) && !key) {
    problems.push("Payment keys cannot be stored right now. Try again later.");
  }
  if (problems.length > 0) return { ok: false, problems };

  // A new secret key connects Kaizen's webhook in the owner's Stripe
  // account, which also proves the key works.
  let note: string | undefined;
  if (input.secretKey && !input.webhookSecret) {
    const hook = await connectWebhook(input.secretKey, origin, store.id);
    if (hook.ok) {
      input = { ...input, webhookSecret: hook.secret };
      note = `Saved the ${mode} keys and connected Stripe: payments will be confirmed automatically.`;
    } else {
      note = `Saved the ${mode} keys, but Stripe could not be connected (${hook.problem}). Check that the secret key is right and allowed to manage webhooks, or add the webhook signing secret by hand.`;
    }
  }

  const secret = input.secretKey && key ? encryptSecret(input.secretKey, key) : null;
  const webhook = input.webhookSecret && key ? encryptSecret(input.webhookSecret, key) : null;

  await db().execute(sql`
    insert into commerce.payment_credentials as c (
      store_id, provider, mode, publishable_key,
      secret_key_ciphertext, secret_key_hint,
      webhook_secret_ciphertext, webhook_secret_hint,
      updated_at, updated_by
    ) values (
      ${store.id}::uuid, 'stripe', ${mode}, ${input.publishableKey || null},
      ${secret}, ${input.secretKey ? secretHint(input.secretKey) : null},
      ${webhook}, ${input.webhookSecret ? secretHint(input.webhookSecret) : null},
      now(), ${account.id}::uuid
    )
    on conflict (store_id, provider, mode) do update set
      publishable_key = coalesce(excluded.publishable_key, c.publishable_key),
      secret_key_ciphertext = coalesce(excluded.secret_key_ciphertext, c.secret_key_ciphertext),
      secret_key_hint = coalesce(excluded.secret_key_hint, c.secret_key_hint),
      webhook_secret_ciphertext = coalesce(excluded.webhook_secret_ciphertext, c.webhook_secret_ciphertext),
      webhook_secret_hint = coalesce(excluded.webhook_secret_hint, c.webhook_secret_hint),
      updated_at = now(),
      updated_by = excluded.updated_by
  `);

  await audit(account.id, store.id, "payments.credentials_saved", {
    provider: "stripe",
    mode,
    changed: Object.entries(input)
      .filter(([, value]) => Boolean(value))
      .map(([field]) => field),
  });
  return { ok: true, note };
}

/** Turns Stripe on or off and chooses test or live mode. */
export async function setStripeProvider(
  { account, store }: Membership,
  enabled: boolean,
  activeMode: PaymentModeName,
): Promise<SaveResult> {
  if (enabled) {
    const settings = await getPaymentSettings(store);
    const credentials = settings.credentials[activeMode];
    if (!credentials.publishableKey || !credentials.secretKeyHint) {
      return {
        ok: false,
        problems: [`Save the ${activeMode} publishable and secret keys before enabling Stripe in ${activeMode} mode.`],
      };
    }
  }
  await db().execute(sql`
    update commerce.payment_providers
       set enabled = ${enabled}, active_mode = ${activeMode},
           updated_at = now(), updated_by = ${account.id}::uuid
     where store_id = ${store.id}::uuid and provider = 'stripe'
  `);
  await audit(account.id, store.id, "payments.provider_updated", {
    provider: "stripe",
    enabled,
    activeMode,
  });
  return { ok: true };
}

/** Sets which payment methods are offered in each of the store's markets. */
export async function setPaymentMethods(
  { account, store }: Membership,
  enabledByMarket: Record<string, string[]>,
): Promise<SaveResult> {
  const storeMarkets = new Set(store.markets.map((market) => market.code));
  const rows: { market: string; method: string }[] = [];
  for (const [market, methods] of Object.entries(enabledByMarket)) {
    if (!storeMarkets.has(market)) {
      return { ok: false, problems: [`The store does not sell to ${market}.`] };
    }
    for (const method of methods) {
      if (!isKnownMethod(market, method)) {
        return { ok: false, problems: [`${method} is not available in ${market}.`] };
      }
      rows.push({ market, method });
    }
  }
  const markets = Object.keys(enabledByMarket);
  if (markets.length === 0) return { ok: true };

  await db().transaction(async (tx) => {
    await tx.execute(sql`
      update commerce.payment_methods
         set enabled = false, updated_at = now(), updated_by = ${account.id}::uuid
       where store_id = ${store.id}::uuid and enabled
         and market_code in (${sql.join(markets.map((m) => sql`${m}`), sql`, `)})
    `);
    for (const { market, method } of rows) {
      await tx.execute(sql`
        insert into commerce.payment_methods (store_id, market_code, method, enabled, updated_at, updated_by)
        values (${store.id}::uuid, ${market}, ${method}, true, now(), ${account.id}::uuid)
        on conflict (store_id, market_code, method) do update set
          enabled = true, updated_at = now(), updated_by = excluded.updated_by
      `);
    }
  });
  await audit(account.id, store.id, "payments.methods_updated", { enabled: enabledByMarket });
  return { ok: true };
}

/**
 * The decrypted Stripe secret key for the store's active mode, for
 * server-side use at checkout. Null if Stripe is disabled or not configured.
 */
export async function getActiveStripeSecret(storeId: string): Promise<{
  mode: PaymentModeName;
  secretKey: string;
  publishableKey: string;
} | null> {
  const key = encryptionKey();
  if (!key) return null;
  const [row] = await db().execute<Row>(sql`
    select p.active_mode, c.publishable_key, c.secret_key_ciphertext
    from commerce.payment_providers p
    join commerce.payment_credentials c
      on c.store_id = p.store_id and c.provider = p.provider and c.mode = p.active_mode
    where p.store_id = ${storeId}::uuid and p.provider = 'stripe' and p.enabled
  `);
  if (!row?.secret_key_ciphertext || !row.publishable_key) return null;
  return {
    mode: row.active_mode as PaymentModeName,
    secretKey: decryptSecret(String(row.secret_key_ciphertext), key),
    publishableKey: String(row.publishable_key),
  };
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

/** The store's webhook signing secrets (test and live), decrypted. */
export async function getWebhookSecrets(storeId: string): Promise<string[]> {
  const key = encryptionKey();
  if (!key) return [];
  const rows = await db().execute<Row>(sql`
    select webhook_secret_ciphertext from commerce.payment_credentials
    where store_id = ${storeId}::uuid and provider = 'stripe' and webhook_secret_ciphertext is not null
  `);
  return rows.map((row) => decryptSecret(String(row.webhook_secret_ciphertext), key));
}

/** A store's Stripe secret key for a mode (to look up a session from either mode). */
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
