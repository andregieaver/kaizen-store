import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";

import { findCustomer } from "./customer-admin";
import { textList, uuidList } from "./sql-arrays";

type Row = Record<string, unknown>;

/**
 * Whose data it is (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.1): in one store a person is an account (`customers.id`) and/or a lower-case
 * email; the same person in two stores is two subjects. An order belongs to the subject when it is linked to their account or was placed
 * with their email, and **never** when it is restricted or anonymised (a restricted order is cut loose from the person and used for nothing,
 * 2.4). Export, erasure and the privacy requests all resolve the person here, so they agree on what is theirs.
 */

export type PrivacySubject = {
  storeId: string;
  /** The account, or null for a guest. */
  customerId: string | null;
  /** The lower-case email the person is known by (the account's, else the one given), or null for a subject with neither. */
  email: string | null;
  /**
   * Every lower-case address of theirs the store holds mail under. For staff: the email, and the emails of their own orders and subscriptions. For the shopper:
   * the account's own email once it is proven, else none (an address typed at checkout or at registration proves nothing).
   */
  addresses: string[];
  /** Orders that are theirs (copied ones included), not restricted and not anonymised. */
  orderIds: string[];
  subscriptionIds: string[];
  /** Carts that are theirs: the account's, the carts their orders were placed from, and carts a reminder was captured for under their address. */
  cartIds: string[];
  /** The account's locale, else the latest order's, else null. */
  locale: string | null;
  /** The account's email is proven (a code was typed): only then are guest orders under that email theirs for the shopper's own file. */
  emailProven: boolean;
};

export type SubjectRef = { customerId?: string | null; email?: string | null };

const clean = (email: string | null | undefined): string | null => {
  const e = (email ?? "").trim().toLowerCase();
  return e === "" || e === "[removed]" ? null : e;
};

/**
 * The subject for an account id and/or an email, or null when neither names anyone. `channel: "shopper"` matches orders by email only when
 * the account's email is proven (the rule `claimOrders()` keeps): a person who registered with someone else's address, unproven, sees only
 * what is linked to their account. Staff, who answer for the person's identity, match by email always.
 */
export async function resolveSubject(storeId: string, ref: SubjectRef, opts: { channel?: "staff" | "shopper" } = {}): Promise<PrivacySubject | null> {
  let customerId: string | null = null;
  let email = clean(ref.email);
  let locale: string | null = null;
  let proven = false;
  if (ref.customerId) {
    const [c] = await db().execute<Row>(sql`
      select id, lower(email) as email, locale, email_verified_at is not null as proven from commerce.customers
      where store_id = ${storeId}::uuid and id = ${ref.customerId}::uuid
    `);
    if (c) {
      customerId = String(c.id);
      email = clean(String(c.email));
      locale = c.locale ? String(c.locale) : null;
      proven = Boolean(c.proven);
    }
  } else if (email) {
    const [c] = await db().execute<Row>(sql`
      select id, locale, email_verified_at is not null as proven from commerce.customers
      where store_id = ${storeId}::uuid and lower(email) = ${email}
    `);
    if (c) {
      customerId = String(c.id);
      locale = c.locale ? String(c.locale) : null;
      proven = Boolean(c.proven);
    }
  }
  if (!customerId && !email) return null;
  const matchEmail = email !== null && (opts.channel !== "shopper" || proven);

  const [orders, subscriptions] = await Promise.all([
    db().execute<Row>(sql`
      select id, lower(email) as email, cart_id, locale from commerce.orders
      where store_id = ${storeId}::uuid and restricted_at is null and anonymised_at is null
        and (customer_id = ${customerId}::uuid or (${matchEmail} and lower(email) = ${email}))
      order by placed_at desc, id
    `),
    db().execute<Row>(sql`
      select id, lower(email) as email from commerce.subscriptions
      where store_id = ${storeId}::uuid and (customer_id = ${customerId}::uuid or (${matchEmail} and lower(email) = ${email}))
      order by created_at desc, id
    `),
  ]);
  // Which addresses the store holds mail and sign-ups under are the person's. Staff answer for the person's identity, so for them the account's email and
  // the emails of the person's orders and subscriptions all count. A shopper has proved only the address a code was typed for: the email on an order
  // is whatever was typed at checkout (Stripe's form, a venue booking) and an account can be opened with an address nobody has proved, so for the shopper
  // the address is the account's own email and only once it is proven; otherwise there are none, and every read and delete keyed by an address (mail,
  // forms, abandoned checkouts, opt-outs, sign-in codes, invitations) finds nothing. What is linked to the account itself (its orders, subscriptions,
  // carts) is still theirs.
  const addresses = new Set<string>();
  if (opts.channel === "shopper") {
    if (proven && email) addresses.add(email);
  } else {
    if (email) addresses.add(email);
    for (const o of orders) {
      const a = clean(String(o.email));
      if (a) addresses.add(a);
    }
    for (const s of subscriptions) {
      const a = clean(String(s.email));
      if (a) addresses.add(a);
    }
  }
  const addressList = [...addresses];
  const orderCarts = orders.map((o) => (o.cart_id ? String(o.cart_id) : null)).filter((c): c is string => c !== null);
  const carts = await db().execute<Row>(sql`
    select id from commerce.carts where store_id = ${storeId}::uuid and (customer_id = ${customerId}::uuid or id = any(${uuidList(orderCarts)}))
    union
    select cart_id from commerce.abandoned_checkouts
     where store_id = ${storeId}::uuid and cart_id is not null and lower(email) = any(${textList(addressList)})
  `);
  return {
    storeId,
    customerId,
    email,
    addresses: addressList,
    orderIds: orders.map((o) => String(o.id)),
    subscriptionIds: subscriptions.map((s) => String(s.id)),
    cartIds: carts.map((c) => String(c.id ?? c.cart_id)),
    locale: locale ?? (orders[0]?.locale ? String(orders[0].locale) : null),
    emailProven: proven,
  };
}

/**
 * The subject a staff page names: an account id, or the id of one of their orders or subscriptions (`findCustomer()`, the customer pages'
 * own key). Null when the key is nobody's in this store.
 */
export async function subjectOf(storeId: string, key: string): Promise<PrivacySubject | null> {
  const ref = await findCustomer(storeId, key);
  if (!ref) return null;
  return resolveSubject(storeId, { customerId: ref.customerId, email: ref.email }, { channel: "staff" });
}

/** The store facts every privacy text and email needs: its name, its country (the seller's, for the periods), its main language and contact. */
export type PrivacyStore = {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  organisationNumber: string | null;
  contactEmail: string | null;
  country: string | null;
  timeZone: string | null;
  mainLocale: string;
};

export async function privacyStore(storeId: string): Promise<PrivacyStore | null> {
  const [s] = await db().execute<Row>(sql`
    select s.id, s.slug, s.name, s.legal_name, s.organisation_number, s.contact_email, s.country, s.time_zone,
      -- The store's main language is its effective first one: a chosen language, else the country's own of its first market (as every reader takes it).
      coalesce(s.locales[1], (select m.default_locale from commerce.markets m where m.store_id = s.id and m.active
                              order by (m.code = s.country) desc nulls last, m.created_at, m.code limit 1)) as main_locale
    from commerce.stores s where s.id = ${storeId}::uuid
  `);
  if (!s) return null;
  return {
    id: String(s.id),
    slug: String(s.slug),
    name: String(s.name),
    legalName: s.legal_name ? String(s.legal_name) : null,
    organisationNumber: s.organisation_number ? String(s.organisation_number) : null,
    contactEmail: s.contact_email ? String(s.contact_email) : null,
    country: s.country ? String(s.country).trim() : null,
    timeZone: s.time_zone ? String(s.time_zone) : null,
    mainLocale: s.main_locale ? String(s.main_locale) : "en",
  };
}
