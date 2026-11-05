"use client";

import { Rows2, Rows4 } from "lucide-react";
import { createContext, useContext, useState, useTransition, type ReactNode } from "react";

import { fillWords } from "@/lib/admin-fill";
import type { AdminView } from "@/lib/admin-view";

import { useAdminText } from "./admin-text";

/**
 * Basic and Advanced (D454, `src/lib/admin-view.ts`): the person's choice, held for a store's admin by `AdminViewProvider` so the sidebar,
 * the phone's menu and the pages of cards follow it at once, and kept on their account by `save` without drawing the page again. Outside a
 * provider (the platform, the owner's level) nothing is hidden and nothing is said about it.
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
 * The switch between the two views: both named, the one in force marked, so what it does is read rather than guessed. `compact` keeps to
 * the icons below `xl`, for the top bar; the names are still each button's accessible name and title.
 */
export function AdminViewToggle({ compact = false }: { compact?: boolean }) {
  const { view, setView, offered } = useAdminView();
  const w = useAdminText("shell").view;
  if (!offered) return null;
  const option = (value: AdminView, Icon: typeof Rows2, label: string, title: string) => (
    <button
      type="button"
      aria-pressed={view === value}
      title={title}
      onClick={() => setView(value)}
      className="flex min-h-9 items-center gap-1.5 rounded-pill px-3 text-sm text-ink-2 hover:text-ink aria-pressed:bg-inverse aria-pressed:text-inverse-ink"
    >
      <Icon aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
      <span className={compact ? "sr-only xl:not-sr-only" : ""}>{label}</span>
    </button>
  );
  return (
    <div role="group" aria-label={w.label} className="flex shrink-0 items-center gap-0.5 self-start rounded-pill border border-edge p-0.5">
      {option("basic", Rows2, w.basic, w.basicTitle)}
      {option("advanced", Rows4, w.advanced, w.advancedTitle)}
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
        <Rows4 aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
        {card ? w.showAdvanced : w.showAdvancedShort}
      </button>
    </div>
  );
}
