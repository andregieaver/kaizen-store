import type { ReactNode } from "react";

/**
 * The parts of a rich text's formatting bar that every editor shares (the page builder's `RichTextToolbar` and a contract's
 * `ContractTextEditor`, D856): a pressed-or-not button that keeps the text selected while it is used, and the list icons. No state.
 */

const tool =
  "flex min-h-9 min-w-9 items-center justify-center rounded px-2 text-sm hover:bg-sunken aria-pressed:bg-inverse aria-pressed:text-inverse-ink disabled:opacity-40";

/** A button of the bar: its name is its label and title; `pressed` undefined for one that is not a toggle. */
export function toolButton(name: string, pressed: boolean | undefined, run: () => void, children: ReactNode, disabled = false) {
  return (
    <button
      type="button"
      title={name}
      aria-label={name}
      aria-pressed={pressed}
      disabled={disabled}
      // Keep the text selected while the toolbar is used.
      onMouseDown={(event) => event.preventDefault()}
      onClick={run}
      className={tool}
    >
      {children}
    </button>
  );
}

const svg = "size-4";
export const ListIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden className={svg} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
  </svg>
);
export const NumberedIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden className={svg} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M10 6h10M10 12h10M10 18h10M4 5l1-1v4M4 14h2l-2 3h2" />
  </svg>
);
