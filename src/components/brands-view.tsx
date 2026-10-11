import type { CSSProperties } from "react";

import { BRANDS_DEFAULTS, brandShows, type BrandsBlock } from "@/lib/page-content";

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
  const style = { "--brand-gap": `${gap}px`, "--brand-h": `${block.logoHeight ?? BRANDS_DEFAULTS.logoHeight}px` } as CSSProperties;
  const cells = items.map((item) => (
    <figure key={item.id} className="kz-brand-figure">
      {item.picture && (
        // eslint-disable-next-line @next/next/no-img-element -- the owner's own logo, drawn at its shape under a height limit
        <img src={item.picture.url} alt={showNames && item.name.trim() ? "" : item.name} width={item.picture.width} height={item.picture.height} loading="lazy" className="kz-brand-logo" />
      )}
      {showNames && item.name.trim() && (
        <figcaption data-kz-text="name" className="kz-brand-name">
          {item.name}
        </figcaption>
      )}
    </figure>
  ));
  if (block.view === "carousel") {
    return (
      <div style={style} className="kz-brands">
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
    <div style={style} className="kz-brands">
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
