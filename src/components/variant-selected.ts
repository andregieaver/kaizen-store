const EVENT = "kaizen:variant-selected";

type Detail = { productId: string; variantId: string };

/** The last variant chosen per product, for a part that starts after the choice was made. */
const latest = new Map<string, string>();

/**
 * Tells the product's other parts which variant is chosen (D118, phase 2: a
 * variant's own fields). Like the gallery's picture (`showVariantPicture`),
 * the parts are anywhere in the product's layout, so they meet through an
 * event on the window.
 */
export function announceVariant(productId: string, variantId: string) {
  latest.set(productId, variantId);
  window.dispatchEvent(new CustomEvent<Detail>(EVENT, { detail: { productId, variantId } }));
}

/** Follows the variants chosen for a product, starting with the current one; returns the function that stops. */
export function onVariantSelected(productId: string, listener: (variantId: string) => void) {
  const known = latest.get(productId);
  if (known) listener(known);
  const handle = (event: Event) => {
    const { detail } = event as CustomEvent<Detail>;
    if (detail.productId === productId) listener(detail.variantId);
  };
  window.addEventListener(EVENT, handle);
  return () => window.removeEventListener(EVENT, handle);
}
