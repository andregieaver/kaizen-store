import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { filedText, participantsOf } from "@/lib/filed-email";
import { bareAddress, filingAddress, inboundDomain } from "@/lib/inbound-email";
import { featureOn } from "@/lib/store-features";

import { log } from "./log";
import { getStore } from "./stores";
import { textList, uuidList } from "./sql-arrays";
import { col, typedRows } from "./typed-rows";

/**
 * Email on the timeline (S5 of `docs/own-books-and-sales.md`, D476): a store's filing address, and the mail its team copies or forwards to
 * it, filed on the customers it is about, their companies and their open deals. It arrives as every received email does (the Resend
 * webhook, `support_inbound_emails` with purpose `filing`, `processInboundEmails()`), which calls `fileReceived()`. Only mail sent from the
 * address of a member of the store's team whose access has not ended is filed, and only while Deals is on; mail about nobody the store knows
 * is not kept. Kept for the email bodies' retention rule (12 months, `pruneFiledEmails()`), and erased with any of its people.
 */

/** The store's filing address, made the first time it is asked for; null while receiving is not set up. */
export async function filingAddressOf(storeId: string, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const domain = inboundDomain(env.SUPPORT_INBOUND_DOMAIN);
  if (!domain) return null;
  const key = Array.from(randomBytes(20), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  await db().execute(sql`insert into commerce.email_filing (store_id, key) values (${storeId}::uuid, ${key}) on conflict (store_id) do nothing`);
  const [row] = await db().execute<{ key: string }>(sql`select key from commerce.email_filing where store_id = ${storeId}::uuid`);
  return row ? filingAddress(row.key, domain) : null;
}

/** The store a filing key is for, or null. */
export async function storeOfFilingKey(key: string): Promise<string | null> {
  const [row] = await db().execute<{ store_id: string }>(sql`select store_id from commerce.email_filing where key = ${key}`);
  return row ? String(row.store_id) : null;
}

export type ReceivedMail = { from: string; to: string[]; cc: string[]; subject: string | null; text: string | null; html: string | null; messageId: string | null; sentAt: string };
export type FilingOutcome = { status: "done" | "refused"; reason?: string };

/** A received mail filed (or refused, with the reason): see the module. */
export async function fileReceived(storeId: string, mail: ReceivedMail, env: Record<string, string | undefined> = process.env): Promise<FilingOutcome> {
  const domain = inboundDomain(env.SUPPORT_INBOUND_DOMAIN);
  if (!domain) return { status: "refused", reason: "not_set_up" };
  const [slug] = await db().execute<{ slug: string }>(sql`select slug from commerce.stores where id = ${storeId}::uuid`);
  const store = slug ? await getStore(String(slug.slug)) : null;
  if (!store || !featureOn(store, "sales")) return { status: "refused", reason: "sales_off" };
  const from = bareAddress(mail.from);
  const team = await typedRows(
    z.object({ id: col.uuid, email: col.text }),
    sql`
      select a.id, lower(a.email) as email from commerce.store_members m join commerce.accounts a on a.id = m.account_id
       where m.store_id = ${storeId}::uuid and (m.expires_at is null or m.expires_at > now())
    `,
  );
  const sender = team.find((m) => m.email === from);
  if (!from || !sender) return { status: "refused", reason: "not_staff" };
  const words = filedText({ text: mail.text, html: mail.html });
  if (!words.text) return { status: "refused", reason: "empty" };
  const addresses = participantsOf({ from: mail.from, to: mail.to, cc: mail.cc, text: words.text }, { team: new Set(team.map((m) => m.email)), domain }).slice(0, 200);
  if (addresses.length === 0) return { status: "refused", reason: "no_match" };

  const known = await typedRows(
    z.object({ id: col.uuid, company_id: col.uuid.nullable() }),
    sql`select id, company_id from commerce.customers where store_id = ${storeId}::uuid and lower(email) = any(${textList(addresses)})`,
  );
  if (known.length === 0) return { status: "refused", reason: "no_match" };
  const customerIds = known.map((c) => c.id);
  const companyIds = [...new Set(known.flatMap((c) => (c.company_id ? [c.company_id] : [])))];
  const deals = await typedRows(
    z.object({ id: col.uuid }),
    sql`
      select id from commerce.deals
       where store_id = ${storeId}::uuid and status = 'open'
         and (customer_id = any(${uuidList(customerIds)}) or company_id = any(${uuidList(companyIds)}))
    `,
  );
  const [filed] = await db().execute<{ id: string }>(sql`
    insert into commerce.filed_emails (store_id, message_id, subject, from_address, addresses, customer_ids, company_ids, deal_ids, body, cut, filed_by, sent_at)
    values (${storeId}::uuid, ${mail.messageId}, ${mail.subject?.slice(0, 300) ?? null}, ${from}, ${textList(addresses)}, ${uuidList(customerIds)}, ${uuidList(companyIds)},
      ${uuidList(deals.map((d) => d.id))}, ${words.text}, ${words.cut}, ${sender.id}::uuid, ${mail.sentAt}::timestamptz)
    on conflict (store_id, message_id) where message_id is not null do nothing
    returning id
  `);
  log("info", "email_filing.filed", { storeId, filed: filed ? 1 : 0, customers: customerIds.length, deals: deals.length });
  return { status: "done" };
}

export type FiledEmail = { id: string; subject: string | null; from: string; sentAt: string; excerpt: string; body: string };

/** The mail filed on a person (by customer or address), a company or a deal, the newest first. */
export async function filedEmailsOf(storeId: string, about: { customerId?: string | null; emails?: readonly string[]; companyId?: string; dealId?: string }, n = 50): Promise<FiledEmail[]> {
  const rows = await typedRows(
    z.object({ id: col.uuid, subject: col.textOrNull, from_address: col.text, sent_at: col.timestamp, body: col.text }),
    sql`
      select id, subject, from_address, sent_at, body from commerce.filed_emails
       where store_id = ${storeId}::uuid and (
         (${about.customerId ?? null}::uuid is not null and customer_ids @> array[${about.customerId ?? null}::uuid])
         or (${about.emails && about.emails.length > 0 ? sql`addresses && ${textList(about.emails)}` : sql`false`})
         or (${about.companyId ?? null}::uuid is not null and company_ids @> array[${about.companyId ?? null}::uuid])
         or (${about.dealId ?? null}::uuid is not null and deal_ids @> array[${about.dealId ?? null}::uuid]))
       order by sent_at desc, id
       limit ${n}
    `,
  );
  return rows.map((r) => ({ id: r.id, subject: r.subject, from: r.from_address, sentAt: r.sent_at, excerpt: r.body.replace(/\s+/g, " ").slice(0, 200), body: r.body }));
}

/** Filed mail past the email bodies' retention rule (12 months) deleted. Never throws. */
export async function pruneFiledEmails(): Promise<number> {
  try {
    const gone = await db().execute(sql`delete from commerce.filed_emails where created_at < now() - interval '12 months' returning id`);
    return gone.length;
  } catch (error) {
    log("error", "email_filing.prune_failed", {}, error);
    return 0;
  }
}
