"use client";

import { useId, useState } from "react";

import { BOUND_PICTURE_SIZE, IMAGE_WIDTH_MIN, imageDisplaySize, type ImageBlock } from "@/lib/page-content";
import type { BlockPatch } from "@/lib/page-rows";
import { setAt, sizeSource, valueAt } from "@/lib/responsive";
import { fillWords } from "@/lib/admin-fill";

import { useAdminText } from "./admin-text";

import { TextAlignFields } from "./block-fields";
import { SizeMark, inheritedClass, useSizeEdit } from "./responsive-edit";

/**
 * A picture's width and position (D151), on its Style tab. A picture is drawn at its own size and never larger; Width makes it
 * narrower, in pixels, and Position says where it sits when it is narrower than its column. What is stored is only what differs
 * from the picture's own size and from the left, so a picture left alone keeps no setting. Both can differ by screen size
 * (D179): they edit the size the builder is at, and below Extra large a width set larger can be given back or made the own
 * size there.
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
  const w = useAdminText("blocks").imageSize;
  // A block bound to a field shows the field's picture, whose size is not known here: its limit is the stand-in's, whatever
  // picture the block keeps of its own for when the field is empty.
  const bound = Boolean(block.bind);
  const own = bound ? { url: "", ...BOUND_PICTURE_SIZE, alt: "" } : block.image;
  const { size } = useSizeEdit();
  const maxWidth = valueAt(block, "maxWidth", size) ?? undefined;
  const source = sizeSource(block, size, "maxWidth");
  const natural = own ? imageDisplaySize({ image: own, shape: block.shape }) : null;
  const shown = own ? imageDisplaySize({ image: own, shape: block.shape, maxWidth }) : null;
  const min = natural ? Math.min(IMAGE_WIDTH_MIN, natural.width) : IMAGE_WIDTH_MIN;
  const tooSmall = natural !== null && natural.width <= IMAGE_WIDTH_MIN;
  const [draft, setDraft] = useState<string | null>(null);
  const write = (value: number | undefined) => onChange(setAt(block, size, { maxWidth: value }));
  const set = (px: number) => natural && write(widthPatch(px, natural.width, min));
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
    if (Number.isFinite(wanted) && natural && widthPatch(wanted, natural.width, min) !== maxWidth) set(wanted);
  };

  return (
    <div className="flex flex-col gap-5">
      <fieldset disabled={!natural || tooSmall} className={`flex flex-col gap-2 ${inheritedClass(source, size)}`}>
        <legend className="text-sm font-medium">
          {w.width}
          <SizeMark part={block} field="maxWidth" label={w.width} onPatch={onChange} />
        </legend>
        <div className="flex min-h-10 flex-wrap items-center gap-3">
          <input
            id={`${id}-range`}
            aria-label={w.inPixels}
            type="range"
            min={min}
            max={natural?.width ?? min}
            step={1}
            value={shown?.width ?? min}
            onChange={(event) => set(Number(event.target.value))}
            aria-describedby={hintId}
            aria-valuetext={shown ? fillWords(w.wide, { n: shown.width }) : undefined}
            className="w-48"
          />
          <output htmlFor={`${id}-range`} className="w-16 text-sm tabular-nums">
            {shown ? fillWords(w.px, { n: shown.width }) : "—"}
          </output>
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">{w.typed}</span>
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
              className="min-h-10 w-20 rounded-md border border-line bg-card px-3 text-sm tabular-nums"
            />
            <span className="text-muted">{w.pixels}</span>
          </label>
          <button
            type="button"
            onClick={() => write(undefined)}
            disabled={maxWidth === undefined}
            className="min-h-10 rounded-pill border border-edge px-3 text-sm hover:bg-sunken disabled:opacity-50"
          >
            {w.own}
          </button>
        </div>
        <p id={hintId} className="text-xs text-muted">
          {!natural
            ? w.addPicture
            : tooSmall
              ? w.tooSmall
              : `${fillWords(w.natural, { own: block.shape ? w.ownShape : w.own, w: natural.width, h: natural.height })}${bound ? w.bound : ""}`}
        </p>
      </fieldset>
      <div className="flex flex-col gap-2">
        <TextAlignFields what={w.position} value={block} onChange={onChange} />
        <p className="text-xs text-muted">{w.positionHint}</p>
      </div>
    </div>
  );
}
