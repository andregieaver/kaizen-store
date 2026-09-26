import Image from "next/image";
import type { CSSProperties } from "react";

import { audienceClass } from "@/lib/b2b";
import type { GridData } from "@/lib/content-grid";
import { fontClass } from "@/lib/fonts";
import { t } from "@/lib/i18n";
import { frameStyle, gridImageShape, type ContentGridBlock } from "@/lib/page-content";

import { HEADING_SIZES, SHAPES, buttonLook } from "./page-block";
import { Price } from "./price";

/**
 * A content grid's tiles (D51), from items looked up on the server: on the
 * site (`ContentGridSection`) and in the page builder's canvas. Columns
 * follow the screen: phones, from tablets (768 px) and computers (1024 px).
 */
export function ContentGridView({ block, data }: { block: ContentGridBlock; data: GridData }) {
  if (data.items.length === 0) {
    return block.emptyText ? <p className="text-muted">{block.emptyText}</p> : null;
  }
  const m = t(data.lang);
  const shape = gridImageShape(block);
  // Product tiles drawn as the theme's cards (D60), unless the grid styles its tiles itself.
  const themed = shape === "theme" && block.source.type === "products";
  const Heading = `h${block.headingLevel}` as const;
  const label = block.buttonLabel || (block.source.type === "products" ? m.viewProduct : m.readMore);
  const button = buttonLook(block.button);
  const tile = block.tile;
  // Articles show the day they appeared (D57), in the grid's language.
  const day = new Intl.DateTimeFormat(data.locale, { dateStyle: "long", timeZone: "Europe/Oslo" });
  const tileStyle: CSSProperties = {
    ...frameStyle(tile ?? {}),
    ...(tile?.background && { backgroundColor: tile.background }),
    ...(tile?.padding && { padding: `${tile.padding}px` }),
  };
  return (
    <ul
      className="grid grid-cols-[repeat(var(--grid-mobile),minmax(0,1fr))] md:grid-cols-[repeat(var(--grid-tablet),minmax(0,1fr))] lg:grid-cols-[repeat(var(--grid-desktop),minmax(0,1fr))]"
      style={
        {
          "--grid-mobile": block.columns.mobile,
          "--grid-tablet": block.columns.tablet,
          "--grid-desktop": block.columns.desktop,
          gap: `${block.gap}px`,
        } as CSSProperties
      }
    >
      {data.items.map((item) => (
        <li
          key={item.id}
          style={tileStyle}
          className={`flex min-w-0 flex-col gap-3 ${tile?.radius ? "overflow-hidden" : ""} ${themed && !tile ? "product-card relative" : ""} ${
            item.audience ? audienceClass(item.audience) : ""
          }`}
        >
          {block.show.image && item.image && (
            // The heading and button are the links for keyboards and screen readers; the picture is for pointing.
            <a href={item.href} tabIndex={-1} aria-hidden className="relative z-[2]">
              <Image
                src={item.image.url}
                alt=""
                width={800}
                height={600}
                unoptimized
                className={`h-auto w-full bg-surface ${
                  shape === "original" ? "rounded-lg" : shape === "theme" ? "product-card-image rounded-lg object-cover" : SHAPES[shape]
                }`}
              />
            </a>
          )}
          {block.show.heading && (
            <Heading
              className={`leading-snug font-heading text-balance ${HEADING_SIZES[block.headingSize ?? "sm"]} ${
                block.headingFont ? fontClass(block.headingFont) : ""
              }`}
            >
              <a href={item.href} className="relative z-[2] hover:underline focus-visible:outline-2">
                {item.title}
              </a>
            </Heading>
          )}
          {item.date && (
            <time dateTime={item.date} className="text-sm text-muted">
              {day.format(new Date(item.date))}
            </time>
          )}
          {block.show.excerpt && item.excerpt && (
            <p
              className="text-sm text-muted"
              style={{
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: block.excerptLines,
                overflow: "hidden",
              }}
            >
              {item.excerpt}
            </p>
          )}
          {block.show.price && item.price && (
            <Price price={item.price.view} locale={data.locale} m={m} from={item.price.from} />
          )}
          {block.show.button && (
            <div className="mt-auto pt-1">
              {/* Named with the item, so "Read more" links are told apart; the visible text starts the name. */}
              <a href={item.href} aria-label={`${label}: ${item.title}`} className={button.className} style={button.style}>
                {label}
              </a>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
