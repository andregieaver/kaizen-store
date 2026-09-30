import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  carrierComplete,
  carrierInfo,
  isCarrierId,
  parseCarrierForm,
  secretHint,
  type CarrierContext,
  type CarrierEnvironment,
  type CarrierId,
  type CarrierSettings,
} from "@/lib/shipping-carriers";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";

import { audit } from "./auth";
import { encryptionKey } from "./settings";

type Row = Record<string, unknown>;

/**
 * Shipping carriers (D133): a store's own agreement with each carrier, saved before the carriers' connections exist (see
 * `src/lib/shipping-carriers.ts`). Secrets are encrypted with the settings key and never leave this module but through
 * `carrierContext()`, which only a carrier's connection calls; screens read `CarrierSettings`, which has their hints.
 */

function toSettings(row: Row): CarrierSettings {
  return {
    carrier: row.carrier as CarrierId,
    environment: row.environment as CarrierEnvironment,
    details: (row.details ?? {}) as Record<string, string>,
    countries: (row.countries ?? []) as string[],
    secrets: (row.secret_hints ?? {}) as Record<string, string>,
    complete: Boolean(row.complete),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

/** What the store has saved for each carrier (only the ones it has started). */
export async function listCarriers(storeId: string): Promise<CarrierSettings[]> {
  const rows = await db().execute<Row>(sql`
    select carrier, environment, details, countries, secret_hints, complete, updated_at
    from commerce.shipping_carriers where store_id = ${storeId}::uuid order by carrier
  `);
  return rows.map(toSettings);
}

export async function getCarrier(storeId: string, carrier: CarrierId): Promise<CarrierSettings | null> {
  return (await listCarriers(storeId)).find((c) => c.carrier === carrier) ?? null;
}

export type CarrierResult = { ok: true } | { ok: false; problems: string[] };

/**
 * Saves the store's details for a carrier. A secret left empty keeps the saved one; the rest replace what was there.
 * `complete` says whether every detail the carrier needs is now saved.
 */
export async function saveCarrier(
  accountId: string,
  storeId: string,
  carrier: string,
  raw: { environment: unknown; countries: unknown[]; fields: Record<string, unknown> },
): Promise<CarrierResult> {
  const info = isCarrierId(carrier) ? carrierInfo(carrier) : null;
  if (!info) return { ok: false, problems: ["Unknown carrier."] };
  const key = encryptionKey();
  if (!key) return { ok: false, problems: ["Kaizen cannot keep the keys safe right now, so nothing was saved. Try again later."] };

  const [current] = await db().execute<Row>(sql`
    select secrets_encrypted, secret_hints from commerce.shipping_carriers
    where store_id = ${storeId}::uuid and carrier = ${info.id}
  `);
  let kept: Record<string, string> = {};
  if (current?.secrets_encrypted) {
    try {
      kept = JSON.parse(decryptSecret(String(current.secrets_encrypted), key)) as Record<string, string>;
    } catch {
      kept = {};
    }
  }
  const parsed = parseCarrierForm(info, raw, { hasSecret: (k) => Boolean(kept[k]) });
  if (!parsed.ok) return parsed;

  const secrets = { ...kept, ...parsed.secrets };
  const hints = Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, secretHint(v)]));
  const complete = carrierComplete(info, parsed.details, Object.keys(secrets));
  await db().execute(sql`
    insert into commerce.shipping_carriers (
      store_id, carrier, environment, details, secrets_encrypted, secret_hints, countries, complete, updated_by
    ) values (
      ${storeId}::uuid, ${info.id}, ${parsed.environment}, ${JSON.stringify(parsed.details)}::jsonb,
      ${Object.keys(secrets).length > 0 ? encryptSecret(JSON.stringify(secrets), key) : null}, ${JSON.stringify(hints)}::jsonb,
      ARRAY[${sql.join(parsed.countries.map((c) => sql`${c}`), sql`, `)}]::text[], ${complete}, ${accountId}::uuid
    )
    on conflict (store_id, carrier) do update set
      environment = excluded.environment, details = excluded.details, secrets_encrypted = excluded.secrets_encrypted,
      secret_hints = excluded.secret_hints, countries = excluded.countries, complete = excluded.complete,
      updated_at = now(), updated_by = excluded.updated_by
  `);
  await audit(accountId, storeId, "shipping.carrier_saved", { carrier: info.id, environment: parsed.environment, complete });
  return { ok: true };
}

/** Forgets everything saved for a carrier, secrets included. */
export async function removeCarrier(accountId: string, storeId: string, carrier: string): Promise<void> {
  if (!isCarrierId(carrier)) return;
  const rows = await db().execute<Row>(sql`
    delete from commerce.shipping_carriers where store_id = ${storeId}::uuid and carrier = ${carrier} returning carrier
  `);
  if (rows.length > 0) await audit(accountId, storeId, "shipping.carrier_removed", { carrier });
}

/**
 * What a carrier's connection is given to call the carrier: the agreement with its secrets decrypted. Null when nothing
 * complete is saved or the secrets cannot be read. Only a carrier's connection calls this; never a page or an action.
 */
export async function carrierContext(storeId: string, carrier: CarrierId): Promise<CarrierContext | null> {
  const [row] = await db().execute<Row>(sql`
    select environment, details, secrets_encrypted, complete from commerce.shipping_carriers
    where store_id = ${storeId}::uuid and carrier = ${carrier}
  `);
  const key = encryptionKey();
  if (!row || !row.complete || !key) return null;
  try {
    const secrets = row.secrets_encrypted ? (JSON.parse(decryptSecret(String(row.secrets_encrypted), key)) as Record<string, string>) : {};
    return { storeId, environment: row.environment as CarrierEnvironment, details: (row.details ?? {}) as Record<string, string>, secrets };
  } catch {
    return null;
  }
}
