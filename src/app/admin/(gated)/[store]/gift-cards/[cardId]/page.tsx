import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card, Chip, List, ListRow, PageHeader, RowAmount, RowFact, RowLead } from "@/components/admin/ui";
import { ENTRY_WORDS, GIFT_CARD_NOTE_MAX, STATE_SIGNAL, STATE_WORDS } from "@/lib/gift-card-admin";
import { formatMoney } from "@/lib/money";
import { giftCardDetail } from "@/server/gift-cards-admin";
import { memberCan, requirePermission } from "@/server/permissions";

import { adjustGiftCardAction, deactivateGiftCardAction, sendGiftCardAgainAction } from "../actions";

export const metadata: Metadata = { title: "Gift card" };

/**
 * One gift card (D300 F4): what it was worth and what is left, until when, how it came to be, its whole ledger in words and the orders it paid
 * for; changing its balance with a reason and deactivating it for staff who may change orders. The code is not here: it is kept nowhere.
 */
export default async function GiftCardPage({ params }: PageProps<"/admin/[store]/gift-cards/[cardId]">) {
  const { store: slug, cardId } = await params;
  const member = await requirePermission(slug, "products:read");
  const { store } = member;
  const card = await giftCardDetail(store.id, cardId, { people: memberCan(member, "customers:read") });
  if (!card) notFound();
  const base = `/admin/${store.slug}/gift-cards`;
  const locale = store.markets[0]?.locale ?? "en";
  const money = (minor: number) => formatMoney(minor, card.currency, locale);
  const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone });
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: store.timeZone });
  const canChange = memberCan(member, "products:write") && card.state !== "deactivated";
  const orderLink = (id: string) => `/admin/${store.slug}/orders/${id}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: base, label: "Gift cards" }}
        title={card.last4 ? `Gift card •••• ${card.last4}` : "Gift card, no code yet"}
        status={
          <Chip signal={STATE_SIGNAL[card.state]} dot>
            {STATE_WORDS[card.state]}
          </Chip>
        }
        meta={[`${money(card.balanceMinor)} left of ${money(card.initialMinor)}`, card.expiresAt ? `Lasts until ${day(card.expiresAt)}` : "Never expires", card.testMode ? "Test card" : null]}
      />

      <Card title="About this card" compact>
        <dl className="grid grid-cols-1 gap-3 text-body sm:grid-cols-2">
          <div>
            <dt className="text-caption text-muted">How it came to be</dt>
            <dd className="text-ink">
              {card.source === "order" && card.orderId ? (
                <>
                  Bought with order{" "}
                  <Link href={orderLink(card.orderId)} className="underline underline-offset-2">
                    {card.orderNumber}
                  </Link>
                </>
              ) : (
                `Issued by ${card.issuedBy ?? "staff"}${card.note ? `: ${card.note}` : ""}`
              )}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-muted">Issued</dt>
            <dd className="text-ink">{when(card.issuedAt)}</dd>
          </div>
          <div>
            <dt className="text-caption text-muted">Its code reached someone</dt>
            <dd className="text-ink">
              {card.sentAt ? when(card.sentAt) : card.sendAt && new Date(card.sendAt) > new Date() ? `Not yet: it goes on ${day(card.sendAt)}` : "Not yet"}
            </dd>
          </div>
          {(card.recipientName || card.recipientEmail) && (
            <div>
              <dt className="text-caption text-muted">For</dt>
              <dd className="text-ink">{[card.recipientName, card.recipientEmail].filter(Boolean).join(", ")}</dd>
            </div>
          )}
          {card.message && (
            <div className="sm:col-span-2">
              <dt className="text-caption text-muted">Their message</dt>
              <dd className="whitespace-pre-line text-ink">{card.message}</dd>
            </div>
          )}
        </dl>
        <p className="mt-4 text-caption text-muted">
          The code is not shown here: Kaizena Flow keeps only a fingerprint of it, so nobody can read it back. A lost code cannot be sent again: deactivate the
          card and issue a new one for what was left.
        </p>
        {card.state === "waiting" && card.source === "order" && memberCan(member, "products:write") && (!card.sendAt || new Date(card.sendAt) <= new Date()) && (
          <ActionForm action={sendGiftCardAgainAction.bind(null, store.slug, card.id)} className="mt-4 flex items-center gap-3">
            <SubmitButton>Try sending it again</SubmitButton>
          </ActionForm>
        )}
      </Card>

      {card.orders.length > 0 && (
        <Card title="Orders it paid for" compact>
          <List label="Orders it paid for">
            {card.orders.map((o) => (
              <ListRow key={o.id}>
                <RowLead title={`Order ${o.number}`} href={orderLink(o.id)} sub={o.refundedMinor > 0 ? `${money(o.refundedMinor)} refunded back to the card` : undefined} />
                <RowAmount>{money(o.spentMinor)}</RowAmount>
              </ListRow>
            ))}
          </List>
        </Card>
      )}

      <Card title="History" compact>
        <List label="History">
          {card.entries.map((e, index) => (
            <ListRow key={index}>
              <RowLead
                title={ENTRY_WORDS[e.kind] ?? e.kind}
                sub={[e.orderNumber ? `Order ${e.orderNumber}` : null, e.by, e.note || null].filter(Boolean).join(" · ") || undefined}
              />
              <RowFact className="hidden sm:block">{when(e.at)}</RowFact>
              <RowAmount>{e.kind === "spend" ? "" : `${e.amountMinor > 0 ? "+" : "−"}${money(Math.abs(e.amountMinor))}`}</RowAmount>
            </ListRow>
          ))}
        </List>
      </Card>

      {canChange && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title="Change the balance" description="Add to the card or take off it, with a reason that is kept with the change." compact>
            <ActionForm action={adjustGiftCardAction.bind(null, store.slug, card.id, card.currency)} className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-3">
                <label className="flex flex-col gap-1 text-body">
                  <span className="text-caption text-muted">Change</span>
                  <select name="direction" defaultValue="up" className="min-h-10 rounded-md border border-line px-3">
                    <option value="up">Add</option>
                    <option value="down">Take off</option>
                  </select>
                </label>
                <label className="flex flex-1 flex-col gap-1 text-body">
                  <span className="text-caption text-muted">Amount, {card.currency}</span>
                  <input name="amount" inputMode="decimal" required autoComplete="off" className="min-h-10 rounded-md border border-line px-3" />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-body">
                <span className="text-caption text-muted">Why</span>
                <input name="reason" required maxLength={GIFT_CARD_NOTE_MAX} autoComplete="off" className="min-h-10 rounded-md border border-line px-3" />
              </label>
              <div>
                <SubmitButton>Change</SubmitButton>
              </div>
            </ActionForm>
          </Card>
          <Card title="Deactivate" description="The card can never be spent again, and what is left on it goes. Orders it already paid for keep their money." compact>
            <ActionForm action={deactivateGiftCardAction.bind(null, store.slug, card.id)} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-body">
                <span className="text-caption text-muted">Why (optional)</span>
                <input name="reason" maxLength={GIFT_CARD_NOTE_MAX} autoComplete="off" className="min-h-10 rounded-md border border-line px-3" />
              </label>
              <label className="flex items-center gap-2 text-body">
                <input type="checkbox" name="sure" required />
                <span>Deactivate this card for good</span>
              </label>
              <div>
                <SubmitButton variant="secondary">Deactivate</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        </div>
      )}
    </div>
  );
}
