"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { stepSlide, type GallerySlide } from "@/lib/gallery";
import { t } from "@/lib/i18n";

import { usePageLanguage } from "./page-language";
import { EmbeddedVideo } from "./video-view";

/**
 * A gallery's lightbox (D209): a press on a tile (`data-gallery-open`, a link to the piece) opens it full size in the browser's own
 * modal `<dialog>`, with the previous and the next by the buttons, the arrow keys or a swipe, going round; Escape or the close button
 * ends it and the focus goes back to the tile. A YouTube or Vimeo video still asks for its play press, so nothing is fetched from
 * them before the visitor chooses. In the builder's canvas a tile opens nothing.
 */
export function GalleryLightbox({ slides, children }: { slides: GallerySlide[]; children: ReactNode }) {
  const m = t(usePageLanguage());
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState<number | null>(null);
  const count = slides.length;

  useEffect(() => {
    const box = root.current;
    if (!box) return;
    const press = (event: MouseEvent) => {
      const opener = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-gallery-open]") : null;
      if (!opener || !box.contains(opener) || event.defaultPrevented) return;
      // A press with a key held opens the piece in a new tab, as a link does.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (box.closest("[data-theme-canvas], [data-theme-preview]")) return;
      setIndex(Number(opener.dataset.galleryOpen) || 0);
    };
    box.addEventListener("click", press);
    return () => box.removeEventListener("click", press);
  }, []);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (index !== null && !el.open) el.showModal();
    if (index === null && el.open) el.close();
  }, [index]);

  const go = (by: 1 | -1) => setIndex((current) => (current === null ? current : stepSlide(current, by, count)));
  const start = useRef<number | null>(null);
  const swiped = useRef(false);
  const slide = index === null ? null : slides[index];

  return (
    <div ref={root}>
      {children}
      <dialog
        ref={dialog}
        className="kz-lightbox"
        aria-label={m.galleryLabel}
        onClose={() => setIndex(null)}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") go(1);
          if (event.key === "ArrowLeft") go(-1);
        }}
        onClick={(event) => {
          // A press on the dark around the piece closes it (not the end of a swipe).
          const target = event.target as Element;
          if (swiped.current) swiped.current = false;
          else if (target === event.currentTarget || target.classList.contains("kz-lightbox-stage")) setIndex(null);
        }}
      >
        {slide && (
          <div className="kz-lightbox-body">
            <div className="kz-lightbox-bar">
              {count > 1 && (
                <span className="kz-lightbox-count" aria-live="polite">
                  {m.galleryOf(index! + 1, count)}
                </span>
              )}
              <button type="button" className="kz-lightbox-button" onClick={() => setIndex(null)} aria-label={m.galleryClose} autoFocus>
                <svg aria-hidden viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div
              className="kz-lightbox-stage"
              onPointerDown={(event) => {
                start.current = event.clientX;
                swiped.current = false;
              }}
              onPointerUp={(event) => {
                const from = start.current;
                start.current = null;
                if (from === null || count < 2) return;
                const moved = event.clientX - from;
                if (Math.abs(moved) > 50) {
                  swiped.current = true;
                  go(moved < 0 ? 1 : -1);
                }
              }}
            >
              <figure key={slide.key} className="kz-lightbox-figure">
                {slide.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the owner's own picture at its full size
                  <img
                    src={slide.src}
                    alt={slide.alt}
                    width={slide.width}
                    height={slide.height}
                    className="kz-lightbox-img"
                    // Sized from what is known of it, so a picture with no size of its own (an SVG) is never drawn at none.
                    style={{ "--lb-w": `${slide.width}px`, "--lb-r": String(slide.width / slide.height) } as CSSProperties}
                    draggable={false}
                  />
                ) : slide.kind === "upload" ? (
                  <video src={slide.src} poster={slide.poster} controls autoPlay playsInline aria-label={slide.title || undefined} className="kz-lightbox-video" />
                ) : (
                  <div className="kz-lightbox-embed">
                    <EmbeddedVideo source={slide.source} player={slide.player} poster={slide.poster} title={slide.title} style={{ aspectRatio: "16 / 9" }} />
                  </div>
                )}
                {slide.caption && <figcaption className="kz-lightbox-caption">{slide.caption}</figcaption>}
              </figure>
              {count > 1 && (
                <>
                  <button type="button" className="kz-lightbox-button kz-lightbox-prev" onClick={() => go(-1)} aria-label={m.carouselPrevious}>
                    <svg aria-hidden viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m15 18-6-6 6-6" />
                    </svg>
                  </button>
                  <button type="button" className="kz-lightbox-button kz-lightbox-next" onClick={() => go(1)} aria-label={m.carouselNext}>
                    <svg aria-hidden viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
