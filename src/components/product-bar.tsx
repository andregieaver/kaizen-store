"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";

import { addToCart, type AddToCartState } from "@/app/s/[store]/[market]/cart/actions";
import { formatMoney } from "@/lib/money";
import { planPrice } from "@/lib/subscriptions";

import type { AddToCartLabels } from "./add-to-cart";
import { useChosenPlan } from "./purchase-options";
import { HidingBottomBar } from "./store-chrome";

export type BarVariant = { id: string; label: string; amountMinor: number; available: boolean };

const initial: AddToCartState = { outcome: "idle", quantity: 0 };

/**
 * A product page's bottom bar on phones (D30): the price and add to cart,
 * always at the thumb. With several variants, the shopper picks one here;
 * the purchase option chosen on the page applies, as for the page's buttons.
 */
export function ProductBar({
  store,
  market,
  cartHref,
  currency,
  locale,
  variants,
  labels,
}: {
  store: string;
  market: string;
  cartHref: string;
  currency: string;
  locale: string;
  variants: BarVariant[];
  labels: AddToCartLabels & { chooseVariant: string; soldOut: string; goCart: string };
}) {
  const [state, action, pending] = useActionState(addToCart, initial);
  const plan = useChosenPlan();
  const [chosen, setChosen] = useState(() => (variants.find((v) => v.available) ?? variants[0])?.id ?? "");
  // The outcome shows for a few seconds, then the price again.
  const [expired, setExpired] = useState<AddToCartState | null>(null);
  const shown = state.outcome !== "idle" && expired !== state;
  const variant = variants.find((v) => v.id === chosen);

  useEffect(() => {
    if (state.outcome === "idle") return;
    const timer = window.setTimeout(() => setExpired(state), 4000);
    return () => window.clearTimeout(timer);
  }, [state]);

  if (!variant) return null;
  const money = (v: BarVariant) => formatMoney(plan ? planPrice(v.amountMinor, plan.discountPercent) : v.amountMinor, currency, locale);
  const message =
    state.outcome === "added"
      ? labels.added
      : state.outcome === "capped"
        ? labels.capped
        : state.outcome === "unavailable"
          ? labels.unavailable
          : state.outcome === "plan_conflict"
            ? labels.planConflict
            : state.outcome === "error"
              ? labels.tryAgain
              : null;

  return (
    <HidingBottomBar product>
      <form action={action} className="flex items-center gap-3 px-4 py-3">
        <input type="hidden" name="store" value={store} />
        <input type="hidden" name="market" value={market} />
        <input type="hidden" name="variantId" value={variant.id} />
        <input type="hidden" name="quantity" value="1" />
        {plan && <input type="hidden" name="sellingPlanId" value={plan.id} />}
        <div className="min-w-0 flex-1" aria-live="polite">
          {shown && message ? (
            <p className="text-sm">
              {message}{" "}
              {(state.outcome === "added" || state.outcome === "capped") && (
                <Link href={cartHref} className="font-medium underline">
                  {labels.goCart}
                </Link>
              )}
            </p>
          ) : variants.length > 1 ? (
            <select
              value={chosen}
              onChange={(event) => setChosen(event.target.value)}
              aria-label={labels.chooseVariant}
              className="min-h-11 w-full truncate rounded-full border border-border bg-background px-3 text-sm"
            >
              {variants.map((v) => (
                <option key={v.id} value={v.id} disabled={!v.available}>
                  {v.label} · {v.available ? money(v) : labels.soldOut}
                </option>
              ))}
            </select>
          ) : (
            <p className="font-semibold">{money(variant)}</p>
          )}
        </div>
        <button
          type="submit"
          disabled={!variant.available || pending}
          className="min-h-11 shrink-0 rounded-full bg-foreground px-5 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-40"
        >
          {!variant.available ? labels.soldOut : pending ? labels.adding : labels.addToCart}
        </button>
      </form>
    </HidingBottomBar>
  );
}
