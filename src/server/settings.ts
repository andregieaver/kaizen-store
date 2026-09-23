import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { MARKET_SLUGS, MARKETS } from "@/lib/markets";
import {
  isKnownMethod,
  validateStripeCredentials,
  type PaymentModeName,
  type StripeCredentialInput,
} from "@/lib/payment-methods";
import { decryptSecret, encryptSecret, parseKey, secretHint } from "@/lib/secret-box";

import { audit, type Staff } from "./auth";

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

export async function getPaymentSettings(): Promise<PaymentSettings> {
  const [[provider], credentials, methods] = await Promise.all([
    db().execute<Row>(sql`
      select enabled, active_mode from commerce.payment_providers where provider = 'stripe'
    `),
    db().execute<Row>(sql`
      select mode, publishable_key, secret_key_hint, webhook_secret_hint, updated_at
      from commerce.payment_credentials where provider = 'stripe'
    `),
    db().execute<Row>(sql`
      select market_code, method from commerce.payment_methods where enabled
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
    MARKET_SLUGS.map((slug) => [MARKETS[slug].code, new Set<string>()]),
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

export type SaveResult = { ok: true } | { ok: false; problems: string[] };

/** Saves Stripe credentials for one mode. Empty fields keep their saved value. */
export async function saveStripeCredentials(
  staff: Staff,
  mode: PaymentModeName,
  input: StripeCredentialInput,
): Promise<SaveResult> {
  const problems = validateStripeCredentials(mode, input);
  const key = encryptionKey();
  if ((input.secretKey || input.webhookSecret) && !key) {
    problems.push("The server has no SETTINGS_ENCRYPTION_KEY, so secrets cannot be stored.");
  }
  if (problems.length > 0) return { ok: false, problems };

  const secret = input.secretKey && key ? encryptSecret(input.secretKey, key) : null;
  const webhook = input.webhookSecret && key ? encryptSecret(input.webhookSecret, key) : null;

  await db().execute(sql`
    insert into commerce.payment_credentials as c (
      provider, mode, publishable_key,
      secret_key_ciphertext, secret_key_hint,
      webhook_secret_ciphertext, webhook_secret_hint,
      updated_at, updated_by
    ) values (
      'stripe', ${mode}, ${input.publishableKey || null},
      ${secret}, ${input.secretKey ? secretHint(input.secretKey) : null},
      ${webhook}, ${input.webhookSecret ? secretHint(input.webhookSecret) : null},
      now(), ${staff.id}::uuid
    )
    on conflict (provider, mode) do update set
      publishable_key = coalesce(excluded.publishable_key, c.publishable_key),
      secret_key_ciphertext = coalesce(excluded.secret_key_ciphertext, c.secret_key_ciphertext),
      secret_key_hint = coalesce(excluded.secret_key_hint, c.secret_key_hint),
      webhook_secret_ciphertext = coalesce(excluded.webhook_secret_ciphertext, c.webhook_secret_ciphertext),
      webhook_secret_hint = coalesce(excluded.webhook_secret_hint, c.webhook_secret_hint),
      updated_at = now(),
      updated_by = excluded.updated_by
  `);

  await audit(staff.id, "payments.credentials_saved", {
    provider: "stripe",
    mode,
    changed: Object.entries(input)
      .filter(([, value]) => Boolean(value))
      .map(([field]) => field),
  });
  return { ok: true };
}

/** Turns Stripe on or off and chooses test or live mode. */
export async function setStripeProvider(
  staff: Staff,
  enabled: boolean,
  activeMode: PaymentModeName,
): Promise<SaveResult> {
  if (enabled) {
    const settings = await getPaymentSettings();
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
           updated_at = now(), updated_by = ${staff.id}::uuid
     where provider = 'stripe'
  `);
  await audit(staff.id, "payments.provider_updated", {
    provider: "stripe",
    enabled,
    activeMode,
  });
  return { ok: true };
}

/** Sets which payment methods are offered in each market. */
export async function setPaymentMethods(
  staff: Staff,
  enabledByMarket: Record<string, string[]>,
): Promise<SaveResult> {
  const rows: { market: string; method: string }[] = [];
  for (const [market, methods] of Object.entries(enabledByMarket)) {
    for (const method of methods) {
      if (!isKnownMethod(market, method)) {
        return { ok: false, problems: [`${method} is not available in ${market}.`] };
      }
      rows.push({ market, method });
    }
  }
  const markets = Object.keys(enabledByMarket);

  await db().transaction(async (tx) => {
    await tx.execute(sql`
      update commerce.payment_methods
         set enabled = false, updated_at = now(), updated_by = ${staff.id}::uuid
       where enabled and market_code in (${sql.join(markets.map((m) => sql`${m}`), sql`, `)})
    `);
    for (const { market, method } of rows) {
      await tx.execute(sql`
        insert into commerce.payment_methods (market_code, method, enabled, updated_at, updated_by)
        values (${market}, ${method}, true, now(), ${staff.id}::uuid)
        on conflict (market_code, method) do update set
          enabled = true, updated_at = now(), updated_by = excluded.updated_by
      `);
    }
  });
  await audit(staff.id, "payments.methods_updated", { enabled: enabledByMarket });
  return { ok: true };
}

/**
 * The decrypted Stripe secret key for the active mode, for server-side use at
 * checkout. Null if Stripe is disabled or not configured.
 */
export async function getActiveStripeSecret(): Promise<{
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
      on c.provider = p.provider and c.mode = p.active_mode
    where p.provider = 'stripe' and p.enabled
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

export async function recentAudit(limit = 20): Promise<AuditEntry[]> {
  const rows = await db().execute<Row>(sql`
    select a.id, a.action, s.email, a.details, a.created_at
    from commerce.settings_audit_log a
    left join commerce.staff s on s.id = a.staff_id
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
  id: string;
  email: string;
  role: "owner" | "admin";
  signedInBefore: boolean;
  disabled: boolean;
};

export async function listStaff(): Promise<StaffMember[]> {
  const rows = await db().execute<Row>(sql`
    select id, email, role, auth_user_id is not null as linked, disabled_at is not null as disabled
    from commerce.staff order by disabled_at nulls first, role, lower(email)
  `);
  return rows.map((row) => ({
    id: String(row.id),
    email: String(row.email),
    role: row.role as "owner" | "admin",
    signedInBefore: Boolean(row.linked),
    disabled: Boolean(row.disabled),
  }));
}

export async function inviteStaff(
  owner: Staff,
  email: string,
  role: "owner" | "admin",
): Promise<SaveResult> {
  const [existing] = await db().execute<Row>(sql`
    select id, disabled_at from commerce.staff where lower(email) = lower(${email})
  `);
  if (existing && !existing.disabled_at) {
    return { ok: false, problems: [`${email} already has access.`] };
  }
  if (existing) {
    await db().execute(sql`
      update commerce.staff set disabled_at = null, role = ${role}
      where id = ${String(existing.id)}::uuid
    `);
  } else {
    await db().execute(sql`
      insert into commerce.staff (email, role, invited_by)
      values (${email}, ${role}, ${owner.id}::uuid)
    `);
  }
  await audit(owner.id, "staff.invited", { email, role });
  return { ok: true };
}

export async function disableStaff(owner: Staff, staffId: string): Promise<SaveResult> {
  if (staffId === owner.id) {
    return { ok: false, problems: ["You cannot remove your own access."] };
  }
  try {
    const [row] = await db().execute<Row>(sql`
      update commerce.staff set disabled_at = now()
      where id = ${staffId}::uuid and disabled_at is null
      returning email
    `);
    if (row) await audit(owner.id, "staff.disabled", { email: String(row.email) });
    return { ok: true };
  } catch {
    return { ok: false, problems: ["The store must keep at least one active owner."] };
  }
}
