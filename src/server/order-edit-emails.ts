import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { EmailBlock } from "@/lib/email-layout";

import type { SendOutcome } from "./email";
import { editPayLink, getOrderEdit, marketOfOrder, type OrderEditView } from "./order-edits";
import { orderNotice } from "./shopper-emails";

type Row = Record<string, unknown>;

/**
 * The order-change emails (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.4): kind `order.changed`, to the order's own address only (`order.email`, never
 * an address typed anywhere), in the order's language, through the shopper emails' own `orderNotice()` (kept in `email_messages`, idempotent by key, held back
 * for an erased person's order). What was taken off and added (titles, quantities, line totals), the shipping if it changed, the new total, the reason in fixed
 * words (`other` says nothing; staff's note never), then the refund, the pay link with its end, or "nothing more to pay"; the change's documents (D159) and the
 * withdrawal block for added goods (D153). The words are `emailText().orderChanged`: hand-written, flagged for legal review.
 */

type ChangedWords = ReturnType<typeof import("@/lib/email-text").emailText>["orderChanged"];

function changeBlocks(edit: OrderEditView, words: ChangedWords, money: (minor: number) => string, { proposed = false }: { proposed?: boolean } = {}): EmailBlock[] {
  const off = edit.lines.filter((l) => l.kind !== "add");
  const on = edit.lines.filter((l) => l.kind === "add");
  const blocks: EmailBlock[] = [];
  if (off.length > 0) {
    blocks.push({ type: "paragraph", text: proposed ? words.proposedRemoved : words.removed });
    blocks.push({ type: "lines", rows: off.map((l) => ({ label: `${l.quantity} × ${l.title}`, value: `−${money(l.totalMinor)}` })) });
  }
  if (on.length > 0) {
    blocks.push({ type: "paragraph", text: proposed ? words.proposedAdded : words.added });
    blocks.push({ type: "lines", rows: on.map((l) => ({ label: `${l.quantity} × ${l.title}`, value: money(l.totalMinor) })) });
  }
  const rows = [
    ...(edit.shippingAfterMinor !== edit.shippingBeforeMinor ? [{ label: words.shipping(money(edit.shippingAfterMinor)), value: "" }] : []),
    { label: words.newTotal, value: money(edit.totalAfterMinor), strong: true },
  ];
  blocks.push({ type: "lines", rows });
  return blocks;
}

/** Whether the change adds goods for a consumer: the withdrawal sentence is said only then (a company buyer has no statutory right, `withdrawBlocks()`'s rule). */
const addsGoodsForConsumer = (edit: OrderEditView, order: { company: unknown }): boolean => edit.lines.some((l) => l.kind === "add") && !order.company;

/** The email after a change was applied (`order-changed:{edit}`): what changed, and the refund or "nothing more to pay". Null when it cannot be built. */
export async function sendOrderChanged(storeId: string, editId: string): Promise<SendOutcome | null> {
  const edit = await getOrderEdit(storeId, editId);
  if (!edit || edit.status !== "applied") return null;
  // The refunds of the difference (more than one when it was split over the order's payments): what went back through Stripe, and whether any part is money
  // the store pays back itself (taken outside Kaizen).
  const [refund] = await db().execute<Row>(sql`
    select sum(r.amount_minor) as amount_minor, bool_or(p.provider = 'manual') as outside from commerce.refunds r
    join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id
    where r.store_id = ${storeId}::uuid and r.order_edit_id = ${editId}::uuid and r.status::text <> 'failed'
    having count(*) > 0
  `);
  return orderNotice(
    storeId,
    edit.orderId,
    "order.changed",
    `order-changed:${editId}`,
    ({ order, text, money, store }) => {
      const words = text.orderChanged;
      const reason = edit.reason === "other" ? null : words.reasons[edit.reason];
      const settle = refund
        ? refund.outside
          ? words.refundedOutside(store.name, money(Number(refund.amount_minor)))
          : words.refunded(money(Number(refund.amount_minor)))
        : words.nothingMore;
      return {
        subject: words.subject(store.name, order.number),
        heading: words.heading,
        intro: [words.intro(order.number), reason].filter(Boolean).join(" "),
        // A business buyer has no statutory right of withdrawal (CRD Art. 2(1)): the sentence about added goods, like D153's block, is for consumers only.
        extra: [...changeBlocks(edit, words, money), { type: "paragraph", text: settle }, ...(addsGoodsForConsumer(edit, order) ? [{ type: "paragraph" as const, text: words.withdrawal }] : [])],
        withdraw: edit.lines.some((l) => l.kind === "add"),
      };
    },
    { want: { ofEdit: editId } },
  );
}

/**
 * The email that asks the customer to pay a change's higher total (`order-change-pay:{edit}:{n}`, one per link sent: a new link is a new email): what would
 * change, the new total, "To confirm the change, pay {amount} by {date}. If you do not, your order stays as it was" and the button to the change pay page.
 * The token is in the link only.
 */
export async function sendOrderChangePayLink(storeId: string, editId: string, token: string, n: number): Promise<SendOutcome | null> {
  const edit = await getOrderEdit(storeId, editId);
  if (!edit || edit.status !== "awaiting_payment" || !edit.expiresAt) return null;
  const where = await marketOfOrder(storeId, edit.orderId);
  if (!where) return null;
  const url = editPayLink(where.store, where.market.slug, token);
  return orderNotice(storeId, edit.orderId, "order.changed", `order-change-pay:${editId}:${n}`, ({ order, text, money, store }) => {
    const words = text.orderChanged;
    // Nothing has changed yet (CRD Art. 22: the change is applied only when the customer pays): the subject, heading, intro and lines say it is proposed.
    const reason = edit.reason === "other" ? null : words.proposedReasons[edit.reason];
    const until = new Date(edit.expiresAt as string).toLocaleDateString(order.locale, { dateStyle: "long" });
    return {
      subject: words.proposedSubject(store.name, order.number),
      heading: words.proposedHeading,
      intro: [words.proposedIntro(order.number), reason].filter(Boolean).join(" "),
      extra: [
        ...changeBlocks(edit, words, money, { proposed: true }),
        { type: "paragraph", text: words.payBy(money(edit.differenceMinor), until) },
        { type: "button", text: words.payButton, url },
        ...(addsGoodsForConsumer(edit, order) ? [{ type: "paragraph" as const, text: words.withdrawal }] : []),
      ],
    };
  });
}
