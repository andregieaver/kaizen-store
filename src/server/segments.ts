import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { rfm, RFM_MIN_CUSTOMERS, type RfmSegment } from "@/lib/analytics-customers";
import { toMain } from "@/lib/analytics-core";
import { mainCurrency } from "@/lib/markets";
import type { SubscriberStatus } from "@/lib/marketing-consent";
import { normaliseTag, tagKey, type Tag } from "@/lib/order-tags";
import {
  countSegment,
  matches,
  SEGMENT_CAP,
  SEGMENT_SAMPLE,
  segmentInput,
  segmentRulesSchema,
  type Person,
  type SegmentCount,
  type SegmentRules,
} from "@/lib/segments";

import { audit } from "./auth";
import { NOT_EDIT_REFUND, PAID } from "./analytics-sql";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * Segments and customer tags (wave 5 unit B, D296, `docs/wave-5-marketing.md` 4): the one reader of a store's people (`segmentPeople()`), the
 * segments' saving, and the only writer of `customer_tags`. A segment is counted when read, never stored as a list.
 */

export type People = {
  people: Person[];
  /** The reader stopped at `SEGMENT_CAP`. */
  capped: boolean;
  /** People with revenue in a currency the store has no rate for: they match no money condition. */
  moneyUnknown: number;
  missingRates: string[];
  /** Whether RFM groups mean anything yet (`RFM_MIN_CUSTOMERS` customers with a paid order). */
  rfmReady: boolean;
};

/**
 * Every person of the store, by lower-case address: accounts, guests with a paid order (D152's `PAID`, never a copied or host's order, never an
 * erased person's), and the subscriber list. One query; money is net revenue without VAT per currency, converted in code.
 */
export async function segmentPeople(store: Pick<Store, "id" | "markets" | "localization">, now = new Date()): Promise<People> {
  const id = store.id;
  const rows = await db().execute<Row>(sql`
    with ord as (
      select lower(coalesce(c.email, o.email)) as email, o.placed_at, trim(o.currency) as currency, o.market_code,
        nullif(o.shipping_address ->> 'name', '') as ship_name,
        (o.total_minor - o.tax_minor)::numeric
          - coalesce(rf.amount * (o.total_minor - o.tax_minor)::numeric / nullif(o.total_minor::numeric, 0), 0) as net
      from commerce.orders o
      left join commerce.customers c on c.store_id = o.store_id and c.id = o.customer_id
      left join (
        select p.order_id, sum(r.amount_minor)::numeric as amount
        from commerce.refunds r
        join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id
        where r.store_id = ${id}::uuid and r.status = 'succeeded' and ${NOT_EDIT_REFUND}
        group by p.order_id
      ) rf on rf.order_id = o.id
      where o.store_id = ${id}::uuid and ${PAID} and o.restricted_at is null and o.anonymised_at is null
        and coalesce(c.email, o.email) <> ''
    ),
    buyers as (
      select email, count(*)::int as orders, min(placed_at) as first_at, max(placed_at) as last_at,
        (array_agg(market_code order by placed_at desc))[1] as country,
        (array_agg(ship_name order by placed_at desc) filter (where ship_name is not null))[1] as ship_name
      from ord group by email
    ),
    money as (
      select email, json_agg(json_build_object('currency', currency, 'minor', round(net))) as money
      from (select email, currency, sum(net) as net from ord group by email, currency) m
      group by email
    ),
    accounts as (
      select c.id, lower(c.email) as email, nullif(c.name, '') as name, c.locale, c.email_verified_at is not null as verified,
        coalesce(c.tier_id, cc.tier_id) as tier_id, c.company_id is not null as company
      from commerce.customers c
      left join commerce.customer_companies cc on cc.store_id = c.store_id and cc.id = c.company_id
      where c.store_id = ${id}::uuid
    ),
    subs as (
      select lower(email) as email, status, locale, market_code, nullif(name, '') as name
      from commerce.marketing_subscribers where store_id = ${id}::uuid
    ),
    tags as (
      select email, array_agg(key order by key) as tags from commerce.customer_tags where store_id = ${id}::uuid group by email
    ),
    keys as (
      select email from accounts union select email from buyers union select email from subs
    )
    select k.email, a.id as customer_id, a.verified, a.tier_id, coalesce(a.company, false) as company,
      coalesce(a.name, b.ship_name, s.name, '') as name, coalesce(a.locale, s.locale) as locale,
      coalesce(b.country, s.market_code) as country, coalesce(b.orders, 0) as orders, b.first_at, b.last_at,
      m.money, s.status as consent, coalesce(t.tags, '{}') as tags
    from keys k
    left join accounts a on a.email = k.email
    left join buyers b on b.email = k.email
    left join money m on m.email = k.email
    left join subs s on s.email = k.email
    left join tags t on t.email = k.email
    order by b.last_at desc nulls last, k.email
    limit ${SEGMENT_CAP + 1}
  `);
  const capped = rows.length > SEGMENT_CAP;
  const main = mainCurrency(store as Store);
  const missing = new Set<string>();
  let unknown = 0;
  const people: Person[] = rows.slice(0, SEGMENT_CAP).map((r) => {
    const money = ((r.money ?? []) as { currency: string; minor: number }[]).map((m) => ({ currency: m.currency, minor: Number(m.minor) }));
    const total = toMain(money, main, store.localization.rates);
    for (const c of total.missing) missing.add(c);
    if (total.unconverted > 0) unknown += 1;
    const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);
    return {
      email: String(r.email),
      customerId: r.customer_id ? String(r.customer_id) : null,
      name: String(r.name ?? ""),
      account: r.customer_id != null,
      language: r.locale ? String(r.locale).slice(0, 2).toLowerCase() : null,
      country: r.country ? String(r.country).toLowerCase() : null,
      groupId: r.tier_id ? String(r.tier_id) : null,
      company: Boolean(r.company),
      orders: Number(r.orders ?? 0),
      firstOrderAt: iso(r.first_at),
      lastOrderAt: iso(r.last_at),
      spentMinor: total.unconverted > 0 ? null : total.minor,
      consent: r.consent ? (String(r.consent) as SubscriberStatus) : "none",
      rfm: null,
      tags: ((r.tags ?? []) as string[]).map(String),
    };
  });
  // D152's groups, over the customers with a paid order: a store's analytics and its segments agree.
  const buyers = people.filter((p) => p.lastOrderAt !== null);
  const rfmReady = buyers.length >= RFM_MIN_CUSTOMERS;
  if (rfmReady) {
    const scored = rfm(
      buyers.map((p) => ({ key: p.email, lastOrderAt: p.lastOrderAt as string, orders: p.orders, revenueMinor: p.spentMinor ?? 0 })),
      now,
    );
    const groups = new Map<string, RfmSegment>(scored.map((s) => [s.key, s.segment]));
    for (const p of people) p.rfm = groups.get(p.email) ?? null;
  }
  return { people, capped, moneyUnknown: unknown, missingRates: [...missing], rfmReady };
}

export type SegmentResult = SegmentCount & { capped: boolean; rfmReady: boolean; missingRates: string[]; sample: Person[] };

/** A rule set counted over the store's people now, with the first people by last order. */
export async function evaluateSegment(store: Pick<Store, "id" | "markets" | "localization">, rules: SegmentRules, now = new Date()): Promise<SegmentResult> {
  const all = await segmentPeople(store, now);
  const count = countSegment(rules, all.people, now);
  const sample = all.people.filter((p) => matches(rules, p, now)).slice(0, SEGMENT_SAMPLE);
  return { ...count, capped: all.capped, rfmReady: all.rfmReady, missingRates: all.missingRates, sample };
}

/** A database error's own words, with its cause's (the driver wraps them), for telling a known refusal from a fault. */
function errorText(error: unknown): string {
  const parts: string[] = [];
  for (let e: unknown = error, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    if (e instanceof Error) parts.push(e.message);
    const constraint = (e as { constraint?: unknown }).constraint;
    if (typeof constraint === "string") parts.push(constraint);
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Saved segments
// ---------------------------------------------------------------------------

/** `rules` is null for a stored rule set that no longer reads (a condition dropped from the list): it counts nobody rather than everyone. */
export type SavedSegment = { id: string; name: string; rules: SegmentRules | null; updatedAt: string };

const readRules = (value: unknown): SegmentRules | null => {
  const parsed = segmentRulesSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export async function listSegments(storeId: string): Promise<SavedSegment[]> {
  const rows = await db().execute<Row>(sql`select id, title, rules, updated_at from commerce.segments where store_id = ${storeId}::uuid order by lower(title)`);
  return rows.map((r) => ({ id: String(r.id), name: String(r.title), rules: readRules(r.rules), updatedAt: new Date(String(r.updated_at)).toISOString() }));
}

export async function getSegment(storeId: string, id: string): Promise<SavedSegment | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [r] = await db().execute<Row>(sql`select id, title, rules, updated_at from commerce.segments where store_id = ${storeId}::uuid and id = ${id}::uuid`);
  return r ? { id: String(r.id), name: String(r.title), rules: readRules(r.rules), updatedAt: new Date(String(r.updated_at)).toISOString() } : null;
}

export type SaveSegmentResult = { ok: true; id: string } | { ok: false; problem: string };

/** Creates (id null) or changes a segment, checked by `segmentInput`; audited with its name and how many conditions, never people. */
export async function saveSegment(storeId: string, accountId: string, id: string | null, input: unknown): Promise<SaveSegmentResult> {
  const parsed = segmentInput.safeParse(input);
  if (!parsed.success) return { ok: false, problem: parsed.error.issues[0]?.message ?? "The segment could not be read." };
  const { name, rules } = parsed.data;
  try {
    const rows = id
      ? await db().execute<Row>(sql`
          update commerce.segments set title = ${name}, rules = ${JSON.stringify(rules)}::jsonb, updated_at = now()
          where store_id = ${storeId}::uuid and id = ${id}::uuid returning id
        `)
      : await db().execute<Row>(sql`
          insert into commerce.segments (store_id, title, rules, created_by) values (${storeId}::uuid, ${name}, ${JSON.stringify(rules)}::jsonb, ${accountId}::uuid)
          returning id
        `);
    if (!rows[0]) return { ok: false, problem: "That segment is no longer there." };
    const saved = String(rows[0].id);
    await audit(accountId, storeId, "segment.saved", { name, conditions: rules.conditions.length }, { target: { type: "segment", id: saved } });
    return { ok: true, id: saved };
  } catch (error) {
    const message = errorText(error);
    if (message.includes("segments_title_idx")) return { ok: false, problem: "Another segment already has that name." };
    if (message.includes("segments.limit")) return { ok: false, problem: "A store has at most 100 segments. Delete one you no longer use." };
    throw error;
  }
}

export async function deleteSegment(storeId: string, accountId: string, id: string): Promise<boolean> {
  const rows = await db().execute<Row>(sql`delete from commerce.segments where store_id = ${storeId}::uuid and id = ${id}::uuid returning title`);
  if (!rows[0]) return false;
  await audit(accountId, storeId, "segment.deleted", { name: String(rows[0].title) }, { target: { type: "segment", id } });
  return true;
}

// ---------------------------------------------------------------------------
// Customer tags
// ---------------------------------------------------------------------------

const normal = (email: string) => email.trim().toLowerCase();

/** A person's tags, by their address. */
export async function tagsOf(storeId: string, email: string): Promise<Tag[]> {
  const rows = await db().execute<Row>(sql`
    select key, label from commerce.customer_tags where store_id = ${storeId}::uuid and email = ${normal(email)} order by created_at, key
  `);
  return rows.map((r) => ({ key: String(r.key), label: String(r.label) }));
}

/** The store's tags with how many people have each, for suggestions and the rule builder. */
export async function storeTags(storeId: string): Promise<{ key: string; label: string; people: number }[]> {
  const rows = await db().execute<Row>(sql`
    select key, (array_agg(label order by created_at))[1] as label, count(*)::int as people
    from commerce.customer_tags where store_id = ${storeId}::uuid group by key order by count(*) desc, key limit 200
  `);
  return rows.map((r) => ({ key: String(r.key), label: String(r.label), people: Number(r.people) }));
}

export type TagChange = { ok: true } | { ok: false; problem: string };

/** Tags a person (staff with `customers:write`), audited with the words and never the address. */
export async function addTag(storeId: string, accountId: string, email: string, typed: string): Promise<TagChange> {
  const result = normaliseTag(typed);
  if (!result.ok) return { ok: false, problem: result.problem === "too_long" ? "A tag is at most 40 characters." : result.problem === "empty" ? "Type a tag." : "A tag cannot hold a comma." };
  try {
    const rows = await db().execute<Row>(sql`
      insert into commerce.customer_tags (store_id, email, key, label, created_by)
      values (${storeId}::uuid, ${normal(email)}, ${result.tag.key}, ${result.tag.label}, ${accountId}::uuid)
      on conflict do nothing returning key
    `);
    if (rows[0]) await audit(accountId, storeId, "customer.tag_added", { tag: result.tag.label });
    return { ok: true };
  } catch (error) {
    if (errorText(error).includes("customer_tags.limit")) return { ok: false, problem: "A person has at most 50 tags." };
    throw error;
  }
}

export async function removeTag(storeId: string, accountId: string, email: string, typed: string): Promise<boolean> {
  const key = tagKey(typed);
  if (!key) return false;
  const rows = await db().execute<Row>(sql`
    delete from commerce.customer_tags where store_id = ${storeId}::uuid and email = ${normal(email)} and key = ${key} returning label
  `);
  if (!rows[0]) return false;
  await audit(accountId, storeId, "customer.tag_removed", { tag: String(rows[0].label) });
  return true;
}
