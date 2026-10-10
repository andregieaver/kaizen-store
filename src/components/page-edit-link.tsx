"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useSyncExternalStore } from "react";

import { handedOffPath, hasSessionCookie } from "@/lib/admin-return";

import { STAFF_EVENT } from "./back-to-admin";

// The editor for the page's words is fetched only when the person turns the mode on (D192): visitors never load it.
const SiteTextEditor = dynamic(() => import("./inline-edit/site-editor"), { ssr: false });

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
 * Beside it, "Edit text" (D192) for the signed-in who may change the website:
 * headings and texts of the page's own are pressed and typed in where they stand.
 */
export function PageEditLink({
  pageId,
  store,
  article = false,
  adminOrigin = "",
  textEditable = true,
}: {
  pageId: string;
  store?: string;
  /** An article in the blog (D57), edited under Blog. */
  article?: boolean;
  /** Where the admin is: empty on Kaizen's own host. */
  adminOrigin?: string;
  /** Whether the page is shown in the language it is written in: a translation is edited in the page builder's Translate view. */
  textEditable?: boolean;
}) {
  const [member, setMember] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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
  // What was done says so for a moment.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  if (!editor) return null;
  // Only the signed-in on this host can type in the page: staff handed over from the admin of another host have the page builder.
  const mayEditText = member && textEditable;
  return (
    <>
      {/* Room at the end of the page, so the button never hides the footer. */}
      <div aria-hidden className="h-16 print:hidden" />
      <div
        lang="en"
        className={`fixed z-50 flex flex-col gap-2 print:hidden ${
          // In a store, beside "Back to admin" and above the phone bar.
          store ? "right-4 bottom-20 items-end md:bottom-4" : "bottom-20 left-4 items-start md:bottom-4"
        }`}
      >
        {notice && (
          <p role="status" className="max-w-72 rounded-md bg-foreground px-3 py-2 text-sm text-background shadow-lg">
            {notice}
          </p>
        )}
        <div className="flex items-center gap-2">
          {mayEditText && (
            <button
              type="button"
              aria-pressed={editing}
              onClick={() => setEditing((on) => !on)}
              className={`rounded-full border-2 border-foreground px-4 py-2 text-sm font-medium shadow-lg ${editing ? "bg-background text-foreground" : "bg-background/90 text-foreground"}`}
            >
              {editing ? "Done editing" : "Edit text"}
            </button>
          )}
          <a
            href={`${adminOrigin}/admin/${store ?? "platform"}/${article ? "articles" : "pages"}/${pageId}`}
            className="rounded-full bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg"
          >
            Edit page
          </a>
        </div>
      </div>
      {editing && mayEditText && <SiteTextEditor pageId={pageId} store={store} onNotice={setNotice} />}
    </>
  );
}
