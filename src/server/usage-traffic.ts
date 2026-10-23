import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { storeOfHost } from "@/lib/ab-routing";
import { storeDomain } from "@/lib/paths";
import { siteUrl } from "@/lib/site";
import { themesHost } from "@/lib/theme-host";
import { slugInPath, type StoreKey, type TrafficTotal } from "@/lib/usage-drain";

/**
 * Where the drain's requests belong (D314, `docs/capacity.md` step 1.4), and adding them up. A host is a store's when it is on the store
 * domain (`{slug}.{domain}`) or one of the store's own domains; Kaizena Flow's own hosts are store null, except `/s/{slug}/…` on them,
 * which is that store's. The stores' slugs and domains are read at most once a minute per instance, never per request.
 */

type Facts = { bySlug: Map<string, string>; byHost: Map<string, string>; own: Set<string>; at: number };
let facts: Facts | null = null;
const FRESH_MS = 60_000;

async function loadFacts(now: number): Promise<Facts> {
  if (facts && now - facts.at < FRESH_MS) return facts;
  const [stores, domains] = await Promise.all([
    db().execute<{ id: string; slug: string }>(sql`select id, slug from commerce.stores`),
    db().execute<{ store_id: string; hostname: string }>(sql`select store_id, hostname from commerce.store_domains where status = 'active'`),
  ]);
  const own = new Set<string>();
  const site = new URL(siteUrl()).host.toLowerCase();
  own.add(site);
  own.add(site.startsWith("www.") ? site.slice(4) : `www.${site}`);
  const themes = themesHost();
  if (themes) own.add(themes.toLowerCase());
  const domain = storeDomain();
  if (domain) own.add(domain).add(`www.${domain}`);
  facts = {
    bySlug: new Map(stores.map((s) => [String(s.slug), String(s.id)])),
    byHost: new Map(domains.map((d) => [String(d.hostname).toLowerCase(), String(d.store_id)])),
    own,
    at: now,
  };
  return facts;
}

/** For tests: forget what was read. */
export function forgetTrafficFacts(): void {
  facts = null;
}

/** A function from host and path to a store id, null for Kaizena Flow's own, undefined for a host that is nobody's. */
export async function storeResolver(now = Date.now()): Promise<(host: string, path: string) => StoreKey | undefined> {
  const known = await loadFacts(now);
  const domain = storeDomain();
  return (host, path) => {
    const custom = known.byHost.get(host);
    if (custom) return custom;
    const slug = storeOfHost(host, domain, {});
    if (slug) return known.bySlug.get(slug);
    if (known.own.has(host) || host.endsWith(".vercel.app")) {
      const inPath = slugInPath(path);
      return inPath ? (known.bySlug.get(inPath) ?? null) : null;
    }
    return undefined;
  };
}

/**
 * Adds the totals to the day's counts, in one statement. A batch the drain sends again after a failed answer counts twice: accepted, as
 * traffic is a soft limit and an estimate either way.
 */
export async function addTraffic(totals: readonly TrafficTotal[]): Promise<number> {
  const rows = totals.flatMap((t) => [
    { storeId: t.storeId, day: t.day, metric: "requests", value: t.requests, estimated: t.estimated },
    ...(t.serverErrors > 0 ? [{ storeId: t.storeId, day: t.day, metric: "server_errors", value: t.serverErrors, estimated: t.estimated }] : []),
  ]);
  if (rows.length === 0) return 0;
  const values = sql.join(
    rows.map((r) => sql`(${r.storeId}::uuid, ${r.day}::date, ${r.metric}::text, ${r.value}::bigint, ${r.estimated}::boolean)`),
    sql`, `,
  );
  await db().execute(sql`
    insert into commerce.store_usage_daily (store_id, day, metric, value, estimated)
    select v.store_id, v.day, v.metric, v.value, v.estimated from (values ${values}) as v(store_id, day, metric, value, estimated)
    where v.store_id is null or exists (select 1 from commerce.stores s where s.id = v.store_id)
    on conflict (store_id, day, metric) do update
      set value = commerce.store_usage_daily.value + excluded.value,
          estimated = commerce.store_usage_daily.estimated or excluded.estimated,
          updated_at = now()
  `);
  return rows.length;
}
