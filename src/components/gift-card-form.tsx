"use client";

import { useActionState } from "react";

/** A card on the cart, worded by the server: its last four, what it pays here and holds after, or why it cannot pay. Never its code. */
export type ShownGiftCard = { id: string; label: string; pays: string | null; left: string | null; problem: string | null };

/**
 * The gift cards an order is paid with (D300 F3), beside the discount code and never in its field: a card is money, a code is a discount. Each
 * card on the cart shows what it pays and what is left on it, with a way to take it off; a field takes another, up to three. Whether a card
 * pays, and how much, is said by the server, which works it out against the basket every time, as checkout will.
 */
export function GiftCardForm({
  cards,
  full,
  apply,
  remove,
  labels,
}: {
  cards: ShownGiftCard[];
  /** The words for a cart holding three cards. */
  full: string;
  /** Puts the typed code on the cart: the cart's action, or the checkout's, which places the order again. */
  apply: (state: { problem: string | null }, form: FormData) => Promise<{ problem: string | null }>;
  /** Takes a card off, by its id. */
  remove: (form: FormData) => Promise<void>;
  labels: { field: string; apply: string; applying: string; remove: string };
}) {
  const [state, action, pending] = useActionState(apply, { problem: null });
  return (
    <div className="flex flex-col gap-2" data-gift-card-form>
      {cards.length > 0 && (
        <ul className="flex flex-col gap-2">
          {cards.map((card) => (
            <li key={card.id} className="flex flex-col gap-1">
              <form action={remove} className="flex items-center justify-between gap-2">
                <input type="hidden" name="remove" value={card.id} />
                <span className="text-sm">
                  <span className="rounded-button border border-border px-3 py-1 font-medium">{card.label}</span>
                  {card.pays && <span className="ml-2">{card.pays}</span>}
                </span>
                <button type="submit" className="min-h-11 px-2 text-sm underline">
                  {labels.remove}
                  <span className="sr-only">: {card.label}</span>
                </button>
              </form>
              {card.left && <p className="text-sm text-muted">{card.left}</p>}
              {card.problem && (
                <p role="alert" className="text-sm">
                  {card.problem}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {/* Three cards at most (`GIFT_CARDS_PER_CART`). */}
      {cards.length >= 3 ? (
        <p className="text-sm text-muted">{full}</p>
      ) : (
        <form action={action} className="flex flex-col gap-1">
          <label htmlFor="gift-card-code" className="text-sm">
            {labels.field}
          </label>
          <div className="flex gap-2">
            <input
              id="gift-card-code"
              name="giftCard"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={40}
              required
              aria-describedby={state.problem ? "gift-card-problem" : undefined}
              className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-3 uppercase"
            />
            <button
              type="submit"
              disabled={pending}
              className="min-h-11 rounded-md border border-foreground px-4 text-sm font-medium disabled:opacity-50"
            >
              {pending ? labels.applying : labels.apply}
            </button>
          </div>
          {state.problem && (
            <p id="gift-card-problem" role="alert" className="text-sm">
              {state.problem}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
