"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";

import { addToCart, type AddToCartState } from "@/app/s/[store]/[market]/cart/actions";
import { GIFT_CARD_SEND_DAYS_MAX, addDays, type GiftCardField, type GiftCardProblem } from "@/lib/gift-card-line";
import { GIFT_MESSAGE_MAX, GIFT_NAME_MAX } from "@/lib/order-limits";
import type { BrowserMessages } from "@/lib/messages/en-browser";

import type { AddToCartLabels } from "./add-to-cart";
import { useOpenCartAfterAdd } from "./cart-drawer";
import { useKeepFocus } from "./keep-focus";

export type GiftCardBuyLabels = BrowserMessages["giftCard"];

const initial: AddToCartState = { outcome: "idle", quantity: 0 };

/**
 * Buying a gift card (D300 F2, `docs/wave-5-marketing.md` 8.2): an amount (its own price in the market), and for Homer one press of Add to
 * cart, the card emailed to him once paid. *Send it to someone* opens who it is for, from whom, a message and the day; the server checks every
 * field again (`cleanGiftCardRecipient()`) and says what is wrong, field by field.
 */
export function GiftCardBuy({
  store,
  market,
  cartHref,
  amounts,
  today,
  labels,
  cartLabels,
  openCart = false,
}: {
  store: string;
  market: string;
  cartHref: string;
  /** Each amount: its variant and its price as the market shows it. */
  amounts: { variantId: string; label: string }[];
  /** The store's day, `YYYY-MM-DD`: the earliest day a card can be sent. */
  today: string;
  labels: GiftCardBuyLabels;
  cartLabels: AddToCartLabels;
  openCart?: boolean;
}) {
  const id = useId();
  const [state, action, pending] = useActionState(addToCart, initial);
  const keepFocus = useKeepFocus(pending);
  useOpenCartAfterAdd(openCart, cartHref, state);
  const [variantId, setVariantId] = useState(amounts[0]?.variantId ?? "");
  const [send, setSend] = useState(false);
  const problems = state.outcome === "gift_card" ? (state.giftCardProblems ?? []) : [];
  const problemOf = (field: GiftCardField): string | null => {
    const found = problems.find((p) => p.field === field);
    return found ? problemText(found, labels) : null;
  };
  const message =
    state.outcome === "added"
      ? cartLabels.added
      : state.outcome === "capped"
        ? cartLabels.capped
        : state.outcome === "unavailable"
          ? cartLabels.unavailable
          : state.outcome === "error"
            ? cartLabels.tryAgain
            : null;

  const field = (name: string, key: GiftCardField, label: string, input: React.ReactNode) => {
    const problem = problemOf(key);
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-${name}`} className="text-sm font-medium">
          {label}
        </label>
        {input}
        {problem && (
          <p id={`${id}-${name}-problem`} role="alert" className="text-sm">
            {problem}
          </p>
        )}
      </div>
    );
  };
  const described = (name: string, key: GiftCardField) => (problemOf(key) ? `${id}-${name}-problem` : undefined);
  const inputClass = "min-h-11 w-full rounded-md border border-border bg-background px-3 text-base";

  return (
    <form action={action} onSubmit={keepFocus} className="flex flex-col gap-4">
      <input type="hidden" name="store" value={store} />
      <input type="hidden" name="market" value={market} />
      <input type="hidden" name="variantId" value={variantId} />
      <input type="hidden" name="quantity" value="1" />
      {amounts.length > 1 && (
        <fieldset>
          <legend className="mb-2 font-medium">{labels.amount}</legend>
          <div className="flex flex-wrap gap-2">
            {amounts.map((amount) => (
              <label
                key={amount.variantId}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-button border border-border px-4 has-checked:border-foreground"
              >
                <input
                  type="radio"
                  name="giftCardAmount"
                  checked={variantId === amount.variantId}
                  onChange={() => setVariantId(amount.variantId)}
                  className="size-4"
                />
                <span>{amount.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {amounts.length === 1 && <p className="text-lg">{amounts[0].label}</p>}

      <div className="flex flex-col gap-3">
        <label className="flex min-h-11 cursor-pointer items-center gap-2">
          <input type="checkbox" name="giftCardSend" checked={send} onChange={(event) => setSend(event.target.checked)} className="size-4" />
          <span className="font-medium">{labels.send}</span>
        </label>
        {send && (
          <div className="flex flex-col gap-3 border-l-2 border-border pl-4">
            <p className="text-sm text-muted">{labels.sendNote}</p>
            {field(
              "to",
              "to",
              labels.to,
              <input
                id={`${id}-to`}
                name="giftCardTo"
                type="email"
                required
                autoComplete="off"
                maxLength={254}
                aria-describedby={described("to", "to")}
                aria-invalid={problemOf("to") ? true : undefined}
                className={inputClass}
              />,
            )}
            {field(
              "toName",
              "toName",
              labels.toName,
              <input id={`${id}-toName`} name="giftCardToName" maxLength={GIFT_NAME_MAX} autoComplete="off" aria-describedby={described("toName", "toName")} className={inputClass} />,
            )}
            {field(
              "from",
              "from",
              labels.from,
              <input id={`${id}-from`} name="giftCardFrom" maxLength={GIFT_NAME_MAX} autoComplete="name" aria-describedby={described("from", "from")} className={inputClass} />,
            )}
            {field(
              "message",
              "message",
              labels.message,
              <textarea
                id={`${id}-message`}
                name="giftCardMessage"
                rows={3}
                maxLength={GIFT_MESSAGE_MAX}
                aria-describedby={described("message", "message")}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-base"
              />,
            )}
            {field(
              "sendOn",
              "sendOn",
              labels.sendOn,
              <input
                id={`${id}-sendOn`}
                name="giftCardSendOn"
                type="date"
                defaultValue={today}
                min={today}
                max={addDays(today, GIFT_CARD_SEND_DAYS_MAX)}
                aria-describedby={described("sendOn", "sendOn")}
                className={inputClass}
              />,
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col items-end gap-1">
        <button
          type="submit"
          disabled={pending || !variantId}
          className="min-h-11 button-primary px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? cartLabels.adding : cartLabels.addToCart}
        </button>
        <p role="status" aria-live="polite" className="text-sm">
          {message}{" "}
          {(state.outcome === "added" || state.outcome === "capped") && (
            <Link href={cartHref} className="underline">
              {cartLabels.goToCart}
            </Link>
          )}
        </p>
      </div>
    </form>
  );
}

function problemText(problem: GiftCardProblem, labels: GiftCardBuyLabels): string {
  return problem.problem === "too_long" ? labels.problem.too_long(problem.over ?? 1) : labels.problem[problem.problem];
}
