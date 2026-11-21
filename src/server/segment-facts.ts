import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { SMS_SUBSCRIBER_STATUSES } from "@/lib/sms";
import { MARKETING_FIELD_TYPES } from "@/lib/custom-fields";
import type { Person, SegmentField, SegmentNeeds } from "@/lib/segments";

import { PAID } from "./analytics-sql";
import { leadScoresByEmail } from "./lead-score";
import { uuidList } from "./sql-arrays";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The facts of segments' newer conditions (ecosystem plan E3.6, D718), for `segmentPeople()`: what each person bought of the products and
 * categories the rules name, their own deals, support conversations, buyer reviews, subscriptions running now and consent to texts. A family
 * is read only when a rule asks for it (`segmentNeeds()`), one grouped query each, from the store's indexed rows (a product's variants, then
 * their order lines, then the order; a store's deals, conversations, reviews, subscriptions and numbers), never a scan of every order per
 * person. A family behind a store feature (Deals, Product reviews, Subscriptions or Subscription boxes) is not read while it is off, so its
 * conditions hold for nobody then. People are keyed as the reader keys them: the account's address, else the row's own, in lower case.
 */

export type SegmentFacts = Pick<Person, "boughtProducts" | "boughtCategories" | "deals" | "support" | "reviews" | "subscriptions" | "sms" | "lastClickAt" | "fields" | "viewedProducts" | "leadScore">;

/** Which families were read (a person missing from one has none of it), and each person's facts by address. */
export type ReadFacts = { read: Set<keyof SegmentFacts>; byEmail: Map<string, SegmentFacts> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidArray = (ids: readonly string[]) => `{${ids.filter((id) => UUID.test(id)).join(",")}}`;

/** The address `email` is one of those asked for, or every address when none was (`only` is a JSON list or null). */
const asked = (email: SQL, only: string | null) => sql`(${only}::jsonb is null or ${email} in (select jsonb_array_elements_text(${only}::jsonb)))`;

/** A paid order of the store's, as the reader counts orders (D152's `PAID`, never a hidden or erased person's), with an address; alias `o`, buyer `c`. */
const COUNTED_ORDER = sql`${PAID} and o.restricted_at is null and o.anonymised_at is null and o.placed_at is not null and coalesce(c.email, o.email) <> ''`;

const boughtRow = z.object({ email: col.text, id: col.uuid, at: col.timestamp });

/** When each person last bought each of the products (a paid order with a line of one of its variants). */
async function boughtProducts(storeId: string, ids: readonly string[], only: string | null) {
  return typedRows(
    boughtRow,
    sql`
      select lower(coalesce(c.email, o.email)) as email, v.product_id as id, max(o.placed_at) as at
      from commerce.product_variants v
      join commerce.order_lines l on l.store_id = v.store_id and l.variant_id = v.id
      join commerce.orders o on o.store_id = l.store_id and o.id = l.order_id
      left join commerce.customers c on c.store_id = o.store_id and c.id = o.customer_id
      where v.store_id = ${storeId}::uuid and v.product_id = any(${uuidArray(ids)}::uuid[])
        and ${COUNTED_ORDER} and ${asked(sql`lower(coalesce(c.email, o.email))`, only)}
      group by 1, 2
    `,
  );
}

/**
 * When each person last bought from each of the categories: a product placed in it or in a category below it (`product_terms`), or meeting the
 * rules of one filled by rules (`commerce.product_matches_rules()`, as listings count a category's products, D319).
 */
async function boughtCategories(storeId: string, ids: readonly string[], only: string | null) {
  return typedRows(
    boughtRow,
    sql`
      with recursive picked (root, id) as (
        select t.id, t.id from commerce.terms t
        where t.store_id = ${storeId}::uuid and t.content_type = 'product' and t.kind = 'category' and t.id = any(${uuidArray(ids)}::uuid[])
        union
        select picked.root, t.id from commerce.terms t join picked on t.parent_id = picked.id
        where t.store_id = ${storeId}::uuid and t.content_type = 'product' and t.kind = 'category'
      ),
      products (root, product_id) as (
        select picked.root, pt.product_id from picked
        join commerce.product_terms pt on pt.store_id = ${storeId}::uuid and pt.content_type = 'product' and pt.term_id = picked.id
        union
        select picked.root, p.id from picked
        join commerce.terms rt on rt.store_id = ${storeId}::uuid and rt.id = picked.id and rt.rules is not null
        join commerce.products p on p.store_id = ${storeId}::uuid and commerce.product_matches_rules(p.store_id, p.id, rt.rules)
      )
      select lower(coalesce(c.email, o.email)) as email, cp.root as id, max(o.placed_at) as at
      from products cp
      join commerce.product_variants v on v.store_id = ${storeId}::uuid and v.product_id = cp.product_id
      join commerce.order_lines l on l.store_id = v.store_id and l.variant_id = v.id
      join commerce.orders o on o.store_id = l.store_id and o.id = l.order_id
      left join commerce.customers c on c.store_id = o.store_id and c.id = o.customer_id
      where ${COUNTED_ORDER} and ${asked(sql`lower(coalesce(c.email, o.email))`, only)}
      group by 1, 2
    `,
  );
}

/** Each person's own deals (D464, the deal's customer), open and won; as their timeline shows them. */
async function deals(storeId: string, only: string | null) {
  return typedRows(
    z.object({ email: col.text, open: col.int, won: col.int }),
    sql`
      select lower(c.email) as email, count(*) filter (where d.status = 'open')::int as open, count(*) filter (where d.status = 'won')::int as won
      from commerce.deals d
      join commerce.customers c on c.store_id = d.store_id and c.id = d.customer_id
      where d.store_id = ${storeId}::uuid and d.customer_id is not null and c.email <> '' and ${asked(sql`lower(c.email)`, only)}
      group by 1
    `,
  );
}

/** Each person's support conversations (D216), by their account or the address they gave, as their timeline finds them; never an erased one. */
async function support(storeId: string, only: string | null) {
  return typedRows(
    z.object({ email: col.text, last_at: col.timestampOrNull, bad: col.bool }),
    sql`
      select lower(coalesce(c.email, v.contact_email)) as email, max(v.last_message_at) as last_at, coalesce(bool_or(v.rating = 'bad'), false) as bad
      from commerce.support_conversations v
      left join commerce.customers c on c.store_id = v.store_id and c.id = v.customer_id
      where v.store_id = ${storeId}::uuid and v.anonymised_at is null and coalesce(c.email, v.contact_email, '') <> ''
        and ${asked(sql`lower(coalesce(c.email, v.contact_email))`, only)}
      group by 1
    `,
  );
}

/** The reviews each buyer wrote (D301), whatever their state: by their account, or a guest by their order's address. Imports have no person. */
async function reviews(storeId: string, only: string | null) {
  return typedRows(
    z.object({ email: col.text, n: col.int, lowest: col.int.nullable() }),
    sql`
      select lower(coalesce(c.email, o.email)) as email, count(*)::int as n, min(r.rating)::int as lowest
      from commerce.product_reviews r
      left join commerce.customers c on c.store_id = r.store_id and c.id = r.customer_id
      left join commerce.orders o on o.store_id = r.store_id and o.id = r.order_id
      where r.store_id = ${storeId}::uuid and r.source = 'buyer' and coalesce(c.email, o.email, '') <> ''
        and ${asked(sql`lower(coalesce(c.email, o.email))`, only)}
      group by 1
    `,
  );
}

/**
 * Each person's subscriptions running now: a subscription (D25) active or waiting on a retried payment (as analytics counts them live), while
 * Subscriptions is on, and a subscription box (D102) that is active, while Subscription boxes is on.
 */
async function subscriptions(storeId: string, on: { subscriptions: boolean; boxes: boolean }, only: string | null) {
  return typedRows(
    z.object({ email: col.text, n: col.int }),
    sql`
      select email, count(*)::int as n from (
        select lower(coalesce(c.email, s.email)) as email from commerce.subscriptions s
        left join commerce.customers c on c.store_id = s.store_id and c.id = s.customer_id
        where ${on.subscriptions}::boolean and s.store_id = ${storeId}::uuid and s.status in ('active', 'past_due')
        union all
        select lower(c.email) from commerce.standing_orders so
        join commerce.customers c on c.store_id = so.store_id and c.id = so.customer_id
        where ${on.boxes}::boolean and so.store_id = ${storeId}::uuid and so.status = 'active'
      ) running
      where email <> '' and ${asked(sql`email`, only)}
      group by 1
    `,
  );
}

/**
 * Each person's consent to texts (D565): of the numbers kept with their address or their account, the best one (subscribed, then waiting for
 * its order, then the latest), as their customer page shows it.
 */
export type MarketingField = SegmentField;

/**
 * The store's customer fields marked for marketing (M2.4, `marketing` on a field of an active group for customers): only these may be named
 * by a segment, and only these are read for one. Top-level fields of `MARKETING_FIELD_TYPES`.
 */
export async function marketingFields(storeId: string): Promise<MarketingField[]> {
  const rows = await typedRows(
    z.object({ fields: z.unknown() }),
    sql`select fields from commerce.field_groups where store_id = ${storeId}::uuid and active and entities ? 'customer'`,
  );
  const out: MarketingField[] = [];
  for (const row of rows) {
    if (!Array.isArray(row.fields)) continue;
    for (const f of row.fields as Record<string, unknown>[]) {
      if (f.marketing !== true || typeof f.id !== "string" || typeof f.type !== "string" || !(MARKETING_FIELD_TYPES as readonly string[]).includes(f.type)) continue;
      const choices = Array.isArray(f.choices) ? (f.choices as { key?: unknown; label?: unknown }[]).flatMap((c) => (typeof c.key === "string" ? [{ key: c.key, label: typeof c.label === "string" ? c.label : c.key }] : [])) : [];
      out.push({ id: f.id, label: typeof f.label === "string" ? f.label : f.id, type: f.type, choices });
    }
  }
  return out;
}

/** A field's value as words in lower case, as `holds()` compares them: a choice's key (or each of several), yes or no, a number, a text. */
export function fieldWords(value: unknown): string[] {
  if (value === null || value === undefined || value === "") return [];
  if (Array.isArray(value)) return value.flatMap(fieldWords);
  if (typeof value === "boolean") return [value ? "yes" : "no"];
  if (typeof value === "number") return [String(value)];
  if (typeof value === "string") return [value.trim().toLowerCase()];
  if (typeof value === "object" && "value" in (value as Record<string, unknown>)) return fieldWords((value as Record<string, unknown>).value);
  return [];
}

/** The marked fields' values of each customer (M2.4), by the account's address; only fields the store marked, whatever a rule names. */
async function fieldValues(storeId: string, ids: string[], only: string | null) {
  const marked = new Set((await marketingFields(storeId)).map((f) => f.id));
  const wanted = ids.filter((id) => marked.has(id));
  if (wanted.length === 0) return [] as { email: string; values: Record<string, string[]> }[];
  const rows = await typedRows(
    z.object({ email: col.text, values: z.unknown() }),
    sql`
      select lower(c.email) as email, v.values from commerce.field_values v
      join commerce.customers c on c.store_id = v.store_id and c.id = v.entity_id
      where v.store_id = ${storeId}::uuid and v.entity = 'customer' and v.locale = '' and c.email <> '' and ${asked(sql`lower(c.email)`, only)}
    `,
  );
  return rows.map((r) => {
    const all = (r.values && typeof r.values === "object" ? r.values : {}) as Record<string, unknown>;
    return { email: r.email, values: Object.fromEntries(wanted.map((id) => [id, fieldWords(all[id])])) };
  });
}

/** When each signed-in customer last looked at each of the products named (M2.4), from the views kept while a browse email runs (D691). */
async function viewedProducts(storeId: string, products: string[], only: string | null) {
  return typedRows(
    z.object({ email: col.text, id: col.uuid, at: col.timestamp }),
    sql`
      select lower(c.email) as email, cv.product_id as id, cv.viewed_at as at
      from commerce.customer_product_views cv
      join commerce.customers c on c.store_id = cv.store_id and c.id = cv.customer_id
      where cv.store_id = ${storeId}::uuid and cv.product_id = any(${uuidList(products)}) and c.email <> '' and ${asked(sql`lower(c.email)`, only)}
    `,
  );
}

/** When each person on the list last pressed a link in the store's emails (M2.4): a broadcast's or a flow's, within the clicks kept. */
async function lastClicks(storeId: string, only: string | null) {
  return typedRows(
    z.object({ email: col.text, at: col.timestamp }),
    sql`
      select lower(m.email) as email, max(c.clicked_at) as at
      from commerce.email_clicks c
      join commerce.marketing_subscribers m on m.store_id = c.store_id and m.id = c.subscriber_id
      where c.store_id = ${storeId}::uuid and ${asked(sql`lower(m.email)`, only)}
      group by 1
    `,
  );
}

async function sms(storeId: string, only: string | null) {
  return typedRows(
    z.object({ email: col.text, status: z.enum(SMS_SUBSCRIBER_STATUSES) }),
    sql`
      select email, (array_agg(status order by (status = 'subscribed') desc, (status = 'pending') desc, updated_at desc))[1] as status
      from (
        select s.email, s.status, s.updated_at from commerce.sms_subscribers s
        where s.store_id = ${storeId}::uuid and s.email is not null and s.email <> ''
        union all
        select lower(c.email), s.status, s.updated_at from commerce.sms_subscribers s
        join commerce.customers c on c.store_id = s.store_id and c.id = s.customer_id
        where s.store_id = ${storeId}::uuid and c.email <> ''
      ) numbers
      where ${asked(sql`email`, only)}
      group by 1
    `,
  );
}

/** The store's features the gated families stand behind, read only when one is asked for. */
async function featuresOn(storeId: string) {
  const row = await typedRow(
    z.object({ sales: col.bool, reviews: col.bool, subscriptions: col.bool, boxes: col.bool }),
    sql`
      select (commerce.feature_on(${storeId}::uuid, 'sales') and commerce.extension_on(${storeId}::uuid, 'deals')) as sales, commerce.feature_on(${storeId}::uuid, 'reviews') as reviews,
        commerce.feature_on(${storeId}::uuid, 'subscriptions') as subscriptions, commerce.feature_on(${storeId}::uuid, 'boxes') as boxes
    `,
  );
  return row ?? { sales: false, reviews: false, subscriptions: false, boxes: false };
}

/** Whether the rules ask for any of these facts at all (most segments do not, and read nothing more). */
export const needsFacts = (needs: SegmentNeeds) =>
  needs.products.length > 0 || needs.categories.length > 0 || needs.deals || needs.support || needs.reviews || needs.subscriptions || needs.sms || needs.clicks || needs.fields.length > 0 || needs.viewed.length > 0 || needs.leads;

/** Reads the families `needs` asks for (`only`: the JSON list of addresses asked for, or null for everyone). */
export async function readSegmentFacts(storeId: string, needs: SegmentNeeds, only: string | null): Promise<ReadFacts> {
  const read = new Set<keyof SegmentFacts>();
  const byEmail = new Map<string, SegmentFacts>();
  if (!needsFacts(needs)) return { read, byEmail };
  const on = needs.deals || needs.reviews || needs.subscriptions ? await featuresOn(storeId) : null;
  const of = (email: string): SegmentFacts => {
    const found = byEmail.get(email);
    if (found) return found;
    const facts: SegmentFacts = {};
    byEmail.set(email, facts);
    return facts;
  };
  const jobs: Promise<void>[] = [];
  const job = <R>(family: keyof SegmentFacts, rows: Promise<R[]>, put: (row: R) => void) => {
    read.add(family);
    jobs.push(
      rows.then((all) => {
        for (const row of all) put(row);
      }),
    );
  };
  if (needs.products.length > 0) {
    job("boughtProducts", boughtProducts(storeId, needs.products, only), (r) => {
      const facts = of(r.email);
      facts.boughtProducts = { ...facts.boughtProducts, [r.id]: r.at };
    });
  }
  if (needs.categories.length > 0) {
    job("boughtCategories", boughtCategories(storeId, needs.categories, only), (r) => {
      const facts = of(r.email);
      facts.boughtCategories = { ...facts.boughtCategories, [r.id]: r.at };
    });
  }
  if (needs.deals && on?.sales) {
    job("deals", deals(storeId, only), (r) => {
      of(r.email).deals = { open: r.open, won: r.won };
    });
  }
  if (needs.support) {
    job("support", support(storeId, only), (r) => {
      of(r.email).support = { lastAt: r.last_at, ratedBad: r.bad };
    });
  }
  if (needs.reviews && on?.reviews) {
    job("reviews", reviews(storeId, only), (r) => {
      of(r.email).reviews = { count: r.n, lowestStars: r.lowest };
    });
  }
  if (needs.subscriptions && on && (on.subscriptions || on.boxes)) {
    job("subscriptions", subscriptions(storeId, on, only), (r) => {
      of(r.email).subscriptions = r.n;
    });
  }
  if (needs.sms) {
    job("sms", sms(storeId, only), (r) => {
      of(r.email).sms = r.status;
    });
  }
  if (needs.viewed.length > 0) {
    job("viewedProducts", viewedProducts(storeId, needs.viewed, only), (r) => {
      const facts = of(r.email);
      facts.viewedProducts = { ...facts.viewedProducts, [r.id]: r.at };
    });
  }
  if (needs.fields.length > 0) {
    job("fields", fieldValues(storeId, needs.fields, only), (r) => {
      of(r.email).fields = r.values;
    });
  }
  if (needs.clicks) {
    job("lastClickAt", lastClicks(storeId, only), (r) => {
      of(r.email).lastClickAt = r.at;
    });
  }
  if (needs.leads) {
    // A business customer's lead score (M2.8, D865), read and worked out as on their page (`leadScoresByEmail()`).
    job("leadScore", leadScoresByEmail(storeId, asked(sql`lower(c.email)`, only)), (r) => {
      of(r.email).leadScore = r.score;
    });
  }
  await Promise.all(jobs);
  return { read, byEmail };
}

/** Gives each person the facts read: their own, or none of a family that was read (no deal, no conversation, never asked for texts). */
export function applySegmentFacts(people: Person[], { read, byEmail }: ReadFacts): void {
  if (read.size === 0) return;
  for (const p of people) {
    const facts = byEmail.get(p.email) ?? {};
    if (read.has("boughtProducts")) p.boughtProducts = facts.boughtProducts ?? {};
    if (read.has("boughtCategories")) p.boughtCategories = facts.boughtCategories ?? {};
    if (read.has("deals")) p.deals = facts.deals ?? { open: 0, won: 0 };
    if (read.has("support")) p.support = facts.support ?? { lastAt: null, ratedBad: false };
    if (read.has("reviews")) p.reviews = facts.reviews ?? { count: 0, lowestStars: null };
    if (read.has("subscriptions")) p.subscriptions = facts.subscriptions ?? 0;
    if (read.has("sms")) p.sms = facts.sms ?? "none";
    if (read.has("lastClickAt")) p.lastClickAt = facts.lastClickAt ?? null;
    if (read.has("fields")) p.fields = facts.fields ?? {};
    if (read.has("viewedProducts")) p.viewedProducts = facts.viewedProducts ?? {};
    if (read.has("leadScore")) p.leadScore = facts.leadScore ?? null;
  }
}
