/**
 * Where duplicating a store lives in the admin (D129): under the owner's `/admin/stores`, never a new `/admin/{word}`.
 * Build every link to the wizard and the progress page with these.
 */

/** The wizard that copies one of the account's stores (`slug` is the store copied). */
export function copyWizardPath(slug: string): string {
  return `/admin/stores/copy/${encodeURIComponent(slug)}`;
}

/** One copy's progress page (`id` is the copy's id). */
export function copyProgressPath(id: string): string {
  return `/admin/stores/copies/${encodeURIComponent(id)}`;
}

/** The new store's admin, and its setup wizard (where `createStoreAction` sends owners of a new store). */
export const copiedStoreAdminPath = (slug: string): string => `/admin/${slug}`;
export const copiedStoreSetupPath = (slug: string): string => `/admin/${slug}/setup`;
