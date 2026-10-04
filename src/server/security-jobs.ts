import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { AUDIT_RETENTION_MONTHS } from "@/lib/audit";

import { audit } from "./auth";

type Row = Record<string, unknown>;

/**
 * The daily jobs of staff security (wave 1, 1f, docs/wave-1-trust.md 3.3, 3.6), plain application code run from the daily cron
 * (`/api/cron/subscription-reminders`). Deletion lives here and not in a database function: a collaborator's expiry, the pruning of
 * the activity log and of old recovery codes are statements the migration tool never has to take. Each takes the clock, so a test
 * holds it still.
 */

/**
 * Ends the access of collaborators whose time has run out: marked `disabled_at` and audit-logged (`staff.collaborator_expired`).
 * `getMembership()` already ignores them from the moment `expires_at` passes, so this only makes it show in the staff list and the
 * log. Never an owner (the database does not allow an owner collaborator). Returns how many ended.
 */
export async function endExpiredCollaborators(now: Date = new Date()): Promise<number> {
  const rows = await db().execute<Row>(sql`
    update commerce.store_members m set disabled_at = ${now.toISOString()}::timestamptz
    from commerce.accounts a
    where m.kind = 'collaborator' and m.disabled_at is null and m.expires_at <= ${now.toISOString()}::timestamptz and a.id = m.account_id
    returning m.store_id, m.account_id, a.email
  `);
  for (const row of rows) {
    await audit(null, String(row.store_id), "staff.collaborator_expired", { email: String(row.email) }, { target: { type: "account", id: String(row.account_id) }, area: "staff" });
  }
  return rows.length;
}

/**
 * Removes activity-log entries older than 24 months (`AUDIT_RETENTION_MONTHS`). The database's guard refuses to remove a younger entry
 * whoever asks, so the cutoff never passes the database's own clock. Done in batches so a long log does not hold one big statement.
 */
export async function pruneAuditLog(now: Date = new Date()): Promise<number> {
  let total = 0;
  for (let round = 0; round < 40; round++) {
    const rows = await db().execute<Row>(sql`
      delete from commerce.audit_log
      where id in (
        select id from commerce.audit_log
        where created_at < least(${now.toISOString()}::timestamptz, now()) - make_interval(months => ${AUDIT_RETENTION_MONTHS})
        order by id limit 5000
      )
      returning id
    `);
    total += rows.length;
    if (rows.length < 5000) break;
  }
  return total;
}

/** Removes recovery codes that were used or revoked more than 12 months ago; the unused ones stay until they are used or replaced. */
export async function pruneRecoveryCodes(now: Date = new Date()): Promise<number> {
  const rows = await db().execute<Row>(sql`
    delete from commerce.account_recovery_codes
    where (used_at is not null or revoked_at is not null)
      and coalesce(used_at, revoked_at) < ${now.toISOString()}::timestamptz - interval '12 months'
    returning id
  `);
  return rows.length;
}

/** The three jobs for the daily cron, each isolated so one failing does not stop the others. */
export async function runSecurityJobs(now: Date = new Date()): Promise<{ collaboratorsEnded: number; auditEntriesPruned: number; recoveryCodesPruned: number }> {
  const run = async (name: string, job: () => Promise<number>) => {
    try {
      return await job();
    } catch (error) {
      console.error(`[security-jobs] ${name} failed`, error);
      return 0;
    }
  };
  return {
    collaboratorsEnded: await run("endExpiredCollaborators", () => endExpiredCollaborators(now)),
    auditEntriesPruned: await run("pruneAuditLog", () => pruneAuditLog(now)),
    recoveryCodesPruned: await run("pruneRecoveryCodes", () => pruneRecoveryCodes(now)),
  };
}
