import { fillWords } from "@/lib/admin-fill";
import { orderEn, type OrderMessages } from "@/lib/admin-messages/order.en";
import { moneyIn, refundNotes, type OrderBonus } from "@/lib/bonus-admin";

type Words = OrderMessages["bonus"];

/**
 * An order's bonus credits (D130) for its totals: the credits used come off the price like a discount, the credits
 * earned are only noted. An order with none, and an order copied from another store (D129), shows nothing.
 */
export function BonusUsedRow({
  bonus,
  currency,
  locale,
  words: w = orderEn.bonus,
}: {
  bonus: OrderBonus | null;
  currency: string;
  locale: string;
  words?: Words;
}) {
  if (!bonus || bonus.usedMinor <= 0) return null;
  return (
    <div className="flex justify-between">
      <dt>{w.used}</dt>
      <dd>−{moneyIn(currency, locale)(bonus.usedMinor)}</dd>
    </div>
  );
}

export function BonusEarnedRow({
  bonus,
  currency,
  locale,
  now = new Date(),
  words: w = orderEn.bonus,
}: {
  bonus: OrderBonus | null;
  currency: string;
  locale: string;
  now?: Date;
  words?: Words;
}) {
  if (!bonus || bonus.earnedMinor <= 0) return null;
  const from = bonus.availableAt ? new Date(bonus.availableAt) : null;
  const when =
    from && from.getTime() > now.getTime()
      ? fillWords(w.usableFrom, { date: from.toLocaleDateString(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" }) })
      : "";
  return (
    <div className="flex justify-between text-muted">
      <dt>
        {w.earned}
        {when}
      </dt>
      <dd>{moneyIn(currency, locale)(bonus.earnedMinor)}</dd>
    </div>
  );
}

/** What a refund does to the order's credits, in the refund section. */
export function BonusRefundNote({
  bonus,
  currency,
  locale,
  refund,
  words: w = orderEn.bonus,
}: {
  bonus: OrderBonus | null;
  currency: string;
  locale: string;
  refund?: { refundedMinor: number; totalMinor: number };
  words?: Words;
}) {
  const notes = refundNotes(bonus, moneyIn(currency, locale), refund);
  if (notes.length === 0) return null;
  return (
    <div className="mb-3 rounded-md bg-sunken p-3 text-sm">
      <p className="mb-1 font-medium">{w.title}</p>
      {notes.map((note) => (
        <p key={note} className="mb-1 last:mb-0">
          {note}
        </p>
      ))}
    </div>
  );
}
