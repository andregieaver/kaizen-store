/** A carousel's round buttons (D155): the arrows and the Pause/Play button. */
export const ARROW =
  "flex size-10 items-center justify-center rounded-full border border-border bg-background shadow-sm transition hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-0";
export const ICON = { "aria-hidden": true, viewBox: "0 0 24 24", className: "size-5", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/**
 * A carousel's Previous and Next arrows: drawn by the frame (`carousel.tsx`) as the server draws them, Previous off and Next on,
 * until the controls' script is here (a press is then kept by the frame and made by the controls as they arrive), and by the controls (`carousel-controls.tsx`) after, which say
 * which way the row can go and move it.
 */
export function CarouselArrows({
  previous,
  next,
  canPrev = false,
  canNext = true,
  onPrev,
  onNext,
}: {
  previous: string;
  next: string;
  canPrev?: boolean;
  canNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  return (
    <div className="ml-auto flex gap-2">
      <button type="button" onClick={onPrev} disabled={!canPrev} aria-label={previous} className={ARROW}>
        <svg {...ICON}>
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <button type="button" onClick={onNext} disabled={!canNext} aria-label={next} className={ARROW}>
        <svg {...ICON}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
    </div>
  );
}
