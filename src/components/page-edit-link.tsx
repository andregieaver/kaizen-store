"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { handedOffPath, hasSessionCookie } from "@/lib/admin-return";

import { STAFF_EVENT } from "./back-to-admin";

const onStaff = (onChange: () => void) => {
  window.addEventListener(STAFF_EVENT, onChange);
  return () => window.removeEventListener(STAFF_EVENT, onChange);
};

/**
 * "Edit page" for those who may edit the page they are looking at: platform
 * admins on Kaizen's pages (D42), the store's own people on its pages
 * (D54). Visitors never see it: it is worked out in the browser, asking the
 * server only when a session cookie is there, so the page stays cached for all.
 * On a store's own domain, where the admin's session is out of reach (P7),
 * staff who came from the admin see it, and the admin asks them to sign in.
 */
export function PageEditLink({
  pageId,
  store,
  article = false,
  adminOrigin = "",
}: {
  pageId: string;
  store?: string;
  /** An article in the blog (D57), edited under Blog. */
  article?: boolean;
  /** Where the admin is: empty on Kaizen's own host. */
  adminOrigin?: string;
}) {
  const [member, setMember] = useState(false);
  const handedOver = useSyncExternalStore(onStaff, () => Boolean(store && adminOrigin && handedOffPath(store)), () => false);
  const editor = member || handedOver;
  useEffect(() => {
    if (!hasSessionCookie(document.cookie)) return;
    const controller = new AbortController();
    const query = store ? `?store=${encodeURIComponent(store)}` : "";
    fetch(`/api/platform/editor${query}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { editor?: boolean } | null) => setMember(Boolean(body?.editor)))
      .catch(() => {});
    return () => controller.abort();
  }, [store]);
  if (!editor) return null;
  return (
    <>
      {/* Room at the end of the page, so the button never hides the footer. */}
      <div aria-hidden className="h-16 print:hidden" />
      <a
        href={`${adminOrigin}/admin/${store ?? "platform"}/${article ? "articles" : "pages"}/${pageId}`}
        lang="en"
        className={`fixed z-50 rounded-full bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg print:hidden ${
          // In a store, beside "Back to admin" and above the phone bar.
          store ? "right-4 bottom-20 md:bottom-4" : "bottom-20 left-4 md:bottom-4"
        }`}
      >
        Edit page
      </a>
    </>
  );
}
