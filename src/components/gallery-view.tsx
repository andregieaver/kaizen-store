import type { CSSProperties, ReactNode } from "react";

import { snapAttribute } from "@/lib/carousel-settings";
import { galleryAspect, galleryFades, gallerySlides, galleryZoomVars, type GallerySlide } from "@/lib/gallery";
import { GALLERY_DEFAULTS, type GalleryBlock } from "@/lib/page-content";
import { EMBED_NAMES } from "@/lib/video-embed";

import { Carousel } from "./carousel";
import { EmbeddedVideo, GalleryFade, GalleryLightbox, UploadedVideo } from "./lazy/blocks";

/**
 * A gallery (D209): pictures and videos in the owner's order, as a grid or a carousel (the site's own, D155), as many in a row as
 * `--grid-cols`, set per screen size by the block's rules (`blockStyle()`). With the lightbox on (the default) each tile is a link
 * to the piece itself, which the lightbox opens full size with the others beside it; without a script the link opens the picture
 * or video on its own. With it off, pictures are shown as they are and videos play in their tiles.
 */
export function GalleryView({ block }: { block: GalleryBlock }) {
  const slides = gallerySlides(block.items);
  if (slides.length === 0) return null;
  const gap = block.gap ?? GALLERY_DEFAULTS.gap;
  const aspect = galleryAspect(block.ratio);
  const lightbox = block.lightbox !== false;
  const captions = block.showCaptions !== false;
  const carousel = block.view === "carousel";
  const figures = slides.map((slide, index) => (
    <figure key={slide.key} className="kz-gallery-figure">
      {lightbox ? <Opener slide={slide} index={index} aspect={aspect} /> : <Shown slide={slide} aspect={aspect} />}
      {captions && slide.caption && (
        <figcaption data-kz-text="caption" className="kz-gallery-caption">
          {slide.caption}
        </figcaption>
      )}
    </figure>
  ));
  const tiles = figures.map((figure, index) => (
    <li key={slides[index].key} className="kz-gallery-tile">
      {figure}
    </li>
  ));
  const list = (
    <ul
      data-gallery=""
      data-carousel-track={carousel ? "" : undefined}
      data-snap={carousel ? snapAttribute(block.carousel) : undefined}
      data-ratio={aspect ? undefined : "auto"}
      className={carousel ? "kz-gallery-track" : "kz-gallery-grid"}
      style={{ "--gallery-gap": `${gap}px`, "--gap": `${gap}px`, gap: `${gap}px` } as CSSProperties}
    >
      {tiles}
    </ul>
  );
  const shown: ReactNode = galleryFades(block) ? (
    // One tile at a time, fading into the next (D210).
    <GalleryFade tiles={figures.map((node, index) => ({ key: slides[index].key, node }))} settings={block.carousel} fadeMs={block.fadeMs ?? GALLERY_DEFAULTS.fadeMs} gap={gap} />
  ) : carousel ? (
    <Carousel settings={block.carousel}>{list}</Carousel>
  ) : (
    list
  );
  return <div className="kz-gallery" style={galleryZoomVars(block) as CSSProperties}>{lightbox ? <GalleryLightbox slides={slides}>{shown}</GalleryLightbox> : shown}</div>;
}

/** A tile's picture: the picture itself, or a video's (a dark panel when it has none). */
function TilePicture({ slide, aspect }: { slide: GallerySlide; aspect: string | undefined }) {
  const src = slide.kind === "image" ? slide.src : slide.poster;
  return (
    <span className="kz-gallery-frame" style={aspect ? { aspectRatio: aspect } : undefined}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- the owner's own picture, cropped to the tile by CSS
        <img
          src={src}
          alt={slide.kind === "image" ? slide.alt : ""}
          width={slide.kind === "image" ? slide.width : undefined}
          height={slide.kind === "image" ? slide.height : undefined}
          loading="lazy"
          className="kz-gallery-img"
        />
      ) : (
        <span className="kz-gallery-blank" />
      )}
      {slide.kind !== "image" && (
        <span aria-hidden className="kz-gallery-play">
          <svg viewBox="0 0 24 24" className="ml-0.5 size-6" fill="currentColor">
            <path d="M8 5.5v13l11-6.5z" />
          </svg>
        </span>
      )}
    </span>
  );
}

/** A tile that opens the lightbox: a link to the piece itself, so it works without a script too. */
function Opener({ slide, index, aspect }: { slide: GallerySlide; index: number; aspect: string | undefined }) {
  const href = slide.kind === "embed" ? slide.player : slide.src;
  const name = slide.kind === "image" ? slide.alt : slide.title || (slide.kind === "embed" ? EMBED_NAMES[slide.source] : "");
  return (
    <a href={href} data-gallery-open={index} className="kz-gallery-open" {...(slide.kind !== "image" && name ? { "aria-label": name } : {})}>
      <TilePicture slide={slide} aspect={aspect} />
    </a>
  );
}

/** A tile without the lightbox: a picture as it is, a video that plays where it is. */
function Shown({ slide, aspect }: { slide: GallerySlide; aspect: string | undefined }) {
  const style: CSSProperties = { aspectRatio: aspect ?? "16 / 9" };
  if (slide.kind === "image") return <TilePicture slide={slide} aspect={aspect} />;
  if (slide.kind === "upload") return <UploadedVideo src={slide.src} poster={slide.poster} title={slide.title} controls autoplay={false} loop={false} style={style} />;
  return <EmbeddedVideo source={slide.source} player={slide.player} poster={slide.poster} title={slide.title} style={style} />;
}
