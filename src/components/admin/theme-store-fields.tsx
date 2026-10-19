"use client";

import { useId } from "react";

import type { ThemeStoreBlock } from "@/lib/page-content";
import type { BlockPatch } from "@/lib/page-rows";
import { THEME_PART_HEADING_MAX, THEME_PART_TEXT_MAX, THEME_STORE_PART_COPY } from "@/lib/theme-store-parts";

/**
 * A theme store component in the page builder (D285): its settings (the heading and line it draws, where it takes them) and its stand-in
 * on the canvas, which reads no themes. The themes themselves are edited on Themes; a change there shows on the page at once.
 */

const input = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

export function ThemeStoreFields({ block, onChange }: { block: ThemeStoreBlock; onChange: (patch: BlockPatch<ThemeStoreBlock>) => void }) {
  const id = useId();
  const copy = THEME_STORE_PART_COPY[block.part];
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">{copy.hint}</p>
      {copy.heading !== undefined && (
        <label htmlFor={`${id}-heading`} className="flex flex-col gap-1 text-sm font-medium">
          Heading
          <input
            id={`${id}-heading`}
            value={block.heading ?? ""}
            maxLength={THEME_PART_HEADING_MAX}
            onChange={(event) => onChange({ heading: event.target.value })}
            className={input}
          />
          <span className="text-xs font-normal text-muted">Shown only when there is something under it. Leave it empty for none.</span>
        </label>
      )}
      {copy.text !== undefined && (
        <label htmlFor={`${id}-text`} className="flex flex-col gap-1 text-sm font-medium">
          Line under it
          <textarea
            id={`${id}-text`}
            rows={2}
            value={block.text ?? ""}
            maxLength={THEME_PART_TEXT_MAX}
            onChange={(event) => onChange({ text: event.target.value })}
            className="rounded-md border border-line bg-card px-3 py-2 font-normal"
          />
          <span className="text-xs font-normal text-muted">{"{theme} becomes the theme's name. Leave it empty for none."}</span>
        </label>
      )}
      <p className="text-sm text-muted">The themes, their pictures and their words are edited on Themes; a change there shows here at once.</p>
    </div>
  );
}

/** On the canvas: what the component draws, with its own heading, as the canvas reads no themes. */
export function ThemeStoreStandIn({ block }: { block: ThemeStoreBlock }) {
  const copy = THEME_STORE_PART_COPY[block.part];
  return (
    <div className="rounded-md border border-dashed border-edge bg-sunken p-4 text-sm">
      {block.heading && <p className="mb-2 text-title text-ink">{block.heading}</p>}
      <p className="font-medium">Theme store: {copy.name}</p>
      <p className="text-xs text-muted">{copy.hint}</p>
      {block.text && <p className="mt-2 text-muted">{block.text}</p>}
    </div>
  );
}

export function ThemeStoreIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-inverse text-inverse-ink">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M7 8h4M7 11h7" />
        <circle cx="17" cy="9.5" r="1.5" />
      </svg>
    </span>
  );
}
