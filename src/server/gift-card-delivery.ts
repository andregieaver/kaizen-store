import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { renderEmail, type EmailBlock } from "@/lib/email-layout";
import { emailText } from "@/lib/email-text";
import { formatGiftCode } from "@/lib/gift-cards";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { marketPath, storeSiteUrl } from "@/lib/paths";

import { sendEmail, type SendOutcome } from "./email";
import { newGiftCode } from "./gift-card-codes";
import { marketSlugFor } from "./marketing-email";
import { notificationOn } from "./notifications";
import { emailFooter, storeById, type EmailStore } from "./shopper-emails";

/**
 * Delivering the gift cards an order bought (D300 F2, `docs/wave-5-marketing.md` 8.2). A card is issued by the database when its order is paid
 * (`commerce.issue_order_gift_cards()`), with no code; here its code is made, kept as its hash (`gift_card_set_code()`) and emailed: to the
 * person it is for on its day, the buyer told it is on its way (without the code), or else to the buyer at once. The code is in the email
 * alone: the log keeps `[code]` in its place (`secrets`). Only once the email is out is the card marked sent; a failed email leaves it
 * unsent, and the next run makes a new code (the old one never reached anyone) and tries again. Runs right after the order's confirmation and
 * from the every-minute marketing job, for any card whose day has come. Never throws.
 */

type Row = Record<string, unknown>;

export type DeliveryRun = { sent: number; failed: number };

/** How many cards one run delivers at most, so a run stays short; the next takes the rest. */
const PER_RUN = 50;

/** The cards to deliver now: of an order, or of every open store; bought, active, unsent, their day come. */
async function dueCards(orderId: string | null): Promise<Row[]> {
  return db().execute<Row>(sql`
    select g.id, g.store_id, g.currency, g.initial_minor, g.expires_at, g.recipient_email, g.recipient_name, g.message,
      o.email as buyer_email, o.locale, o.market_code, ol.gift_card_from, s.time_zone
    from commerce.gift_cards g
    join commerce.orders o on o.store_id = g.store_id and o.id = g.order_id
    join commerce.order_lines ol on ol.store_id = g.store_id and ol.id = g.order_line_id
    join commerce.stores s on s.id = g.store_id
    where g.source = 'order' and g.status = 'active' and g.sent_at is null
      and (g.send_at is null or g.send_at <= now())
      and o.status in ('paid', 'fulfilled') and o.restricted_at is null and o.anonymised_at is null
      and commerce.store_is_active(g.store_id)
      and (${orderId}::uuid is null or g.order_id = ${orderId}::uuid)
    order by g.send_at nulls first, g.issued_at, g.id
    limit ${PER_RUN}
  `);
}

/** Delivers the cards whose time has come: an order's (right after it is paid), or every store's (the job). Never throws. */
export async function deliverGiftCards(options: { orderId?: string; deadline?: number } = {}): Promise<DeliveryRun> {
  const run: DeliveryRun = { sent: 0, failed: 0 };
  try {
    const cards = await dueCards(options.orderId ?? null);
    const stores = new Map<string, EmailStore | null>();
    for (const card of cards) {
      if (options.deadline && Date.now() > options.deadline) break;
      const storeId = String(card.store_id);
      if (!stores.has(storeId)) stores.set(storeId, await storeById(storeId));
      const store = stores.get(storeId);
      if (!store) continue;
      const outcome = await deliverOne(store, card).catch((error) => {
        console.error("gift cards: a card was not delivered", error);
        return "failed" as const;
      });
      if (outcome === "sent") run.sent += 1;
      else run.failed += 1;
    }
  } catch (error) {
    console.error("gift cards: the delivery run stopped", error);
  }
  return run;
}

/** One card: a code, its email, and the card marked sent once the email is out. */
async function deliverOne(store: EmailStore, card: Row): Promise<"sent" | "failed"> {
  const storeId = store.id;
  const cardId = String(card.id);
  // Required (D238): always on; asked as every catalogue sender asks.
  if (!(await notificationOn(storeId, "gift_card.issued"))) return "failed";
  const code = newGiftCode();
  if (!code) return "failed";
  const [set] = await db().execute<Row>(sql`select commerce.gift_card_set_code(${storeId}::uuid, ${cardId}::uuid, ${code.hash}, ${code.last4}) as ok`);
  if (!set?.ok) return "failed";

  const lang = String(card.locale ?? "").slice(0, 2) || "en";
  const m = t(lang);
  const amount = formatMoney(Number(card.initial_minor), String(card.currency).trim(), String(card.locale || "en"));
  const recipient = card.recipient_email ? String(card.recipient_email) : null;
  const to = recipient ?? String(card.buyer_email);
  const slug = marketSlugFor(store, card.market_code ? String(card.market_code) : null);
  const link = `${storeSiteUrl(store.slug)}${marketPath(store.slug, slug, "/")}`;
  const until = card.expires_at
    ? new Date(String(card.expires_at)).toLocaleDateString(String(card.locale || "en"), { dateStyle: "long", timeZone: String(card.time_zone || "UTC") })
    : null;
  const from = card.gift_card_from ? String(card.gift_card_from) : null;
  const blocks: EmailBlock[] = [
    { type: "heading", text: m.giftCardEmail.heading(amount, store.name) },
    ...(recipient && (from || card.message)
      ? ([{ type: "paragraph", text: [from ? m.giftCardEmail.from(from) : null, card.message ? String(card.message) : null].filter(Boolean).join("\n") }] satisfies EmailBlock[])
      : []),
    { type: "code", text: formatGiftCode(code.code) },
    { type: "paragraph", text: m.giftCardEmail.useIt(store.name) },
    { type: "paragraph", text: until ? m.giftCardEmail.validUntil(until) : m.giftCardEmail.noExpiry },
    { type: "paragraph", text: m.giftCardEmail.keepIt },
    { type: "button", text: m.giftCardEmail.visit(store.name), url: link },
  ];
  const email = renderEmail({
    subject: m.giftCardEmail.subject(store.name),
    preview: m.giftCardEmail.heading(amount, store.name),
    blocks,
    footer: emailFooter(store, emailText(lang)),
    lang,
  });
  const outcome: SendOutcome = await sendEmail({
    storeId,
    kind: "gift_card.issued",
    to,
    email,
    fromName: store.name,
    replyTo: store.details.contactEmail ?? null,
    // A new code is a new email: the one before never reached anyone.
    idempotencyKey: `gift-card:${cardId}:${code.hash.slice(0, 16)}`,
    secrets: [formatGiftCode(code.code), code.code],
  });
  if (outcome !== "sent" && outcome !== "logged") return "failed";
  await db().execute(sql`select commerce.gift_card_mark_sent(${storeId}::uuid, ${cardId}::uuid)`);

  // The buyer hears that it went, without the code (only the person it is for has it).
  if (recipient) {
    const copy = renderEmail({
      subject: m.giftCardEmail.copySubject(store.name),
      preview: m.giftCardEmail.copyHeading,
      blocks: [
        { type: "heading", text: m.giftCardEmail.copyHeading },
        { type: "paragraph", text: m.giftCardEmail.copyText(amount, recipient) },
      ],
      footer: emailFooter(store, emailText(lang)),
      lang,
    });
    await sendEmail({
      storeId,
      kind: "gift_card.on_its_way",
      to: String(card.buyer_email),
      email: copy,
      fromName: store.name,
      replyTo: store.details.contactEmail ?? null,
      idempotencyKey: `gift-card-copy:${cardId}`,
    });
  }
  return "sent";
}
