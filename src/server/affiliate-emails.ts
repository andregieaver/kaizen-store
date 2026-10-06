import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { convertCredits } from "@/lib/bonus";
import { renderEmail } from "@/lib/email-layout";
import { affiliateRewardText } from "@/lib/email-text";
import { formatMoney } from "@/lib/money";
import { marketPath, storeSiteUrl } from "@/lib/paths";

import { bonusProgram } from "./bonus";
import { sendEmail, type SendOutcome } from "./email";
import { emailContext, emailFooter } from "./shopper-emails";

type Row = Record<string, unknown>;

/** How far back the job looks for rewards whose email has not gone out. */
const RECENT_DAYS = 3;
/** At most this many rewards are written to per run. */
const BATCH = 100;

/**
 * The email to a referrer when a friend's order earned them credits (D131): once per order (the key is the order), however
 * often it is asked for, in the referrer's own language and currency as they read the page. It says what they earned and
 * from when it is usable, never who the friend is or what was bought. Null when there is nothing to say: the order has no
 * reward, the referrer has no email or opted out of the store's emails.
 */
export async function sendReferrerRewardEmail(storeId: string, orderId: string): Promise<SendOutcome | null> {
  const [row] = await db().execute<Row>(sql`
    select a.reward_minor, a.customer_id, e.available_at, r.email, r.name, r.locale,
      exists (select 1 from commerce.email_opt_outs o where o.store_id = r.store_id and lower(o.email) = lower(r.email)) as opted_out
    from (
      select x.store_id, x.affiliate_customer_id as customer_id, x.reward_minor, x.order_id
      from commerce.affiliate_attributions x
      where x.store_id = ${storeId}::uuid and x.order_id = ${orderId}::uuid and x.status = 'rewarded' and x.reward_minor > 0
    ) a
    join commerce.customers r on r.store_id = a.store_id and r.id = a.customer_id
    left join commerce.bonus_entries e on e.store_id = a.store_id and e.idempotency_key = 'referral:' || a.order_id::text
  `);
  if (!row || !row.email || row.opted_out) return null;
  // The store's own country, in the referrer's language when they have one.
  const [main] = await db().execute<Row>(sql`
    select m.code, m.default_locale from commerce.markets m join commerce.stores s on s.id = m.store_id
    where m.store_id = ${storeId}::uuid and m.active
    order by (m.code = s.country) desc nulls last, m.created_at, m.code limit 1
  `);
  if (!main) return null;
  const ctx = await emailContext(storeId, String(main.code), String(row.locale ?? main.default_locale));
  if (!ctx) return null;
  const { store, market, text } = ctx;
  // The credits are in the store's credits currency; the referrer reads them in the market's when the store has a rate.
  const program = await bonusProgram(db(), storeId);
  const shown = convertCredits(Number(row.reward_minor), program.currency, market.currency, program.rates, "down");
  const amount = shown === null ? formatMoney(Number(row.reward_minor), program.currency, market.locale) : formatMoney(shown, market.currency, market.locale);
  const at = row.available_at ? new Date(String(row.available_at)) : null;
  const words = affiliateRewardText(text, {
    store: store.name,
    customerName: String(row.name ?? ""),
    amount,
    usableFrom: at && at.getTime() > Date.now() ? at.toLocaleDateString(market.locale, { dateStyle: "long" }) : null,
    url: `${storeSiteUrl(store.slug)}${marketPath(store.slug, market.slug, "/account/referrals")}`,
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
    storeId,
    kind: "affiliate.reward",
    to: String(row.email),
    email,
    fromName: store.name,
    replyTo: store.details.contactEmail,
    // Once per order.
    idempotencyKey: `affiliate-reward:${orderId}`,
  });
}

/**
 * Every five minutes (D131): referrers whose friends' orders were rewarded in the last days and who have not been told
 * get their email (the key makes it once). Payment paths that do not pass the order confirmation, such as a booking
 * confirmed at the venue, are covered here. Never throws: a failing email is left as it is.
 */
export async function runAffiliateJobs(): Promise<{ emailed: number }> {
  let emailed = 0;
  try {
    const rows = await db().execute<Row>(sql`
      select a.store_id, a.order_id from commerce.affiliate_attributions a
      where commerce.store_is_active(a.store_id) and a.status = 'rewarded' and a.reward_minor > 0 and a.rewarded_at > now() - make_interval(days => ${RECENT_DAYS})
        and not exists (select 1 from commerce.email_messages m where m.idempotency_key = 'affiliate-reward:' || a.order_id::text)
      order by a.rewarded_at
      limit ${BATCH}
    `);
    for (const row of rows) {
      const outcome = await sendReferrerRewardEmail(String(row.store_id), String(row.order_id));
      if (outcome === "sent" || outcome === "logged") emailed++;
    }
  } catch {
    // Left for the next run.
  }
  return { emailed };
}

