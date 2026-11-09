import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { adRequest, AD_HOSTS, normaliseEmail, type AdPlatform, type PlatformAdEvent } from "@/lib/ad-payloads";
import { cleanAdSignals } from "@/lib/ad-signals";
import { platformConversion } from "@/lib/platform-ad-conversions";
import { siteUrl } from "@/lib/site";

import { liveConnections } from "./ad-connections";
import { SEND_TRIES } from "./ad-conversions";
import { houseStoreId } from "./house-customers";
import { log } from "./log";
import { col, typedRows } from "./typed-rows";

/**
 * Kaizena Flow's own conversions (C2, D523, `src/lib/platform-ad-conversions.ts`): a sign-up and the first paid plan of the store it made,
 * sent to the ad platforms connected to Kaizena Flow's store (its Ads and conversions page, D303) as a store's checkout and purchase are. Only
 * a request made with marketing consent (`access_requests.ad_consent_at`, kept by the sign-up form) ever sends; a plan only within 90 days of
 * the request, while its ids are kept; each event once per platform (`commerce.platform_ad_conversions`, written only here). Nothing personal
 * leaves unless the connection's level is *Enhanced*, and then only the email's SHA-256 hash.
 */

/** Requests of real owners only: never a demo store, a template, a sandbox or Kaizena Flow's own. */
const REAL_STORE = sql`not (s.is_template or s.starter) and not s.sandbox and not s.house`;

/**
 * Queues what may send, for every connection of Kaizena Flow's store that is on: a sign-up made in the last 7 days, and the first live plan
 * paid in the last 7 days by the store a request made. A row once made is never made again.
 */
export async function queuePlatformAdConversions(): Promise<number> {
  const signUps = await db().execute(sql`
    insert into commerce.platform_ad_conversions (request_id, platform, event)
    select r.id, c.platform, 'sign_up'
    from commerce.access_requests r
    join commerce.ad_connections c on c.store_id = commerce.house_store() and c."on"
    where r.ad_consent_at is not null and r.created_at > now() - interval '7 days'
    on conflict (request_id, platform, event) do nothing
    returning 1
  `);
  const plans = await db().execute(sql`
    insert into commerce.platform_ad_conversions (request_id, platform, event)
    select r.id, c.platform, 'plan_paid'
    from commerce.access_requests r
    join commerce.stores s on s.id = r.store_id
    join commerce.ad_connections c on c.store_id = commerce.house_store() and c."on"
    where r.ad_consent_at is not null and r.created_at > now() - interval '90 days' and ${REAL_STORE}
      and (select min(p.paid_at) from commerce.platform_sales p where p.buyer_store_id = r.store_id and p.mode = 'live' and p.kind = 'plan')
        > now() - interval '7 days'
    on conflict (request_id, platform, event) do nothing
    returning 1
  `);
  return signUps.length + plans.length;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** The request's facts as an event: null when it may no longer send (consent gone, ids pruned, no plan paid, a store that is not an owner's). */
async function conversionOf(requestId: string, event: PlatformAdEvent, enhanced: boolean) {
  const [request] = await typedRows(
    z.object({ email: col.text, created_at: col.timestamp, ad_signals: z.unknown(), store_id: col.uuid.nullable(), real: col.bool }),
    sql`
      select r.email, r.created_at, r.ad_signals, r.store_id, coalesce((select ${REAL_STORE} from commerce.stores s where s.id = r.store_id), false) as real
      from commerce.access_requests r where r.id = ${requestId}::uuid and r.ad_consent_at is not null
    `,
  );
  if (!request) return null;
  const email = normaliseEmail(request.email);
  const base = { requestId, signals: cleanAdSignals(request.ad_signals), emailHash: enhanced && email.includes("@") ? sha256(email) : null, site: siteUrl() };
  if (event === "sign_up") return platformConversion({ ...base, event, at: new Date(request.created_at) });
  if (!request.store_id || !request.real) return null;
  const [sale] = await typedRows(
    z.object({ id: col.uuid, paid_at: col.timestamp, currency: col.currency, net_minor: col.minor, plan: col.textOrNull }),
    sql`
      select p.id, p.paid_at, p.currency, p.net_minor, (select b.plan_id::text from commerce.store_billing b where b.store_id = p.buyer_store_id) as plan
      from commerce.platform_sales p
      where p.buyer_store_id = ${request.store_id}::uuid and p.mode = 'live' and p.kind = 'plan'
      order by p.paid_at, p.id limit 1
    `,
  );
  if (!sale) return null;
  return platformConversion({ ...base, event, saleId: sale.id, at: new Date(sale.paid_at), netMinor: sale.net_minor, currency: sale.currency, plan: sale.plan });
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

/** Sends what is due, a batch at a time; a failure is tried again later, three times in all, then kept as failed with its answer. */
export async function sendPlatformAdConversions({ deadline = Date.now() + 40_000, fetcher = fetch as unknown as Fetch } = {}): Promise<{ sent: number; skipped: number; failed: number }> {
  const done = { sent: 0, skipped: 0, failed: 0 };
  const house = await houseStoreId();
  const connections = house ? await liveConnections(house) : [];
  while (Date.now() < deadline) {
    const due = await typedRows(
      z.object({ id: col.uuid, request_id: col.uuid, platform: col.text, event: z.enum(["sign_up", "plan_paid"]), tries: col.int }),
      sql`
        update commerce.platform_ad_conversions set next_at = now() + interval '5 minutes'
        where id in (select id from commerce.platform_ad_conversions where status = 'pending' and next_at <= now() order by next_at limit 20 for update skip locked)
        returning id, request_id, platform, event, tries
      `,
    );
    if (due.length === 0) break;
    for (const row of due) {
      const finish = async (status: "sent" | "skipped" | "failed" | "pending", answer: string | null, tries = row.tries) => {
        await db().execute(sql`
          update commerce.platform_ad_conversions set status = ${status}, answer = ${answer}, tries = ${tries},
            sent_at = ${status === "sent" ? sql`now()` : sql`sent_at`},
            next_at = now() + make_interval(mins => ${5 * 2 ** tries})
          where id = ${row.id}::uuid
        `);
        if (status !== "pending") done[status]++;
      };
      const connection = connections.find((c) => c.platform === row.platform);
      if (!connection) {
        await finish("skipped", "not_connected");
        continue;
      }
      const conversion = await conversionOf(row.request_id, row.event, connection.dataLevel === "enhanced");
      if (!conversion) {
        await finish("skipped", "not_eligible");
        continue;
      }
      const request = adRequest(connection, conversion);
      if (!request) {
        await finish("skipped", "nothing_to_match");
        continue;
      }
      // Only the platform's own host, ever.
      if (new URL(request.url).host !== AD_HOSTS[connection.platform as AdPlatform]) {
        await finish("failed", "bad_host");
        continue;
      }
      const tries = row.tries + 1;
      try {
        const answer = await fetcher(request.url, { method: "POST", headers: request.headers, body: request.body, signal: AbortSignal.timeout(5000) });
        if (answer.ok) await finish("sent", String(answer.status), tries);
        else await finish(tries >= SEND_TRIES || (answer.status >= 400 && answer.status < 500 && answer.status !== 429) ? "failed" : "pending", `http_${answer.status}`, tries);
      } catch (error) {
        await finish(tries >= SEND_TRIES ? "failed" : "pending", error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network", tries);
      }
    }
  }
  if (done.failed > 0) log("warn", "platform_ads.failed", { ...done });
  return done;
}

/** The consent and the ids leave a request 90 days after it was made (the daily job): a plan paid later sends nothing. */
export async function prunePlatformAdSignals(): Promise<number> {
  const rows = await db().execute(sql`
    update commerce.access_requests set ad_consent_at = null, ad_signals = null
    where ad_consent_at is not null and created_at < now() - interval '90 days' returning 1
  `);
  return rows.length;
}

export type PlatformAdCount = { platform: AdPlatform; event: PlatformAdEvent; status: string; answer: string | null; n: number };

/** The last 30 days per platform and event, by outcome and reason, for the platform's page: counts only, never a request or a person. */
export async function platformAdConversionCounts(): Promise<PlatformAdCount[]> {
  const rows = await typedRows(
    z.object({ platform: col.text, event: z.enum(["sign_up", "plan_paid"]), status: col.text, answer: col.textOrNull, n: col.int }),
    sql`
      select platform, event, status, case when status = 'sent' then null else answer end as answer, count(*)::int as n
      from commerce.platform_ad_conversions where created_at > now() - interval '30 days'
      group by 1, 2, 3, 4 order by 1, 2, 3
    `,
  );
  return rows.map((r) => ({ platform: r.platform as AdPlatform, event: r.event, status: r.status, answer: r.answer, n: r.n }));
}

/** Kaizena Flow's store's connections, for the platform's page: which platforms are on, never a token. */
export async function platformAdConnections(): Promise<{ houseSlug: string | null; on: AdPlatform[] }> {
  const rows = await typedRows(
    z.object({ slug: col.text, platform: col.textOrNull }),
    sql`
      select s.slug, c.platform from commerce.stores s left join commerce.ad_connections c on c.store_id = s.id and c."on"
      where s.id = commerce.house_store() order by c.platform
    `,
  );
  return { houseSlug: rows[0]?.slug ?? null, on: rows.flatMap((r) => (r.platform ? [r.platform as AdPlatform] : [])) };
}
