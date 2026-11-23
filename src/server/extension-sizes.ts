import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { readAllowances, type Allowances, type ExtensionId } from "@/lib/extensions";
import { ON_PLAN_STATUSES } from "@/lib/plans";

import { col, typedRow, type Executor } from "./typed-rows";

/**
 * The size of an extension an account has (D876, D748 E10 part three): the biggest of what it bought on its own, in a bundle or on trial
 * (a bundle or a trial without a size is the smallest), and what its plan includes while it is on the plan. What the send allowance and the
 * contact limit are read from, and what moving up starts from.
 */

const onPlan = sql.join(
  ON_PLAN_STATUSES.map((s) => sql`${s}`),
  sql`, `,
);

/**
 * The size row (`id`, `label`, `position`, `allowances`) of `extensionId` the account named by `organisation` has, as a statement to read
 * on its own or inside another (the store's limits, `readStoreLimits()`); no row when it has none.
 */
export const accountSizeSql = (organisation: SQL, extensionId: ExtensionId): SQL => sql`
  select es.id, es.label, es.position, es.allowances from commerce.extension_sizes es
   where es.extension_id = ${extensionId} and es.id in (
     select coalesce(oe.size_id, (select s.id from commerce.extension_sizes s where s.extension_id = oe.extension_id and s.active order by s.position, s.created_at limit 1))
       from commerce.organisation_extensions oe
      where oe.organisation_id = ${organisation} and oe.extension_id = ${extensionId} and (oe.ended_at is null or oe.grace_ends_at > now())
     union
     select g.size_id from commerce.plan_extension_grants g
       join commerce.organisation_billing ob on ob.plan_id = g.plan_id and ob.status in (${onPlan})
      where ob.organisation_id = ${organisation} and g.extension_id = ${extensionId})
   order by es.position desc, es.created_at desc
   limit 1`;

export type AccountSize = { id: string; label: string; position: number; allowances: Allowances };

const SIZE_ROW = z.object({ id: col.uuid, label: col.text, position: col.int, allowances: z.unknown() });

/** The size of the extension the account has, or null when it has none. */
export async function accountSize(organisationId: string, extensionId: ExtensionId, executor?: Executor): Promise<AccountSize | null> {
  const r = await typedRow(SIZE_ROW, accountSizeSql(sql`${organisationId}::uuid`, extensionId), executor);
  return r ? { id: r.id, label: r.label, position: r.position, allowances: readAllowances(r.allowances) } : null;
}

/** The next size up of an extension after this one (or its smallest without one), among the sizes offered; null when there is none. */
export async function nextSize(extensionId: ExtensionId, after: AccountSize | null, executor?: Executor): Promise<AccountSize | null> {
  const r = await typedRow(
    SIZE_ROW,
    sql`select id, label, position, allowances from commerce.extension_sizes
         where extension_id = ${extensionId} and active ${after ? sql`and (position, created_at) > (${after.position}, (select created_at from commerce.extension_sizes where id = ${after.id}::uuid))` : sql``}
         order by position, created_at limit 1`,
    executor,
  );
  return r ? { id: r.id, label: r.label, position: r.position, allowances: readAllowances(r.allowances) } : null;
}
