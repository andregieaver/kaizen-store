"use client";

import { useState, type ReactNode } from "react";

import { browserText as t } from "@/lib/browser-text";

import { usePageLanguage } from "./page-language";

/**
 * A Before and after on the site (D413): the before picture, the after picture over it showing right of the slider, and a line with a handle
 * at the slider. The slider is the browser's own range input, laid over the whole picture and unseen: a press or a drag anywhere moves it,
 * the arrow keys move it a step, Home and End to an edge, and a screen reader hears what it is and how much of each picture shows. The
 * words on the pictures are the owner's, or the visitor's language's "Before" and "After".
 */
export function BeforeAfterSlider({
  before,
  after,
  start,
  beforeLabel,
  afterLabel,
  hideLabels,
  children,
}: {
  before: ReactNode;
  after: ReactNode;
  /** Where the slider starts, in percent from the left. */
  start: number;
  beforeLabel?: string;
  afterLabel?: string;
  hideLabels?: boolean;
  /** What shows while the script loads after a client navigation: the before picture. */
  children?: ReactNode;
}) {
  const m = t(usePageLanguage()).beforeAfter;
  const [at, setAt] = useState(start);
  const words = (own: string | undefined, fallback: string) => (own?.trim() ? own : fallback);
  return (
    <div className="kz-before-after relative isolate h-full w-full select-none overflow-hidden" data-before-after="">
      {children ?? before}
      <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${at}%)` }} data-before-after-after="">
        {after}
      </div>
      {!hideLabels && (
        <>
          <span data-kz-text="caption" className="pointer-events-none absolute top-3 left-3 rounded-pill bg-black/60 px-2.5 py-1 text-xs font-medium text-white">
            {words(beforeLabel, m.before)}
          </span>
          <span data-kz-text="caption" className="pointer-events-none absolute top-3 right-3 rounded-pill bg-black/60 px-2.5 py-1 text-xs font-medium text-white">
            {words(afterLabel, m.after)}
          </span>
        </>
      )}
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={at}
        onChange={(event) => setAt(Number(event.target.value))}
        aria-label={m.slider}
        aria-valuetext={m.position(at)}
        className="peer absolute inset-0 m-0 h-full w-full cursor-ew-resize touch-pan-y opacity-0"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_4px_rgb(0_0_0/0.5)] peer-focus-visible:*:outline-2 peer-focus-visible:*:outline-offset-0 peer-focus-visible:*:outline-black peer-focus-visible:*:shadow-[0_0_0_4px_white]"
        style={{ left: `${at}%` }}
      >
        <span className="absolute top-1/2 left-1/2 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-black shadow-md">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 7-5 5 5 5" />
            <path d="m15 7 5 5-5 5" />
          </svg>
        </span>
      </span>
    </div>
  );
}
