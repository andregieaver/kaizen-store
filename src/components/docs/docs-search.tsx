"use client";

import { useEffect } from "react";

import { DOCS_SEARCH_EVENT, isSearchShortcut } from "@/lib/docs-search";

const inField = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * The docs' search box in the top bar (D442). The search itself is unit E3's: until it ships the button is shown and switched off, and ⌘K
 * (Ctrl+K, or `/` outside a field) already says `DOCS_SEARCH_EVENT` on `window`, which E3's dialog listens for.
 */
export function DocsSearchButton({ label, soon }: { label: string; soon: string }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isSearchShortcut(event, inField(event.target))) return;
      event.preventDefault();
      window.dispatchEvent(new Event(DOCS_SEARCH_EVENT));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <button
      type="button"
      disabled
      aria-keyshortcuts="Meta+K Control+K"
      className="flex min-h-10 items-center gap-3 rounded-full border border-border px-3 text-sm text-muted print:hidden"
    >
      <span>{label}</span>
      <span className="sr-only">{soon}</span>
      <kbd aria-hidden="true" className="hidden rounded border border-border px-1.5 font-mono text-xs sm:inline">
        ⌘K
      </kbd>
    </button>
  );
}
