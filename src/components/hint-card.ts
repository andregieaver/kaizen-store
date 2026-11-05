/**
 * Where a suggestion card floats (a store's country, D338; Kaizena Flow's language, D312): over the page, clear of everything else fixed
 * on it. Not at the top, where a header that lies over the page (D80) covers it; above the chat's launcher, which holds the bottom right
 * corner (on a phone 5rem up, over the bottom bar, and 3.5rem tall; on a computer 1.5rem up), so neither covers the other's buttons.
 */
export const HINT_CARD =
  "fixed inset-x-4 bottom-[calc(9rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-xl flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm shadow-lg md:bottom-24";
