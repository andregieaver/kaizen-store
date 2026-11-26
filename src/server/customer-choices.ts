import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { col, typedRows } from "./typed-rows";

/** A customer to choose in a picker: their name and email only. */
export type CustomerChoice = { id: string; name: string; email: string };

const CHOICE_ROW = z.object({ id: col.uuid, name: col.textOrNull, email: col.text });

/**
 * The store's customers found by name or email, for a picker (a draft order's customer, a task's in Projects): name and email only, 10 at
 * most, from two characters typed. The caller checks the person may read customers.
 */
export async function findCustomerChoices(storeId: string, query: string, limit = 10): Promise<CustomerChoice[]> {
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return [];
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await typedRows(CHOICE_ROW, sql`
    select id, name, email from commerce.customers
    where store_id = ${storeId}::uuid and (lower(email) like lower(${like}) or lower(name) like lower(${like}))
    order by lower(email) limit ${limit}
  `);
  return rows.map((r) => ({ id: r.id, name: r.name ?? "", email: r.email }));
}
