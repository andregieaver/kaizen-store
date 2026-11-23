"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";

import { fillWords } from "@/lib/admin-fill";
import type { AdminView } from "@/lib/admin-view";

import { useAdminText } from "./admin-text";

/**
 * Basic and Advanced (D454, `src/lib/admin-view.ts`): the person's choice, held by `AdminViewProvider` in each level's layout (a store's,
 * the platform's and the owner's, D884) so the sidebar, the phone's menu and the pages of cards follow it at once, and kept on their
 * account by `save` without drawing the page again. Outside a provider (the builder's sandbox, a page drawn alone in a test) nothing is
 * hidden and nothing is said about it.
 */
type ViewState = { view: AdminView; setView: (view: AdminView) => void; offered: boolean };

const ViewContext = createContext<ViewState>({ view: "advanced", setView: () => {}, offered: false });

export function AdminViewProvider({ saved, save, children }: { saved: AdminView; save: (view: AdminView) => Promise<void>; children: ReactNode }) {
  const [view, setLocal] = useState<AdminView>(saved);
  // A choice saved elsewhere (Your account) comes back as a new `saved` once the layout is drawn again.
  const [was, setWas] = useState<AdminView>(saved);
  if (saved !== was) {
    setWas(saved);
    setLocal(saved);
  }
  const [, startTransition] = useTransition();
  const setView = (next: AdminView) => {
    if (next === view) return;
    setLocal(next);
    startTransition(async () => {
      try {
        await save(next);
      } catch {
        // Not kept on the account: the choice still holds for this visit.
      }
    });
  };
  return <ViewContext value={{ view, setView, offered: true }}>{children}</ViewContext>;
}

/** The view in force here: `advanced` outside a provider. */
export function useAdminView(): ViewState {
  return useContext(ViewContext);
}

/**
 * The two views' icons (lucide's rows-2 and rows-4 at the sections' stroke), drawn inline: the switch is in every admin document twice (the
 * top bar and the phone's menu), at all three levels since D884, so its markup is kept to what draws it.
 */
function RowsIcon({ rows }: { rows: 2 | 4 }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d={rows === 2 ? "M3 12h18" : "M21 7.5H3M21 12H3M21 16.5H3"} />
    </svg>
  );
}

/**
 * The switch between the two views: both named, the one in force marked, so what it does is read rather than guessed. `compact` keeps to
 * the icons below `xl`, for the top bar; the names are still each button's accessible name, and its title says what the view shows. The
 * full switch (the phone's menu, Your account) shows its names, so it needs no title.
 */
export function AdminViewToggle({ compact = false }: { compact?: boolean }) {
  const { view, setView, offered } = useAdminView();
  const w = useAdminText("shell").view;
  if (!offered) return null;
  const option = (value: AdminView, rows: 2 | 4, label: string, title: string) => (
    <button
      type="button"
      aria-pressed={view === value}
      title={compact ? title : undefined}
      onClick={() => setView(value)}
      className="flex min-h-9 items-center gap-1.5 rounded-pill px-3 text-sm text-ink-2 hover:text-ink aria-pressed:bg-inverse aria-pressed:text-inverse-ink"
    >
      <RowsIcon rows={rows} />
      {compact ? <span className="sr-only xl:not-sr-only">{label}</span> : label}
    </button>
  );
  return (
    <div role="group" aria-label={w.label} className="flex shrink-0 items-center gap-0.5 self-start rounded-pill border border-edge p-0.5">
      {option("basic", 2, w.basic, w.basicTitle)}
      {option("advanced", 4, w.advanced, w.advancedTitle)}
    </div>
  );
}

/**
 * What Basic says while it is in force (D454): that this is the everyday view, how many pages it leaves out here (`hidden`, when known),
 * and one press to see them all. Nothing in Advanced, or outside a provider. `card` is the box for a page; the default sits at a
 * sidebar's foot.
 */
export function BasicViewHint({ hidden, card = false }: { hidden?: number; card?: boolean }) {
  const { view, setView, offered } = useAdminView();
  const w = useAdminText("shell").view;
  if (!offered || view !== "basic") return null;
  const more = hidden ? fillWords(w.more, { count: hidden }) : null;
  return (
    <div
      role="note"
      className={
        card
          ? "flex flex-col gap-3 rounded-card border border-dashed border-edge p-4 sm:flex-row sm:items-center sm:gap-4"
          : "flex flex-col gap-2 rounded-panel bg-sunken px-3 py-3"
      }
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-body-strong text-ink">{more ?? w.hintTitle}</p>
        <p className="text-caption text-ink-2">{w.hint}</p>
      </div>
      <button
        type="button"
        onClick={() => setView("advanced")}
        className={`inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-pill border border-edge bg-card px-3 text-ink hover:bg-sunken ${card ? "self-start text-sm sm:self-auto" : "w-full text-caption"}`}
      >
        <RowsIcon rows={4} />
        {card ? w.showAdvanced : w.showAdvancedShort}
      </button>
    </div>
  );
}
