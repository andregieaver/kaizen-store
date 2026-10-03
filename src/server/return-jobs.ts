import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";

import { sendRefundOverdueReminder, sendWithdrawalAcknowledgement } from "./return-emails";

type Row = Record<string, unknown>;

/**
 * The upkeep of withdrawals and returns (D153), run by the cron routes; none of it throws.
 *
 * - Daily: `expireWithdrawalRequests()` deletes the requests nobody confirmed within 24 hours (a confirmed withdrawal is a
 *   legal record and is never deleted).
 * - Every five minutes: `runReturnJobs()` emails the store once when a withdrawal's refund is past its legal deadline
 *   (14 days after it was informed), and tries again to send the acknowledgement of a confirmed withdrawal whose first
 *   email never got out. Nothing is refunded automatically.
 */

/** Deletes unconfirmed requests past their time; how many. */
export async function expireWithdrawalRequests(): Promise<number> {
  try {
    const [row] = await db().execute<Row>(sql`select commerce.expire_withdrawal_requests() as n`);
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}

const OVERDUE_BATCH = 50;
const ACK_BATCH = 25;
/** Acknowledgement attempts in all (the shopper's copy and the order address's copy count as two). */
const ACK_ATTEMPTS = 6;

export type ReturnJobs = { overdueReminders: number; acknowledgementsRetried: number };

/** Reminders for refunds past their deadline (once per return) and unsent acknowledgements tried again. */
export async function runReturnJobs(): Promise<ReturnJobs> {
  const out: ReturnJobs = { overdueReminders: 0, acknowledgementsRetried: 0 };
  try {
    const overdue = await db().execute<Row>(sql`
      select r.store_id, r.id from commerce.returns r
      join commerce.stores s on s.id = r.store_id
      where r.refund_deadline is not null and r.refund_deadline < now() and r.refund_minor is null
        and r.status::text in ('approved', 'in_transit', 'received', 'inspected') and s.contact_email is not null
        and not exists (select 1 from commerce.email_messages m where m.idempotency_key = 'return.' || r.id::text || '.overdue')
      order by r.refund_deadline limit ${OVERDUE_BATCH}
    `);
    for (const row of overdue) {
      const outcome = await sendRefundOverdueReminder(String(row.store_id), String(row.id)).catch(() => null);
      if (outcome === "sent" || outcome === "logged") out.overdueReminders++;
    }
  } catch {
    // A job that cannot read does nothing this time and is tried again in five minutes.
  }
  try {
    const unsent = await db().execute<Row>(sql`
      select w.store_id, w.id from commerce.withdrawal_requests w
      where w.status = 'confirmed' and w.acknowledged_at is null
        and w.confirmed_at < now() - interval '5 minutes' and w.confirmed_at > now() - interval '3 days'
        and (select count(*) from commerce.email_messages m where m.idempotency_key like 'return.ack:' || w.id::text || '%') < ${ACK_ATTEMPTS}
        and not exists (
          select 1 from commerce.email_messages m
          where m.idempotency_key like 'return.ack:' || w.id::text || '%' and m.created_at > now() - interval '5 minutes'
        )
      order by w.confirmed_at limit ${ACK_BATCH}
    `);
    for (const row of unsent) {
      const storeId = String(row.store_id);
      const requestId = String(row.id);
      const outcome = await sendWithdrawalAcknowledgement(storeId, requestId, { resend: true });
      if (outcome.sent && outcome.messageId) {
        await db().execute(sql`
          update commerce.withdrawal_requests set acknowledged_at = now(), acknowledgement_reference = ${outcome.messageId}
          where store_id = ${storeId}::uuid and id = ${requestId}::uuid and status = 'confirmed' and acknowledged_at is null
        `);
        out.acknowledgementsRetried++;
      }
    }
  } catch {
    // Tried again in five minutes.
  }
  return out;
}
