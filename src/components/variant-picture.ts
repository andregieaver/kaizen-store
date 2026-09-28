/** A variant's own picture (D82): the full size for the gallery and its thumbnail, and its alt text (D89). */
export type VariantPicture = { url: string; thumbnailUrl: string; alt?: string };

const EVENT = "kaizen:variant-picture";

type Detail = { productId: string; picture: VariantPicture | null };

/** The last variant's picture per product, for a gallery that starts after the choice was made. */
const latest = new Map<string, VariantPicture | null>();

/**
 * Tells the product's gallery which variant is chosen, so it shows
 * the variant's picture. The pickers and the gallery are separate parts of
 * the product's layout (D79), anywhere on the page, so they meet through an
 * event on the window rather than a shared parent.
 */
export function showVariantPicture(productId: string, picture: VariantPicture | null) {
  latest.set(productId, picture);
  window.dispatchEvent(new CustomEvent<Detail>(EVENT, { detail: { productId, picture } }));
}

/** Follows the variants chosen for a product, starting with the current one; returns the function that stops. */
export function onVariantPicture(productId: string, listener: (picture: VariantPicture | null) => void) {
  if (latest.has(productId)) listener(latest.get(productId) ?? null);
  const handle = (event: Event) => {
    const { detail } = event as CustomEvent<Detail>;
    if (detail.productId === productId) listener(detail.picture);
  };
  window.addEventListener(EVENT, handle);
  return () => window.removeEventListener(EVENT, handle);
}
