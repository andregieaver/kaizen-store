"use client";

import { useEffect, useRef } from "react";

import type { PublicEmailForm } from "@/lib/forms";

import { SiteForm } from "./site-form";
import { onVariantSelected } from "./variant-selected";

/**
 * The product question (D431) on a product's page: the site's own email form (`SiteForm`, its fields from the part's settings) sent to
 * `/api/product-question` with the product and the variant chosen on the page, so the store's inbox knows what it is about.
 */
export function ProductQuestion({
  form,
  storeId,
  market,
  productId,
  initialVariant,
  lang,
}: {
  form: PublicEmailForm;
  storeId: string;
  market: string;
  productId: string;
  initialVariant: string | null;
  lang: string;
}) {
  const variant = useRef(initialVariant);
  useEffect(
    () =>
      onVariantSelected(productId, (id) => {
        variant.current = id;
      }),
    [productId],
  );
  return (
    <SiteForm
      form={form}
      store={storeId}
      lang={lang}
      endpoint="/api/product-question"
      extra={() => ({ market, product: productId, variant: variant.current })}
    />
  );
}
