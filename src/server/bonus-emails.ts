import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { BonusExpiryReminder } from "@/lib/bonus";
import { renderEmail } from "@/lib/email-layout";
import { bonusExpiryText } from "@/lib/email-text";
import { formatMoney } from "@/lib/money";
import { marketPath, storeSiteUrl } from "@/lib/paths";

import { sendEmail, type SendOutcome } from "./email";
import { emailContext, emailFooter } from "./shopper-emails";

type Row = Record<string, unknown>;

/**
 * The reminder before credits expire (D130): one email per customer and expiry date (the date the first of their
 * expiring credits expires), however often the job runs, for the credits that expire within the reminder window.
 * The words are `bonusExpiryText()` in `src/lib/email-text.ts`. Null when the customer cannot be written to: no email,
 * or they opted out of the store's emails.
 */
export async function sendBonusExpiryEmail(reminder: BonusExpiryReminder): Promise<SendOutcome | null> {
  const [customer] = await db().execute<Row>(sql`
    select c.email, c.name, c.locale,
      exists (select 1 from commerce.email_opt_outs o where o.store_id = c.store_id and lower(o.email) = lower(c.email)) as opted_out
    from commerce.customers c
    where c.store_id = ${reminder.storeId}::uuid and c.id = ${reminder.customerId}::uuid
  `);
  if (!customer || !customer.email || customer.opted_out) return null;
  // The store's own country, in the customer's language when they have one.
  const [main] = await db().execute<Row>(sql`
    select m.code, m.default_locale from commerce.markets m join commerce.stores s on s.id = m.store_id
    where m.store_id = ${reminder.storeId}::uuid and m.active
    order by (m.code = s.country) desc nulls last, m.created_at, m.code limit 1
  `);
  if (!main) return null;
  const ctx = await emailContext(reminder.storeId, String(main.code), String(customer.locale ?? main.default_locale));
  if (!ctx) return null;
  const { store, market, text } = ctx;
  const expiresOn = new Date(reminder.firstExpiresAt);
  const words = bonusExpiryText(text, {
    store: store.name,
    customerName: String(customer.name ?? ""),
    amount: formatMoney(reminder.amountMinor, reminder.currency, market.locale),
    expiresOn: expiresOn.toLocaleDateString(market.locale, { dateStyle: "long" }),
    url: `${storeSiteUrl(store.slug)}${marketPath(store.slug, market.slug, "/account/bonus")}`,
  });
  const email = renderEmail({
    subject: words.subject,
    preview: words.preview,
    lang: ctx.lang,
    footer: emailFooter(store, text),
    blocks: [
      { type: "heading", text: words.heading },
      ...words.paragraphs.map((paragraph) => ({ type: "paragraph" as const, text: paragraph })),
      { type: "button", text: words.button.text, url: words.button.url },
    ],
  });
  return sendEmail({
    storeId: reminder.storeId,
    kind: "bonus.expiry_reminder",
    to: String(customer.email),
    email,
    fromName: store.name,
    replyTo: store.details.contactEmail,
    // Once per customer and expiry date.
    idempotencyKey: `bonus-expiry:${reminder.customerId}:${reminder.firstExpiresAt.slice(0, 10)}`,
  });
}
