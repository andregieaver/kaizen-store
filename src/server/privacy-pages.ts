import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";

import { planErasure } from "./privacy-erasure";
import type { RequestView } from "./privacy-requests";
import { resolveSubject } from "./privacy-subject";

type Row = Record<string, unknown>;

/**
 * What the staff privacy pages need that the other privacy modules do not give (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.3 items 3 to 5):
 * which customer page a request's person lives at, whether the store holds anything about them, and what an order's personal data stands at.
 * Counts, keys and dates only, never a value.
 */

/**
 * The customer page's key for the person a request names (their account, else their latest order, else a subscription), and whether the
 * erasure preview has anything in it. Null key: the store holds nothing it could resolve to a customer page.
 */
export async function requestSubject(storeId: string, request: Pick<RequestView, "subjectCustomerId" | "subjectEmail">): Promise<{ key: string | null; holdsData: boolean }> {
  if (!request.subjectCustomerId && !request.subjectEmail) return { key: null, holdsData: false };
  const subject = await resolveSubject(storeId, { customerId: request.subjectCustomerId, email: request.subjectEmail }, { channel: "staff" });
  if (!subject) return { key: null, holdsData: false };
  const key = subject.customerId ?? subject.orderIds[0] ?? subject.subscriptionIds[0] ?? null;
  const planned = await planErasure(subject);
  const holdsData = planned ? planned.plan.rows.length > 0 || planned.plan.alsoHappens.subscriptionsCancelled > 0 || planned.plan.alsoHappens.savedCardsDetached > 0 : false;
  return { key, holdsData };
}

export type OrderPrivacy = {
  /** The day (store's own) the order's personal data was restricted, and the first day it may be made anonymous. */
  restrictedOn: string | null;
  keptUntil: string | null;
  /** The day the personal data was made anonymous. */
  anonymisedOn: string | null;
};

/** An order's personal-data state for the banner of the order page: null when nothing has happened to it. */
export async function orderPrivacy(storeId: string, orderId: string): Promise<OrderPrivacy | null> {
  const [row] = await db().execute<Row>(sql`
    select commerce.store_day(o.store_id, o.restricted_at)::text as restricted_on,
           commerce.store_day(o.store_id, o.anonymised_at)::text as anonymised_on,
           case when o.restricted_at is not null and o.anonymised_at is null then commerce.order_anonymisable_on(o.id)::text end as kept_until
    from commerce.orders o where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid
  `);
  if (!row || (!row.restricted_on && !row.anonymised_on)) return null;
  return {
    restrictedOn: row.restricted_on ? String(row.restricted_on) : null,
    keptUntil: row.kept_until ? String(row.kept_until) : null,
    anonymisedOn: row.anonymised_on ? String(row.anonymised_on) : null,
  };
}
