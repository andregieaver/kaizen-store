import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { OPTIONAL_CATEGORIES, versionHas } from "@/lib/cookie-consent";

import { owned } from "./owned";

type Row = Record<string, unknown>;

/** What the consent widget sends when a visitor decides (D58). */
export const consentRecord = z.object({
  storeId: z.uuid().nullable(),
  visitor: z.uuid(),
  version: z.string().regex(/^[a-z+]{0,60}$/),
  // `recordings` (D656) may be missing, so a choice sent by a page from before it existed is still kept as proof.
  choices: z.object({
    ...(Object.fromEntries(OPTIONAL_CATEGORIES.filter((c) => c !== "recordings").map((c) => [c, z.boolean()])) as Record<
      Exclude<(typeof OPTIONAL_CATEGORIES)[number], "recordings">,
      z.ZodBoolean
    >),
    recordings: z.boolean().optional(),
  }),
});

/**
 * Keeps a visitor's choice as proof of consent (D58): the random id in their
 * consent cookie, the site, the categories asked about and what they allowed.
 * Nothing else about them is kept; records go after 12 months. False when
 * the record cannot be read or names no open store.
 */
export async function recordConsent(input: unknown): Promise<boolean> {
  const parsed = consentRecord.safeParse(input);
  if (!parsed.success) return false;
  const { storeId, visitor, version, choices: sent } = parsed.data;
  // Recordings are part of the proof only where the site asked about them (D656): every other record keeps the three it always had.
  const { recordings, ...asked } = sent;
  const choices = versionHas(version, "recordings") ? { ...asked, recordings: recordings ?? false } : asked;
  const rows = await db().execute<Row>(sql`
    insert into commerce.consents (store_id, visitor, choices, version)
    select ${storeId}::uuid, ${visitor}::uuid, ${JSON.stringify(choices)}::jsonb, ${version}
    where ${storeId}::uuid is null or exists (select 1 from commerce.stores where id = ${storeId}::uuid and status = 'active')
    returning id
  `);
  return rows.length > 0;
}

/** A store's (or Kaizen's) consent records, newest first, for its admin (D58). */
export async function listConsents(
  storeId: string | null,
  limit = 50,
): Promise<{ id: string; visitor: string; choices: Record<string, boolean>; version: string; createdAt: string }[]> {
  const rows = await db().execute<Row>(sql`
    select id, visitor, choices, version, created_at from commerce.consents
    where ${owned(storeId)}
    order by created_at desc
    limit ${limit}
  `);
  return rows.map((row) => ({
    id: String(row.id),
    visitor: String(row.visitor),
    choices: row.choices as Record<string, boolean>,
    version: String(row.version),
    createdAt: new Date(String(row.created_at)).toISOString(),
  }));
}
