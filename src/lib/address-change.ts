/**
 * What a saved product or category says when its address changed (D168), apart from the redirects' admin helpers (`redirect-admin.ts`) and
 * their words (`redirects.ts`, which read a whole catalogue): the product's editor needs only these (bloat review step 0.10).
 */

/** The sentence a changed address says; `redirectSentences.handleChanged` in `redirects.ts` is this function, so the words exist once. */
export const handleChangedSentence = (from: string, to: string) => `The old address ${from} now redirects to ${to}.`;

export type AddressChange = { from: string; to: string };

/**
 * The pair a saved product's changed handle gives (`/p/old` and `/p/new`): null when the handle did not change, or when the database left no redirect (a
 * product that was never live leaves none, since nobody has the address). `redirected` is whether a redirect from the old address exists after the save.
 */
export function productAddressChange(oldHandle: string | null, newHandle: string, redirected: boolean): AddressChange | null {
  if (!oldHandle || oldHandle === newHandle || !redirected) return null;
  return { from: `/p/${oldHandle}`, to: `/p/${newHandle}` };
}

/** The same for a category or a tag (`/category/old`, `/tag/old`). */
export function termAddressChange(kind: "category" | "tag", oldSlug: string | null, newSlug: string, redirected: boolean): AddressChange | null {
  if (!oldSlug || oldSlug === newSlug || !redirected) return null;
  return { from: `/${kind}/${oldSlug}`, to: `/${kind}/${newSlug}` };
}

/** The sentence a saved product or category says. */
export const addressChangeWords = (change: AddressChange): string => handleChangedSentence(change.from, change.to);
