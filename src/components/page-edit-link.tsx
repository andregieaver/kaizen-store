"use client";

import { useEffect, useState } from "react";

import { hasSessionCookie } from "@/lib/admin-return";

/**
 * "Edit page" for platform admins looking at one of Kaizen's pages (D42).
 * Visitors never see it: it is worked out in the browser, asking the server
 * only when a session cookie is there, so the page stays cached for all.
 */
export function PageEditLink({ pageId }: { pageId: string }) {
  const [editor, setEditor] = useState(false);
  useEffect(() => {
    if (!hasSessionCookie(document.cookie)) return;
    const controller = new AbortController();
    fetch("/api/platform/editor", { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { editor?: boolean } | null) => setEditor(Boolean(body?.editor)))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  if (!editor) return null;
  return (
    <>
      {/* Room at the end of the page, so the button never hides the footer. */}
      <div aria-hidden className="h-16 print:hidden" />
      <a
        href={`/admin/platform/pages/${pageId}`}
        className="fixed bottom-20 left-4 z-50 rounded-full bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg md:bottom-4 print:hidden"
      >
        Edit page
      </a>
    </>
  );
}
