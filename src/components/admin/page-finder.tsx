"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { fillWords } from "@/lib/admin-fill";
import type { FinderItem } from "@/lib/page-finder";

export type FinderWords = { open: string; placeholder: string; hint: string; none: string; results: string; close: string };

const inField = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** Whether a key press asks for the finder: ⌘K or Ctrl+K anywhere, `/` outside a field. */
export function opensFinder(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, typing: boolean): boolean {
  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") return true;
  return event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !typing;
}

/**
 * The page finder (admin redesign round 1, audit D454 N6): a search icon in the top bar, and ⌘K, Ctrl+K or `/` from any page, open a dialog
 * that finds an admin page by what a person types, Advanced pages too. The search runs on the server (`find`, the level's action, which
 * knows the person's role and the store's features), so no screen loads the admin map. The dialog is the platform's own `<dialog>` opened
 * as a modal: the page behind is inert, Esc or a click outside closes it, and the focus goes back where it was. Arrow keys move through the
 * results and Enter opens one.
 */
export function PageFinder({ find, words }: { find: (query: string) => Promise<FinderItem[]>; words: FinderWords }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<FinderItem[]>([]);
  const [asked, setAsked] = useState("");
  const [active, setActive] = useState(0);
  const [, startTransition] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const title = useId();
  const listId = useId();
  const latest = useRef("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!opensFinder(event, inField(event.target))) return;
      if (dialog.current?.open) return;
      event.preventDefault();
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      element.querySelector<HTMLInputElement>("input")?.focus();
    }
    if (!open && element.open) element.close();
  }, [open]);

  // What was typed, searched a moment after the typing stops; an answer to an older question is dropped.
  useEffect(() => {
    const q = query.trim();
    latest.current = q;
    if (!q) return;
    const timer = window.setTimeout(() => {
      find(q).then(
        (found) => {
          if (latest.current !== q) return;
          setItems(found);
          setAsked(q);
          setActive(0);
        },
        () => {
          if (latest.current === q) setItems([]);
        },
      );
    }, 140);
    return () => window.clearTimeout(timer);
  }, [query, find]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setItems([]);
    setAsked("");
    opener.current?.focus();
  };

  const go = (item: FinderItem) => {
    close();
    startTransition(() => router.push(item.href));
  };

  const shown = query.trim() ? items : [];

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="Meta+K Control+K /"
        aria-label={words.open}
        title={`${words.open} (⌘K)`}
        onClick={(event) => {
          opener.current = event.currentTarget;
          setOpen(true);
        }}
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-pill border border-edge bg-card text-ink hover:bg-sunken"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={title}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialog.current) close();
        }}
        className="mx-auto mt-[10vh] w-[min(40rem,calc(100%-2rem))] max-w-none rounded-panel border border-line bg-card p-0 text-ink shadow-[var(--shadow-modal)] backdrop:bg-[rgb(16_22_20/0.4)]"
      >
        <h2 id={title} className="sr-only">
          {words.open}
        </h2>
        <div className="flex max-h-[76dvh] flex-col">
          <div className="flex items-center gap-3 border-b border-line px-4">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              role="combobox"
              aria-expanded={shown.length > 0}
              aria-controls={listId}
              aria-activedescendant={shown.length > 0 ? `${listId}-${active}` : undefined}
              aria-label={words.open}
              placeholder={words.placeholder}
              value={query}
              maxLength={100}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && shown.length > 0) {
                  event.preventDefault();
                  setActive((i) => (i + 1) % shown.length);
                } else if (event.key === "ArrowUp" && shown.length > 0) {
                  event.preventDefault();
                  setActive((i) => (i - 1 + shown.length) % shown.length);
                } else if (event.key === "Enter" && shown[active]) {
                  event.preventDefault();
                  go(shown[active]);
                }
              }}
              className="h-14 min-w-0 flex-1 bg-transparent text-body-lg outline-none placeholder:text-muted focus-visible:outline-none focus-visible:ring-0 [&::-webkit-search-cancel-button]:hidden"
            />
            <button type="button" onClick={close} className="shrink-0 rounded-pill px-2 py-1 text-caption text-muted hover:bg-sunken">
              {words.close}
            </button>
          </div>
          <div className="overflow-y-auto p-2">
            {shown.length > 0 ? (
              <ul id={listId} role="listbox" aria-label={words.results} className="flex flex-col">
                {shown.map((item, i) => (
                  <li
                    key={item.href}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(item)}
                    className="flex cursor-pointer flex-col gap-0.5 rounded-panel px-3 py-2.5 aria-selected:bg-sunken"
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-body-strong text-ink">{item.title}</span>
                      <span className="shrink-0 text-caption text-muted">{item.group}</span>
                    </span>
                    <span className="line-clamp-1 text-caption text-muted">{item.what}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p role="status" className="px-3 py-6 text-center text-body text-muted">
                {query.trim() && asked === query.trim() ? fillWords(words.none, { query: query.trim() }) : words.hint}
              </p>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
