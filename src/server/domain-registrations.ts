import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";

import type { RegistrationFacts } from "./domain-health";

type Row = Record<string, unknown>;

/**
 * The domains Kaizena Flow registered for stores (D315, `docs/domains.md` 4): `commerce.domain_registrations`. Buying is
 * `src/server/domain-purchases.ts`; this module reads and keeps the registrations themselves.
 */

export type Registration = {
  id: string;
  storeId: string;
  apex: string;
  registrar: string;
  status: "active" | "expired" | "transferring_out" | "transferred_out";
  registeredAt: string | null;
  expiresAt: string | null;
  renew: boolean;
  registrarRenews: boolean;
  contactVerified: boolean | null;
  transferredOutAt: string | null;
};

const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);

export const toRegistration = (r: Row): Registration => ({
  id: String(r.id),
  storeId: String(r.store_id),
  apex: String(r.apex),
  registrar: String(r.registrar),
  status: String(r.status) as Registration["status"],
  registeredAt: iso(r.registered_at),
  expiresAt: iso(r.expires_at),
  renew: r.renew === true,
  registrarRenews: r.registrar_renews === true,
  contactVerified: r.contact_verified === null || r.contact_verified === undefined ? null : r.contact_verified === true,
  transferredOutAt: iso(r.transferred_out_at),
});

/** A store's registrations still with Kaizena Flow (not moved away), newest first. */
export async function storeRegistrations(storeId: string): Promise<Registration[]> {
  const rows = await db().execute<Row>(sql`
    select * from commerce.domain_registrations
     where store_id = ${storeId}::uuid and status <> 'transferred_out'
     order by created_at desc
  `);
  return rows.map(toRegistration);
}

/** One of a store's registrations by its name. */
export async function storeRegistration(storeId: string, apex: string): Promise<Registration | null> {
  const [row] = await db().execute<Row>(sql`
    select * from commerce.domain_registrations
     where store_id = ${storeId}::uuid and apex = ${apex.toLowerCase()} and status <> 'transferred_out'
  `);
  return row ? toRegistration(row) : null;
}

/** What the health check reads of a store's registrations. */
export async function registrationFacts(storeId: string): Promise<RegistrationFacts[]> {
  return (await storeRegistrations(storeId)).map((r) => ({ apex: r.apex, expiresAt: r.expiresAt, renews: r.renew, contactVerified: r.contactVerified }));
}
