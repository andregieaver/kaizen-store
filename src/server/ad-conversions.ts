import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { adRequest, AD_HOSTS, normaliseEmail, normalisePhone, type AdEvent, type AdPlatform, type Conversion } from "@/lib/ad-payloads";
import { cleanAdSignals, type AdSignals } from "@/lib/ad-signals";
import { storeSiteUrl } from "@/lib/paths";
import { majorAmount } from "@/lib/shop-events";

import { liveConnections } from "./ad-connections";

/**
 * Server-side conversion events (wave 5 unit I2, D303, `docs/wave-5-marketing.md` 12.3). A cart keeps the shopper's marketing consent and the
 * ad platforms' ids (`recordAdSignals()`, from `/api/ads/signals`); an order takes them from its cart by trigger. The every-minute marketing job
 * queues a checkout started and a purchase for each order that may send (`queueAdConversions()`: consent on its cart, a shopper's checkout, not
 * copied, a host's, restricted, test mode or gift cards only) and sends them (`sendAdConversions()`), each once per platform with the order's id
 * as the event id. Nothing personal leaves Kaizena Flow unless the owner chose *Enhanced*, and then only hashes.
 */

type Row = Record<string, unknown>;

/** Writes (or with consent withdrawn, clears) the ids on the store's open carts named by the shopper's own cart cookies. */
export async function recordAdSignals(storeId: string, cartIds: string[], consent: boolean, input: unknown): Promise<number> {
  if (cartIds.length === 0) return 0;
  const signals = cleanAdSignals(input);
  const rows = consent
    ? await db().execute<Row>(sql`
        update commerce.carts set ad_consent_at = coalesce(ad_consent_at, now()), ad_signals = coalesce(ad_signals, '{}'::jsonb) || ${JSON.stringify(signals)}::jsonb
        where store_id = ${storeId}::uuid and id = any(${`{${cartIds.join(",")}}`}::uuid[]) and status = 'open'
        returning id
      `)
    : await db().execute<Row>(sql`
        update commerce.carts set ad_consent_at = null, ad_signals = null
        where store_id = ${storeId}::uuid and id = any(${`{${cartIds.join(",")}}`}::uuid[]) and status = 'open'
        returning id
      `);
  return rows.length;
}

/** Orders that may send a conversion: a shopper's own checkout with consent on its cart, no copy, host, restricted or gift-card-only order. */
const ELIGIBLE = sql`(o.ad_consent_at is not null and o.source = 'checkout' and o.copied_from is null and o.host_id is null
  and o.restricted_at is null
  and exists (select 1 from commerce.order_lines l left join commerce.product_variants v on v.id = l.variant_id
    left join commerce.products p on p.id = v.product_id where l.order_id = o.id and coalesce(p.kind, 'goods') <> 'gift_card'))`;

/** A purchase: a captured payment that is not Stripe's test mode. */
const PURCHASED = sql`(exists (select 1 from commerce.payments p where p.store_id = o.store_id and p.order_id = o.id and p.status = 'captured')
  and not exists (select 1 from commerce.payments p where p.store_id = o.store_id and p.order_id = o.id and p.test_mode))`;

/** Queues each eligible order's events for every connection that is on; a row once made is never made again. */
export async function queueAdConversions(): Promise<number> {
  const rows = await db().execute<Row>(sql`
    insert into commerce.ad_conversions (store_id, order_id, platform, event)
    select o.store_id, o.id, c.platform, e.event
    from commerce.orders o
    join commerce.ad_connections c on c.store_id = o.store_id and c."on"
    cross join (values ('begin_checkout'), ('purchase')) as e(event)
    where o.created_at > now() - interval '7 days' and ${ELIGIBLE}
      and (e.event = 'begin_checkout' or ${PURCHASED})
      and commerce.store_is_active(o.store_id)
    on conflict (store_id, order_id, platform, event) do nothing
    returning 1
  `);
  return rows.length;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** The order's facts as a conversion; the hashes only at the *Enhanced* level. */
async function conversionOf(storeId: string, orderId: string, event: AdEvent, enhanced: boolean): Promise<Conversion | null> {
  const [order] = await db().execute<Row>(sql`
    select o.id, o.currency, o.total_minor, o.created_at, o.email, o.billing_address->>'phone' as phone, o.ad_signals, s.slug,
      (select max(p.created_at) from commerce.payments p where p.store_id = o.store_id and p.order_id = o.id and p.status = 'captured') as paid_at
    from commerce.orders o join commerce.stores s on s.id = o.store_id
    where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid and ${ELIGIBLE}
  `);
  if (!order) return null;
  const lines = await db().execute<Row>(sql`
    select coalesce(nullif(l.sku, ''), l.variant_id::text, l.id::text) as id, l.quantity, l.unit_price_minor
    from commerce.order_lines l where l.store_id = ${storeId}::uuid and l.order_id = ${orderId}::uuid
  `);
  const currency = String(order.currency);
  const when = new Date(String(event === "purchase" && order.paid_at ? order.paid_at : order.created_at));
  const email = order.email ? normaliseEmail(String(order.email)) : "";
  const phone = order.phone ? normalisePhone(String(order.phone)) : null;
  return {
    event,
    eventId: String(order.id),
    time: Math.floor(when.getTime() / 1000),
    currency,
    value: majorAmount(Number(order.total_minor), currency),
    lines: lines.map((l) => ({ id: String(l.id), quantity: Number(l.quantity), price: majorAmount(Number(l.unit_price_minor), currency) })),
    signals: cleanAdSignals(order.ad_signals) as AdSignals,
    pageUrl: storeSiteUrl(String(order.slug)),
    ...(enhanced ? { hashes: { ...(email.includes("@") ? { email: sha256(email) } : {}), ...(phone ? { phone: sha256(phone) } : {}) } } : {}),
  };
}

export const SEND_TRIES = 3;

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

/** Sends the due events, a batch at a time; a failure is tried again later, three times in all, then kept as failed with its answer. */
export async function sendAdConversions({ deadline = Date.now() + 40_000, fetcher = fetch as unknown as Fetch } = {}): Promise<{ sent: number; skipped: number; failed: number }> {
  const done = { sent: 0, skipped: 0, failed: 0 };
  while (Date.now() < deadline) {
    const due = await db().execute<Row>(sql`
      update commerce.ad_conversions set next_at = now() + interval '5 minutes'
      where id in (select id from commerce.ad_conversions where status = 'pending' and next_at <= now() order by next_at limit 20 for update skip locked)
      returning id, store_id, order_id, platform, event, tries
    `);
    if (due.length === 0) break;
    const connections = new Map<string, Awaited<ReturnType<typeof liveConnections>>>();
    for (const row of due) {
      const storeId = String(row.store_id);
      if (!connections.has(storeId)) connections.set(storeId, await liveConnections(storeId));
      const connection = connections.get(storeId)!.find((c) => c.platform === row.platform);
      const finish = async (status: "sent" | "skipped" | "failed" | "pending", answer: string | null, tries = Number(row.tries)) => {
        await db().execute(sql`
          update commerce.ad_conversions set status = ${status}, answer = ${answer}, tries = ${tries},
            sent_at = ${status === "sent" ? sql`now()` : sql`sent_at`},
            next_at = now() + make_interval(mins => ${5 * 2 ** tries})
          where id = ${String(row.id)}::uuid
        `);
        if (status === "sent") done.sent++;
        else if (status === "skipped") done.skipped++;
        else if (status === "failed") done.failed++;
      };
      if (!connection) {
        await finish("skipped", "not_connected");
        continue;
      }
      const conversion = await conversionOf(storeId, String(row.order_id), row.event as AdEvent, connection.dataLevel === "enhanced");
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
      const tries = Number(row.tries) + 1;
      try {
        const answer = await fetcher(request.url, { method: "POST", headers: request.headers, body: request.body, signal: AbortSignal.timeout(5000) });
        if (answer.ok) await finish("sent", String(answer.status), tries);
        else await finish(tries >= SEND_TRIES || (answer.status >= 400 && answer.status < 500 && answer.status !== 429) ? "failed" : "pending", `http_${answer.status}`, tries);
      } catch (error) {
        await finish(tries >= SEND_TRIES ? "failed" : "pending", error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network", tries);
      }
    }
  }
  return done;
}

/** Clears the ids from orders 90 days after they were made (the daily job): what was sent is sent, and nothing more is needed. */
export async function pruneAdSignals(): Promise<number> {
  const rows = await db().execute<Row>(sql`
    update commerce.orders set ad_signals = null where ad_signals is not null and created_at < now() - interval '90 days' returning 1
  `);
  return rows.length;
}

/** The last seven days per platform, by outcome and reason, for the settings page: counts only, never an order or a person. */
export async function adConversionCounts(storeId: string): Promise<{ platform: AdPlatform; status: string; answer: string | null; n: number }[]> {
  const rows = await db().execute<Row>(sql`
    select platform, status, case when status = 'sent' then null else answer end as answer, count(*)::int as n
    from commerce.ad_conversions where store_id = ${storeId}::uuid and created_at > now() - interval '7 days'
    group by 1, 2, 3 order by 1, 2
  `);
  return rows.map((r) => ({ platform: String(r.platform) as AdPlatform, status: String(r.status), answer: r.answer ? String(r.answer) : null, n: Number(r.n) }));
}
