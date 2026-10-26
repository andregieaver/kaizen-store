"use client";

import Image from "next/image";
import { createElement, useCallback, useEffect, useRef, useState } from "react";

import { embedUrl } from "@/lib/video-embed";

import { onVariantPicture } from "./variant-picture";

/**
 * A gallery item (D325): its picture (`url`, a video's or model's poster), and for a video or a 3D model its file or YouTube or Vimeo
 * address. A variant's own picture comes without a kind and is a picture.
 */
type GalleryImage = {
  url: string;
  thumbnailUrl: string;
  alt: string;
  kind?: "image" | "video" | "model";
  source?: "upload" | "youtube" | "vimeo" | null;
  mediaUrl?: string | null;
};

/** Words from the page, per picture where they name one ("Show picture 2", "2 of 5"). */
export type GalleryLabels = {
  label: string;
  previous: string;
  next: string;
  show: string[];
  slide: string[];
  /** Videos and 3D models (D325). */
  media: {
    video: string;
    model: string;
    view3d: string;
    loading3d: string;
    controls3d: string;
    play: string;
    playsFrom: { youtube: string; vimeo: string };
  };
};

const smooth = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

/**
 * A product's pictures: the main picture swipes (arrows on larger
 * screens), with a strip of thumbnails beneath. Choosing a thumbnail shows
 * that picture; swiping highlights and centres its thumbnail. Swiping is
 * the browser's own scroll snapping, so it feels native and needs no library.
 *
 * Choosing a variant with a picture of its own (D82) moves to that picture
 * where it is among the product's; else it takes the first place until
 * another variant is chosen, so the count and the words stay the same.
 */
export function ProductGallery({
  images: own,
  productId,
  title,
  labels,
  thumbnails = true,
}: {
  images: GalleryImage[];
  productId: string;
  title: string;
  labels: GalleryLabels;
  /** The strip of small pictures beneath; a product layout can leave it out (D79). */
  thumbnails?: boolean;
}) {
  const main = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  // A chosen variant's picture shown in the first place, when it is not one of the product's.
  const [lead, setLead] = useState<GalleryImage | null>(null);
  const images = lead && own.length > 0 ? [lead, ...own.slice(1)] : own;
  const many = images.length > 1;

  const show = useCallback((index: number) => {
    const el = main.current;
    if (!el) return;
    el.scrollTo({ left: index * el.clientWidth, behavior: smooth() });
  }, []);

  useEffect(
    () =>
      onVariantPicture(productId, (picture) => {
        if (!picture) {
          setLead(null);
          return;
        }
        const at = own.findIndex((image) => image.url === picture.url || image.thumbnailUrl === picture.thumbnailUrl);
        setLead(at >= 0 ? null : { ...picture, alt: picture.alt ?? "" });
        show(Math.max(0, at));
      }),
    [productId, own, show],
  );

  // A video swiped away from stops: an uploaded one is paused, a YouTube or Vimeo player is taken away (D325).
  const [started, setStarted] = useState<number | null>(null);
  useEffect(() => {
    main.current?.querySelectorAll("video").forEach((video) => {
      if (video.dataset.slide !== String(active)) video.pause();
    });
  }, [active]);

  // The picture in view is the one whose slide is mostly showing.
  useEffect(() => {
    const el = main.current;
    if (!el || !many) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = Math.min(images.length - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth)));
        setActive(next);
        setStarted((was) => (was === next ? was : null));
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
              key={`${i}:${image.mediaUrl ?? image.url}`}
              role="group"
              aria-roledescription="slide"
              aria-label={labels.slide[i]}
              className="w-full shrink-0 snap-center"
            >
              {image.kind === "video" && image.mediaUrl ? (
                <GalleryVideo item={image} index={i} title={title} labels={labels.media} started={started === i} onStart={() => setStarted(i)} />
              ) : image.kind === "model" && image.mediaUrl ? (
                <GalleryModel item={image} title={title} labels={labels.media} />
              ) : (
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
              )}
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

      {many && thumbnails && (
        <div
          ref={strip}
          className="flex gap-2 overflow-x-auto px-0.5 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {images.map((image, i) => (
            <button
              key={`${i}:${image.mediaUrl ?? image.url}`}
              type="button"
              onClick={() => show(i)}
              aria-label={labels.show[i]}
              aria-current={i === active ? "true" : undefined}
              className={`relative size-16 shrink-0 overflow-hidden rounded-md bg-surface transition sm:size-20 ${
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
              {(image.kind === "video" || image.kind === "model") && <KindMark kind={image.kind} />}
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
      className={`absolute top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow-md transition hover:bg-background disabled:pointer-events-none disabled:opacity-0 kzb-md-flex ${
        direction === "previous" ? "left-3" : "right-3"
      }`}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
        <path d={direction === "previous" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/** A small mark over a thumbnail: a play triangle for a video, a cube for a 3D model. */
function KindMark({ kind }: { kind: "video" | "model" }) {
  return (
    <span aria-hidden className="absolute inset-0 flex items-center justify-center bg-black/20 text-white">
      <svg viewBox="0 0 24 24" className="size-6 drop-shadow" fill={kind === "video" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5">
        {kind === "video" ? <path d="M8 5.5v13l11-6.5z" /> : <path d="M12 2.5 3.5 7v10L12 21.5 20.5 17V7z M3.5 7 12 11.5 20.5 7 M12 11.5V21.5" strokeLinejoin="round" />}
      </svg>
    </span>
  );
}

/**
 * A video in the gallery: an uploaded one plays in the browser's own player, never by itself; a YouTube or Vimeo one shows its picture
 * and a play button, and its player is loaded from there only when pressed (D91), and taken away again when the shopper swipes on.
 */
function GalleryVideo({
  item,
  index,
  title,
  labels,
  started,
  onStart,
}: {
  item: GalleryImage;
  index: number;
  title: string;
  labels: GalleryLabels["media"];
  started: boolean;
  onStart: () => void;
}) {
  const name = item.alt || title;
  if (item.source === "upload") {
    return (
      <video
        src={item.mediaUrl ?? undefined}
        poster={item.url}
        controls
        playsInline
        preload="none"
        data-slide={index}
        aria-label={name}
        className="aspect-square w-full bg-black object-contain"
      />
    );
  }
  const source = item.source === "vimeo" ? "vimeo" : "youtube";
  const player = item.mediaUrl ? embedUrl(source, item.mediaUrl) : null;
  if (started && player) {
    return (
      <iframe
        src={player}
        title={name}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        className="aspect-square w-full border-0 bg-black"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={onStart}
      disabled={!player}
      aria-label={`${labels.play}: ${name} (${labels.playsFrom[source]})`}
      className="group relative flex aspect-square w-full items-center justify-center overflow-hidden bg-black text-white focus-visible:outline-2 focus-visible:-outline-offset-4"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- the store's own picture, shown as it is */}
      <img src={item.url} alt="" loading="lazy" draggable={false} className="absolute inset-0 size-full object-cover" />
      <span aria-hidden className="relative flex size-16 items-center justify-center rounded-full bg-black/70 transition group-hover:scale-105">
        <svg viewBox="0 0 24 24" className="ml-1 size-7" fill="currentColor">
          <path d="M8 5.5v13l11-6.5z" />
        </svg>
      </span>
      <span aria-hidden className="absolute bottom-3 left-3 rounded bg-black/70 px-2 py-1 text-xs">
        {labels.playsFrom[source]}
      </span>
    </button>
  );
}

/**
 * A 3D model in the gallery: its picture and *View in 3D*. Only that press loads `<model-viewer>` (D211: never in a page's first
 * scripts); a browser where it cannot run keeps the picture.
 */
function GalleryModel({ item, title, labels }: { item: GalleryImage; title: string; labels: GalleryLabels["media"] }) {
  const [state, setState] = useState<"poster" | "loading" | "ready" | "failed">("poster");
  const name = item.alt || title;
  const open = () => {
    setState("loading");
    import("@google/model-viewer").then(
      () => setState("ready"),
      () => setState("failed"),
    );
  };
  if (state === "ready" && item.mediaUrl) {
    return (
      <div className="relative aspect-square w-full bg-surface">
        {createElement("model-viewer", {
          src: item.mediaUrl,
          poster: item.url,
          alt: name,
          "camera-controls": "",
          "touch-action": "pan-y",
          "interaction-prompt": "none",
          style: { width: "100%", height: "100%", backgroundColor: "transparent" },
        })}
        <p className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-background/90 px-2 py-1 text-xs">{labels.controls3d}</p>
      </div>
    );
  }
  return (
    <div className="relative aspect-square w-full">
      {/* eslint-disable-next-line @next/next/no-img-element -- the store's own picture, shown as it is */}
      <img src={item.url} alt={name} loading="lazy" draggable={false} className="size-full object-cover" />
      {state !== "failed" && (
        <button
          type="button"
          onClick={open}
          disabled={state === "loading"}
          className="button-primary absolute bottom-3 left-1/2 inline-flex min-h-10 -translate-x-1/2 items-center gap-2 rounded-button px-4 text-sm shadow-md"
        >
          {state === "loading" ? labels.loading3d : labels.view3d}
        </button>
      )}
    </div>
  );
}
