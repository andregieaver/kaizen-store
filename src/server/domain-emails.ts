import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { DOMAIN_EMAIL_KINDS, domainEmail, reminderDue, type DomainEmailKind } from "@/lib/domain-emails";
import { renderEmail } from "@/lib/email-layout";
import { siteUrl } from "@/lib/site";

import { sendEmail } from "./email";

type Row = Record<string, unknown>;

/**
 * Emails to a domain's holder (D315 9.1, D317): sent to the holding account's address in its admin language, once each by its idempotency
 * key, never throwing (a domain stays as it is whatever an email does).
 */

const langOf = (locale: unknown) => (locale === "nb-NO" ? "nb" : "en");
const dateIn = (iso: string, lang: "en" | "nb") =>
  new Intl.DateTimeFormat(lang === "nb" ? "nb-NO" : "en-GB", { dateStyle: "long", timeZone: "Europe/Oslo" }).format(new Date(iso));
const yourDomains = () => `${siteUrl()}/admin/account/domains`;

async function send(kind: DomainEmailKind, to: string, key: string, email: ReturnType<typeof domainEmail>, storeId: string | null): Promise<boolean> {
  try {
    const outcome = await sendEmail({ storeId, kind: DOMAIN_EMAIL_KINDS[kind], to, email: renderEmail(email), fromName: "Kaizena Flow", idempotencyKey: key });
    return outcome !== "duplicate" && outcome !== "suppressed";
  } catch (error) {
    console.error("[domains] an email could not be sent", error);
    return false;
  }
}

/** *{domain} is yours*: after a registration or a transfer in is done, with a consumer's consent repeated. */
export async function sendRegisteredEmail(purchaseId: string): Promise<void> {
  const [row] = await db().execute<Row>(sql`
    select p.apex, p.store_id, p.consent_text, r.expires_at, a.email, a.admin_locale,
           coalesce(nullif(g.company_name, ''), trim(g.first_name || ' ' || g.last_name)) as holder
      from commerce.domain_purchases p
      join commerce.domain_registrations r on r.id = p.registration_id
      join commerce.accounts a on a.id = p.account_id
      left join commerce.domain_registrants g on g.id = p.registrant_id
     where p.id = ${purchaseId}::uuid and p.status = 'done' and p.kind in ('register', 'transfer')
  `);
  if (!row?.email || !row.expires_at) return;
  const lang = langOf(row.admin_locale);
  await send(
    "registered",
    String(row.email),
    `domain-registered:${purchaseId}`,
    domainEmail("registered", lang, {
      domain: String(row.apex),
      date: dateIn(String(row.expires_at), lang),
      holder: String(row.holder ?? ""),
      consent: row.consent_text ? String(row.consent_text) : null,
      url: yourDomains(),
    }),
    row.store_id ? String(row.store_id) : null,
  );
}

/**
 * The daily reminders (D315 9.1): a registration expiring within 30 days whose renewal is off, or on but not yet paid, at 30, 14, 7 and 1
 * days before. One that renews and is paid gets none. Returns how many were sent.
 */
export async function sendRenewalReminders(now = new Date()): Promise<number> {
  const rows = await db().execute<Row>(sql`
    select r.id, r.apex, r.store_id, r.expires_at, r.renew, a.email, a.admin_locale,
           (select p.invoice_url from commerce.domain_purchases p where p.registration_id = r.id and p.kind = 'renew' and p.status = 'invoiced'
             order by p.created_at desc limit 1) as invoice_url,
           exists (select 1 from commerce.domain_purchases p where p.registration_id = r.id and p.kind = 'renew' and p.status in ('paid', 'registering', 'done')
                    and p.created_at > r.expires_at - interval '35 days') as renewed
      from commerce.domain_registrations r join commerce.accounts a on a.id = r.account_id
     where r.status = 'active' and r.expires_at between ${now.toISOString()}::timestamptz and ${now.toISOString()}::timestamptz + interval '30 days'
     limit 200
  `);
  let sent = 0;
  for (const row of rows) {
    if (row.renewed === true || !row.email) continue;
    const expires = new Date(String(row.expires_at));
    const due = reminderDue(Math.floor((expires.getTime() - now.getTime()) / 86_400_000));
    if (due === null) continue;
    const kind: DomainEmailKind = row.renew === true ? "unpaid" : "stopping";
    // A renewal that isn't invoiced yet is made by the daily job first; without an invoice to pay, the reminder waits a day.
    if (kind === "unpaid" && !row.invoice_url) continue;
    const lang = langOf(row.admin_locale);
    const ok = await send(
      kind,
      String(row.email),
      `domain-reminder:${String(row.id)}:${expires.toISOString().slice(0, 10)}:${due}`,
      domainEmail(kind, lang, { domain: String(row.apex), date: dateIn(expires.toISOString(), lang), url: kind === "unpaid" ? String(row.invoice_url) : yourDomains() }),
      row.store_id ? String(row.store_id) : null,
    );
    if (ok) sent++;
  }
  return sent;
}
