"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { suggestAction } from "@/app/s/[store]/[market]/search/actions";
import type { Suggestion } from "@/server/search";

import { Icon } from "./icons";

export type SearchBoxLabels = {
  label: string;
  placeholder: string;
  submit: string;
  suggestions: string;
  /** With `#` where the query goes. */
  showAll: string;
};

/**
 * The store's search field (Phase 2, S1): a plain form to the search page,
 * which works without JavaScript; with it, a few products are suggested as
 * the shopper types (an ARIA combobox: arrow keys move through them, Enter
 * opens the one chosen or searches, Escape closes the list).
 */
export function SearchBox({
  store,
  market,
  base,
  defaultValue = "",
  autoFocus = false,
  labels,
}: {
  store: string;
  market: string;
  /** The market's path, for the search page and the products' addresses. */
  base: string;
  defaultValue?: string;
  autoFocus?: boolean;
  labels: SearchBoxLabels;
}) {
  const router = useRouter();
  const id = useId();
  const listId = `${id}-list`;
  const [value, setValue] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [, startLoading] = useTransition();
  const asked = useRef(0);

  // Ask for suggestions a moment after typing stops; only the latest answer counts.
  useEffect(() => {
    const text = value.trim();
    if (text.length < 2) return;
    const ticket = ++asked.current;
    const timer = setTimeout(() => {
      startLoading(async () => {
        const found = await suggestAction(store, market, text);
        if (ticket !== asked.current) return;
        setSuggestions(found);
        setActive(-1);
      });
    }, 150);
    return () => clearTimeout(timer);
  }, [value, store, market]);

  const shown = open && value.trim().length >= 2 && suggestions.length > 0;
  const productHref = (s: Suggestion) => `${base}/p/${s.handle}`;

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && suggestions.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp" && suggestions.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
    } else if (event.key === "Enter" && shown && active >= 0) {
      event.preventDefault();
      router.push(productHref(suggestions[active]));
    }
  }

  return (
    <form action={`${base}/search`} method="get" role="search" className="relative flex max-w-xl gap-2">
      <label htmlFor={`${id}-input`} className="sr-only">
        {labels.label}
      </label>
      <input
        id={`${id}-input`}
        name="q"
        type="search"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
          if (e.target.value.trim().length < 2) setSuggestions([]);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        placeholder={labels.placeholder}
        autoComplete="off"
        autoFocus={autoFocus}
        maxLength={100}
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown && active >= 0 ? `${id}-option-${active}` : undefined}
        className="min-h-11 w-full rounded-button border border-border bg-background px-4"
      />
      <button type="submit" className="flex min-h-11 items-center gap-2 button-primary rounded-button px-4 text-sm font-medium">
        <Icon name="search" className="size-5" />
        <span>{labels.submit}</span>
      </button>
      <ul
        id={listId}
        role="listbox"
        aria-label={labels.suggestions}
        hidden={!shown}
        className="absolute top-full left-0 z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-background shadow-lg"
      >
        {suggestions.map((s, i) => (
          <li
            key={s.handle}
            id={`${id}-option-${i}`}
            role="option"
            aria-selected={i === active}
            // Chosen with the mouse before the field loses focus.
            onMouseDown={(e) => {
              e.preventDefault();
              router.push(productHref(s));
            }}
            className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm aria-selected:bg-surface hover:bg-surface"
          >
            {s.image ? (
              <Image src={s.image.url} alt="" width={36} height={36} className="size-9 rounded object-cover" />
            ) : (
              <span className="size-9 rounded bg-surface" aria-hidden="true" />
            )}
            <span>{s.title}</span>
          </li>
        ))}
        <li
          role="option"
          id={`${id}-option-all`}
          aria-selected={false}
          onMouseDown={(e) => {
            e.preventDefault();
            router.push(`${base}/search?q=${encodeURIComponent(value.trim())}`);
          }}
          className="flex min-h-11 cursor-pointer items-center border-t border-border px-3 text-sm underline hover:bg-surface"
        >
          {labels.showAll.replace("#", value.trim())}
        </li>
      </ul>
    </form>
  );
}
