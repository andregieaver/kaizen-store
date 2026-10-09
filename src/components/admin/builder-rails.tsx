"use client";

import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";

/**
 * The builder's two sidebars can be folded away to leave the canvas more room (D125): a slim rail with a button to open
 * one again. Each side's choice is kept in this browser, and only there; both start open, and the page works the same
 * where storage is blocked (the choice then lasts until the page is left).
 */

export type RailSide = "left" | "right";

export const RAIL_KEYS: Record<RailSide, string> = {
  left: "kaizen_admin_builder_left",
  right: "kaizen_admin_builder_right",
};

/** The stored word for a folded sidebar; anything else, or nothing, is open. */
export const FOLDED = "folded";

const listeners = new Set<() => void>();
/** This page's own memory of the choices, for where storage is missing; a `storage` event from another tab clears it. */
const memory: Partial<Record<RailSide, boolean>> = {};

/** Whether a stored value means folded. */
export const isFolded = (value: string | null): boolean => value === FOLDED;

function readFolded(side: RailSide): boolean {
  const known = memory[side];
  if (known !== undefined) return known;
  try {
    return isFolded(window.localStorage.getItem(RAIL_KEYS[side]));
  } catch {
    return false;
  }
}

function writeFolded(side: RailSide, folded: boolean): void {
  memory[side] = folded;
  try {
    if (folded) window.localStorage.setItem(RAIL_KEYS[side], FOLDED);
    else window.localStorage.removeItem(RAIL_KEYS[side]);
  } catch {
    /* kept for this page only */
  }
  listeners.forEach((listener) => listener());
}

function subscribe(changed: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    // Another tab chose: what it stored is the truth again.
    for (const side of ["left", "right"] as const)
      if (event.key === null || event.key === RAIL_KEYS[side]) delete memory[side];
    changed();
  };
  listeners.add(changed);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(changed);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Whether a sidebar is folded, and a way to change it. The server and the first draw in the browser show it open; the
 * browser's own choice follows at once after.
 */
export function useFolded(side: RailSide): [boolean, (folded: boolean) => void] {
  const folded = useSyncExternalStore(
    subscribe,
    () => readFolded(side),
    () => false,
  );
  const set = useCallback((next: boolean) => writeFolded(side, next), [side]);
  return [folded, set];
}

const ICONS = {
  left: { fold: PanelLeftClose, open: PanelLeftOpen },
  right: { fold: PanelRightClose, open: PanelRightOpen },
} as const;

/** The button in an open sidebar's header that folds it away. */
export function FoldButton({
  side,
  label,
  controls,
  onFold,
}: {
  side: RailSide;
  label: string;
  controls: string;
  onFold: () => void;
}) {
  const Icon = ICONS[side].fold;
  const text = `Hide ${label}`;
  return (
    <button
      type="button"
      onClick={onFold}
      aria-label={text}
      title={text}
      aria-expanded
      aria-controls={controls}
      className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-foreground"
    >
      <Icon aria-hidden className="size-5" />
    </button>
  );
}

/**
 * What stands in a sidebar's place while it is folded: a narrow bar down the side of the page, and on phones, where the
 * sidebars stack, a full-width button with its words.
 */
export function Rail({
  side,
  label,
  controls,
  onOpen,
  className = "",
}: {
  side: RailSide;
  label: string;
  controls: string;
  onOpen: () => void;
  className?: string;
}) {
  const Icon = ICONS[side].open;
  const text = `Show ${label}`;
  return (
    <div
      className={`rounded-lg border border-border bg-background lg:sticky lg:top-4 lg:flex lg:justify-center lg:py-1 ${className}`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={text}
        title={text}
        aria-expanded={false}
        aria-controls={controls}
        className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm font-medium hover:bg-surface lg:size-9 lg:min-h-0 lg:w-auto lg:justify-center lg:rounded-md lg:px-0"
      >
        <Icon aria-hidden className="size-5 shrink-0" />
        <span className="lg:hidden">{text}</span>
      </button>
    </div>
  );
}

/** The header of an open sidebar: what it is, and the button that folds it. */
export function RailHeader({
  side,
  label,
  controls,
  onFold,
}: {
  side: RailSide;
  label: string;
  controls: string;
  onFold: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-xs font-medium tracking-wide text-muted uppercase">{label}</h2>
      <FoldButton side={side} label={label} controls={controls} onFold={onFold} />
    </div>
  );
}

/**
 * The columns of the builder for what is folded. Written out in full so Tailwind finds them: the side that is folded is a
 * narrow column, and the canvas keeps its share of what is left (twice the open sidebar's).
 */
export function railColumns(leftFolded: boolean, rightFolded: boolean): string {
  if (leftFolded && rightFolded) return "lg:grid-cols-[2.75rem_minmax(0,1fr)_2.75rem]";
  if (leftFolded) return "lg:grid-cols-[2.75rem_minmax(0,2fr)_minmax(0,1fr)]";
  if (rightFolded) return "lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_2.75rem]";
  return "lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]";
}

/**
 * The header of an open sidebar that holds more than one thing (the page builder's Building blocks and Theme): the
 * choices as tabs where its name would be, and the button that folds it. The panels are the caller's, each told by
 * `aria-controls`.
 */
export function RailTabsHeader<K extends string>({
  side,
  label,
  controls,
  onFold,
  tabs,
  value,
  onChange,
}: {
  side: RailSide;
  /** What the sidebar is called when it is folded or unfolded. */
  label: string;
  controls: string;
  onFold: () => void;
  tabs: readonly { key: K; label: string; panel: string }[];
  value: K;
  onChange: (key: K) => void;
}) {
  const select = (index: number) => {
    const next = tabs[(index + tabs.length) % tabs.length];
    onChange(next.key);
    document.getElementById(`${controls}-head-${next.key}`)?.focus();
  };
  return (
    <div className="flex items-center justify-between gap-2">
      <div role="tablist" aria-label={label} className="flex items-center gap-4">
        {tabs.map((tab, index) => (
          <button
            key={tab.key}
            id={`${controls}-head-${tab.key}`}
            type="button"
            role="tab"
            aria-selected={value === tab.key}
            aria-controls={tab.panel}
            tabIndex={value === tab.key ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") select(index + 1);
              if (event.key === "ArrowLeft") select(index - 1);
            }}
            className="min-h-9 border-b-2 border-transparent text-xs font-medium tracking-wide text-muted uppercase aria-selected:border-foreground aria-selected:text-foreground"
          >
            {tab.label}
          </button>
        ))}
      </div>
      <FoldButton side={side} label={label} controls={controls} onFold={onFold} />
    </div>
  );
}
