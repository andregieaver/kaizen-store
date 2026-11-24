import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { encryptSecret, secretHint } from "@/lib/secret-box";

import { audit, type Account } from "./auth";
import { platformRow, type CompanyLookupSettings } from "./company-lookup-settings";
import { encryptionKey } from "./encryption-key";
import { OwnerToolError } from "./owner-tool-error";

/**
 * The only writer of `commerce.company_lookup_settings` (D890): Kaizena Flow's own Leadfeeder connection, saved and taken away by a
 * platform admin on its store's Analytics settings, each change audited without the key.
 */

export const companyLookupInput = z.object({
  /** A new key replaces the saved one; empty keeps it (the first needs one). */
  apiKey: z.string().trim().max(500).default(""),
  /** Leadfeeder's account id: digits only. */
  accountId: z.string().trim().regex(/^[0-9]{1,20}$/),
});

/** The words a refusal is given in, so the action can show them in the admin's language. */
export type CompanyLookupProblem = "platform_admin" | "account" | "key" | "no_secret";

/** Saves Kaizena Flow's Leadfeeder connection (platform admins only); a first connection needs a key. */
export async function saveCompanyLookupSettings(account: Account, input: unknown): Promise<CompanyLookupSettings> {
  if (!account.platformAdmin) throw new CompanyLookupError("platform_admin");
  const parsed = companyLookupInput.safeParse(input);
  if (!parsed.success) throw new CompanyLookupError("account");
  const { apiKey, accountId } = parsed.data;
  const before = await platformRow();
  const key = encryptionKey();
  if (!key) throw new CompanyLookupError("no_secret");
  if (!apiKey && !before) throw new CompanyLookupError("key");
  const encrypted = apiKey ? encryptSecret(apiKey, key) : (before?.api_key_encrypted ?? "");
  const hint = apiKey ? secretHint(apiKey) : (before?.api_key_hint ?? "");
  await db().execute(sql`
    insert into commerce.company_lookup_settings (store_id, provider, api_key_encrypted, api_key_hint, account_id, updated_by, updated_at)
    values (null, 'leadfeeder', ${encrypted}, ${hint}, ${accountId}, ${account.id}::uuid, now())
    on conflict (store_id) do update set api_key_encrypted = excluded.api_key_encrypted, api_key_hint = excluded.api_key_hint,
      account_id = excluded.account_id, updated_by = excluded.updated_by, updated_at = now()
  `);
  await audit(account.id, null, "platform.company_lookup_set", { provider: "leadfeeder", newKey: Boolean(apiKey) }, { area: "platform" });
  return { provider: "leadfeeder", keyHint: hint, accountId };
}

/** Takes Kaizena Flow's Leadfeeder connection away (platform admins only): lookups stop at once. */
export async function removeCompanyLookupSettings(account: Account): Promise<void> {
  if (!account.platformAdmin) throw new CompanyLookupError("platform_admin");
  await db().execute(sql`delete from commerce.company_lookup_settings where store_id is null`);
  await audit(account.id, null, "platform.company_lookup_removed", { provider: "leadfeeder" }, { area: "platform" });
}

/** A refusal to save, by its reason; the action says it in the admin's language. */
export class CompanyLookupError extends OwnerToolError {
  constructor(readonly problem: CompanyLookupProblem) {
    super(problem);
  }
}
