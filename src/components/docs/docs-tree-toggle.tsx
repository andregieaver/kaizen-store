"use client";

import { useState } from "react";

/**
 * The track's pages on a phone (D442): folded under one button, open beside the article on a wider screen. Folded from the first paint, so
 * nothing moves when the script arrives; until it does (or without it) the breadcrumbs, the track's own page and previous and next still
 * lead to every page.
 */
export function DocsTreeToggle({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex min-h-11 w-full items-center justify-between rounded-lg border border-border px-3 text-sm font-medium md:hidden print:hidden"
      >
        {label}
        <span aria-hidden="true" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      <div id={id} className={open ? undefined : "max-md:hidden"}>
        {children}
      </div>
    </div>
  );
}
