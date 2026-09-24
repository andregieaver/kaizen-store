"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

type GalleryImage = { url: string; thumbnailUrl: string; alt: string };

/** Words from the page, per picture where they name one ("Show picture 2", "2 of 5"). */
export type GalleryLabels = {
  label: string;
  previous: string;
  next: string;
  show: string[];
  slide: string[];
};

const smooth = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

/**
 * A product's pictures: the main picture swipes (arrows on larger
 * screens), with a strip of thumbnails beneath. Choosing a thumbnail shows
 * that picture; swiping highlights and centres its thumbnail. Swiping is
 * the browser's own scroll snapping, so it feels native and needs no library.
 */
export function ProductGallery({ images, title, labels }: { images: GalleryImage[]; title: string; labels: GalleryLabels }) {
  const main = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const many = images.length > 1;

  const show = useCallback((index: number) => {
    const el = main.current;
    if (!el) return;
    el.scrollTo({ left: index * el.clientWidth, behavior: smooth() });
  }, []);

  // The picture in view is the one whose slide is mostly showing.
  useEffect(() => {
    const el = main.current;
    if (!el || !many) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setActive(Math.min(images.length - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth))));
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [images.length, many]);

  // Its thumbnail moves to the middle of the strip (without scrolling the page).
  useEffect(() => {
    const row = strip.current;
    const thumb = row?.children[active] as HTMLElement | undefined;
    if (!row || !thumb) return;
    row.scrollTo({ left: thumb.offsetLeft - (row.clientWidth - thumb.offsetWidth) / 2, behavior: smooth() });
  }, [active]);

  if (images.length === 0) return null;

  return (
    <section aria-label={labels.label} aria-roledescription="carousel" className="mt-4 flex flex-col gap-3">
      <div className="relative">
        <div
          ref={main}
          tabIndex={many ? 0 : undefined}
          className="flex snap-x snap-mandatory overflow-x-auto rounded-lg bg-surface [scrollbar-width:none] focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-scrollbar]:hidden"
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
              event.preventDefault();
              show(Math.min(images.length - 1, Math.max(0, active + (event.key === "ArrowRight" ? 1 : -1))));
            }
          }}
        >
          {images.map((image, i) => (
            <div
              key={image.url}
              role="group"
              aria-roledescription="slide"
              aria-label={labels.slide[i]}
              className="w-full shrink-0 snap-center"
            >
              <Image
                src={image.url}
                alt={image.alt || (i === 0 ? title : "")}
                width={600}
                height={600}
                priority={i === 0}
                loading={i === 0 ? undefined : "lazy"}
                unoptimized
                draggable={false}
                className="aspect-square w-full object-cover"
              />
            </div>
          ))}
        </div>
        {many && (
          <>
            <Arrow direction="previous" label={labels.previous} disabled={active === 0} onClick={() => show(active - 1)} />
            <Arrow
              direction="next"
              label={labels.next}
              disabled={active === images.length - 1}
              onClick={() => show(active + 1)}
            />
          </>
        )}
      </div>

      {many && (
        <div
          ref={strip}
          className="flex gap-2 overflow-x-auto px-0.5 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {images.map((image, i) => (
            <button
              key={image.url}
              type="button"
              onClick={() => show(i)}
              aria-label={labels.show[i]}
              aria-current={i === active ? "true" : undefined}
              className={`size-16 shrink-0 overflow-hidden rounded-md bg-surface transition sm:size-20 ${
                i === active ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : "opacity-60 hover:opacity-100"
              }`}
            >
              <Image
                src={image.thumbnailUrl}
                alt=""
                width={80}
                height={80}
                loading="lazy"
                unoptimized
                className="size-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** Previous and next, over the picture, on screens with a pointer to click them. */
function Arrow({
  direction,
  label,
  disabled,
  onClick,
}: {
  direction: "previous" | "next";
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`absolute top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow-md transition hover:bg-background disabled:pointer-events-none disabled:opacity-0 md:flex ${
        direction === "previous" ? "left-3" : "right-3"
      }`}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
        <path d={direction === "previous" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
