"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore, useTransition } from "react";

import { fillWords } from "@/lib/admin-fill";
import type { ShellMessages } from "@/lib/admin-messages/shell.en";
import { ASK_AI_MANAGER_EVENT, type AskDetail } from "@/lib/alert-ask";
import { finderOptions, type FinderGroup, type FinderItem } from "@/lib/page-finder";

export type FinderWords = ShellMessages["finder"];

const inField = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** Whether a key press asks for the finder: ⌘K or Ctrl+K anywhere, `/` outside a field. */
export function opensFinder(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, typing: boolean): boolean {
  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") return true;
  return event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !typing;
}

/** Follows the AI manager launcher's mark on `<html>` (D348), which it sets once it listens: the finder hands a search to it only then. */
function watchAiManager(changed: () => void): () => void {
  const observer = new MutationObserver(changed);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ai-manager"] });
  return () => observer.disconnect();
}

/**
 * The page finder (admin redesign round 1, audit D454 N6): a search icon in the top bar, and ⌘K, Ctrl+K or `/` from any page, open a dialog
 * that finds an admin page by what a person types, Advanced pages too. The search runs on the server (`find`, the level's action, which
 * knows the person's role and the store's features), so no screen loads the admin map. The dialog is the platform's own `<dialog>` opened
 * as a modal: the page behind is inert, Esc or a click outside closes it, and the focus goes back where it was. Arrow keys move through the
 * results and Enter opens one.
 *
 * In a store and at the owner's level the answer also holds records (ecosystem plan E2.2, D713): orders, customers, conversations, deals and
 * products, each kind under its heading (a `group` of the listbox, named by its heading), one list for the arrow keys. Where the AI manager
 * is on the page, the last option asks it about the words typed (`ASK_AI_MANAGER_EVENT`, sent as the person's message), so a search that
 * finds nothing still leads somewhere. The search is sent a moment after the typing stops, and an answer to an older question is dropped.
 */
export function PageFinder({ find, words }: { find: (query: string) => Promise<FinderGroup[]>; words: FinderWords }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<FinderGroup[]>([]);
  const [asked, setAsked] = useState("");
  const [active, setActive] = useState(0);
  const [, startTransition] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const title = useId();
  const listId = useId();
  const latest = useRef("");
  const aiHere = useSyncExternalStore(watchAiManager, () => document.documentElement.dataset.aiManager === "on", () => false);

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
          setGroups(found);
          setAsked(q);
          setActive(0);
        },
        () => {
          if (latest.current === q) setGroups([]);
        },
      );
    }, 160);
    return () => window.clearTimeout(timer);
  }, [query, find]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setGroups([]);
    setAsked("");
    opener.current?.focus();
  };

  const go = (item: FinderItem) => {
    close();
    startTransition(() => router.push(item.href));
  };

  const typed = query.trim();
  const shown = typed ? groups : [];
  const options = finderOptions(shown);
  // The AI manager's option comes after every result, while it is on the page and something is typed.
  const askAt = aiHere && typed ? options.length : -1;
  const count = options.length + (askAt >= 0 ? 1 : 0);
  const current = Math.min(active, Math.max(count - 1, 0));

  const ask = () => {
    const message = typed;
    close();
    window.dispatchEvent(new CustomEvent<AskDetail>(ASK_AI_MANAGER_EVENT, { detail: { message } }));
  };

  const choose = (index: number) => {
    if (index < options.length) go(options[index]);
    else if (index === askAt) ask();
  };

  const nothing = typed !== "" && asked === typed && options.length === 0;

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
              aria-expanded={count > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={count > 0 ? finderOptionId(listId, current) : undefined}
              aria-label={words.open}
              placeholder={words.placeholder}
              value={query}
              maxLength={100}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && count > 0) {
                  event.preventDefault();
                  setActive((current + 1) % count);
                } else if (event.key === "ArrowUp" && count > 0) {
                  event.preventDefault();
                  setActive((current - 1 + count) % count);
                } else if (event.key === "Enter" && count > 0) {
                  event.preventDefault();
                  choose(current);
                }
              }}
              className="h-14 min-w-0 flex-1 bg-transparent text-body-lg outline-none placeholder:text-muted focus-visible:outline-none focus-visible:ring-0 [&::-webkit-search-cancel-button]:hidden"
            />
            <button type="button" onClick={close} className="shrink-0 rounded-pill px-2 py-1 text-caption text-muted hover:bg-sunken">
              {words.close}
            </button>
          </div>
          <div className="overflow-y-auto p-2">
            {options.length === 0 && (
              <p role="status" className="px-3 py-6 text-center text-body text-muted">
                {nothing ? fillWords(words.none, { query: typed }) : words.hint}
              </p>
            )}
            {count > 0 && (
              <FinderList listId={listId} groups={shown} current={current} ask={askAt >= 0 ? typed : null} words={words} onHover={setActive} onChoose={choose} />
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}

/** An option's id: the list's id and its place in the one list the arrow keys walk (the combobox's `aria-activedescendant`). */
export const finderOptionId = (listId: string, index: number): string => `${listId}-${index}`;

/**
 * The finder's results as one listbox: each group of rows under its heading (a `group` named by the heading, ecosystem plan E2.2, D713),
 * without headings when only pages are shown, as before; then, when `ask` holds the words typed, the option that asks the AI manager about
 * them. Every option is numbered in drawing order, so `current` and the ids follow the arrow keys across the groups.
 */
export function FinderList({
  listId,
  groups,
  current,
  ask,
  words,
  onHover,
  onChoose,
}: {
  listId: string;
  groups: readonly FinderGroup[];
  current: number;
  ask: string | null;
  words: FinderWords;
  onHover: (index: number) => void;
  onChoose: (index: number) => void;
}) {
  const options = finderOptions(groups);
  // Headings only where there is more than one kind of thing to tell apart: the pages alone read as they always did.
  const headed = groups.length > 1 || groups.some((group) => group.kind !== "pages");
  // Where each group's rows start in the one list.
  const starts = groups.map((_, g) => groups.slice(0, g).reduce((sum, group) => sum + group.items.length, 0));
  const row = (item: FinderItem, at: number) => (
    <div
      key={item.href}
      id={finderOptionId(listId, at)}
      role="option"
      aria-selected={at === current}
      onMouseEnter={() => onHover(at)}
      onClick={() => onChoose(at)}
      className="flex cursor-pointer flex-col gap-0.5 rounded-panel px-3 py-2.5 aria-selected:bg-sunken"
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-body-strong text-ink">{item.title}</span>
        {item.group && <span className="shrink-0 text-caption text-muted">{item.group}</span>}
      </span>
      {item.what && <span className="line-clamp-1 text-caption text-muted">{item.what}</span>}
    </div>
  );
  const askAt = options.length;
  return (
    <div id={listId} role="listbox" aria-label={words.results} className="flex flex-col">
      {groups.map((group, g) => {
        const rows = group.items.map((item, i) => row(item, starts[g] + i));
        if (!headed) return rows;
        const headingId = `${listId}-${group.kind}`;
        return (
          <div key={group.kind} role="presentation" className="flex flex-col">
            <div id={headingId} role="presentation" className="px-3 pb-1 pt-3 text-caption text-muted">
              {words.groups[group.kind]}
            </div>
            <div role="group" aria-labelledby={headingId} className="flex flex-col">
              {rows}
            </div>
          </div>
        );
      })}
      {ask !== null && (
        <div
          id={finderOptionId(listId, askAt)}
          role="option"
          aria-selected={askAt === current}
          onMouseEnter={() => onHover(askAt)}
          onClick={() => onChoose(askAt)}
          className={`flex cursor-pointer items-center gap-3 rounded-panel px-3 py-2.5 aria-selected:bg-sunken ${options.length > 0 ? "mt-1 border-t border-line" : ""}`}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 shrink-0 text-brand-text" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
            <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
          </svg>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="line-clamp-2 text-body-strong text-ink">{fillWords(words.ask, { query: ask })}</span>
            <span className="text-caption text-muted">{words.askWhat}</span>
          </span>
        </div>
      )}
    </div>
  );
}
