import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card, Chip, List, ListRow, PageHeader, RowAmount, RowFact, RowLead } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { GIFT_CARD_NOTE_MAX, STATE_SIGNAL } from "@/lib/gift-card-admin";
import { formatMoney } from "@/lib/money";
import { giftCardDetail } from "@/server/gift-cards-admin";
import { memberCan, requirePermission } from "@/server/permissions";

import { adjustGiftCardAction, deactivateGiftCardAction, newGiftCardCodeAction, sendGiftCardAgainAction } from "../actions";
import { NewCodeForm } from "./new-code-form";

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
  const lang = adminLangOf(member.account.adminLocale);
  const g = adminText(lang, "giftCards");
  const w = g.card;
  // English keeps the store's own number format and en-GB dates, as before; another language its own.
  const locale = lang === "en" ? (store.markets[0]?.locale ?? "en") : ADMIN_LANG_FACTS[lang].locale;
  const dateLocale = lang === "en" ? "en-GB" : ADMIN_LANG_FACTS[lang].locale;
  const money = (minor: number) => formatMoney(minor, card.currency, locale);
  const when = (iso: string) => new Date(iso).toLocaleString(dateLocale, { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone });
  const day = (iso: string) => new Date(iso).toLocaleDateString(dateLocale, { dateStyle: "medium", timeZone: store.timeZone });
  const canChange = memberCan(member, "products:write") && card.state !== "deactivated";
  const orderLink = (id: string) => `/admin/${store.slug}/orders/${id}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: base, label: w.back }}
        title={card.last4 ? fillWords(w.titleWithCode, { last4: card.last4 }) : w.titleNoCode}
        status={
          <Chip signal={STATE_SIGNAL[card.state]} dot>
            {g.states[card.state]}
          </Chip>
        }
        meta={[fillWords(w.left, { left: money(card.balanceMinor), initial: money(card.initialMinor) }), card.expiresAt ? fillWords(w.lastsUntil, { date: day(card.expiresAt) }) : w.neverExpires, card.testMode ? w.testCard : null]}
      />

      <Card title={w.about} compact>
        <dl className="grid grid-cols-1 gap-3 text-body sm:grid-cols-2">
          <div>
            <dt className="text-caption text-muted">{w.howItCame}</dt>
            <dd className="text-ink">
              {card.source === "order" && card.orderId ? (
                <>
                  {w.boughtWith}{" "}
                  <Link href={orderLink(card.orderId)} className="underline underline-offset-2">
                    {card.orderNumber}
                  </Link>
                </>
              ) : (
                `${fillWords(w.issuedBy, { name: card.issuedBy ?? w.staff })}${card.note ? `: ${card.note}` : ""}`
              )}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-muted">{w.issued}</dt>
            <dd className="text-ink">{when(card.issuedAt)}</dd>
          </div>
          <div>
            <dt className="text-caption text-muted">{w.reached}</dt>
            <dd className="text-ink">
              {card.sentAt ? when(card.sentAt) : card.sendAt && new Date(card.sendAt) > new Date() ? fillWords(w.goesOn, { date: day(card.sendAt) }) : w.notYet}
            </dd>
          </div>
          {(card.recipientName || card.recipientEmail) && (
            <div>
              <dt className="text-caption text-muted">{w.forWhom}</dt>
              <dd className="text-ink">{[card.recipientName, card.recipientEmail].filter(Boolean).join(", ")}</dd>
            </div>
          )}
          {card.message && (
            <div className="sm:col-span-2">
              <dt className="text-caption text-muted">{w.message}</dt>
              <dd className="whitespace-pre-line text-ink">{card.message}</dd>
            </div>
          )}
        </dl>
        <p className="mt-4 text-caption text-muted">
          {w.codeNote}
        </p>
        {card.state === "waiting" && card.source === "order" && memberCan(member, "products:write") && (!card.sendAt || new Date(card.sendAt) <= new Date()) && (
          <ActionForm action={sendGiftCardAgainAction.bind(null, store.slug, card.id)} className="mt-4 flex items-center gap-3">
            <SubmitButton>{w.sendAgain}</SubmitButton>
          </ActionForm>
        )}
      </Card>

      {card.orders.length > 0 && (
        <Card title={w.ordersPaid} compact>
          <List label={w.ordersPaid}>
            {card.orders.map((o) => (
              <ListRow key={o.id}>
                <RowLead title={fillWords(w.order, { number: o.number })} href={orderLink(o.id)} sub={o.refundedMinor > 0 ? fillWords(w.refundedBack, { amount: money(o.refundedMinor) }) : undefined} />
                <RowAmount>{money(o.spentMinor)}</RowAmount>
              </ListRow>
            ))}
          </List>
        </Card>
      )}

      <Card title={w.history} compact>
        <List label={w.history}>
          {card.entries.map((e, index) => (
            <ListRow key={index}>
              <RowLead
                title={(g.entries as Record<string, string>)[e.kind] ?? e.kind}
                sub={[e.orderNumber ? fillWords(w.order, { number: e.orderNumber }) : null, e.by, e.note || null].filter(Boolean).join(" · ") || undefined}
              />
              <RowFact className="hidden sm:block">{when(e.at)}</RowFact>
              <RowAmount>{e.kind === "spend" ? "" : `${e.amountMinor > 0 ? "+" : "−"}${money(Math.abs(e.amountMinor))}`}</RowAmount>
            </ListRow>
          ))}
        </List>
      </Card>

      {canChange && card.state === "active" && card.sentAt && (
        <Card title={w.newCodeTitle} description={w.newCodeDescription} compact>
          <NewCodeForm action={newGiftCardCodeAction.bind(null, store.slug, card.id)} words={w} />
        </Card>
      )}

      {canChange && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title={w.changeTitle} description={w.changeDescription} compact>
            <ActionForm action={adjustGiftCardAction.bind(null, store.slug, card.id, card.currency)} className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-3">
                <label className="flex flex-col gap-1 text-body">
                  <span className="text-caption text-muted">{w.change}</span>
                  <select name="direction" defaultValue="up" className="min-h-10 rounded-md border border-line px-3">
                    <option value="up">{w.add}</option>
                    <option value="down">{w.takeOff}</option>
                  </select>
                </label>
                <label className="flex flex-1 flex-col gap-1 text-body">
                  <span className="text-caption text-muted">{fillWords(w.amountIn, { currency: card.currency })}</span>
                  <input name="amount" inputMode="decimal" required autoComplete="off" className="min-h-10 rounded-md border border-line px-3" />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-body">
                <span className="text-caption text-muted">{w.why}</span>
                <input name="reason" required maxLength={GIFT_CARD_NOTE_MAX} autoComplete="off" className="min-h-10 rounded-md border border-line px-3" />
              </label>
              <div>
                <SubmitButton>{w.changeButton}</SubmitButton>
              </div>
            </ActionForm>
          </Card>
          <Card title={w.deactivateTitle} description={w.deactivateDescription} compact>
            <ActionForm action={deactivateGiftCardAction.bind(null, store.slug, card.id)} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-body">
                <span className="text-caption text-muted">{w.whyOptional}</span>
                <input name="reason" maxLength={GIFT_CARD_NOTE_MAX} autoComplete="off" className="min-h-10 rounded-md border border-line px-3" />
              </label>
              <label className="flex items-center gap-2 text-body">
                <input type="checkbox" name="sure" required />
                <span>{w.forGood}</span>
              </label>
              <div>
                <SubmitButton variant="secondary">{w.deactivate}</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        </div>
      )}
    </div>
  );
}
