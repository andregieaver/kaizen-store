"use client";

import { useEffect, useState } from "react";

import { hasSessionCookie } from "@/lib/admin-return";

/**
 * "Edit page" for those who may edit the page they are looking at: platform
 * admins on Kaizen's pages (D42), the store's own people on its pages
 * (D54). Visitors never see it: it is worked out in the browser, asking the
 * server only when a session cookie is there, so the page stays cached for all.
 */
export function PageEditLink({
  pageId,
  store,
  article = false,
}: {
  pageId: string;
  store?: string;
  /** An article in the blog (D57), edited under Blog. */
  article?: boolean;
}) {
  const [editor, setEditor] = useState(false);
  useEffect(() => {
    if (!hasSessionCookie(document.cookie)) return;
    const controller = new AbortController();
    const query = store ? `?store=${encodeURIComponent(store)}` : "";
    fetch(`/api/platform/editor${query}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { editor?: boolean } | null) => setEditor(Boolean(body?.editor)))
      .catch(() => {});
    return () => controller.abort();
  }, [store]);
  if (!editor) return null;
  return (
    <>
      {/* Room at the end of the page, so the button never hides the footer. */}
      <div aria-hidden className="h-16 print:hidden" />
      <a
        href={`/admin/${store ?? "platform"}/${article ? "articles" : "pages"}/${pageId}`}
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
