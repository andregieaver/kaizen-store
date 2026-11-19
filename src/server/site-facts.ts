import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";

import { readDb } from "@/db/client";
import { cookieNoteInput, parseScannedItems, type CookieNote, type ScannedItem } from "@/lib/cookie-scan";
import { REFERRAL_DEFAULTS } from "@/lib/referrals";
import { cookiesTag } from "@/lib/cache-tags";

import { affiliateCapture, affiliateTag } from "./affiliates";
import { chatTag } from "./chat-agent";
import { experimentsTag } from "./experiments";
import { owned } from "./owned";
import { rememberedModalExists } from "./page-modals";
import { pagesTag } from "./pages";
import { offeredLangs, PLATFORM_NAVIGATION_TAG } from "./platform-navigation";
import { recommendTag } from "./recommend-settings";
import { REFERRALS_TAG } from "./referrals";
import { col, typedRow } from "./typed-rows";

/**
 * What a site's frame asks about its optional features, in one statement (bloat review step 2.18, DQ-7): `siteCookies()` read it with nine
 * readers one after another, one per feature whether the site used it or not. It folds the store's features and visit counting with heatmaps
 * and recordings (`storeFeatures()`, tag `cookiesTag`), whether the chat agent is on (`getChatAgent()`, `chatTag`), whether a published
 * pop-up remembers being closed (`usesRememberedModals()`, `pagesTag`), a store's referral and creator programmes (`affiliateSite()`,
 * `affiliateTag`) or Kaizena Flow's referral program (`referralPublicSettings()`, `REFERRALS_TAG`), recommendations (`getRecommendSettings()`,
 * `recommendTag`), running A/B tests (`storeHasExperiments()`, `experimentsTag`), Kaizena Flow's languages (`getPlatformLangs()`,
 * `PLATFORM_NAVIGATION_TAG`), and the latest finished scan with the owner's notes (`siteFindings()`, `cookiesTag`). It keeps exactly the
 * tags of the readers it folds, so a switch of any feature refreshes it as it refreshed them; a new feature the banner must know about adds a
 * field here and its tag, not a read. The per-feature readers stay for their own screens and parts.
 */

export { cookiesTag } from "@/lib/cache-tags";

export type SiteFacts = {
  /** The store's features (D178); null for Kaizena Flow's own site. */
  features: string[] | null;
  visitCounting: boolean;
  /** Heatmaps and recordings (D656), a store's only. */
  heatmaps: boolean;
  recordings: boolean;
  /** The chat agent is on (D81). */
  chat: boolean;
  /** A published pop-up remembers being closed (D121). */
  modals: boolean;
  /** Kaizena Flow's referral program (D131); null for a store. */
  referral: { enabled: boolean; cookieDays: number } | null;
  /** A store's referral or creator link capture (D131, D386); null for Kaizena Flow. */
  affiliate: { capture: boolean; captureDays: number } | null;
  /** Recommendations are on (D139). */
  recommendations: boolean;
  /** A test is running (D148). */
  experiments: boolean;
  /** How many languages Kaizena Flow's own site is offered in (D312); 0 for a store. */
  platformLangs: number;
  scanItems: ScannedItem[];
  notes: CookieNote[];
};

const FACTS = z.object({
  features: z.array(z.string()).nullable(),
  visit_counting: col.bool,
  heatmaps: col.bool,
  recordings: col.bool,
  chat: col.bool,
  modals: col.bool,
  referral: z.object({ enabled: z.boolean().nullable(), cookieDays: z.number().nullable() }).nullable(),
  affiliate_on: col.bool,
  affiliate_days: col.int,
  creators_on: col.bool,
  creator_days: col.int,
  recommendations: col.bool,
  experiments: col.bool,
  locales: z.unknown(),
  scan_items: z.unknown(),
  notes: z.array(z.unknown()),
});

export async function siteFacts(storeId: string | null): Promise<SiteFacts> {
  "use cache";
  cacheLife("hours");
  if (storeId === null) cacheTag(cookiesTag(null), chatTag(null), pagesTag(null), REFERRALS_TAG, PLATFORM_NAVIGATION_TAG);
  else cacheTag(cookiesTag(storeId), chatTag(storeId), pagesTag(storeId), affiliateTag(storeId), recommendTag(storeId), experimentsTag(storeId));
  const store = storeId === null ? null : sql`${storeId}::uuid`;
  const row = await typedRow(
    FACTS,
    sql`
      select
        ${store ? sql`st.features` : sql`null::text[]`} as features,
        ${store ? sql`coalesce(st.visit_counting, false)` : sql`false`} as visit_counting,
        ${store ? sql`coalesce(st.heatmaps, false)` : sql`false`} as heatmaps,
        ${store ? sql`coalesce(st.recordings, false)` : sql`false`} as recordings,
        exists (select 1 from commerce.chat_agents where ${owned(storeId)} and enabled) as chat,
        ${rememberedModalExists(storeId)} as modals,
        ${store ? sql`null::jsonb` : sql`(select jsonb_build_object('enabled', r.enabled, 'cookieDays', r.cookie_days) from commerce.referral_program() r)`} as referral,
        ${store ? sql`coalesce(commerce.affiliate_program_on(${store}), false)` : sql`false`} as affiliate_on,
        ${store ? sql`coalesce((select cookie_days from commerce.affiliate_settings where store_id = ${store}), 30)` : sql`30`}::int as affiliate_days,
        ${store ? sql`coalesce(commerce.creator_program_on(${store}), false)` : sql`false`} as creators_on,
        ${store ? sql`coalesce((select cookie_days from commerce.creator_settings where store_id = ${store}), 30)` : sql`30`}::int as creator_days,
        ${store ? sql`coalesce((select enabled from commerce.recommendation_settings where store_id = ${store}), false)` : sql`false`} as recommendations,
        ${
          store
            ? sql`exists (select 1 from commerce.experiments where store_id = ${store} and status = 'running' and commerce.extension_on(store_id, 'ab_testing'))`
            : sql`false`
        } as experiments,
        ${store ? sql`null::text[]` : sql`(select locales from commerce.platform_settings limit 1)`} as locales,
        (select items from commerce.cookie_scans
         where coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(${storeId}::uuid, '00000000-0000-0000-0000-000000000000'::uuid) and status = 'done'
         order by finished_at desc limit 1) as scan_items,
        (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'name', name, 'domain', domain, 'category', category, 'provider', provider, 'purpose', purpose) order by name), '[]'::jsonb)
         from commerce.cookie_notes where ${owned(storeId)}) as notes
      from (select 1) one
      ${store ? sql`left join commerce.stores st on st.id = ${store}` : sql``}
    `,
    readDb(),
  );
  if (!row) throw new Error("siteFacts: the statement returned no row");
  return {
    features: storeId === null ? null : (row.features ?? []).map(String),
    visitCounting: row.visit_counting,
    heatmaps: row.heatmaps,
    recordings: row.recordings,
    chat: row.chat,
    modals: row.modals,
    referral:
      storeId === null ? { enabled: Boolean(row.referral?.enabled), cookieDays: Number(row.referral?.cookieDays ?? REFERRAL_DEFAULTS.cookieDays) } : null,
    affiliate:
      storeId === null
        ? null
        : affiliateCapture({ on: row.affiliate_on, creators: row.creators_on, cookieDays: row.affiliate_days, creatorDays: row.creator_days }),
    recommendations: row.recommendations,
    experiments: row.experiments,
    platformLangs: storeId === null ? offeredLangs(row.locales).length : 0,
    scanItems: parseScannedItems(row.scan_items),
    notes: row.notes.flatMap((note) => {
      const parsed = cookieNoteInput.safeParse(note);
      return parsed.success ? [parsed.data] : [];
    }),
  };
}
