"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { toggleWishlistAction } from "@/app/s/[store]/[market]/wishlist/actions";

/**
 * The shopper's saved products (D34), fetched once per page for every
 * heart on it, so the pages themselves stay the same for everyone (and
 * cached). Null until it arrives.
 */
let saved: Set<string> | null = null;
let loading: string | null = null;
const listeners = new Set<() => void>();

function setSaved(products: string[]) {
  saved = new Set(products);
  for (const listener of listeners) listener();
}

function load(base: string) {
  if (loading === base) return;
  loading = base;
  fetch(`${base}/wishlist/saved`, { cache: "no-store" })
    .then((response) => response.json())
    .then((data: { products: string[] }) => setSaved(data.products))
    .catch(() => {
      loading = null;
    });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useSaved(base: string): Set<string> | null {
  useEffect(() => load(base), [base]);
  return useSyncExternalStore(subscribe, () => saved, () => null);
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
  base,
  productId,
  labels,
  placement = "card",
}: {
  store: string;
  market: string;
  /** The market's path, e.g. `/s/demo/no`. */
  base: string;
  productId: string;
  labels: { save: string; saved: string; removed: string };
  placement?: "card" | "page";
}) {
  const products = useSaved(base);
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
export function WishlistCount({ base }: { base: string }) {
  const products = useSaved(base);
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
