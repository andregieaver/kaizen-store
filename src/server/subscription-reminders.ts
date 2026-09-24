import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { reminderDue } from "@/lib/subscriptions";

import { sendRenewalReminder } from "./shopper-emails";
import { getSubscription } from "./subscriptions";

type Row = Record<string, unknown>;

export type ReminderRun = { checked: number; sent: number; failed: number };

/**
 * Sends the reminders that are due (D29): before a free trial ends and
 * before renewals of a month or longer. Run daily; each charge date gets
 * one reminder however often it runs. Only subscriptions renewing within
 * the reminder window are looked at (a pause only moves a charge later).
 */
export async function sendDueReminders(now = new Date()): Promise<ReminderRun> {
  const rows = await db().execute<Row>(sql`
    select store_id, id, reminded_for from commerce.subscriptions
    where status in ('active', 'paused') and email is not null
      and not cancel_at_period_end and cancel_at is null
      and current_period_end between ${now.toISOString()}::timestamptz
                                 and ${now.toISOString()}::timestamptz + interval '8 days'
    order by current_period_end
    limit 1000
  `);
  const run: ReminderRun = { checked: rows.length, sent: 0, failed: 0 };
  for (const row of rows) {
    const storeId = String(row.store_id);
    const subscription = await getSubscription(storeId, String(row.id));
    if (!subscription?.nextChargeAt) continue;
    const due = reminderDue(now, {
      interval: subscription.interval,
      intervalCount: subscription.intervalCount,
      nextChargeAt: new Date(subscription.nextChargeAt),
      trialEndsAt: subscription.trialEndsAt ? new Date(subscription.trialEndsAt) : null,
      remindedFor: row.reminded_for ? new Date(String(row.reminded_for)) : null,
    });
    if (!due) continue;
    const outcome = await sendRenewalReminder(storeId, subscription, due.kind, due.chargeAt);
    if (outcome === "failed" || outcome === null) {
      run.failed++;
      continue;
    }
    run.sent++;
    await db().execute(sql`
      update commerce.subscriptions set reminded_for = ${due.chargeAt.toISOString()}::timestamptz
      where store_id = ${storeId}::uuid and id = ${subscription.id}::uuid
    `);
  }
  return run;
}
