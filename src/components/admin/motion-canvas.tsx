"use client";

import { useEffect, useId, type RefObject } from "react";

import { partFx, type FxProps } from "@/lib/motion-attrs";
import { initMotion } from "@/lib/motion-runtime";
import type { BackgroundMotion, EnterMotion, MotionTarget, PartMotion } from "@/lib/motion";
import { REDUCED_NOTE, useReducedMotion } from "./motion-fields";

/**
 * The canvas's motion preview (D128): off, the canvas draws exactly as it always did; on, rows, columns, components
 * and backgrounds carry the same attributes and styles the site gives them, with every entrance playing at once, and the
 * small runtime runs over the canvas (pointer effects, waypoints, text splitting).
 */

export const NO_FX: FxProps = { attrs: {}, style: {} };

export type CanvasFxOptions = {
  firstRow?: boolean;
  image?: boolean;
  index?: number;
  parentStagger?: number;
  /** The parent's entrance, which a child with none of its own takes when the parent staggers. */
  parentEnter?: EnterMotion;
};

/** A part's attributes and styles for the canvas: none unless the preview is on. */
export function canvasFx(
  on: boolean,
  motion: PartMotion | undefined,
  target: MotionTarget,
  options: CanvasFxOptions = {},
): FxProps {
  // A part with no motion of its own may still take part in its parent's stagger, so the renderer decides.
  if (!on) return NO_FX;
  return partFx(motion, target, { ...options, preview: true });
}

/** What a background is given to move by the preview; nothing when it is off. */
export function canvasBackground(
  on: boolean,
  motion: BackgroundMotion | undefined,
  firstRow = false,
): { motion?: BackgroundMotion; firstRow?: boolean; preview?: boolean } {
  return on ? { motion, firstRow, preview: true } : {};
}

/** Runs the motion runtime over the canvas while the preview is on, and again when the motion on the page changes. */
export function useCanvasMotion(ref: RefObject<HTMLElement | null>, on: boolean, signature: string, run: number) {
  useEffect(() => {
    const canvas = ref.current;
    if (!on || !canvas) return;
    return initMotion(canvas);
  }, [ref, on, signature, run]);
}

/** The switch above the canvas: "Preview motion", with a Replay button while it is on. */
export function MotionPreviewToggle({
  on,
  onChange,
  onReplay,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  onReplay: () => void;
}) {
  const reduced = useReducedMotion();
  const help = useId();
  return (
    <div role="toolbar" aria-label="Canvas" className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        aria-describedby={help}
        className="flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-sm aria-checked:border-foreground aria-checked:bg-surface aria-checked:font-medium"
      >
        <span
          aria-hidden
          className={`flex h-4 w-7 items-center rounded-full p-0.5 ${on ? "justify-end bg-foreground" : "justify-start bg-border"}`}
        >
          <span className="size-3 rounded-full bg-background" />
        </span>
        Preview motion
      </button>
      {on && (
        <button type="button" onClick={onReplay} className="min-h-9 rounded-md border border-border px-3 text-sm">
          Replay
        </button>
      )}
      <p id={help} className="text-xs text-muted">
        {reduced
          ? REDUCED_NOTE
          : "Plays the effects on the canvas. Parts with effects show a wave in their tools. Visitors who prefer less motion see none."}
      </p>
    </div>
  );
}

/** The little wave in a part's tools that says it has motion (`hasMotion`). */
export function MotionMark() {
  return (
    <span title="Has motion effects" className="ml-1 inline-flex items-center align-middle">
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      >
        <path d="M2 12c3-7 6-7 10 0s7 7 10 0" />
      </svg>
      <span className="sr-only">Has motion effects</span>
    </span>
  );
}
