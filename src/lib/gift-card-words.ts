import type { ShownGiftCard } from "@/components/gift-card-form";
import type { Messages } from "@/lib/i18n";

/** The cart's gift cards as the field shows them (D300 F3): each one's last four, what it pays here and holds after, or why it cannot pay. */
export function shownCartGiftCards(
  cards: { id: string; last4: string; amountMinor: number; afterMinor: number; problem: string | null; currency: string }[],
  m: Messages,
  money: (minor: number) => string,
): ShownGiftCard[] {
  const words = m.giftCardPay.problems;
  return cards.map((card) => ({
    id: card.id,
    label: m.giftCardPay.card(card.last4),
    pays: card.amountMinor > 0 ? `−${money(card.amountMinor)}` : null,
    left: card.amountMinor > 0 ? m.giftCardPay.left(money(card.afterMinor)) : null,
    problem:
      card.amountMinor > 0 || card.problem === null
        ? null
        : card.problem === "currency"
          ? words.currency(card.currency)
          : card.problem in words
            ? (words[card.problem as keyof typeof words] as string)
            : words.unusable,
  }));
}
