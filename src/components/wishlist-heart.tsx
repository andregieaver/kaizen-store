"use client";

import { useEffect, useState } from "react";

import { toggleWishlistAction } from "@/app/s/[store]/[market]/(shop)/wishlist/actions";

import { loadOwn, setSaved, useSaved } from "./shopper-own";

/**
 * The shopper's saved products (D34), asked once per page for every heart on it (`loadOwn()`, from `/api/shop/mine`), so the pages
 * themselves stay the same for everyone (and static), and only when the marker cookie `kaizen_mine_{storeId}` says this visitor may
 * have saved something or signed in. Null until it arrives.
 */
function useSavedIn(store: string, market: string, storeId: string): Set<string> | null {
  useEffect(() => loadOwn({ store, market, storeId, hinted: false }), [store, market, storeId]);
  return useSaved();
}

function HeartShape({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round">
      <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0112 7.3a4.3 4.3 0 017.5 2.5C19.5 15.4 12 20 12 20z" />
    </svg>
  );
}

/**
 * The heart on a product card or page: saves the product in the shopper's
 * wishlist, or takes it out of every list. Works signed in or not.
 */
export function WishlistHeart({
  store,
  market,
  storeId,
  productId,
  labels,
  placement = "card",
}: {
  store: string;
  market: string;
  /** The store's id, whose marker cookie says whether there is anything to ask for. */
  storeId: string;
  productId: string;
  labels: { save: string; saved: string; removed: string };
  placement?: "card" | "page";
}) {
  const products = useSavedIn(store, market, storeId);
  const [pending, setPending] = useState<boolean | null>(null);
  const [announce, setAnnounce] = useState("");
  const isSaved = pending ?? products?.has(productId) ?? false;

  const toggle = async () => {
    // The heart turns at once; the words come once it is really saved.
    setPending(!isSaved);
    setAnnounce("");
    try {
      const result = await toggleWishlistAction(store, market, productId);
      setSaved(result.products);
      setAnnounce(result.saved ? labels.saved : labels.removed);
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <button
        type="button"
        aria-pressed={isSaved}
        aria-label={labels.save}
        onClick={toggle}
        className={
          placement === "card"
            ? "absolute top-2 right-2 z-10 flex size-11 items-center justify-center rounded-full bg-background/90 shadow-sm backdrop-blur transition-transform hover:scale-105 active:scale-95"
            : "flex size-11 shrink-0 items-center justify-center rounded-full border border-border hover:bg-surface active:scale-95"
        }
      >
        <span className={isSaved ? "text-red-600 dark:text-red-400" : ""}>
          <HeartShape filled={isSaved} />
        </span>
      </button>
      <span role="status" className="sr-only">
        {announce}
      </span>
    </>
  );
}

/** How many products the shopper has saved, beside the header's wishlist link. */
export function WishlistCount({ store, market, storeId }: { store: string; market: string; storeId: string }) {
  const products = useSavedIn(store, market, storeId);
  const count = products?.size ?? 0;
  if (count === 0) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-xs font-semibold text-accent-foreground"
    >
      {count}
    </span>
  );
}
