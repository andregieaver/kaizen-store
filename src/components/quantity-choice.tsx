"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

import type { QuantityRule } from "@/lib/quantity-rules";

/** The quantity chosen on a product page (D430), for the variant it was chosen for. */
type Counted = { variant: string; n: number } | null;
type QuantityChoiceState = [Counted, (counted: Counted) => void];

const ChosenQuantity = createContext<QuantityChoiceState | null>(null);

/** Shares how many the shopper chose between a product page's buy box and its phone bar (`VariantChoice` holds it). */
export function QuantityChoice({ children }: { children: ReactNode }) {
  const counted = useState<Counted>(null);
  return <ChosenQuantity.Provider value={counted}>{children}</ChosenQuantity.Provider>;
}

/**
 * How many of the variant the page adds (D430): what the buy box's chooser or the phone's bar shows, shared between them, starting at the
 * rule's minimum and starting over when another variant is chosen (its rule may differ). Outside a `QuantityChoice`, the component's own.
 */
export function useQuantityChoice(variantId: string, rule: QuantityRule): [number, (n: number) => void] {
  const shared = useContext(ChosenQuantity);
  const own = useState<Counted>(null);
  const [counted, setCounted] = shared ?? own;
  return [counted?.variant === variantId ? counted.n : rule.min, (n) => setCounted({ variant: variantId, n })];
}
