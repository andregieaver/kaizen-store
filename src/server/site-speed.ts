import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { decryptSecret, encryptSecret, secretHint } from "@/lib/secret-box";
import {
  CRUX_ENDPOINT,
  cruxRequest,
  readCrux,
  SPEED_CHECK_DAYS,
  SPEED_SITES_MAX,
  SPEED_STORES_PER_RUN,
  type CruxTarget,
  type SiteSpeedFacts,
  type SpeedFigures,
} from "@/lib/site-speed";

import { audit, type Account } from "./auth";
import { encryptionKey } from "./encryption-key";
import { log } from "./log";
import { ownSite } from "./market-search";
import { OwnerToolError } from "./owner-tool-error";
import { pgTextArray } from "./pg-arrays";
import { getStore, type Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * How fast a store's own site and its rivals' sites are for their visitors (D905, market check M5c, `docs/market-check.md` 7.4), the only
 * writer of `commerce.site_speeds` and `commerce.speed_settings`. The platform's Chrome UX Report key is set by a platform admin on
 * Platform → AI (free: 150 lookups a minute a Google Cloud project); the five-minute dispatcher's `rivalWatch` reads a store's sites
 * monthly, one store a run, sending only each site's address. No AI.
 */

// The key ---------------------------------------------------------------------------------------------------------------------------

const KEY_ROW = z.object({ key_encrypted: col.text, key_hint: col.text });
const keyRow = () => typedRow(KEY_ROW, sql`select key_encrypted, key_hint from commerce.speed_settings limit 1`);

/** What the settings card shows: the key's hint, or null when none is set. */
export async function speedSettings(): Promise<{ keyHint: string } | null> {
  const row = await keyRow();
  return row ? { keyHint: row.key_hint } : null;
}

/** The key for a reading, or null: none set, or it cannot be read. */
async function speedKey(): Promise<string | null> {
  const row = await keyRow();
  const key = encryptionKey();
  if (!row || !key) return null;
  try {
    return decryptSecret(row.key_encrypted, key);
  } catch {
    return null;
  }
}

/** Saves the platform's Chrome UX Report key (platform admins only); an empty key keeps the saved one. */
export async function saveSpeedKey(account: Account, input: { apiKey: string }): Promise<{ keyHint: string }> {
  if (!account.platformAdmin) throw new OwnerToolError("Only a platform admin sets the site speed key.");
  const apiKey = input.apiKey.trim();
  const before = await keyRow();
  if (!apiKey) {
    if (before) return { keyHint: before.key_hint };
    throw new OwnerToolError("Paste the Chrome UX Report API key.");
  }
  if (apiKey.length > 200 || /\s/.test(apiKey)) throw new OwnerToolError("That is not an API key: paste the key as Google Cloud shows it.");
  const key = encryptionKey();
  if (!key) throw new OwnerToolError("Secrets cannot be kept: SETTINGS_ENCRYPTION_KEY is not set.");
  const hint = secretHint(apiKey);
  await db().execute(sql`
    insert into commerce.speed_settings (key_encrypted, key_hint, updated_by, updated_at) values (${encryptSecret(apiKey, key)}, ${hint}, ${account.id}::uuid, now())
    on conflict (single) do update set key_encrypted = excluded.key_encrypted, key_hint = excluded.key_hint, updated_by = excluded.updated_by, updated_at = now()
  `);
  await audit(account.id, null, "platform.speed_key_set", {}, { area: "platform" });
  return { keyHint: hint };
}

/** Removes the key: no site's speed is read until one is set again. */
export async function removeSpeedKey(account: Account): Promise<void> {
  if (!account.platformAdmin) throw new OwnerToolError("Only a platform admin sets the site speed key.");
  await db().execute(sql`delete from commerce.speed_settings`);
  await audit(account.id, null, "platform.speed_key_removed", {}, { area: "platform" });
}

// Reading ---------------------------------------------------------------------------------------------------------------------------

export type SpeedDeps = { fetch?: typeof fetch; now?: Date };

/** One site's figures from the report, `none` when it has too few Chrome visitors, `failed` when it could not be asked. */
async function askCrux(target: CruxTarget, key: string, deps: SpeedDeps): Promise<(SpeedFigures & { periodEnd: string | null }) | "none" | "failed"> {
  const request = cruxRequest(target, key);
  if (!request.url.startsWith(`${CRUX_ENDPOINT}?`)) return "failed";
  try {
    const response = await (deps.fetch ?? fetch)(request.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: request.body,
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    if (response.status === 404) return "none";
    if (!response.ok) return "failed";
    return readCrux(await response.json()) ?? "none";
  } catch {
    return "failed";
  }
}

/** A site's figures by its origin, its `www.` twin tried when the bare host has none. */
async function askSite(site: string, key: string, deps: SpeedDeps) {
  if (site.includes("/")) return askCrux({ url: `https://${site}` }, key, deps);
  const bare = await askCrux({ origin: `https://${site}` }, key, deps);
  if (bare !== "none" || site.startsWith("www.")) return bare;
  return askCrux({ origin: `https://www.${site}` }, key, deps);
}

/** The sites a store's speed is read for: its own (a host, or a host and path), then its rivals' hosts, at most `SPEED_SITES_MAX`. */
async function sitesOf(store: Pick<Store, "id" | "slug" | "house">): Promise<{ site: string; own: boolean }[]> {
  const own = await ownSite(store);
  const mine = own.hosts[0] ?? (own.prefix ? `${own.prefix.host}${own.prefix.path}` : null);
  const rivals = await typedRows(z.object({ host: col.text }), sql`select distinct host from commerce.market_rivals where store_id = ${store.id}::uuid order by host`);
  const sites = [...(mine ? [{ site: mine, own: true }] : []), ...rivals.filter((r) => r.host !== mine).map((r) => ({ site: r.host, own: false }))];
  return sites.slice(0, SPEED_SITES_MAX);
}

/** Reads every site of a store and keeps what was found; a site no longer the store's or a rival's is dropped. */
async function measureStore(store: Pick<Store, "id" | "slug" | "house">, key: string, deps: SpeedDeps = {}): Promise<{ measured: number; none: number; failed: number }> {
  const at = (deps.now ?? new Date()).toISOString();
  const sites = await sitesOf(store);
  const tally = { measured: 0, none: 0, failed: 0 };
  for (const { site, own } of sites) {
    const got = await askSite(site, key, deps);
    if (got === "none" || got === "failed") {
      tally[got]++;
      // A site that could not be asked is tried again a day later; one with too few visitors next month.
      const tried = got === "failed" ? sql`${at}::timestamptz - make_interval(days => ${SPEED_CHECK_DAYS - 1})` : sql`${at}::timestamptz`;
      await db().execute(sql`
        insert into commerce.site_speeds (store_id, site, own, tried_at, problem) values (${store.id}::uuid, ${site}, ${own}, ${tried}, ${got})
        on conflict (store_id, site) do update set own = excluded.own, tried_at = excluded.tried_at, problem = excluded.problem
      `);
      continue;
    }
    tally.measured++;
    await db().execute(sql`
      insert into commerce.site_speeds (store_id, site, own, lcp_ms, inp_ms, cls_milli, period_end, checked_at, tried_at, problem)
      values (${store.id}::uuid, ${site}, ${own}, ${got.lcp}, ${got.inp}, ${got.cls}, ${got.periodEnd}::date, ${at}::timestamptz, ${at}::timestamptz, null)
      on conflict (store_id, site) do update set own = excluded.own, lcp_ms = excluded.lcp_ms, inp_ms = excluded.inp_ms, cls_milli = excluded.cls_milli,
        period_end = excluded.period_end, checked_at = excluded.checked_at, tried_at = excluded.tried_at, problem = null
    `);
  }
  await db().execute(sql`
    delete from commerce.site_speeds where store_id = ${store.id}::uuid
      and not (site = any(${pgTextArray(sites.map((s) => s.site))}::text[]))
  `);
  return tally;
}

export type SpeedWatchRun = { stores: number; measured: number; none: number; failed: number };

/**
 * The watcher's part for speed: with the platform's key set, a store whose sites were not tried within `SPEED_CHECK_DAYS` (one never
 * measured first), `SPEED_STORES_PER_RUN` a run, for every open store, Kaizena Flow's own too. The store's first site is marked tried
 * before it is read, so the next run takes another store. No AI.
 */
export async function watchSiteSpeeds(deps: SpeedDeps = {}): Promise<SpeedWatchRun> {
  const run: SpeedWatchRun = { stores: 0, measured: 0, none: 0, failed: 0 };
  const key = await speedKey();
  if (!key) return run;
  const at = (deps.now ?? new Date()).toISOString();
  const due = await typedRows(
    z.object({ id: col.uuid, slug: col.text }),
    sql`
      select s.id, s.slug from commerce.stores s
      where commerce.store_is_active(s.id)
        and not exists (
          select 1 from commerce.site_speeds x where x.store_id = s.id and x.tried_at > ${at}::timestamptz - make_interval(days => ${SPEED_CHECK_DAYS})
        )
      order by (select max(x.tried_at) from commerce.site_speeds x where x.store_id = s.id) nulls first, s.created_at
      limit ${SPEED_STORES_PER_RUN}
    `,
  );
  for (const d of due) {
    const store = await getStore(d.slug);
    if (!store || store.id !== d.id) continue;
    const tally = await measureStore(store, key, deps);
    run.stores++;
    run.measured += tally.measured;
    run.none += tally.none;
    run.failed += tally.failed;
    if (tally.failed > 0) log("info", "site_speed.failed", { store: store.id, failed: tally.failed });
  }
  return run;
}

const SPEED_ROW = z.object({
  site: col.text,
  own: col.bool,
  rival_name: col.textOrNull,
  lcp_ms: col.int.nullable(),
  inp_ms: col.int.nullable(),
  cls_milli: col.int.nullable(),
  period_end: col.textOrNull,
  checked_at: col.textOrNull,
  tried_at: col.text,
  problem: z.enum(["none", "failed"]).nullable(),
});

export type KeptSiteSpeed = SiteSpeedFacts & { triedAt: string };

/** The store's sites as last read: its own first, then its rivals' by name. */
export async function listSiteSpeeds(storeId: string): Promise<KeptSiteSpeed[]> {
  const rows = await typedRows(
    SPEED_ROW,
    sql`
      select x.site, x.own, r.name as rival_name, x.lcp_ms, x.inp_ms, x.cls_milli, x.period_end::text, x.checked_at::text, x.tried_at::text, x.problem
      from commerce.site_speeds x
      left join lateral (
        select m.name from commerce.market_rivals m where m.store_id = x.store_id and m.host = x.site order by m.created_at limit 1
      ) r on not x.own
      where x.store_id = ${storeId}::uuid and (x.own or r.name is not null)
      order by x.own desc, lower(r.name)
    `,
  );
  return rows.map((r) => ({
    host: r.site,
    rivalName: r.own ? null : r.rival_name,
    lcp: r.lcp_ms,
    inp: r.inp_ms,
    cls: r.cls_milli,
    periodEnd: r.period_end,
    checkedAt: r.checked_at,
    triedAt: r.tried_at,
    problem: r.problem,
  }));
}
