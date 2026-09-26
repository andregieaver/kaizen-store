import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import type { ListedCookie } from "@/components/consent/cookie-policy";
import { db, readDb } from "@/db/client";
import {
  declaredCookies,
  OPTIONAL_CATEGORIES,
  toolCategories,
  trackingSchema,
  type KnownCookie,
  type OptionalCategory,
  type TrackingSettings,
} from "@/lib/cookie-consent";
import { cookieNoteInput, parseScannedItems, reviewFindings, type CookieNote, type ScannedItem } from "@/lib/cookie-scan";
import { codeCategories, customCodeInput, type CustomCode } from "@/lib/custom-code";

import { audit, type Account } from "./auth";

type Row = Record<string, unknown>;

/** Revalidate after a site's scan finishes or its notes change. */
export const cookiesTag = (storeId: string | null) => `cookies:${storeId ?? "kaizen"}`;

/** A site's latest finished scan and the owner's notes, cached until either changes. */
async function siteFindings(storeId: string | null): Promise<{ items: ScannedItem[]; notes: CookieNote[] }> {
  "use cache";
  cacheLife("hours");
  cacheTag(cookiesTag(storeId));
  const [scan] = await readDb().execute<Row>(sql`
    select items from commerce.cookie_scans
    where store_id is not distinct from ${storeId}::uuid and status = 'done'
    order by finished_at desc limit 1
  `);
  return { items: parseScannedItems(scan?.items), notes: await readNotes(storeId) };
}

async function readNotes(storeId: string | null): Promise<CookieNote[]> {
  const rows = await readDb().execute<Row>(sql`
    select kind, name, domain, category, provider, purpose from commerce.cookie_notes
    where store_id is not distinct from ${storeId}::uuid
    order by name
  `);
  return rows.flatMap((row) => {
    const parsed = cookieNoteInput.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

/** The owner's notes on what scans found, for the admin. */
export const listCookieNotes = readNotes;

/**
 * What a site stores in the browser (D58), for its cookie page and consent:
 * Kaizen's own cookies for that kind of site and those of the tools it has
 * switched on, plus what its latest scan found that Kaizen knows or the
 * owner has described. The optional categories among them are what
 * visitors are asked about, so a scan that finds a marketing cookie brings
 * the banner by itself, as does the owner's own code in an optional
 * category (D61, only where it is added: `liveCustomCode()`).
 */
export async function siteCookies(
  storeId: string | null,
  tracking: TrackingSettings,
  code: CustomCode = {},
): Promise<{ cookies: ListedCookie[]; categories: OptionalCategory[] }> {
  const listed = new Map<string, ListedCookie>();
  const list = ({ name, provider, category, days, purpose }: KnownCookie) =>
    listed.has(name) || listed.set(name, { name, provider, category, days, purpose });
  declaredCookies(storeId === null ? "platform" : "store", tracking).forEach(list);

  const { items, notes } = await siteFindings(storeId);
  for (const item of reviewFindings(items, notes)) {
    if (item.note) {
      const key = `${item.kind}|${item.name}`;
      if (!listed.has(key)) {
        listed.set(key, {
          name: item.name,
          kind: item.kind,
          provider: item.note.provider,
          category: item.note.category,
          days: item.days,
          purpose: { en: item.note.purpose },
        });
      }
    } else if (item.known) {
      list(item.known);
    }
  }
  const cookies = [...listed.values()];
  const used = new Set<OptionalCategory>([
    ...toolCategories(tracking),
    ...codeCategories(code),
    ...cookies.flatMap((cookie) => (cookie.category === "necessary" ? [] : [cookie.category])),
  ]);
  return { cookies, categories: OPTIONAL_CATEGORIES.filter((c) => used.has(c)) };
}

/**
 * Saves what an owner says about an item a scan found (D58): Kaizen's
 * with a null store. It goes on the cookie page, and an optional category
 * brings the banner.
 */
export async function saveCookieNote(
  account: Account,
  storeId: string | null,
  input: unknown,
): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const parsed = cookieNoteInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const note = parsed.data;
  await db().execute(sql`
    insert into commerce.cookie_notes (store_id, kind, name, domain, category, provider, purpose, updated_by)
    values (${storeId}::uuid, ${note.kind}, ${note.name}, ${note.domain}, ${note.category}, ${note.provider}, ${note.purpose}, ${account.id}::uuid)
    on conflict (coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, name, domain)
    do update set category = excluded.category, provider = excluded.provider, purpose = excluded.purpose,
      updated_by = excluded.updated_by, updated_at = now()
  `);
  await audit(account.id, storeId, "cookies.note_saved", { kind: note.kind, name: note.name, domain: note.domain, category: note.category });
  return { ok: true };
}

/**
 * Saves a site's analytics and marketing tools (D58): Kaizen's with a null
 * store. Each loads only once a visitor allows its category.
 */
export async function saveTracking(
  account: Account,
  storeId: string | null,
  input: unknown,
): Promise<{ ok: true; tracking: TrackingSettings } | { ok: false; problems: string[] }> {
  const parsed = trackingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const json = JSON.stringify(parsed.data);
  if (storeId === null) {
    await db().execute(sql`
      update commerce.platform_settings set tracking = ${json}::jsonb, updated_at = now(), updated_by = ${account.id}::uuid
    `);
  } else {
    await db().execute(sql`update commerce.stores set tracking = ${json}::jsonb where id = ${storeId}::uuid`);
  }
  await audit(account.id, storeId, `${storeId === null ? "platform" : "store"}.tracking_updated`, {
    tools: Object.keys(parsed.data),
  });
  return { ok: true, tracking: parsed.data };
}

/**
 * Saves a store's own code (D61). Owners only, checked by the action: the
 * code runs on the store's pages with full access to them.
 */
export async function saveCustomCode(
  account: Account,
  storeId: string,
  input: unknown,
): Promise<{ ok: true; code: CustomCode } | { ok: false; problems: string[] }> {
  const parsed = customCodeInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  await db().execute(sql`update commerce.stores set custom_code = ${JSON.stringify(parsed.data)}::jsonb where id = ${storeId}::uuid`);
  await audit(account.id, storeId, "store.custom_code_updated", {
    places: Object.fromEntries(Object.entries(parsed.data).map(([place, snippet]) => [place, { category: snippet.category, length: snippet.code.length }])),
  });
  return { ok: true, code: parsed.data };
}
