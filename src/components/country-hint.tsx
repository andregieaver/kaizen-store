"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

import { hintHref } from "@/lib/country-hint";

/**
 * A dismissible line suggesting this page in the store for the visitor's country (D338, D3): a link, never a redirect. Closing it is kept in
 * memory only (the layout's state lives across the store's pages until a full load); nothing is stored, so it needs no cookie or consent.
 */
export function CountryHint({
  fromBase,
  toBase,
  lang,
  words,
}: {
  fromBase: string;
  toBase: string;
  lang: string;
  words: { offer: string; go: string; close: string; label: string };
}) {
  const pathname = usePathname();
  const [closed, setClosed] = useState(false);
  if (closed) return null;
  return (
    <div
      role="region"
      aria-label={words.label}
      lang={lang}
      data-country-hint=""
      className="fixed inset-x-4 bottom-20 z-40 mx-auto flex max-w-xl flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm shadow-lg md:bottom-4"
    >
      <span className="min-w-0 flex-1">{words.offer}</span>
      <a href={hintHref(pathname, fromBase, toBase)} className="font-medium underline">
        {words.go}
      </a>
      <button type="button" onClick={() => setClosed(true)} className="min-h-10 rounded-button px-3 hover:bg-background">
        {words.close}
      </button>
    </div>
  );
}
