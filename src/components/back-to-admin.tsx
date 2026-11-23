"use client";

import dynamic from "next/dynamic";
import { useEffect, useSyncExternalStore } from "react";

import { adminReturnPath, handedOffPath, hasSessionCookie, takeHandoff } from "@/lib/admin-return";
import { editPassActive } from "@/lib/edit-link";

import { StaffDock, useStaffDockItems } from "./staff-dock";

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
 * taken out of the address here. On phones it is one of the icons behind the staff's pencil (`StaffDock`).
 */
export function BackToAdmin({ storeSlug, adminOrigin }: { storeSlug: string; adminOrigin: string }) {
  useEffect(() => {
    if (!takeHandoff(storeSlug, window.location.hash)) return;
    history.replaceState(history.state, "", `${window.location.pathname}${window.location.search}`);
    window.dispatchEvent(new Event(STAFF_EVENT));
  }, [storeSlug]);
  const path = useSyncExternalStore(subscribe, () => staffPath(storeSlug), () => null);
  useStaffDockItems("back-to-admin", path ? [{ key: "back", label: "Back to admin", icon: "back", order: 0, lang: "en", href: `${adminOrigin}${path}` }] : []);
  if (!path) return null;
  return (
    <>
      <a
        href={`${adminOrigin}${path}`}
        lang="en"
        className="fixed bottom-4 left-4 z-50 rounded-full bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg max-md:hidden print:hidden"
      >
        ← Back to admin
      </a>
      <StaffDock />
    </>
  );
}

// The whole site's CSS from any page (`SiteCssLink`), fetched only for staff: shoppers never load it.
const SiteCssLink = dynamic(() => import("./site-css-link").then((m) => m.SiteCssLink), { ssr: false });

/** Whether this browser may belong to staff: a session, an editing pass, or a page handed over from the admin. Worked out in the browser. */
const maybeStaff = (store?: string) => hasSessionCookie(document.cookie) || Boolean(store && (editPassActive(store) || handedOffPath(store)));

/**
 * Where the site's layout draws *Custom CSS* for the whole site (`SiteCssLink`): nothing for shoppers, and for a browser that may be
 * staff's the tool's code, loaded then, which asks the server whether the person may change the website.
 */
export function SiteCssSlot({ store }: { store?: string }) {
  const staff = useSyncExternalStore(subscribe, () => maybeStaff(store), () => false);
  return staff ? <SiteCssLink store={store} /> : null;
}
