import "server-only";

import { sql } from "drizzle-orm";

import type { ListedCookie } from "@/components/consent/cookie-policy";
import { db, readDb } from "@/db/client";
import { OPTIONAL_CATEGORIES, STORE_ONLY_TOOLS, toolCategories, type ConsentExtra, type OptionalCategory, type TrackingSettings } from "@/lib/cookie-consent";
import { declaredCookies, type KnownCookie } from "@/lib/known-cookies";
import { trackingSchema } from "@/lib/cookie-consent-schema";
import { cookieNoteInput, reviewFindings, type CookieNote } from "@/lib/cookie-scan";
import { codeCategories, type CustomCode } from "@/lib/custom-code";
import { customCodeInput } from "@/lib/custom-code-schema";
import { featureOn } from "@/lib/store-features";

import { audit, type Account } from "./auth";
import { refreshStoreById } from "./stores";
import { owned } from "./owned";
import { cookiesTag, siteFacts } from "./site-facts";

type Row = Record<string, unknown>;

/** Revalidate after a site's scan finishes or its notes change. */
export { cookiesTag };

async function readNotes(storeId: string | null): Promise<CookieNote[]> {
  const rows = await readDb().execute<Row>(sql`
    select kind, name, domain, category, provider, purpose from commerce.cookie_notes
    where ${owned(storeId)}
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
  /**
   * The store sells to both private shoppers and businesses, so keeps their
   * choice (D63); it lets visitors choose light or dark (D99); it is private (D339), so a visitor who enters its password is given a pass,
   * a necessary cookie (the store as read says so: `store.privateMode`).
   */
  options: { buyers?: boolean; colorMode?: boolean; privateStore?: boolean } = {},
): Promise<{ cookies: ListedCookie[]; categories: OptionalCategory[]; extras: ConsentExtra[] }> {
  const listed = new Map<string, ListedCookie>();
  // What the site's optional features are, in one statement that carries every one of their tags (`siteFacts()`, bloat review step 2.18).
  const facts = await siteFacts(storeId);
  // A cookie of a store feature that is off (D178) is not the site's while it is: left out, even when an earlier scan found it.
  const features = facts.features;
  const offFeature = (cookie: KnownCookie) => Boolean(cookie.feature && features && !featureOn(features, cookie.feature));
  const list = (cookie: KnownCookie) => {
    const { name, provider, category, days, purpose, storage } = cookie;
    if (offFeature(cookie)) return;
    if (!listed.has(name)) listed.set(name, { name, provider, category, days, purpose, ...(storage ? { kind: `${storage}Storage` as const } : {}) });
  };
  // The chat agent keeps its conversation in the tab while it is on (D81).
  const chat = facts.chat;
  // Pop-ups that remember being closed keep it in the browser, as a preference (D121).
  const modals = facts.modals;
  // Kaizen's referral link is kept in a cookie, as marketing, while its program is on (D131): the banner asks for it.
  const referral = facts.referral;
  // A store with a referral program keeps the link a visitor opened, as marketing, once they allow it (D131).
  const site = facts.affiliate;
  // A creator's link (D386) is the same cookie, kept while either programme works.
  const affiliate = site?.capture ?? false;
  // A store with recommendations on keeps what a visitor did in this tab, to suggest products (D139).
  const recommendations = facts.recommendations;
  // A store with a running A/B test remembers a visitor's version, as statistics, once they allow it (D148): the banner asks for it.
  const experiments = facts.experiments;
  // Kaizena Flow's own site in more than one language remembers a closed language suggestion, as a preference (D312); a store with Several
  // languages on remembers a language a visitor chose in its switcher, for its front door (D479).
  const languages = storeId === null ? facts.platformLangs > 1 : Boolean(features && featureOn(features, "languages"));
  // A store that counts visits and already asks about statistics keeps a visitor's first visit in 30 days once they allow it (D303 I3).
  // Heatmaps run under statistics and recordings ask a purpose of their own (D656): the banner asks for them while they are on.
  const heatmaps = facts.heatmaps;
  const recordings = facts.recordings;
  const touch = facts.visitCounting && (toolCategories(tracking).includes("statistics") || experiments);
  declaredCookies(storeId === null ? "platform" : "store", tracking, { ...options, chat, modals, referrals: referral?.enabled ?? false, affiliate, recommendations, experiments, recordings, languages, touch })
    .map((cookie) => (cookie.referrals && referral ? { ...cookie, days: referral.cookieDays } : cookie))
    .map((cookie) => (cookie.affiliate && site ? { ...cookie, days: site.captureDays } : cookie))
    .forEach(list);

  for (const item of reviewFindings(facts.scanItems, facts.notes)) {
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
    ...(heatmaps ? (["statistics"] as const) : []),
  ]);
  // The `heat` token makes visitors be asked again when heatmaps start, and only then: a store without them keeps its version as it was.
  const extras: ConsentExtra[] = heatmaps ? ["heat"] : [];
  return { cookies, categories: OPTIONAL_CATEGORIES.filter((c) => used.has(c)), extras };
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
  // Kaizena Flow's own site has no ads tags (D303 I1).
  if (storeId === null) for (const key of STORE_ONLY_TOOLS) delete parsed.data[key];
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
  if (storeId !== null) await refreshStoreById(storeId);
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
  await refreshStoreById(storeId);
  return { ok: true, code: parsed.data };
}
