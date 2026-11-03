"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import type { DocLang, DocTrack } from "@/lib/docs-content";
import { DOCS_ASK_EVENT, DOCS_SEARCH_EVENT, isSearchShortcut, NO_FILTERS } from "@/lib/docs-search";

import { DocsSearchPanel, type DocsFinderWords, type DocsPanelStart, type DocsSearchNames } from "./docs-search-panel";

const inField = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

const never = () => () => {};

/**
 * The docs' search box in the top bar (wave 14 unit E3, D443; the shortcut since D442). Without JavaScript it is a link to the search page,
 * which works on its own; with it, a button that opens the search in a dialog, as ⌘K, Ctrl+K and `/` outside a field do (they say
 * `DOCS_SEARCH_EVENT`, which anything may say to open it). The dialog is the platform's own `<dialog>` opened as a modal, so the rest of the
 * page is inert and the keyboard stays in it; Esc, the close button or a click outside closes it and the focus goes back to where it was. It
 * searches the page's language and, on a track's page, that track first: two chips the reader takes away with one press.
 */
export function DocsSearch({
  label,
  lang,
  track,
  words,
  names,
  searchHref,
  homeHref,
  guide,
}: {
  label: string;
  lang: DocLang;
  track: DocTrack | null;
  words: DocsFinderWords;
  names: DocsSearchNames;
  searchHref: string;
  homeHref: string;
  guide: boolean;
}) {
  // False in the server's HTML and while hydrating, true after: the link becomes the button with no mismatch.
  const enhanced = useSyncExternalStore(never, () => true, () => false);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const title = useId();

  useEffect(() => {
    const show = () => {
      if (dialog.current?.open) return;
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    };
    const onKey = (event: KeyboardEvent) => {
      if (!isSearchShortcut(event, inField(event.target))) return;
      event.preventDefault();
      window.dispatchEvent(new Event(DOCS_SEARCH_EVENT));
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(DOCS_SEARCH_EVENT, show);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(DOCS_SEARCH_EVENT, show);
    };
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      // The modal focuses its first control (the close button); the reader came to type.
      element.querySelector<HTMLInputElement>("[data-docs-search-field]")?.focus();
    }
    if (!open && element.open) element.close();
  }, [open]);

  const close = () => {
    setOpen(false);
    opener.current?.focus();
  };

  const start: DocsPanelStart = {
    query: { q: "", filters: { ...NO_FILTERS, lang: [lang], track: track ? [track] : [] }, sort: "relevance" },
    answer: null,
    problem: null,
    missCounted: false,
  };

  const look = "flex min-h-10 items-center gap-3 rounded-full border border-border px-3 text-sm text-muted hover:bg-surface print:hidden";
  const keys = (
    <kbd aria-hidden="true" className="hidden rounded border border-border px-1.5 font-mono text-xs sm:inline">
      ⌘K
    </kbd>
  );

  return (
    <>
      {enhanced ? (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-keyshortcuts="Meta+K Control+K /"
          onClick={() => window.dispatchEvent(new Event(DOCS_SEARCH_EVENT))}
          className={look}
        >
          <span>{label}</span>
          {keys}
        </button>
      ) : (
        <a href={searchHref} className={look}>
          <span>{label}</span>
          {keys}
        </a>
      )}
      <dialog
        ref={dialog}
        aria-labelledby={title}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          // A click on the backdrop (the dialog itself, outside its box) closes it.
          if (event.target === dialog.current) close();
        }}
        className="mx-auto mt-[8vh] w-[min(44rem,calc(100%-2rem))] max-w-none rounded-xl border border-border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50 print:hidden"
      >
        <div className="flex max-h-[84dvh] flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
            <h2 id={title} className="text-lg font-semibold">
              {words.title}
            </h2>
            <button type="button" onClick={close} aria-label={words.close} className="inline-flex size-10 items-center justify-center rounded-full hover:bg-surface">
              <span aria-hidden="true">✕</span>
            </button>
          </div>
          {/* The panel lives while the dialog is open: each opening starts a new search. */}
          {open && (
            <div className="overflow-y-auto p-4">
              <DocsSearchPanel
                mode="dialog"
                start={start}
                words={words}
                names={names}
                uiLang={lang}
                searchHref={searchHref}
                homeHref={homeHref}
                guide={guide}
                sectionTitle={null}
                onAsk={(question) => {
                  // The guide (unit E5) listens for the question; the dialog makes way for it.
                  window.dispatchEvent(new CustomEvent(DOCS_ASK_EVENT, { detail: { question } }));
                  setOpen(false);
                }}
              />
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}
