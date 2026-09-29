"use client";

import Link from "next/link";
import { useActionState } from "react";

import { addToDeliveryAction, type AddToDeliveryState } from "@/app/s/[store]/[market]/deliveries/actions";

export type AddToDeliveryLabels = {
  add: string;
  adding: string;
  added: string;
  seeList: string;
  needsList: string;
  needsSignIn: string;
  notListable: string;
  full: string;
  tryAgain: string;
};

const initial: AddToDeliveryState = { outcome: "idle" };

/** The product page's second button (D102): the chosen variant onto the shopper's weekly delivery list. */
export function AddToDelivery({
  store,
  market,
  variantId,
  listHref,
  labels,
}: {
  store: string;
  market: string;
  variantId: string;
  listHref: string;
  labels: AddToDeliveryLabels;
}) {
  const [state, action, pending] = useActionState(addToDeliveryAction, initial);
  const message = {
    idle: null,
    added: labels.added,
    sign_in: labels.needsSignIn,
    no_list: labels.needsList,
    not_listable: labels.notListable,
    full: labels.full,
    error: labels.tryAgain,
  }[state.outcome];
  const linked = state.outcome === "added" || state.outcome === "sign_in" || state.outcome === "no_list";

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="store" value={store} />
      <input type="hidden" name="market" value={market} />
      <input type="hidden" name="variantId" value={variantId} />
      <button type="submit" disabled={pending} className="min-h-11 rounded-button border border-border px-4 text-sm font-medium hover:bg-surface disabled:opacity-50">
        {pending ? labels.adding : labels.add}
      </button>
      <p role="status" aria-live="polite" className="text-right text-sm">
        {message}{" "}
        {linked && (
          <Link href={listHref} className="underline">
            {labels.seeList}
          </Link>
        )}
      </p>
    </form>
  );
}
