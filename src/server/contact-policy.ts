import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { contactPolicySchema, POLICY_DEFAULT, type ContactPolicy } from "@/lib/contact-policy";
import { normaliseEmail } from "@/lib/email-address";

import { audit } from "./auth";
import { textList, uuidList } from "./sql-arrays";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * One contact policy across a store's email and texts (email plan M1.5, D764): the only writer of `commerce.contact_policies`, and the one
 * reader of what reached a person lately. Marketing emails are read from `email_messages` (broadcasts, automation emails and cart
 * reminders, once sent: a queued one has not reached anyone, and a retry never counts itself), texts from `sms_messages` (sent or delivered);
 * order emails are never counted.
 */

/** The emails that count against the policy: marketing, and cart reminders. Order and account emails never do. */
const COUNTED_KINDS = ["marketing.broadcast", "marketing.automation", "cart_reminder"] as const;

const policyRow = z.object({ per_week: col.int, spacing_hours: col.int, quiet_hours: col.bool });

/** The store's policy, or the default when it has none. */
export async function getContactPolicy(storeId: string): Promise<ContactPolicy> {
  const row = await typedRow(policyRow, sql`select per_week, spacing_hours, quiet_hours from commerce.contact_policies where store_id = ${storeId}::uuid`);
  return row ? { perWeek: row.per_week, spacingHours: row.spacing_hours, quietHours: row.quiet_hours } : { ...POLICY_DEFAULT };
}

export type SavePolicyResult = { ok: true; policy: ContactPolicy } | { ok: false; problem: string };

/** Saves the store's policy from a form's values; the change is in the audit log as its two numbers. */
export async function saveContactPolicy(storeId: string, accountId: string, input: unknown): Promise<SavePolicyResult> {
  const parsed = contactPolicySchema.safeParse(input);
  if (!parsed.success) return { ok: false, problem: parsed.error.issues[0]?.message ?? "Check the numbers." };
  const policy = parsed.data;
  await db().execute(sql`
    insert into commerce.contact_policies (store_id, per_week, spacing_hours, quiet_hours)
    values (${storeId}::uuid, ${policy.perWeek}, ${policy.spacingHours}, ${policy.quietHours})
    on conflict (store_id) do update set per_week = excluded.per_week, spacing_hours = excluded.spacing_hours, quiet_hours = excluded.quiet_hours, updated_at = now()
  `);
  await audit(accountId, storeId, "marketing.contact_policy", { perWeek: policy.perWeek, spacingHours: policy.spacingHours, quietHours: policy.quietHours });
  return { ok: true, policy };
}

/** A person as the policy knows them: their address and, where known, their customer account (a text's number is found by either). */
export type Contactee = { email: string | null; customerId: string | null };

const contactRow = z.object({ email: col.textOrNull, customer_id: z.string().nullable(), at: col.timestamp });

/**
 * The marketing messages that reached each person in the last 7 days, in one statement: for each of `people`, in order, the instants of the
 * emails to their address and the texts to a number that names their address or account.
 */
export async function recentContacts(storeId: string, people: readonly Contactee[], now = new Date()): Promise<string[][]> {
  const emails = [...new Set(people.map((p) => (p.email ? normaliseEmail(p.email) : null)).filter((e): e is string => Boolean(e)))];
  const customers = [...new Set(people.map((p) => p.customerId).filter((c): c is string => Boolean(c)))];
  if (emails.length === 0 && customers.length === 0) return people.map(() => []);
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const rows = await typedRows(
    contactRow,
    sql`
      select lower(e.to_address) as email, null::text as customer_id, e.created_at as at
        from commerce.email_messages e
       where e.store_id = ${storeId}::uuid and e.created_at >= ${since}::timestamptz and e.kind in (${sql.join(COUNTED_KINDS.map((k) => sql`${k}`), sql`, `)})
         and e.status in ('sent', 'logged', 'delivered', 'bounced', 'complained') and lower(e.to_address) = any(${textList(emails)})
      union all
      select lower(p.email), p.customer_id::text, t.sent_at
        from commerce.sms_messages t
        join commerce.sms_subscribers p on p.store_id = t.store_id and p.id = t.subscriber_id
       where t.store_id = ${storeId}::uuid and t.status in ('sent', 'delivered') and t.sent_at >= ${since}::timestamptz
         and (lower(p.email) = any(${textList(emails)}) or p.customer_id = any(${uuidList(customers)}))
    `,
  );
  return people.map((person) => {
    const email = person.email ? normaliseEmail(person.email) : null;
    return rows.filter((r) => (email !== null && r.email === email) || (person.customerId !== null && r.customer_id === person.customerId)).map((r) => r.at);
  });
}
