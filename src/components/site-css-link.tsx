"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useSyncExternalStore } from "react";

import { hasSessionCookie } from "@/lib/admin-return";
import { editPassActive } from "@/lib/edit-link";

import { STAFF_EVENT } from "./back-to-admin";
import { StaffDock, useStaffDockHas, useStaffDockItems } from "./staff-dock";

// The panel is fetched only when it is opened (D306): visitors never load it.
const SiteCssEditor = dynamic(() => import("./inline-edit/site-css-editor"), { ssr: false });

const onStaff = (onChange: () => void) => {
  window.addEventListener(STAFF_EVENT, onChange);
  return () => window.removeEventListener(STAFF_EVENT, onChange);
};

/**
 * *Custom CSS* for the whole site on every page of it, also those not built in the page builder (a product, a category, the cart),
 * for those who may change the website: the CSS panel with its *Whole site* tab alone. Drawn once by the site's layout; on a page with
 * its own *Edit page* tools (`PageEditLink`, whose panel has both tabs) it stands back. Worked out in the browser, asking the server only
 * when a session or an editing pass is there, so the pages stay the same for everyone and cached. On phones it is an icon behind the
 * staff's pencil (`StaffDock`).
 */
export function SiteCssLink({ store }: { store?: string }) {
  const [word, setWord] = useState<{ lang: string; customCss: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pageTools = useStaffDockHas("page-edit-link");
  const hasPass = useSyncExternalStore(onStaff, () => Boolean(store && editPassActive(store)), () => false);
  useEffect(() => {
    if (!hasSessionCookie(document.cookie) && !hasPass) return;
    const controller = new AbortController();
    const query = store ? `?store=${encodeURIComponent(store)}` : "";
    fetch(`/api/platform/editor${query}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { editor?: boolean; words?: { lang?: string; customCss?: string } } | null) => {
        setWord(body?.editor ? { lang: body.words?.lang ?? "en", customCss: body.words?.customCss ?? "Custom CSS" } : null);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [store, hasPass]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const shown = word !== null && !pageTools;
  useStaffDockItems(
    "site-css-link",
    shown ? [{ key: "css", label: word.customCss, icon: "code", order: 2, lang: word.lang, pressed: open, onSelect: () => setOpen((was) => !was) }] : [],
  );
  if (!shown) return null;
  return (
    <>
      <button
        type="button"
        lang={word.lang}
        data-staff-tools=""
        aria-pressed={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((was) => !was)}
        className={`fixed bottom-4 z-50 rounded-full border-2 border-foreground px-4 py-2 font-mono text-sm font-medium shadow-lg max-md:hidden print:hidden ${
          store ? "right-4" : "left-4"
        } ${open ? "bg-foreground text-background" : "bg-background/90 text-foreground"}`}
      >
        <span aria-hidden>{"{ } "}</span>
        <span className="font-sans">{word.customCss}</span>
      </button>
      {notice && (
        <p
          role="status"
          className={`fixed z-50 max-w-72 rounded-md bg-foreground px-3 py-2 text-sm text-background shadow-lg print:hidden max-md:bottom-[calc(9.5rem+env(safe-area-inset-bottom))] max-md:left-4 md:bottom-16 ${
            store ? "md:right-4" : "md:left-4"
          }`}
        >
          {notice}
        </p>
      )}
      <StaffDock />
      {open && <SiteCssEditor pageId={null} store={store} onClose={() => setOpen(false)} onNotice={setNotice} />}
    </>
  );
}
