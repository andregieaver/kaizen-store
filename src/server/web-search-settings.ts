import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { decryptSecret, encryptSecret, secretHint } from "@/lib/secret-box";
import { SEARCH_API_IDS, type SearchApiId } from "@/lib/web-search";

import { audit, type Account } from "./auth";
import { OwnerToolError } from "./owner-tool-error";
import { encryptionKey } from "./settings";
import { col, typedRow } from "./typed-rows";

/**
 * The web search service for the AI's research (D329, `docs/ai-autopilot.md` 13.1), the only writer of `commerce.search_settings`:
 * Kaizena Flow's own row (`store_id` null), set by platform admins on Platform → AI. The key is kept encrypted and shown by its hint only;
 * it is decrypted for a search and never sent to a page.
 */

export type SearchSettings = { provider: SearchApiId; keyHint: string; enabled: boolean };
export type SearchConnection = { provider: SearchApiId; apiKey: string };

const ROW = z.object({ provider: z.enum(SEARCH_API_IDS), api_key_encrypted: col.text, api_key_hint: col.text, enabled: col.bool });

const platformRow = () =>
  typedRow(ROW, sql`select provider, api_key_encrypted, api_key_hint, enabled from commerce.search_settings where store_id is null`);

/** What the settings card shows: the service, the key's hint and the switch; null when none was set. */
export async function searchSettings(): Promise<SearchSettings | null> {
  const row = await platformRow();
  return row ? { provider: row.provider, keyHint: row.api_key_hint, enabled: row.enabled } : null;
}

/** The service and its key for a search, or null: none set, switched off, or the key cannot be read. */
export async function searchConnection(): Promise<SearchConnection | null> {
  const row = await platformRow();
  const key = encryptionKey();
  if (!row || !row.enabled || !key) return null;
  try {
    return { provider: row.provider, apiKey: decryptSecret(row.api_key_encrypted, key) };
  } catch {
    return null;
  }
}

export const searchSettingsInput = z.object({
  provider: z.enum(SEARCH_API_IDS),
  /** A new key replaces the saved one; empty keeps it (a new service needs a new key). */
  apiKey: z.string().trim().max(500).default(""),
  enabled: z.boolean().default(true),
});

/** Saves Kaizena Flow's search service (platform admins only); a first key, or a new service, needs a key. */
export async function saveSearchSettings(account: Account, input: unknown): Promise<SearchSettings> {
  if (!account.platformAdmin) throw new OwnerToolError("Only a platform admin sets the web search service.");
  const parsed = searchSettingsInput.safeParse(input);
  if (!parsed.success) throw new OwnerToolError("Choose a search service.");
  const { provider, apiKey, enabled } = parsed.data;
  const before = await platformRow();
  const key = encryptionKey();
  if (!key) throw new OwnerToolError("Secrets cannot be kept: SETTINGS_ENCRYPTION_KEY is not set.");
  if (!apiKey && (!before || before.provider !== provider)) throw new OwnerToolError("Paste the search service's API key.");
  const encrypted = apiKey ? encryptSecret(apiKey, key) : (before?.api_key_encrypted ?? "");
  const hint = apiKey ? secretHint(apiKey) : (before?.api_key_hint ?? "");
  await db().execute(sql`
    insert into commerce.search_settings (store_id, provider, api_key_encrypted, api_key_hint, enabled, updated_by, updated_at)
    values (null, ${provider}, ${encrypted}, ${hint}, ${enabled}, ${account.id}::uuid, now())
    on conflict (store_id) do update set provider = excluded.provider, api_key_encrypted = excluded.api_key_encrypted,
      api_key_hint = excluded.api_key_hint, enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now()
  `);
  await audit(account.id, null, "platform.web_search_set", { provider, enabled, newKey: Boolean(apiKey) }, { area: "platform" });
  return { provider, keyHint: hint, enabled };
}

