/**
 * Where a template is previewed in the admin (D127): a page with nothing but the template on it, drawn as the store's
 * own pages are, without the admin around it (the `(print)` route group), meant for a frame in the page builder. It is
 * under the owner's `/admin/account/…` because a new `/admin/{word}` would take a store address; `s` is shorter than
 * any store address. Build the link with this, never by hand.
 */
export const TEMPLATES_ROOT = "/admin/account/templates";

/** The preview of one template as store `storeSlug` would see it, for example `/admin/account/templates/s/acme/{id}/preview`. */
export function templatePreviewPath(storeSlug: string, id: string): string {
  return `${TEMPLATES_ROOT}/s/${storeSlug}/${id}/preview`;
}
