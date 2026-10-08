import Image from "next/image";
import type { CSSProperties } from "react";

import { audienceClass } from "@/lib/b2b";
import { snapAttribute } from "@/lib/carousel-settings";
import { noticesFor, type CampaignNotices } from "@/lib/campaign-notices";
import type { GridData } from "@/lib/content-grid";
import { fontClass } from "@/lib/fonts";
import { familyClassOf, textRoles } from "@/lib/typography";
import { t } from "@/lib/i18n";
import { inlinePlain } from "@/lib/inline-text";
import { sourceTraits } from "@/lib/grid-source";
import { frameStyle, gridImageShape, type ContentGridBlock } from "@/lib/page-content";
import { gridListStyle } from "@/lib/part-css";
import { carouselAnywhere } from "@/lib/responsive";

import { Carousel } from "./carousel";
import { Inline } from "./inline-text";
import { SHAPES, buttonLook } from "./page-block";
import { CampaignBadge } from "./campaign-notice";
import { Price } from "./price";

/**
 * A content grid's tiles (D51), from items looked up on the server: on the
 * site (`ContentGridSection`) and in the page builder's canvas. Columns
 * follow the screen sizes (D179): the grid's own at Extra large, overrides below.
 */
export function ContentGridView({ block, data, notices }: { block: ContentGridBlock; data: GridData; /** The store's campaigns (D115), for a badge on the products they reach. */ notices?: CampaignNotices }) {
  if (data.items.length === 0) {
    return block.emptyText ? (
      <p className="text-muted">
        <Inline text={block.emptyText} links />
      </p>
    ) : null;
  }
  const m = t(data.lang);
  const shape = gridImageShape(block);
  // Product tiles drawn as the theme's cards (D60), unless the grid styles its tiles itself.
  const traits = sourceTraits(block.source);
  const themed = shape === "theme" && traits.products;
  const Heading = `h${block.headingLevel}` as const;
  // The titles' own family (D179), drawn as its class unless it differs by size (then the part stylesheet's rule).
  const titleRole = textRoles(block).find((def) => def.role === "title");
  const titleFamily = titleRole ? familyClassOf(block, titleRole) : undefined;
  // The item's own button text (custom items, D155), else the grid's, else the kind of content's.
  const label = block.buttonLabel || (traits.button === "viewProduct" ? m.viewProduct : m.readMore);
  // Words an owner typed into the grid or its custom items may hold inline markup (a span with a class, bold); a product's or a page's own title never does.
  const own = !traits.lookedUp;
  const words = (text: string) => (own ? <Inline text={text} /> : text);
  const plain = (text: string) => (own ? inlinePlain(text) : text);
  const button = buttonLook(block.button);
  const tile = block.tile;
  // Articles show the day they appeared (D57), in the grid's language.
  const day = new Intl.DateTimeFormat(data.locale, { dateStyle: "long", timeZone: "Europe/Oslo" });
  const tileStyle: CSSProperties = {
    ...frameStyle(tile ?? {}),
    ...(tile?.background && { backgroundColor: tile.background }),
    ...(tile?.padding && { padding: `${tile.padding}px` }),
  };
  // A carousel at some sizes is drawn as one, and laid out as a grid where it is not (D179, the part stylesheet).
  const carousel = carouselAnywhere(block);
  // Its columns and gap by screen size are custom properties its rules set (`gridListStyle()`, drawn with the row's or the listing's).
  const listStyle = gridListStyle(block);
  const list = (
    <ul
      data-carousel-track={carousel ? "" : undefined}
      data-snap={carousel ? snapAttribute(block.carousel) : undefined}
      className={[listStyle.className, carousel ? "" : "grid grid-cols-[repeat(var(--grid-cols),minmax(0,1fr))]"].filter(Boolean).join(" ") || undefined}
      style={
        {
          "--gap": "var(--grid-gap)",
          ...(carousel && block.peek && { "--peek": 0.25 }),
          gap: "var(--grid-gap)",
        } as CSSProperties
      }
    >
      {data.items.map((item) => (
        <li
          key={item.id}
          data-item-id={item.id}
          style={tileStyle}
          className={`flex min-w-0 flex-col gap-3 ${tile?.radius ? "overflow-hidden" : ""} ${themed && !tile ? "product-card relative" : ""} ${
            item.audience ? audienceClass(item.audience) : ""
          }`}
        >
          {block.show.image && item.image && (
            <TileImage
              item={item}
              image={item.image}
              shape={shape}
              isProduct={traits.products}
              notices={notices}
              m={m}
              // Without a heading or a button to link, the picture is the item's link for everyone (a logo strip, picture-only cards).
              only={item.href !== "" && !(block.show.heading && item.title) && !block.show.button}
              fallbackName={plain(item.title || item.buttonLabel || label)}
            />
          )}
          {item.badge && !(block.show.image && item.image) && <ItemBadge text={item.badge} />}
          {block.show.heading && item.title && (
            <Heading
              // Its size and font are the grid's `title` typography (D179), over these.
              data-kz-text="title"
              className={`leading-snug font-heading text-balance text-lg ${titleFamily ? fontClass(titleFamily) : ""}`}
            >
              {item.href !== "" ? (
                <a href={item.href} className="relative z-[2] hover:underline focus-visible:outline-2" {...externalAttributes(item)}>
                  {words(item.title)}
                </a>
              ) : (
                words(item.title)
              )}
            </Heading>
          )}
          {item.note && (
            // A recommendation's reason (D139), a fixed sentence with a title of the store's.
            <p className="text-xs text-muted">{item.note}</p>
          )}
          {item.fields && item.fields.length > 0 && (
            // Custom fields chosen for the tiles (D120): one line each, plain words.
            <ul className="flex flex-col gap-0.5 text-sm text-muted" data-kz-text="meta">
              {item.fields.map((field, index) => (
                <li key={`${field.label}-${index}`}>
                  {field.label !== "" && <span className="font-medium">{`${field.label}:`}</span>} {field.text}
                </li>
              ))}
            </ul>
          )}
          {item.date && (
            <time dateTime={item.date} className="text-sm text-muted">
              {day.format(new Date(item.date))}
            </time>
          )}
          {block.show.excerpt && item.excerpt && (
            <p
              data-kz-text="excerpt"
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
            <Price price={item.price.view} locale={data.locale} m={m} from={item.price.from} textRole="price" />
          )}
          {block.show.price && item.priceText && (
            // A custom item's price is the owner's own words (D155): plain text, no VAT label, no reference price, nothing to buy.
            <p className="font-medium" data-kz-text="price">
              {words(item.priceText)}
            </p>
          )}
          {block.show.button && item.href !== "" && (
            <div className="mt-auto pt-1">
              {/* Named with the item, so "Read more" links are told apart; the visible text starts the name. */}
              <a
                href={item.href}
                // Named with the item; with no title, with what its picture shows, so the buttons are still told apart.
                aria-label={itemName(block, item) ? `${inlinePlain(item.buttonLabel || label)}: ${plain(itemName(block, item))}` : undefined}
                className={button.className}
                style={button.style}
                data-kz-text="button"
                {...externalAttributes(item)}
              >
                <Inline text={item.buttonLabel || label} />
              </a>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
  return carousel ? <Carousel settings={block.carousel}>{list}</Carousel> : list;
}

/** What names an item for a screen reader: its title, else the description of the picture the tile shows. */
const itemName = (block: ContentGridBlock, item: GridData["items"][number]): string => item.title || (block.show.image ? (item.image?.alt ?? "") : "");

/** A link that leaves the site (a custom item's web address) opens as any other link, but without handing the other site the page's address. */
const externalAttributes = (item: { external?: boolean }) => (item.external ? { rel: "noopener noreferrer" } : {});

/**
 * A tile's picture: a link for pointing (the heading and button are the links for keyboards and screen readers), or, for
 * a custom item without a link, a picture that says what it shows (D155; empty alt text: decoration). When the tile has no
 * heading or button to link (`only`: a logo strip, picture-only cards), the picture is the link for everyone: it can be
 * tabbed to, and named by its description, else the title or the button's words. A badge sits over it.
 */
function TileImage({
  item,
  image,
  shape,
  isProduct,
  notices,
  m,
  only,
  fallbackName,
}: {
  item: GridData["items"][number];
  image: { url: string; alt: string; width?: number; height?: number };
  shape: ReturnType<typeof gridImageShape>;
  isProduct: boolean;
  notices?: CampaignNotices;
  m: ReturnType<typeof t>;
  only: boolean;
  fallbackName: string;
}) {
  const picture =
    item.href === "" ? (
      <TilePicture image={image} alt={image.alt} shape={shape} />
    ) : only ? (
      <a
        href={item.href}
        // The picture's own description names the link; without one, the item's title (or the button's words) does.
        aria-label={image.alt.trim() === "" ? fallbackName : undefined}
        className="relative z-[2] block focus-visible:outline-2"
        {...externalAttributes(item)}
      >
        <TilePicture image={image} alt={image.alt} shape={shape} />
      </a>
    ) : (
      <a href={item.href} tabIndex={-1} aria-hidden className="relative z-[2] block" {...externalAttributes(item)}>
        {isProduct && <CampaignBadge notices={noticesFor(notices, item.id)} m={m} />}
        <TilePicture image={image} alt="" shape={shape} />
      </a>
    );
  return item.badge ? (
    <div className="relative">
      {picture}
      <ItemBadge text={item.badge} over />
    </div>
  ) : (
    picture
  );
}

/** A tile's picture, at its own size when the item has one (custom items, D155), else the usual 800 by 600. */
function TilePicture({ image, alt, shape }: { image: { url: string; width?: number; height?: number }; alt: string; shape: ReturnType<typeof gridImageShape> }) {
  return (
    <Image
      src={image.url}
      alt={alt}
      width={image.width ?? 800}
      height={image.height ?? 600}
      unoptimized
      className={`h-auto w-full bg-surface ${
        shape === "original" ? "rounded-lg" : shape === "theme" ? "product-card-image rounded-lg object-cover" : SHAPES[shape]
      }`}
    />
  );
}

/** A custom item's badge (D155): the owner's words, over the picture's corner, or above the title when there is no picture. */
function ItemBadge({ text, over = false }: { text: string; over?: boolean }) {
  return (
    <span
      data-kz-text="badge"
      className={`rounded-button bg-accent px-2 py-1 text-xs font-medium text-accent-foreground ${
        over ? "pointer-events-none absolute top-2 left-2 z-10" : "self-start"
      }`}
    >
      {text}
    </span>
  );
}
