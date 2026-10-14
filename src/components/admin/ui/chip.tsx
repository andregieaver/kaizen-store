import type { ReactNode } from "react";

import type { Signal } from "@/lib/admin-schemes";

/**
 * Chips and badges (docs/admin-style.md 5.7). A chip names a state in a signal's tint and words, with its dot when it is a state;
 * a trend chip names a change, and its signal is what the change means (worse is `warning` or `danger`), never its direction, so
 * the arrow and the words always say which way. A count badge is a number beside a title, with words for screen readers.
 */

const CHIP: Record<Signal, string> = {
  positive: "bg-positive-soft text-positive-text",
  warning: "bg-warning-soft text-warning-text",
  danger: "bg-danger-soft text-danger-text",
  neutral: "bg-neutral-soft text-neutral-text",
  insight: "bg-insight-soft text-insight-text",
};

const DOT: Record<Signal, string> = {
  positive: "bg-positive-solid",
  warning: "bg-warning-solid",
  danger: "bg-danger-solid",
  neutral: "bg-neutral-solid",
  insight: "bg-insight-solid",
};

const PILL = "inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 text-chip";

export function chipClass(signal: Signal = "neutral"): string {
  return `${PILL} ${CHIP[signal]}`;
}

/** The dot's colour: a signal's bright fill, for a chip, a share bar and a legend. */
export function dotClass(signal: Signal): string {
  return DOT[signal];
}

export function Chip({ signal = "neutral", dot = false, children }: { signal?: Signal; dot?: boolean; children: ReactNode }) {
  return (
    <span className={chipClass(signal)}>
      {dot && <span aria-hidden className={`size-1.5 rounded-full ${DOT[signal]}`} />}
      {children}
    </span>
  );
}

const ARROW = { up: "↑", down: "↓", flat: "→" } as const;

/** "↑ Up 11 since June": the words carry the change; the arrow repeats which way. */
export function TrendChip({ direction, signal, children }: { direction: keyof typeof ARROW; signal: Signal; children: ReactNode }) {
  return (
    <span className={chipClass(signal)}>
      <span aria-hidden>{ARROW[direction]}</span>
      {children}
    </span>
  );
}

/** "4" beside "Open invoices"; `label` is what the number counts, read in place of the bare number ("4 open"). */
export function CountBadge({ count, label }: { count: number; label?: string }) {
  return (
    <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-pill bg-sunken px-1.5 text-caption text-ink-2 tabular-nums">
      <span aria-hidden={label ? true : undefined}>{count}</span>
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}
