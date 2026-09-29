"use client";

import { useEffect, useState, type ReactNode } from "react";

import { onVariantSelected } from "./variant-selected";

/**
 * A variant's own custom fields (D118, phase 2) on the product's page: the
 * server draws each variant's fields, this shows the chosen variant's, and
 * follows the picker as the shopper chooses. Until the choice is known, the
 * first variant's are shown, so the page reads whole without JavaScript.
 */
export function VariantFields({
  productId,
  initial,
  panels,
}: {
  productId: string;
  initial: string;
  /** The drawn fields by variant id; a variant with none is missing. */
  panels: Record<string, ReactNode>;
}) {
  const [chosen, setChosen] = useState(initial);
  useEffect(() => onVariantSelected(productId, setChosen), [productId]);
  return <>{panels[chosen] ?? null}</>;
}
