"use client";

import { useId, useState } from "react";

import { BOUND_PICTURE_SIZE, IMAGE_WIDTH_MIN, imageDisplaySize, type ImageBlock } from "@/lib/page-content";
import type { BlockPatch } from "@/lib/page-rows";

import { TextAlignFields } from "./block-fields";

/**
 * A picture's width and position (D151), on its Style tab. A picture is drawn at its own size and never larger; Width makes it
 * narrower, in pixels, and Position says where it sits when it is narrower than its column. What is stored is only what differs
 * from the picture's own size and from the left, so a picture left alone keeps no setting.
 */

/** What to store for a wish: nothing at or above the picture's own size (the key goes), else no less than the floor. */
export function widthPatch(px: number, natural: number, min: number): number | undefined {
  if (!Number.isFinite(px)) return undefined;
  const whole = Math.round(px);
  return whole >= natural ? undefined : Math.max(min, whole);
}

export function ImageSizeFields({ block, onChange }: { block: ImageBlock; onChange: (patch: BlockPatch<ImageBlock>) => void }) {
  const id = useId();
  const hintId = `${id}-hint`;
  // A block bound to a field shows the field's picture, whose size is not known here: its limit is the stand-in's, whatever
  // picture the block keeps of its own for when the field is empty.
  const bound = Boolean(block.bind);
  const own = bound ? { url: "", ...BOUND_PICTURE_SIZE, alt: "" } : block.image;
  const natural = own ? imageDisplaySize({ image: own, shape: block.shape }) : null;
  const shown = own ? imageDisplaySize({ image: own, shape: block.shape, maxWidth: block.maxWidth }) : null;
  const min = natural ? Math.min(IMAGE_WIDTH_MIN, natural.width) : IMAGE_WIDTH_MIN;
  const tooSmall = natural !== null && natural.width <= IMAGE_WIDTH_MIN;
  const [draft, setDraft] = useState<string | null>(null);
  const set = (px: number) => natural && onChange({ maxWidth: widthPatch(px, natural.width, min) });
  // A typed number is kept as soon as it is a width the picture can have; one still being typed (too small) waits for the
  // field to be left, so closing the dialog straight after typing loses nothing.
  const typed = (text: string) => {
    const digits = text.replace(/[^\d]/g, "");
    setDraft(digits);
    const wanted = Number(digits);
    if (digits !== "" && natural && wanted >= min && wanted <= natural.width) set(wanted);
  };
  const commit = () => {
    if (draft === null) return;
    const wanted = draft.trim() === "" ? Number.NaN : Number(draft);
    setDraft(null);
    // A width already kept as it was typed is not written again.
    if (Number.isFinite(wanted) && natural && widthPatch(wanted, natural.width, min) !== block.maxWidth) set(wanted);
  };

  return (
    <div className="flex flex-col gap-5">
      <fieldset disabled={!natural || tooSmall} className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Width</legend>
        <div className="flex min-h-10 flex-wrap items-center gap-3">
          <input
            id={`${id}-range`}
            aria-label="Width in pixels"
            type="range"
            min={min}
            max={natural?.width ?? min}
            step={1}
            value={shown?.width ?? min}
            onChange={(event) => set(Number(event.target.value))}
            aria-describedby={hintId}
            aria-valuetext={shown ? `${shown.width} pixels wide` : undefined}
            className="w-48"
          />
          <output htmlFor={`${id}-range`} className="w-16 text-sm tabular-nums">
            {shown ? `${shown.width} px` : "—"}
          </output>
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">Width in pixels, typed</span>
            <input
              type="text"
              inputMode="numeric"
              value={draft ?? (shown ? String(shown.width) : "")}
              onChange={(event) => typed(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commit();
                }
              }}
              aria-describedby={hintId}
              className="min-h-10 w-20 rounded-md border border-border bg-background px-3 text-sm tabular-nums"
            />
            <span className="text-muted">pixels</span>
          </label>
          <button
            type="button"
            onClick={() => onChange({ maxWidth: undefined })}
            disabled={block.maxWidth === undefined}
            className="min-h-10 rounded-md border border-border px-3 text-sm hover:bg-surface disabled:opacity-50"
          >
            Own size
          </button>
        </div>
        <p id={hintId} className="text-xs text-muted">
          {!natural
            ? "Add a picture on the General tab to set its width."
            : tooSmall
              ? "This picture is too small to make smaller."
              : `${block.shape ? "Own size with this shape" : "Own size"}: ${natural.width} × ${natural.height} pixels. A picture is never shown larger than that, and in a narrower column or on a phone it shrinks to fit.${bound ? " A picture from a field is limited to 1600 pixels wide here." : ""}`}
        </p>
      </fieldset>
      <div className="flex flex-col gap-2">
        <TextAlignFields what="Position" value={block} onChange={onChange} />
        <p className="text-xs text-muted">Where the picture sits when it is narrower than its column. A left or right margin set under Spacing takes the place of this, so leave those at 0.</p>
      </div>
    </div>
  );
}
