"use client";

import { useEffect, useState } from "react";

/**
 * Cards' filter chips (D916): All, then each group with its count; choosing one hides the other groups' cards in the list beside it
 * (`list` is its id), so the cards themselves stay drawn on the server and all show without script.
 */
export function CardsFilter({ list, all, total, groups }: { list: string; all: string; total: number; groups: { name: string; count: number }[] }) {
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    const cards = document.getElementById(list)?.children;
    if (!cards) return;
    for (const card of Array.from(cards)) (card as HTMLElement).hidden = shown !== null && card.getAttribute("data-group") !== shown;
  }, [list, shown]);
  const chip = (name: string | null, label: string, count: number) => (
    <button
      key={name ?? ""}
      type="button"
      aria-pressed={shown === name}
      onClick={() => setShown(name)}
      className={`min-h-9 rounded-full px-3.5 text-sm font-medium ${shown === name ? "bg-accent text-accent-foreground" : "text-muted shadow-[inset_0_0_0_1px_var(--border)] hover:text-current"}`}
    >
      {label} <span className="opacity-70">{count}</span>
    </button>
  );
  return (
    <div role="group" aria-controls={list} className="flex flex-wrap gap-2">
      {chip(null, all, total)}
      {groups.map((group) => chip(group.name, group.name, group.count))}
    </div>
  );
}
