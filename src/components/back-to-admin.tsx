"use client";

import { useEffect, useSyncExternalStore } from "react";

import { adminReturnPath, handedOffPath, takeHandoff } from "@/lib/admin-return";

/** Told when the admin's handover is kept, as the storage event only fires in other tabs. */
export const STAFF_EVENT = "kaizen:staff";

const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  window.addEventListener("focus", onChange);
  window.addEventListener(STAFF_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("focus", onChange);
    window.removeEventListener(STAFF_EVENT, onChange);
  };
};

/** The admin page staff came from: with the admin's session on Kaizen's own host, else as the admin handed it over. */
export const staffPath = (storeSlug: string) => adminReturnPath(storeSlug, document.cookie) ?? handedOffPath(storeSlug);

/**
 * For owners and staff looking at their store: a way back to the admin page
 * they came from. Shoppers never see it; it is worked out in the browser, so
 * the cached storefront stays the same for everyone. On the store's own
 * domain the admin hands its page over in the link it opened (P7), which is
 * taken out of the address here.
 */
export function BackToAdmin({ storeSlug, adminOrigin }: { storeSlug: string; adminOrigin: string }) {
  useEffect(() => {
    if (!takeHandoff(storeSlug, window.location.hash)) return;
    history.replaceState(history.state, "", `${window.location.pathname}${window.location.search}`);
    window.dispatchEvent(new Event(STAFF_EVENT));
  }, [storeSlug]);
  const path = useSyncExternalStore(subscribe, () => staffPath(storeSlug), () => null);
  if (!path) return null;
  return (
    <>
      {/* Room at the end of the page, so the button never hides the footer. */}
      <div aria-hidden className="h-16 print:hidden" />
      <a
        href={`${adminOrigin}${path}`}
        lang="en"
        className="fixed bottom-4 left-4 z-50 rounded-full bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg print:hidden"
      >
        ← Back to admin
      </a>
    </>
  );
}
