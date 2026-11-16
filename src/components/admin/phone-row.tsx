"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Round 26 (D699): a part of a long settings page as one row on a phone (its name, what is chosen, Change), its content opening under it.
 * From the small breakpoint up the row is not there and the content shows as before, so the desktop page and its tests stay as they were.
 */
export function PhoneRow({
  id,
  title,
  sub,
  change,
  done,
  children,
  last = false,
  flat = false,
}: {
  title: string;
  sub?: ReactNode;
  change: string;
  done: string;
  children: ReactNode;
  last?: boolean;
  /** Content that is a card of its own: on a phone its frame is taken off, so it is not a card in a card. */
  flat?: boolean;
  /** The row's anchor: a link to `#id` (a strip's Post it) opens it and brings it into view. */
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!id) return;
    const follow = () => {
      if (window.location.hash !== `#${id}`) return;
      setOpen(true);
      requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "start" }));
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [id]);
  return (
    <div ref={ref} id={id} className={`scroll-mt-20 max-sm:bg-card max-sm:px-4 ${last ? "" : "max-sm:border-b max-sm:border-line"}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((shown) => !shown)} className="flex min-h-14 w-full items-center justify-between gap-3 py-2 text-left sm:hidden">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-body text-ink">{title}</span>
          {sub ? <span className="text-caption text-ink-2">{sub}</span> : null}
        </span>
        <span className="shrink-0 text-sm font-medium text-ink underline underline-offset-2">{open ? done : change}</span>
      </button>
      <div className={`${open ? "max-sm:pb-4" : "max-sm:hidden"} ${flat ? "max-sm:*:rounded-none max-sm:*:border-0 max-sm:*:bg-transparent max-sm:*:p-0 max-sm:*:shadow-none" : ""}`}>{children}</div>
    </div>
  );
}

/** The rows' card on a phone: one rounded card holding them; nothing from the small breakpoint up. */
export function PhoneRows({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-col gap-6 max-sm:gap-0 max-sm:overflow-hidden max-sm:rounded-panel max-sm:[&>*:last-child]:border-b-0 ${className}`}>{children}</div>;
}
