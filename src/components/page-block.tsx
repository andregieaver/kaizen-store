import Image from "next/image";
import type { CSSProperties } from "react";

import {
  HEADING_DEFAULT_SIZE,
  faqShows,
  richTextPlain,
  type AccordionBlock,
  type FaqBlock,
  type PanelItem,
  buttonShows,
  frameStyle,
  type ButtonBlock,
  type ButtonShape,
  type ButtonSize,
  type DualButtonBlock,
  type DualButtonSide,
  type FontWeight,
  type HeadingBlock,
  type HeadingSize,
  type ImageShape,
  type PageBlock,
  type SeparatorBlock,
  type TabsBlock,
  type VideoBlock,
} from "@/lib/page-content";

import { faqJsonLd } from "@/lib/seo";
import { embedUrl } from "@/lib/video-embed";

import { HtmlFrame } from "./html-frame";
import { JsonLdScript } from "./json-ld";
import { RichText } from "./rich-text";
import { TabsView } from "./tabs-view";
import { EmbeddedVideo, UploadedVideo } from "./video-view";

// Written out whole so Tailwind finds every class.

/** Crops (D48). */
export const SHAPES: Record<ImageShape, string> = {
  landscape: "aspect-[4/3] object-cover rounded-lg",
  portrait: "aspect-[3/4] object-cover rounded-lg",
  panorama: "aspect-[3/1] object-cover rounded-lg",
  square: "aspect-square object-cover rounded-lg",
  circle: "aspect-square object-cover rounded-full",
};

export const HEADING_SIZES: Record<HeadingSize, string> = {
  sm: "text-lg",
  md: "text-xl md:text-2xl",
  lg: "text-2xl md:text-3xl",
  xl: "text-3xl md:text-5xl",
  "2xl": "text-4xl md:text-6xl",
};
export const WEIGHTS: Record<FontWeight, string> = {
  normal: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
  bold: "font-bold",
};

const BUTTON_SIZES: Record<ButtonSize, string> = { sm: "min-h-9 text-sm", md: "min-h-11 text-base", lg: "min-h-13 text-lg" };
/** Room at the sides; a text link has none. */
const BUTTON_PADDING: Record<ButtonSize, string> = { sm: "px-3", md: "px-5", lg: "px-7" };
const BUTTON_SHAPES: Record<ButtonShape, string> = { rounded: "rounded-md", pill: "rounded-full", square: "rounded-none" };

/**
 * One block as the site shows it (D42, D47, D49): rich text, a picture with
 * its caption (in its own shape or cropped to one, D48), a heading or a
 * button. The page builder's canvas shows blocks with this too.
 */
export function PageBlockView({ block }: { block: PageBlock }) {
  switch (block.type) {
    case "richText":
      return <RichText doc={block.doc} />;
    case "heading":
      return <Heading block={block} />;
    case "button":
      return <Button block={block} />;
    case "contentGrid":
      // Its items are looked up where it is shown: `ContentGridSection` on the site, a preview in the editor.
      return null;
    case "product":
      // The product's page draws it with the product (`ProductPartView`); the editor shows a stand-in.
      return null;
    case "site":
      // The site's header or footer draws it with the site (`SitePartView`, D80); the editor shows a stand-in.
      return null;
    case "menu":
      // Its links are looked up where it is shown (`MenuSection`, D85); the editor shows a stand-in.
      return null;
    case "separator":
      return <Separator block={block} />;
    case "dualButton":
      return <DualButton block={block} />;
    case "accordion":
      return <Accordion block={block} />;
    case "tabs":
      return <Tabs block={block} />;
    case "faq":
      return <Faq block={block} />;
    case "video":
      return <Video block={block} />;
    case "html":
      return block.html.trim() ? <HtmlFrame html={block.html} title={block.title} height={block.height} waitForClick={Boolean(block.waitForClick)} /> : null;
    case "image":
      if (!block.image) return null;
      return (
        <figure className="flex flex-col gap-2">
          <Image
            src={block.image.url}
            alt={block.image.alt}
            width={block.image.width}
            height={block.image.height}
            unoptimized
            className={`h-auto w-full bg-surface ${block.shape ? SHAPES[block.shape] : "rounded-lg"}`}
          />
          {block.caption && <figcaption className="text-sm text-muted">{block.caption}</figcaption>}
        </figure>
      );
  }
}

function Heading({ block }: { block: HeadingBlock }) {
  const Tag = `h${block.level}` as const;
  return (
    <Tag
      className={`leading-tight text-balance ${HEADING_SIZES[block.size ?? HEADING_DEFAULT_SIZE[block.level]]} ${block.weight ? WEIGHTS[block.weight] : "font-heading"}`}
      style={block.textColor ? { color: block.textColor } : undefined}
    >
      {block.text}
    </Tag>
  );
}

/** How a button looks (D49): its kind, size, corners and colours; also a content grid's tile buttons (D51). */
export type ButtonLook = Pick<ButtonBlock, "variant" | "size" | "shape" | "fill" | "textColor">;

/** The classes and colours of a link that looks like a button. */
export function buttonLook(
  look: ButtonLook | undefined,
  fullWidth = false,
  weight: FontWeight = "medium",
): { className: string; style: CSSProperties } {
  const variant = look?.variant ?? "filled";
  const size = look?.size ?? "md";
  const colors =
    variant === "filled"
      ? "border-2 border-transparent bg-accent text-accent-foreground hover:opacity-90"
      : variant === "outline"
        ? "border-2 border-current text-foreground hover:bg-foreground/5"
        : "text-foreground underline underline-offset-4 hover:no-underline";
  return {
    className: `relative z-[2] inline-flex items-center justify-center text-center ${WEIGHTS[weight]} transition focus-visible:outline-2 focus-visible:outline-offset-2 ${
      BUTTON_SIZES[size]
    } ${variant === "text" ? "" : `${BUTTON_PADDING[size]} ${BUTTON_SHAPES[look?.shape ?? "rounded"]}`} ${fullWidth ? "w-full" : ""} ${colors}`,
    style:
      variant === "filled"
        ? { backgroundColor: look?.fill, color: look?.textColor }
        : { color: look?.textColor ?? look?.fill, borderColor: look?.fill },
  };
}

/**
 * A link that looks like a button. Its colour fills it, or draws an
 * outline's line and text, or colours a text link; its text colour is for
 * a filled button. It stays usable above a column's own link.
 */
function Button({ block }: { block: ButtonBlock }) {
  const look = buttonLook(block, block.fullWidth, block.weight);
  return (
    <a
      href={block.href}
      {...(block.newTab && { target: "_blank", rel: "noopener noreferrer" })}
      // A border, corners and shadow chosen for the button win over its style's own.
      style={{ ...look.style, ...frameStyle(block) }}
      className={look.className}
    >
      {block.label}
      {block.newTab && <span className="sr-only"> (opens in a new tab)</span>}
    </a>
  );
}

/** A separator line (D91): a thematic break, in the site's border colour unless one is chosen. */
function Separator({ block }: { block: SeparatorBlock }) {
  const thickness = block.thickness ?? 1;
  const line = block.line ?? "solid";
  const width = block.width ?? 100;
  const position = block.position ?? "center";
  return (
    <hr
      className="my-0 border-0 border-border"
      style={{
        borderTopStyle: line,
        // A double line needs room for two lines and the gap between.
        borderTopWidth: `${line === "double" ? Math.max(3, thickness) : thickness}px`,
        borderTopColor: block.color,
        width: `${width}%`,
        marginLeft: width < 100 && position !== "left" ? "auto" : 0,
        marginRight: width < 100 && position !== "right" ? "auto" : 0,
      }}
    />
  );
}

/**
 * Two buttons side by side (D91), each shown once it has its text and
 * address, sharing size, corners and weight; one under another, each the
 * column's width, on phones if set.
 */
function DualButton({ block }: { block: DualButtonBlock }) {
  const sides = [block.first, block.second].filter(buttonShows);
  return (
    <div
      className={`inline-flex flex-wrap items-center ${block.stackOnPhones ? "max-md:flex max-md:flex-col max-md:items-stretch" : ""}`}
      style={{ gap: `${block.gap ?? 12}px` }}
    >
      {sides.map((side, index) => (
        <SideButton key={index} side={side} block={block} />
      ))}
    </div>
  );
}

function SideButton({ side, block }: { side: DualButtonSide; block: DualButtonBlock }) {
  const look = buttonLook({ ...side, size: block.size, shape: block.shape }, false, block.weight);
  return (
    <a href={side.href} {...(side.newTab && { target: "_blank", rel: "noopener noreferrer" })} style={look.style} className={look.className}>
      {side.label}
      {side.newTab && <span className="sr-only"> (opens in a new tab)</span>}
    </a>
  );
}

/**
 * An accordion (D91): each section the browser's own `details`, so it
 * opens without script and the browser's find opens the one holding what
 * was searched for; sections sharing a `name` close each other.
 */
function Accordion({ block }: { block: AccordionBlock }) {
  return <DetailsList block={block} items={block.items.filter((item) => item.title.trim() !== "")} />;
}

/**
 * Frequently asked questions (D91): drawn as the accordion is, with
 * schema.org's FAQPage beside them for search engines and AI assistants
 * unless switched off. Only questions with an answer show.
 */
function Faq({ block }: { block: FaqBlock }) {
  const items = block.items.filter(faqShows);
  return (
    <>
      <DetailsList block={block} items={items} />
      {block.structuredData !== false && items.length > 0 && (
        <JsonLdScript data={faqJsonLd(items.map((item) => ({ question: item.title, answer: richTextPlain(item.body) })))} />
      )}
    </>
  );
}

/** Titled items that open under their titles: an accordion's sections, or questions and answers. */
function DetailsList({ block, items }: { block: AccordionBlock | FaqBlock; items: PanelItem[] }) {
  const boxed = block.look === "boxed";
  return (
    <div className={boxed ? "flex flex-col gap-3" : "divide-y divide-border border-y border-border"}>
      {items.map((item, index) => (
        <details
          key={item.id}
          name={block.single ? `details-${block.id}` : undefined}
          open={Boolean(block.openFirst) && index === 0}
          className={`group ${boxed ? "rounded-lg border border-border px-4" : ""}`}
        >
          <summary
            className={`flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-medium [&::-webkit-details-marker]:hidden ${HEADING_SIZES[block.titleSize ?? "sm"]}`}
          >
            <span>{item.title}</span>
            <svg aria-hidden viewBox="0 0 24 24" className="size-5 shrink-0 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <div className="pb-4">
            <RichText doc={item.body} />
          </div>
        </details>
      ))}
    </div>
  );
}

/** Tabs (D91): the tab list chooses the panel (`TabsView`); the panels are drawn here, all in the page. */
function Tabs({ block }: { block: TabsBlock }) {
  const items = block.items.filter((item) => item.title.trim() !== "");
  return (
    <TabsView
      titles={items.map((item) => item.title)}
      look={block.look ?? "underline"}
      align={block.tabsAlign ?? "start"}
      panels={items.map((item) => (
        <RichText key={item.id} doc={item.body} />
      ))}
    />
  );
}

/** A video (D91): uploaded, or from YouTube or Vimeo, in its shape (16:9 unless set). */
function Video({ block }: { block: VideoBlock }) {
  const style = { aspectRatio: (block.ratio ?? "16:9").replace(":", " / ") };
  if (block.source === "upload") {
    if (!block.video) return null;
    return (
      <UploadedVideo
        src={block.video.url}
        poster={block.poster?.url}
        title={block.title}
        controls={block.controls !== false}
        autoplay={Boolean(block.autoplay)}
        loop={Boolean(block.loop)}
        style={style}
      />
    );
  }
  const player = embedUrl(block.source, block.link);
  if (!player) return null;
  return <EmbeddedVideo source={block.source} player={player} poster={block.poster?.url} title={block.title} style={style} />;
}
