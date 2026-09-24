"use client";

import { useSyncExternalStore } from "react";

import { adminReturnPath } from "@/lib/admin-return";

const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  window.addEventListener("focus", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("focus", onChange);
  };
};

/**
 * For signed-in staff looking at their store: a way back to the admin page
 * they came from. Shoppers never see it; it is worked out in the browser, so
 * the cached storefront stays the same for everyone.
 */
export function BackToAdmin({ storeSlug }: { storeSlug: string }) {
  const path = useSyncExternalStore(
    subscribe,
    () => adminReturnPath(storeSlug, document.cookie),
    () => null,
  );
  if (!path) return null;
  return (
    <>
      {/* Room at the end of the page, so the button never hides the footer. */}
      <div aria-hidden className="h-16 print:hidden" />
      <a
        href={path}
        lang="en"
        className="fixed bottom-4 left-4 z-50 rounded-full bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg print:hidden"
      >
        ← Back to admin
      </a>
    </>
  );
}
