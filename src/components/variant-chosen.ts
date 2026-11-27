"use client";

import { createContext, useContext, useState } from "react";

/** The variant chosen on a product page and the way to choose another. */
export type Choice = [string, (id: string) => void];

/**
 * The page's chosen variant, provided by `VariantChoice`. Kept in a file of its own, with nothing else to import, so the parts that
 * only read it (the purchase options, D911; the phone's bar) do not pull the buy box's add-to-cart and its server action with them.
 */
export const ChosenVariant = createContext<Choice | null>(null);

/** The page's chosen variant, or one of the component's own outside a `VariantChoice`. */
export function useVariantChoice(fallback: string): Choice {
  const shared = useContext(ChosenVariant);
  const own = useState(fallback);
  return shared ?? own;
}
