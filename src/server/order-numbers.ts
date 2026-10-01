import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { OrderNumberAudit } from "@/lib/order-numbers";

type Row = Record<string, unknown>;

const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));

/** Checks that a store's order numbers are one unbroken sequence (D141). Copied history (D129) is not counted. */
export async function orderNumberAudit(storeId: string): Promise<OrderNumberAudit> {
  const [row] = await db().execute<Row>(sql`select * from commerce.order_number_audit(${storeId}::uuid)`);
  return {
    orders: Number(row?.orders ?? 0),
    firstNumber: num(row?.first_number),
    lastNumber: num(row?.last_number),
    missing: Number(row?.missing ?? 0),
    firstMissing: num(row?.first_missing),
    offFormat: Number(row?.off_format ?? 0),
    nextNumber: num(row?.next_number),
    ok: Boolean(row?.ok),
  };
}
