import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import type { SendAllowance } from "@/lib/send-allowance";

import { accountSize, nextSize } from "./extension-sizes";
import { limitFor, usageNow } from "./limits";
import { col, typedRow } from "./typed-rows";

/**
 * Email automation's send allowance and contact limit for a store's account (D876, D748 E10 part three): the size the account has
 * (`accountSize()`), the people subscribed on its stores' lists, and the marketing emails sent this month across them (the store limit
 * `marketing_emails_month`, which the size sets: `readStoreLimits()`). Null for a store whose account is not billed through its account, has
 * no size of email automation, or is one Kaizena Flow keeps (a template, a demo, its own): nothing is held for them here.
 */
export async function sendAllowance(storeId: string, now: Date = new Date()): Promise<SendAllowance | null> {
  const store = await typedRow(
    z.object({ organisation_id: col.uuid }),
    sql`select s.organisation_id from commerce.stores s
          join commerce.organisation_billing ob on ob.organisation_id = s.organisation_id
         where s.id = ${storeId}::uuid and not (s.is_template or s.starter or s.sandbox or s.house)`,
  );
  if (!store) return null;
  const size = await accountSize(store.organisation_id, "email_automation");
  if (!size) return null;
  const [next, contacts, emails, emailsAllowed] = await Promise.all([
    nextSize("email_automation", size),
    contactsOf(store.organisation_id),
    usageNow(storeId, "marketing_emails_month", now),
    limitFor(storeId, "marketing_emails_month"),
  ]);
  return { contacts, contactsAllowed: size.allowances.contacts ?? null, emails, emailsAllowed, next: next ? { contacts: next.allowances.contacts ?? null } : null };
}

/** The same for an account (Account, Extensions): read through one of its open stores, as its limits are kept per store. */
export async function accountSendAllowance(organisationId: string, now: Date = new Date()): Promise<SendAllowance | null> {
  const store = await typedRow(
    z.object({ id: col.uuid }),
    sql`select id from commerce.stores where organisation_id = ${organisationId}::uuid and status <> 'closed'
          and not (is_template or starter or sandbox or house) order by created_at limit 1`,
  );
  return store ? sendAllowance(store.id, now) : null;
}

/** The people subscribed on the lists of the account's open stores, each address once (`marketing_subscribers_list_idx`). */
async function contactsOf(organisationId: string): Promise<number> {
  const row = await typedRow(
    z.object({ n: col.int }),
    sql`select count(distinct lower(ms.email))::int as n from commerce.marketing_subscribers ms
          join commerce.stores s on s.id = ms.store_id
         where s.organisation_id = ${organisationId}::uuid and s.status <> 'closed' and not (s.is_template or s.starter or s.sandbox or s.house)
           and ms.status = 'subscribed'`,
  );
  return row?.n ?? 0;
}
