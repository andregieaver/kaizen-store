"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { forgetAdminPages, handoffHash, rememberAdminPage } from "@/lib/admin-return";

/**
 * Remembers the store admin page being viewed, for the storefront's "Back to
 * admin". A store on its own domain cannot read what Kaizen's site keeps
 * (P7), so links to it carry the page instead, added as they are followed.
 */
export function AdminTrail({ storeSlug, storeOrigins }: { storeSlug: string; storeOrigins: string[] }) {
  const pathname = usePathname();
  useEffect(() => {
    rememberAdminPage(storeSlug, `${pathname}${window.location.search}`);
  }, [storeSlug, pathname]);

  const origins = storeOrigins.join(" ");
  useEffect(() => {
    if (!origins) return;
    const mark = (event: Event) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const url = new URL(anchor.href);
      // A link of the store's own to a part of the page keeps it.
      if (!origins.split(" ").includes(url.origin) || (url.hash && !url.hash.startsWith(handoffHash("").slice(0, -1)))) return;
      url.hash = handoffHash(`${window.location.pathname}${window.location.search}`);
      anchor.href = url.href;
    };
    // Clicks, middle clicks and the menu's "open in new tab" all read the link after this.
    const events = ["click", "auxclick", "contextmenu"] as const;
    for (const type of events) document.addEventListener(type, mark, true);
    return () => {
      for (const type of events) document.removeEventListener(type, mark, true);
    };
  }, [origins]);
  return null;
}

/** The sign-out form; it also forgets the admin pages, so the storefront stops offering a way back. */
export function SignOutForm({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action} onSubmit={forgetAdminPages}>
      <button type="submit" className="underline">
        Sign out
      </button>
    </form>
  );
}
