import type { CSSProperties } from "react";

import {
  BRANDS_DEFAULTS,
  brandShows,
  type BrandsBlock,
} from "@/lib/page-content";

import { isSafeAddress } from "@/lib/field-parts";

import { BrandsCarousel } from "./brands-carousel";

/**
 * Brands (D204): logos with their names under them, as a grid or a carousel. How many are in a row is `--brand-cols`, set by the
 * block's own rules by screen size (`blockStyle()`); the gap and the tallest a logo may be are properties here. A logo is drawn at its
 * own shape, never stretched, and has no alternative text when its name is shown beside it.
 */
export function BrandsView({ block }: { block: BrandsBlock }) {
  const items = block.items.filter(brandShows);
  if (items.length === 0) return null;
  const gap = block.gap ?? BRANDS_DEFAULTS.gap;
  const showNames = block.showNames !== false;
  // One colour over greys (D206); either may give way to the logo as uploaded under the pointer.
  const tint = block.tint === "custom" && !block.tintColor ? undefined : block.tint;
  const grey = !tint && block.greyscale ? (block.colourOnHover ? "hover" : "always") : undefined;
  const masked = tint !== undefined && tint !== "invert";
  const style = {
    "--brand-gap": `${gap}px`,
    "--brand-h": `${block.logoHeight ?? BRANDS_DEFAULTS.logoHeight}px`,
    ...(masked && { "--brand-tint": tint === "brand" ? "var(--accent)" : tint === "white" ? "#ffffff" : tint === "black" ? "#000000" : block.tintColor }),
  } as CSSProperties;
  const marks = { "data-grey": grey, "data-tint": tint, "data-tint-hover": tint && block.colourOnHover ? "" : undefined };
  const cells = items.map((item) => {
    const figure = (
      <figure key={item.id} className="kz-brand-figure">
        {item.picture &&
          (() => {
            const logo = (
              // eslint-disable-next-line @next/next/no-img-element -- the owner's own logo, drawn at its shape under a height limit
              <img
                src={item.picture.url}
                alt={showNames && item.name.trim() ? "" : item.name}
                width={item.picture.width}
                height={item.picture.height}
                loading="lazy"
                className="kz-brand-logo"
              />
            );
            // In one colour, the logo is its own shape filled with that colour (a mask over the picture, which keeps its size and words).
            return masked ? (
              <span className="kz-brand-mask" style={{ "--kz-logo": `url(${JSON.stringify(item.picture.url)})` } as CSSProperties}>
                {logo}
              </span>
            ) : (
              logo
            );
          })()}
        {showNames && item.name.trim() && (
          <figcaption data-kz-text="name" className="kz-brand-name">
            {item.name}
          </figcaption>
        )}
      </figure>
    );
    // A brand that links is one link: its name (or the logo's, when names are hidden) is the link's words.
    const href = item.href?.trim();
    return href && isSafeAddress(href) ? (
      <a key={item.id} href={href} className="kz-brand-link">
        {figure}
      </a>
    ) : (
      figure
    );
  });
  if (block.view === "carousel") {
    return (
      <div style={style} className="kz-brands" {...marks}>
        <BrandsCarousel
          cells={cells}
          movement={block.movement ?? "continuous"}
          speed={block.speed ?? BRANDS_DEFAULTS.speed}
          interval={block.interval ?? BRANDS_DEFAULTS.interval}
          gap={gap}
          label="Brands"
        />
      </div>
    );
  }
  return (
    <div style={style} className="kz-brands" {...marks}>
      <ul data-brands="" className="kz-brands-grid">
        {cells.map((cell, i) => (
          <li key={items[i].id} className="kz-brand">
            {cell}
          </li>
        ))}
      </ul>
    </div>
  );
}
