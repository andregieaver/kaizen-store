"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Round 26 (D699): a part of a long settings page as one row on a phone (its name, what is chosen, Change), its content opening under it.
 * From the small breakpoint up the row is not there and the content shows as before, so the desktop page and its tests stay as they were.
 */
export function PhoneRow({
  id,
  opens,
  action,
  title,
  sub,
  change,
  done,
  children,
  last = false,
  flat = false,
  inset = false,
}: {
  title: string;
  sub?: ReactNode;
  change: string;
  done: string;
  children: ReactNode;
  last?: boolean;
  /** Content that is a card of its own: on a phone its frame is taken off, so it is not a card in a card. */
  flat?: boolean;
  /** A row inside a card that already has its frame and padding (round 32, D706): no card colour or padding of its own. */
  inset?: boolean;
  /** The row's anchor: a link to `#id` (a strip's Post it) opens it and brings it into view. */
  id?: string;
  /** Another anchor that opens it too: the id of a section inside, which older links name (round 27, D700). */
  opens?: string;
  /** One press on the row itself on a phone, beside Change (a switch that is off: Turn on). */
  action?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!id && !opens) return;
    const follow = () => {
      const hash = window.location.hash;
      if (hash !== `#${id}` && hash !== `#${opens}`) return;
      setOpen(true);
      requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "start" }));
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [id, opens]);
  return (
    <div ref={ref} id={id} className={`scroll-mt-20 ${inset ? "" : "max-sm:bg-card max-sm:px-4"} ${last ? "" : "max-sm:border-b max-sm:border-line"}`}>
      <div className="flex items-center gap-3 sm:hidden">
        <button type="button" aria-expanded={open} onClick={() => setOpen((shown) => !shown)} className="flex min-h-14 min-w-0 flex-1 items-center justify-between gap-3 py-2 text-left">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-body text-ink">{title}</span>
            {sub ? <span className="text-caption text-ink-2">{sub}</span> : null}
          </span>
          {/* A row with its own press (Turn on) keeps only that; the row still opens its explanation. */}
          <span className={`shrink-0 text-sm font-medium text-ink underline underline-offset-2 ${action && !open ? "sr-only" : ""}`}>{open ? done : change}</span>
        </button>
        {action && !open ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className={`${open ? "max-sm:pb-4" : "max-sm:hidden"} ${flat ? "max-sm:*:rounded-none max-sm:*:border-0 max-sm:*:bg-transparent max-sm:*:p-0 max-sm:*:shadow-none" : ""}`}>{children}</div>
    </div>
  );
}

/** The rows' card on a phone: one rounded card holding them; nothing from the small breakpoint up. */
export function PhoneRows({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-col gap-6 max-sm:gap-0 max-sm:overflow-hidden max-sm:rounded-panel max-sm:[&>*:last-child]:border-b-0 ${className}`}>{children}</div>;
}
