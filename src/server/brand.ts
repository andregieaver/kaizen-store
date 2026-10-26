import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { brandInput, EMPTY_BRAND, uniqueWords, type Brand } from "@/lib/brand";
import { findClaims } from "@/lib/claims";

import { audit } from "./auth";
import { OwnerToolError } from "./owner-tool-error";
import type { Store } from "./stores";
import { col, typedRow } from "./typed-rows";

/**
 * A store's brand profile (D330, `docs/ai-autopilot.md` 14.1), the only writer of `commerce.brand_profiles`: a store's, or Kaizena Flow's own
 * with no store. Only the tagline may reach customers, so only it passes the claims filter; the rest guides the AI's writing.
 */

export type BrandScope = { account: { id: string }; store: Store | null };

/** A Postgres array literal: an array given to sql`` would be spread into separate parameters. */
const textArray = (words: readonly string[]) => `{${words.map((w) => `"${w.replace(/["\\]/g, (c) => `\\${c}`)}"`).join(",")}}`;

const ROW = z.object({ tagline: col.text, voice: col.text, audience: col.text, values: z.array(z.string()), avoid: z.array(z.string()), updated_at: col.timestamp });

export async function getBrand(scope: BrandScope): Promise<Brand> {
  return brandOf(scope.store?.id ?? null);
}

/** The brand of a store, or Kaizena Flow's own with no store, for the writers (D330 F2b); the empty brand when none is set down. */
export async function brandOf(storeId: string | null): Promise<Brand> {
  const where = storeId ? sql`store_id = ${storeId}::uuid` : sql`store_id is null`;
  const row = await typedRow(ROW, sql`select tagline, voice, audience, values, avoid, updated_at from commerce.brand_profiles where ${where}`);
  return row ? { tagline: row.tagline, voice: row.voice, audience: row.audience, values: row.values, avoid: row.avoid, updatedAt: row.updated_at } : EMPTY_BRAND;
}

/** Lays the fields given over the brand as it is; refused, with the words found, when the tagline makes a claim. */
export async function setBrand(scope: BrandScope, raw: unknown): Promise<Brand> {
  const parsed = brandInput.safeParse(raw);
  if (!parsed.success) throw new OwnerToolError(`The brand could not be read: ${parsed.error.issues.map((i) => i.path.join(".") || i.message).join(", ")}.`);
  const input = parsed.data;
  const claims = input.tagline ? [...new Set(findClaims(input.tagline).map((c) => c.phrase))] : [];
  if (claims.length) throw new OwnerToolError(`The tagline makes a claim customers would read: ${claims.join(", ")}. Say what the store does instead.`);
  const before = await getBrand(scope);
  const next = {
    tagline: input.tagline ?? before.tagline,
    voice: input.voice ?? before.voice,
    audience: input.audience ?? before.audience,
    values: input.values ? uniqueWords(input.values) : before.values,
    avoid: input.avoid ? uniqueWords(input.avoid) : before.avoid,
  };
  await db().execute(sql`
    insert into commerce.brand_profiles (store_id, tagline, voice, audience, values, avoid, updated_by, updated_at)
    values (${scope.store?.id ?? null}::uuid, ${next.tagline}, ${next.voice}, ${next.audience}, ${textArray(next.values)}::text[], ${textArray(next.avoid)}::text[],
      ${scope.account.id}::uuid, now())
    on conflict (store_id) do update set tagline = excluded.tagline, voice = excluded.voice, audience = excluded.audience,
      values = excluded.values, avoid = excluded.avoid, updated_by = excluded.updated_by, updated_at = now()
  `);
  await audit(scope.account.id, scope.store?.id ?? null, scope.store ? "store.brand_set" : "platform.brand_set", { changed: Object.keys(input) }, {
    area: scope.store ? "website" : "platform",
  });
  return getBrand(scope);
}
