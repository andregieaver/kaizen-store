import type { CSSProperties } from "react";

import { snapAttribute, type CarouselSettings } from "@/lib/carousel-settings";
import type { TestimonialColumns, TestimonialLook } from "@/lib/page-content";

import { Carousel } from "./carousel";
import { StarRating } from "./star-rating";
import { Inline } from "@/components/inline-text";

/** One testimonial as drawn: written in by the owner, or a Google review. */
export type TestimonialEntry = {
  key: string;
  quote: string;
  name: string;
  role?: string;
  rating?: number;
  picture?: string | null;
  /** Where the name links: a Google reviewer's profile. */
  nameHref?: string;
};

/**
 * The columns at each screen size (D179): one on Small, at most two on Medium, all from Large. A testimonials component's
 * own rules set `--grid-cols` by the store's screen sizes (`blockStyle()`), over these classes (the window's default sizes).
 */
const COLUMNS: Record<TestimonialColumns, string> = {
  1: "",
  2: "md:[--grid-cols:2]",
  3: "md:[--grid-cols:2] lg:[--grid-cols:3]",
  4: "md:[--grid-cols:2] lg:[--grid-cols:4]",
};
const LOOKS: Record<TestimonialLook, string> = {
  cards: "rounded-lg border border-border bg-background p-5 shadow-sm",
  plain: "",
  quote: "",
};

/**
 * Testimonials (D91) side by side in up to four columns, one on phones:
 * each a figure with what was said as its quote and who said it as its
 * caption, their stars read out as words.
 */
export function TestimonialCards({
  entries,
  columns = 3,
  look = "cards",
  showRating = true,
  carousel = false,
  carouselSettings,
}: {
  entries: TestimonialEntry[];
  columns?: TestimonialColumns;
  look?: TestimonialLook;
  showRating?: boolean;
  /** In a row that scrolls sideways, the columns as many to a screen. */
  carousel?: boolean;
  /** What the carousel does besides scrolling (D155): arrows only unless set. */
  carouselSettings?: CarouselSettings;
}) {
  const list = (
    <div
      data-carousel-track={carousel ? "" : undefined}
      data-snap={carousel ? snapAttribute(carouselSettings) : undefined}
      data-testimonial-list=""
      className={carousel ? undefined : `grid grid-cols-[repeat(var(--grid-cols,1),minmax(0,1fr))] gap-6 ${COLUMNS[columns]}`}
      style={
        carousel
          ? ({ "--grid-mobile": 1, "--grid-tablet": Math.min(2, columns), "--grid-desktop": columns, "--gap": "24px", "--peek": 0.15, gap: "24px" } as CSSProperties)
          : undefined
      }
    >
      {entries.map((entry) => (
        <figure key={entry.key} className={`flex flex-col gap-4 ${LOOKS[look]}`}>
          {showRating && entry.rating !== undefined && <StarRating stars={entry.rating} />}
          <blockquote className={look === "quote" ? "relative pt-6 text-lg leading-relaxed" : "leading-relaxed"}>
            {look === "quote" && (
              <span aria-hidden className="absolute -top-2 left-0 font-heading text-5xl leading-none opacity-30">
                “
              </span>
            )}
            <p className="whitespace-pre-line">
              <Inline text={entry.quote} />
            </p>
          </blockquote>
          {(entry.name || entry.role) && (
            <figcaption className="mt-auto flex items-center gap-3">
              {entry.picture && (
                // eslint-disable-next-line @next/next/no-img-element -- a small round picture, as the site keeps it
                <img src={entry.picture} alt="" width={44} height={44} className="size-11 shrink-0 rounded-full object-cover" />
              )}
              <span className="flex flex-col text-sm">
                {entry.name &&
                  (entry.nameHref ? (
                    <a href={entry.nameHref} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold hover:underline">
                      {entry.name}
                    </a>
                  ) : (
                    <span className="font-semibold">{entry.name}</span>
                  ))}
                {entry.role && (
              <span className="text-muted">
                <Inline text={entry.role} />
              </span>
            )}
              </span>
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  );
  return carousel ? <Carousel settings={carouselSettings}>{list}</Carousel> : list;
}
