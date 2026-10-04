import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { changesProblem, diffOf, type AuditChanges, type AuditKind, type AuditTarget } from "@/lib/audit";

import { audit, type Membership } from "./auth";

/**
 * The writes of the activity log (wave 1, 1f, docs/wave-1-trust.md 2.10). `audit()` (in `auth.ts`, 224 callers) keeps its
 * signature; these two add what the criteria ask for.
 *
 * - `auditChange()` writes an entry with the thing's id and the changed fields as before and after, only the fields on the
 *   kind's allowlist and never a secret: a field outside the list is `{ changed: true }` with no value, a secret-like name is
 *   dropped (and throws under test, so a caller that puts one in is found), a long value is cut. It never throws into the request:
 *   the change it describes has already happened.
 * - `auditAccount()` writes a person's own security event once for the platform and once for each store they work in, so
 *   each owner sees their own staff's.
 */

/** Who did it, and in which store (null for the platform's own). A membership is the usual way to say it. */
export type AuditActor = { accountId: string | null; storeId: string | null };

const actorOf = (who: AuditActor | Pick<Membership, "account" | "store">): AuditActor =>
  "account" in who ? { accountId: who.account.id, storeId: who.store.id } : who;

/** Under test a refused field is a mistake of the caller's, found at once; in production it is dropped and logged. */
const strict = () => process.env.VITEST !== undefined || process.env.NODE_ENV === "test";

/**
 * Writes an entry about a change with its allowlisted before and after. An update that changed nothing writes nothing; a creation
 * (`before` null) and a deletion (`after` null) always do. `details` carries what the sentence needs and no secret (the target's name
 * as `label` is added for the Activity page).
 */
export async function auditChange(
  who: AuditActor | Pick<Membership, "account" | "store">,
  action: string,
  target: AuditTarget,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  kind: AuditKind,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { accountId, storeId } = actorOf(who);
    const { changes, refused } = diffOf(kind, before, after);
    if (refused.length > 0) {
      if (strict()) throw new Error(`auditChange: a secret-like field changed (${refused.join(", ")}) and is never written`);
      console.error("[audit] a secret-like field was left out of an entry", action, refused);
    }
    if (Object.keys(changes).length === 0 && before !== null && after !== null) return;
    const problem = changesProblem(changes);
    if (problem) throw new Error(`auditChange: ${problem}`);
    await audit(accountId, storeId, action, { ...(target.label ? { label: target.label } : {}), ...details }, { target: { type: target.type, id: target.id }, changes });
  } catch (error) {
    if (strict() && error instanceof Error && error.message.startsWith("auditChange:")) throw error;
    console.error("[audit] an entry could not be written", action, error);
  }
}

/**
 * A person's own security event (two-step enrolled, removed, failed, a recovery code used, reset by a platform admin): the
 * platform's row (store null, area `account`) and, with `perStore`, one row in each store the person is an active member of
 * (area `staff`), so an owner sees what happened to their own staff. `actorId` is who did it when it is not the person
 * (a platform admin's reset); the row names the person as its target. Never throws.
 */
export async function auditAccount(
  accountId: string,
  action: string,
  details: Record<string, unknown> = {},
  options: { actorId?: string | null; perStore?: boolean; label?: string } = {},
): Promise<void> {
  try {
    const actor = options.actorId ?? accountId;
    const json = JSON.stringify({ ...(options.label ? { label: options.label } : {}), ...details });
    await db().execute(sql`
      insert into commerce.audit_log (account_id, store_id, action, details, area, target_type, target_id)
      values (${actor}::uuid, null, ${action}, ${json}::jsonb, 'account', 'account', ${accountId})
    `);
    if (options.perStore !== false) {
      await db().execute(sql`
        insert into commerce.audit_log (account_id, store_id, action, details, area, target_type, target_id)
        select ${actor}::uuid, m.store_id, ${action}, ${json}::jsonb, 'staff', 'account', ${accountId}
        from commerce.store_members m
        where m.account_id = ${accountId}::uuid and m.disabled_at is null
      `);
    }
  } catch (error) {
    console.error("[audit] an account entry could not be written", action, error);
  }
}

export type { AuditChanges };
