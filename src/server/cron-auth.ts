import "server-only";

import { timingSafeEqual } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";

type Row = Record<string, unknown>;

let vaultSecret: { value: string | null; at: number } | null = null;

/**
 * The token Supabase's scheduler sends (D33): made in the database and
 * kept in Vault, so it never passes through code or chat. Read at most
 * every five minutes; null where there is no Vault (local databases).
 */
async function scheduledSecret(): Promise<string | null> {
  if (vaultSecret && Date.now() - vaultSecret.at < 5 * 60_000) return vaultSecret.value;
  let value: string | null = null;
  try {
    const [row] = await db().execute<Row>(sql`
      select decrypted_secret from vault.decrypted_secrets where name = 'kaizen_cron_secret'
    `);
    value = row?.decrypted_secret ? String(row.decrypted_secret) : null;
  } catch {
    value = null;
  }
  vaultSecret = { value, at: Date.now() };
  return value;
}

function same(given: string, secret: string | null | undefined): boolean {
  if (!secret) return false;
  const expected = `Bearer ${secret}`;
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** Whether a scheduled job's request is Vercel Cron's (CRON_SECRET) or Supabase's scheduler (Vault). */
export async function cronAuthorised(request: Request): Promise<boolean> {
  const given = request.headers.get("authorization") ?? "";
  if (!given.startsWith("Bearer ")) return false;
  return same(given, process.env.CRON_SECRET) || same(given, await scheduledSecret());
}
