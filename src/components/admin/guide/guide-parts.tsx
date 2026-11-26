"use client";

import { fillWords } from "@/lib/admin-fill";
import type { GuideMessages } from "@/lib/admin-messages/guide.en";

import type { GuideHintPlace } from "./guide-slots";

/**
 * What Guide draws in its slots (D909, `guide-slots.tsx`): the rail's button, the phone's link and the hints in empty pages, drawn by its
 * runtime (`guide-runtime.tsx`) into the slots the server sent, so none of it is in a screen's first scripts.
 */
export type GuideShown = {
  found: number;
  total: number;
  button: GuideMessages["button"];
  panel: boolean;
  setPanel: (open: boolean) => void;
};

/** The compass Guide is drawn with: lucide's at the sections' stroke. */
export function GuideIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36z" />
    </svg>
  );
}

/**
 * Guide's tile at the foot of the rail: its name and how far the person is, read out as it is shown. In the rail's classes, so it adds no rule
 * to the stylesheet every page shares; the runtime leaves it out of a workspace tool's narrow rail.
 */
export function GuideRailButton({ shown }: { shown: GuideShown }) {
  const progress = fillWords(shown.button.progress, { found: shown.found, total: shown.total });
  return (
    <button
      type="button"
      data-guide="button"
      onClick={() => shown.setPanel(!shown.panel)}
      aria-expanded={shown.panel}
      className="group relative flex size-11 items-center justify-center rounded-tile text-rail-icon hover:bg-[color-mix(in_srgb,var(--rail),white_8%)] hover:text-[color-mix(in_srgb,var(--rail-icon),white_45%)] [[data-rail=names]_&]:w-full [[data-rail=names]_&]:justify-start [[data-rail=names]_&]:gap-3 [[data-rail=names]_&]:px-3"
    >
      <span style={{ color: "var(--brand)" }}>
        <GuideIcon />
      </span>
      {/* Named by its words, read as they are shown when the rail shows names (no label of its own to disagree with them, axe's rule). */}
      <span className="sr-only">{`${shown.button.label} ${progress}`}</span>
      <span aria-hidden className="hidden flex-1 truncate text-left text-body-strong [[data-rail=names]_&]:inline">
        {shown.button.label}
      </span>
      <span aria-hidden className="hidden text-caption tabular-nums [[data-rail=names]_&]:inline">
        {progress}
      </span>
      {shown.found < shown.total && (
        <span aria-hidden className="absolute top-2 right-2 size-2 rounded-pill bg-brand ring-2 ring-rail [[data-rail=names]_&]:hidden" />
      )}
    </button>
  );
}

/**
 * Guide in the phone's menu: a link, so the menu closes as it does for any link (`MobileMenu`), then the panel opens. It leads to `href`, the
 * level's Home.
 */
export function GuideMenuLink({ shown, href }: { shown: GuideShown; href: string }) {
  return (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        shown.setPanel(true);
      }}
      className="flex min-h-11 items-center gap-2 text-ink"
    >
      <span className="text-brand-text">
        <GuideIcon className="size-4" />
      </span>
      <span className="flex-1">{shown.button.label}</span>
      <span className="text-caption text-muted tabular-nums">{fillWords(shown.button.progress, { found: shown.found, total: shown.total })}</span>
    </a>
  );
}

/**
 * A hint inside an empty page (D909): a line and a few steps of what the person will do here, part of the page and in no budget. Gone once
 * the page has something in it (the page draws its slot only while empty) and while hints are switched off.
 */
export function GuideHint({ place, hints }: { place: GuideHintPlace; hints: GuideMessages["hints"] }) {
  const hint = hints[place];
  return (
    <div data-guide-hint={place} className="mt-4 flex w-full max-w-3xl flex-col items-center gap-4 text-left">
      <p className="inline-flex items-center gap-2 rounded-pill border border-insight-line bg-insight-soft px-4 py-2 text-body text-insight-text">
        <GuideIcon className="size-4" />
        <span>
          <span className="sr-only">{hints.lead}: </span>
          {hint.line}
        </span>
      </p>
      <ol className={`grid w-full gap-3 ${hint.steps.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        {hint.steps.map((step, i) => (
          <li key={step.title} className="flex flex-col gap-1.5 rounded-panel bg-sunken p-4">
            <span aria-hidden className="flex size-7 items-center justify-center rounded-pill bg-inverse text-caption text-inverse-ink tabular-nums">
              {i + 1}
            </span>
            <span className="text-body-strong text-ink">{step.title}</span>
            <span className="text-body text-ink-2">{step.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
