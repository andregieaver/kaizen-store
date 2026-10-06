import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { renderEmail, type EmailBlock } from "@/lib/email-layout";
import { formatMoney } from "@/lib/money";
import { storeSiteUrl, marketPath } from "@/lib/paths";

import { sendEmail, type SendOutcome } from "./email";
import { getOrder } from "./orders";
import { emailContext, emailFooter, orderLinesBlock } from "./shopper-emails";

type Row = Record<string, unknown>;

/**
 * The pay-link email of a draft order (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.1): kind `draft.pay_link`, to the ONE address staff typed (or took from the customer), in the order's language: the lines, the total,
 * the store's note (quoted, plain text, never HTML), the date the link is valid to and the button. The words are hand-written (nb, sv, da, en) and need legal review (`emailText().draft`). The token is in the
 * link only; the email is kept in `email_messages` like every shopper email, so the message holds the link (the store's own record of what it sent). One per token: a new token (*Send again*) is a new email.
 * Never throws into the caller: a failed email is `failed` and staff may send again.
 */
export async function sendDraftLink(storeId: string, draftId: string, token: string, options: { again?: boolean } = {}): Promise<SendOutcome> {
  const [draft] = await db().execute<Row>(sql`
    select number, status, order_id, email, locale, market_slug, market_code, currency, note_to_buyer, expires_at, pay_token_hash from commerce.draft_orders
    where store_id = ${storeId}::uuid and id = ${draftId}::uuid
  `);
  if (!draft || draft.status !== "sent" || !draft.order_id || !draft.email) return "failed";
  const order = await getOrder(storeId, String(draft.order_id));
  if (!order || order.status !== "pending_payment") return "failed";
  const ctx = await emailContext(storeId, String(draft.market_code).trim(), String(draft.locale), String(draft.currency).trim());
  if (!ctx) return "failed";
  const { store, market, text, m } = ctx;
  const words = text.draft;
  const money = (minor: number) => formatMoney(minor, order.currency, market.locale);
  const url = `${storeSiteUrl(store.slug)}${marketPath(store.slug, String(draft.market_slug), `/account/pay/${token}`)}`;
  const until = new Date(String(draft.expires_at)).toLocaleDateString(market.locale, { dateStyle: "long" });
  const note = draft.note_to_buyer ? String(draft.note_to_buyer) : null;
  const blocks: EmailBlock[] = [
    { type: "heading", text: words.heading },
    { type: "paragraph", text: words.intro(store.name) },
    orderLinesBlock(order, text, m, money, storeSiteUrl(store.slug)),
    // The store's own words to the buyer, quoted as text.
    ...(note ? [{ type: "paragraph" as const, text: `${words.noteHeading}:\n${note}` }] : []),
    { type: "paragraph", text: words.validUntil(until) },
    { type: "button", text: words.button, url },
    { type: "paragraph", text: words.notYou },
  ];
  const email = renderEmail({ subject: words.subject(store.name, order.number), preview: words.intro(store.name), blocks, footer: emailFooter(store, text), lang: ctx.lang });
  return sendEmail({
    storeId,
    kind: "draft.pay_link",
    to: String(draft.email),
    email,
    fromName: store.name,
    replyTo: store.details.contactEmail,
    // One per link: sending again makes a new link, so a new email.
    idempotencyKey: `draft-link:${draftId}:${String(draft.pay_token_hash).slice(0, 16)}${options.again ? ":again" : ""}`,
    orderId: order.id,
  });
}

