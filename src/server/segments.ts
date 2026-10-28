import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { toMain } from "@/lib/analytics-core";
import { amountCell, writeCsv } from "@/lib/csv";
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
  TAGS_PER_PERSON,
  type Person,
  type SegmentCount,
  type SegmentRules,
} from "@/lib/segments";

import { audit } from "./auth";
import { rfmGroups } from "./analytics-customers-data";
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

/** What the people reader needs of a store; its time zone is read when not given (the RFM groups' months are the store's). */
export type SegmentStore = Pick<Store, "id" | "markets" | "localization"> & { timeZone?: string };

/**
 * Every person of the store, by lower-case address: accounts, guests with a paid order (D152's `PAID`, never a copied or host's order, never an
 * erased person's), and the subscriber list. One query; money is net revenue without VAT per currency, converted in code. With `emails`, only
 * those people (a discount limited to a segment asks for one buyer, D380); `rfm: false` leaves their RFM group unread (no rule asks it).
 */
export async function segmentPeople(
  store: SegmentStore,
  now = new Date(),
  options: { emails?: readonly string[]; rfm?: boolean } = {},
): Promise<People> {
  const id = store.id;
  const only = options.emails ? JSON.stringify([...new Set(options.emails.map((e) => e.trim().toLowerCase()))]) : null;
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
      select email from (select email from accounts union select email from buyers union select email from subs) k
      where ${only}::jsonb is null or k.email in (select jsonb_array_elements_text(${only}::jsonb))
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
  // The Customers page's own groups (D380, `rfmGroups()`): a segment of Champions is the page's Champions.
  let rfmReady = false;
  if (options.rfm !== false) {
    const timeZone = store.timeZone ?? (await storeTimeZone(id));
    const scored = await rfmGroups({ ...store, timeZone }, now);
    rfmReady = scored.ready;
    if (rfmReady) for (const p of people) p.rfm = scored.groups.get(p.email) ?? null;
  }
  return { people, capped, moneyUnknown: unknown, missingRates: [...missing], rfmReady };
}

async function storeTimeZone(storeId: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`select time_zone from commerce.stores where id = ${storeId}::uuid`);
  return row?.time_zone ? String(row.time_zone) : "Europe/Oslo";
}

export type SegmentResult = SegmentCount & {
  capped: boolean;
  rfmReady: boolean;
  missingRates: string[];
  /** One page of the people in it, by last order (`SEGMENT_SAMPLE` a page). */
  sample: Person[];
  /** The page shown (from 0) and how many there are (D380). */
  page: number;
  pages: number;
};

/** A rule set counted over the store's people now, with one page of them by last order (the first unless `page` says). */
export async function evaluateSegment(store: SegmentStore, rules: SegmentRules, now = new Date(), page = 0): Promise<SegmentResult> {
  const all = await segmentPeople(store, now);
  const count = countSegment(rules, all.people, now);
  const matched = all.people.filter((p) => matches(rules, p, now));
  const pages = Math.max(1, Math.ceil(matched.length / SEGMENT_SAMPLE));
  const shown = Math.min(Math.max(0, Math.floor(page)), pages - 1);
  const sample = matched.slice(shown * SEGMENT_SAMPLE, (shown + 1) * SEGMENT_SAMPLE);
  return { ...count, capped: all.capped, rfmReady: all.rfmReady, missingRates: all.missingRates, sample, page: shown, pages };
}

/**
 * Everyone in a segment as a CSV (D380), for the owner: address, name, orders, first and last order, money spent without VAT in the main
 * currency (blank where a currency had no rate, never 0), customer type, email consent and tags. Through `writeCsv()`, formula-safe.
 */
export async function segmentCsv(store: SegmentStore, rules: SegmentRules, now = new Date()): Promise<{ csv: string; rows: number }> {
  const all = await segmentPeople(store, now);
  const currency = mainCurrency(store as Store);
  const people = all.people.filter((p) => matches(rules, p, now));
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
  const rows = [
    ["email", "name", "orders", "first_order", "last_order", "spent_without_vat", "currency", "customer_type", "email_consent", "tags"],
    ...people.map((p) => [
      p.email,
      p.name,
      p.orders,
      day(p.firstOrderAt),
      day(p.lastOrderAt),
      amountCell(p.spentMinor, currency),
      currency,
      p.rfm ?? "",
      p.consent,
      p.tags.join(" "),
    ]),
  ];
  return { csv: writeCsv(rows), rows: people.length };
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

/** The codes and campaigns limited to a segment (D380), by their own names: while any is, the segment cannot be deleted. */
export async function segmentUses(storeId: string, id: string): Promise<{ codes: string[]; campaigns: string[] }> {
  const rows = await db().execute<Row>(sql`
    select 'code' as kind, code as name from commerce.discount_codes where store_id = ${storeId}::uuid and segment_id = ${id}::uuid
    union all
    select 'campaign', name from commerce.campaigns where store_id = ${storeId}::uuid and segment_id = ${id}::uuid
    order by 1, 2
  `);
  return {
    codes: rows.filter((r) => r.kind === "code").map((r) => String(r.name)),
    campaigns: rows.filter((r) => r.kind === "campaign").map((r) => String(r.name)),
  };
}

/** Deletes a segment; `in_use` while a code or campaign is limited to it (the database refuses it too, D380). */
export async function deleteSegment(storeId: string, accountId: string, id: string): Promise<boolean | "in_use"> {
  const uses = await segmentUses(storeId, id);
  if (uses.codes.length > 0 || uses.campaigns.length > 0) return "in_use";
  let rows: Row[];
  try {
    rows = await db().execute<Row>(sql`delete from commerce.segments where store_id = ${storeId}::uuid and id = ${id}::uuid returning title`);
  } catch (error) {
    if (/discount_codes_segment_fk|campaigns_segment_fk/.test(errorText(error))) return "in_use";
    throw error;
  }
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

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/** The most people one bulk tag change reaches (D380). */
export const BULK_TAG_MAX = 1000;

export type BulkTagResult = { ok: true; changed: number; full: number } | { ok: false; problem: "too_many" | "bad_tag" };

/**
 * Adds a tag to, or takes it off, many people at once (D380, staff with `customers:write`): the addresses a list's filter found, at most
 * `BULK_TAG_MAX`, in one transaction. A person already at `TAGS_PER_PERSON` tags is left as they were and counted in `full`. One audit entry
 * for the batch, with the tag's words and the counts, never an address.
 */
export async function tagMany(storeId: string, accountId: string, emails: readonly string[], typed: string, mode: "add" | "remove"): Promise<BulkTagResult> {
  const people = [...new Set(emails.map(normal).filter(Boolean))];
  if (people.length > BULK_TAG_MAX) return { ok: false, problem: "too_many" };
  const result = normaliseTag(typed);
  if (!result.ok) return { ok: false, problem: "bad_tag" };
  const tag = result.tag;
  if (people.length === 0) return { ok: true, changed: 0, full: 0 };
  const list = JSON.stringify(people);
  let changed = 0;
  let full = 0;
  await db().transaction(async (tx) => {
    if (mode === "remove") {
      const rows = await tx.execute<Row>(sql`
        delete from commerce.customer_tags
        where store_id = ${storeId}::uuid and key = ${tag.key} and email in (select jsonb_array_elements_text(${list}::jsonb))
        returning email
      `);
      changed = rows.length;
      return;
    }
    // Who has room for one more, counted first, so the limit's trigger never aborts the batch.
    const counts = await tx.execute<Row>(sql`
      select e.email, count(t.key)::int as n, bool_or(t.key = ${tag.key}) as has
      from jsonb_array_elements_text(${list}::jsonb) e(email)
      left join commerce.customer_tags t on t.store_id = ${storeId}::uuid and t.email = e.email
      group by e.email
    `);
    const room = counts.filter((r) => !r.has && Number(r.n) < TAGS_PER_PERSON).map((r) => String(r.email));
    full = counts.filter((r) => !r.has && Number(r.n) >= TAGS_PER_PERSON).length;
    if (room.length === 0) return;
    const rows = await tx.execute<Row>(sql`
      insert into commerce.customer_tags (store_id, email, key, label, created_by)
      select ${storeId}::uuid, e.email, ${tag.key}, ${tag.label}, ${accountId}::uuid
      from jsonb_array_elements_text(${JSON.stringify(room)}::jsonb) e(email)
      on conflict do nothing returning email
    `);
    changed = rows.length;
  });
  if (changed > 0) {
    await audit(accountId, storeId, mode === "add" ? "customer.tags_added" : "customer.tags_removed", { tag: tag.label, people: changed, full });
  }
  return { ok: true, changed, full };
}

/**
 * Tags an address inside the caller's transaction (a customer import's row, D366): the tags it does not have yet, up to a person's
 * `TAGS_PER_PERSON` (counted first, so the limit's trigger never aborts the transaction). No audit entry: the import writes one for the job.
 */
export async function tagIn(tx: Tx, storeId: string, accountId: string | null, email: string, tags: readonly Tag[]): Promise<{ added: number; full: boolean }> {
  if (tags.length === 0) return { added: 0, full: false };
  const [row] = await tx.execute<Row>(sql`select count(*)::int as n from commerce.customer_tags where store_id = ${storeId}::uuid and email = ${normal(email)}`);
  let room = TAGS_PER_PERSON - Number(row?.n ?? 0);
  let added = 0;
  let full = false;
  for (const tag of tags) {
    if (room <= 0) {
      full = true;
      break;
    }
    const rows = await tx.execute<Row>(sql`
      insert into commerce.customer_tags (store_id, email, key, label, created_by)
      values (${storeId}::uuid, ${normal(email)}, ${tag.key}, ${tag.label}, ${accountId}::uuid)
      on conflict do nothing returning key
    `);
    if (rows[0]) {
      added += 1;
      room -= 1;
    }
  }
  return { added, full };
}

/** How many tags two addresses would have together (a merge refuses more than `TAGS_PER_PERSON`). */
export async function tagsTogether(tx: Tx, storeId: string, a: string, b: string): Promise<number> {
  const [row] = await tx.execute<Row>(sql`
    select count(distinct key)::int as n from commerce.customer_tags where store_id = ${storeId}::uuid and email in (${normal(a)}, ${normal(b)})
  `);
  return Number(row?.n ?? 0);
}

/**
 * Moves an address's tags to another (D366: a staff email change, a merge), in the caller's transaction: a tag the new address has already is
 * kept as it is there. The caller checks the limit first (`tagsTogether()`). The number of tags the new address gained.
 */
export async function moveTags(tx: Tx, storeId: string, from: string, to: string): Promise<number> {
  if (normal(from) === normal(to)) return 0;
  const moved = await tx.execute<Row>(sql`
    insert into commerce.customer_tags (store_id, email, key, label, created_by, created_at)
    select store_id, ${normal(to)}, key, label, created_by, created_at from commerce.customer_tags
    where store_id = ${storeId}::uuid and email = ${normal(from)}
    on conflict do nothing returning key
  `);
  await tx.execute(sql`delete from commerce.customer_tags where store_id = ${storeId}::uuid and email = ${normal(from)}`);
  return moved.length;
}

/**
 * Puts a sign-up form's tags on an address that has just confirmed (D304 J3): no person did it, so no actor; tags that are not a tag are skipped,
 * as is any past a person's 50. One audit entry with the count, never the address.
 */
export async function tagFromForm(storeId: string, email: string, typed: string[]): Promise<number> {
  let added = 0;
  for (const words of typed) {
    const result = normaliseTag(words);
    if (!result.ok) continue;
    try {
      const rows = await db().execute<Row>(sql`
        insert into commerce.customer_tags (store_id, email, key, label)
        values (${storeId}::uuid, ${normal(email)}, ${result.tag.key}, ${result.tag.label})
        on conflict do nothing returning key
      `);
      if (rows[0]) added++;
    } catch (error) {
      if (errorText(error).includes("customer_tags.limit")) break;
      throw error;
    }
  }
  if (added) await audit(null, storeId, "marketing.form_tagged", { count: added });
  return added;
}
