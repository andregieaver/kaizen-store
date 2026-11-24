import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { decryptSecret } from "@/lib/secret-box";

import { encryptionKey } from "./encryption-key";
import { col, typedRow } from "./typed-rows";

/**
 * The company lookup service (D890, `docs/analytics.md` "Companies"), read: Kaizena Flow's own Leadfeeder connection (`store_id` null),
 * set by a platform admin on its store's Analytics settings (`company-lookup-admin.ts`, the table's only writer). The key is kept encrypted
 * and shown by its hint only; it is decrypted for a lookup and never sent to a page. Light on purpose: the visit beacon's work reads it.
 */

export type CompanyLookupSettings = { provider: "leadfeeder"; keyHint: string; accountId: string };
export type CompanyLookupConnection = { provider: "leadfeeder"; apiKey: string; accountId: string };

const ROW = z.object({ provider: z.literal("leadfeeder"), api_key_encrypted: col.text, api_key_hint: col.text, account_id: col.text });

export const platformRow = () =>
  typedRow(ROW, sql`select provider, api_key_encrypted, api_key_hint, account_id from commerce.company_lookup_settings where store_id is null`);

/** What the settings card shows: the key's hint and the account; null when none was set. */
export async function companyLookupSettings(): Promise<CompanyLookupSettings | null> {
  const row = await platformRow();
  return row ? { provider: row.provider, keyHint: row.api_key_hint, accountId: row.account_id } : null;
}

/** The connection for a lookup, or null: none set, or the key cannot be read. */
export async function companyLookupConnection(): Promise<CompanyLookupConnection | null> {
  const row = await platformRow();
  const key = encryptionKey();
  if (!row || !key) return null;
  try {
    return { provider: row.provider, apiKey: decryptSecret(row.api_key_encrypted, key), accountId: row.account_id };
  } catch {
    return null;
  }
}
