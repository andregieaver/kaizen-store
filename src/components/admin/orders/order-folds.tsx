"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * A fold that opens itself when the address points at it or at something inside it (round 1, D595): the order's *Refund or cancel* is kept
 * out of the way, and the header's menu links to it (`#refund-cancel`, `#refund`, `#cancel`).
 */
export function FoldOnHash({ id, summary, hint, children }: { id: string; summary: string; hint?: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const open = () => {
      const hash = window.location.hash.slice(1);
      const element = ref.current;
      if (!element || !hash) return;
      const target = document.getElementById(hash);
      if (target && (target === element || element.contains(target))) {
        element.open = true;
        target.scrollIntoView({ block: "start" });
      }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return (
    <details ref={ref} id={id} data-advanced className="group flex flex-col gap-4">
      <summary className="flex cursor-pointer list-none items-start gap-3 rounded-card bg-card p-5 marker:hidden [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 transition-transform group-open:rotate-90" />
        <span className="flex flex-col gap-0.5">
          <span className="text-body-strong text-ink">{summary}</span>
          {hint && <span className="text-caption text-muted">{hint}</span>}
        </span>
      </summary>
      <div className="mt-4 flex flex-col gap-6">{children}</div>
    </details>
  );
}

/** The header's menu (round 1): the order's rarer actions behind one button, closed again by a press outside or Escape. */
export function MoreMenu({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent | KeyboardEvent) => {
      const element = ref.current;
      if (!element?.open) return;
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !element.contains(event.target as Node)) element.open = false;
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <details ref={ref} className="relative">
      <summary className="inline-flex h-11 cursor-pointer list-none items-center gap-2 rounded-pill border border-edge bg-card px-4 text-body text-ink hover:bg-sunken [&::-webkit-details-marker]:hidden">
        {label}
        <ChevronDown aria-hidden className="size-4" />
      </summary>
      <div className="absolute right-0 z-30 mt-2 flex w-72 max-w-[calc(100vw-2rem)] flex-col items-stretch gap-2 rounded-panel border border-line bg-card p-3 shadow-[var(--shadow-float)] [&>*]:w-full">
        {children}
      </div>
    </details>
  );
}
