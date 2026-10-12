import Image from "next/image";
import type { ReactNode } from "react";

import { Inline } from "@/components/inline-text";
import { inlinePlain } from "@/lib/inline-text";
import {
  faqShows,
  richTextPlain,
  type AccordionBlock,
  type FaqBlock,
  type FaqItem,
  type PanelItem,
  richTextIsEmpty,
  blockHasContent,
  buttonShows,
  imageDisplaySize,
  type ButtonBlock,
  type DualButtonBlock,
  type DualButtonSide,
  type HeadingBlock,
  type PageBlock,
  type SeparatorBlock,
  type TabsBlock,
  type VideoBlock,
  type TestimonialsBlock,
  testimonialShows,
  isLinkAddress,
} from "@/lib/page-content";

import { faqJsonLd } from "@/lib/seo";
import { embedUrl } from "@/lib/video-embed";

import { SHAPES, buttonLook } from "./button-look";
import { EmbeddedVideo, HtmlFrame, TabsView, UploadedVideo } from "./lazy/blocks";
import { blockBox } from "./page-parts";
import { IconListView } from "./icon-list-view";
import { TableView } from "./table-view";
import { BrandsView } from "./brands-view";
import { GalleryView } from "./gallery-view";
import { JsonLdScript } from "./json-ld";
import { RichText } from "./rich-text";
import { SocialLinksView } from "./social-links-view";
import { TestimonialCards } from "./testimonials-view";

// Written out whole so Tailwind finds every class.

// How buttons and pictures look, kept apart so the browser's parts (a form, a grid) can use them without the whole page model.
export { SHAPES, WEIGHTS, buttonLook, type ButtonLook } from "./button-look";

/**
 * One block as the site shows it (D42, D47, D49): rich text, a picture with
 * its caption (in its own shape or cropped to one, D48), a heading or a
 * button. The page builder's canvas shows blocks with this too.
 */
export function PageBlockView({
  block,
  renderChildren,
  eager = false,
}: {
  block: PageBlock;
  renderChildren?: ChildRenderer;
  /** In a row that may be on the first screen: its picture loads at once and before the others, never lazily. */
  eager?: boolean;
}) {
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
    case "search":
      // The store's search is looked up where it is shown (`SearchSection`, D112); the editor shows a stand-in.
      return null;
    case "plans":
      // Kaizen's plans are looked up where the page is shown (`PlansSection`, D142); the editor shows a stand-in.
      return null;
    case "customField":
      // The page's own values are looked up where it is shown (`CustomFieldSection`, D118); the editor shows a stand-in.
      return null;
    case "fieldLoop":
      // The page's own repeater rows are looked up where it is shown (`FieldLoopSection`, D120); the editor shows a stand-in.
      return null;
    case "storePart":
      // A working page's component draws where it is shown (`StorePartSection`, D113); the editor shows a stand-in.
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
      return <Faq block={block} renderChildren={renderChildren ?? siteChildren} />;
    case "video":
      return <Video block={block} />;
    case "socialLinks":
      return <SocialLinksView block={block} />;
    case "iconList":
      return <IconListView block={block} />;
    case "table":
      return <TableView block={block} />;
    case "brands":
      return <BrandsView block={block} />;
    case "gallery":
      return <GalleryView block={block} />;
    case "emailForm":
    case "newsletter":
      // Sent from the site (`SiteForm`, drawn by the page's rows with the site's owner, D93); the editor shows it itself.
      return null;
    case "testimonials":
      // Google's reviews are fetched where they are shown (`GoogleReviewsSection`); the editor shows a stand-in.
      return block.source === "google" ? null : <Testimonials block={block} />;
    case "html":
      return block.html.trim() ? <HtmlFrame html={block.html} title={block.title} height={block.height} waitForClick={Boolean(block.waitForClick)} /> : null;
    case "image": {
      // Its own size, never stretched to the column (D151): the box `blockBox()` draws is as wide as the picture and no wider than
      // the column, so the picture shrinks to a narrower column or a phone, keeping its shape, and the caption stays under it.
      const size = imageDisplaySize(block);
      if (!block.image || !size) return null;
      const picture = (
        <Image
          src={block.image.url}
          alt={block.image.alt}
          width={size.width}
          height={size.height}
          unoptimized
          {...(eager ? { loading: "eager" as const, fetchPriority: "high" as const } : {})}
          className={`h-auto max-w-full ${block.shape ? SHAPES[block.shape] : "rounded-lg"}`}
        />
      );
      const href = block.href?.trim() ?? "";
      return (
        <figure>
          {href !== "" && isLinkAddress(href) ? (
            <a
              href={href}
              className="inline-block max-w-full focus-visible:outline-2"
              {...(block.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {picture}
              {block.newTab && <span className="sr-only"> (opens in a new tab)</span>}
            </a>
          ) : (
            picture
          )}
          {block.caption && (
            <figcaption className="mt-2 text-sm text-muted [overflow-wrap:anywhere]">
              <Inline text={block.caption} links />
            </figcaption>
          )}
        </figure>
      );
    }
  }
}

/**
 * A heading (D49): its size (by its level unless set), weight (the theme's unless set), alignment, font and colour are its
 * typography (D179, D180), drawn by the part stylesheet by the store's screen sizes.
 */
function Heading({ block }: { block: HeadingBlock }) {
  const Tag = `h${block.level}` as const;
  return (
    <Tag className="leading-tight text-balance font-heading">
      <Inline text={block.text} links />
    </Tag>
  );
}

/**
 * A link that looks like a button. Its colour fills it, or draws an
 * outline's line and text, or colours a text link; its text colour is for
 * a filled button. It stays usable above a column's own link.
 */
function Button({ block }: { block: ButtonBlock }) {
  // Its weight, medium unless its typography sets one (D179).
  const look = buttonLook(block, block.fullWidth);
  return (
    <a
      href={block.href}
      // An A/B test counts clicks on a button by its block (D148).
      data-block-id={block.id}
      {...(block.newTab && { target: "_blank", rel: "noopener noreferrer" })}
      // A border, corners and shadow chosen for the button win over its style's own (by size, the block's rules, D179).
      data-button-frame=""
      data-hover={look.hover}
      style={look.style}
      className={look.className}
    >
      <Inline text={block.label} />
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
  return (
    <div
      // One under another where it stacks (D179: the block's rules, `blockStyle()`).
      data-dual-buttons=""
      className="inline-flex flex-wrap items-center"
      style={{ gap: `${block.gap ?? 12}px` }}
    >
      {(["first", "second"] as const)
        .filter((which) => buttonShows(block[which]))
        .map((which) => (
          <SideButton key={which} which={which} side={block[which]} block={block} />
        ))}
    </div>
  );
}

function SideButton({ which, side, block }: { which: "first" | "second"; side: DualButtonSide; block: DualButtonBlock }) {
  const look = buttonLook({ ...side, size: block.size, shape: block.shape, hover: block.hover });
  return (
    <a
      href={side.href}
      data-hover={look.hover}
      {...(side.newTab && { target: "_blank", rel: "noopener noreferrer" })}
      style={look.style}
      className={look.className}
      // Each button's own typography (its colour, D180).
      data-kz-text={which}
    >
      <Inline text={side.label} />
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
function Faq({ block, renderChildren }: { block: FaqBlock; renderChildren: ChildRenderer }) {
  const items = block.items.filter(faqShows);
  return (
    <>
      <DetailsList block={block} items={items} renderChildren={renderChildren} />
      {block.structuredData !== false && items.some((item) => answerText(item) !== "") && (
        // The answer's words: its text and its components' (D208).
        // An answer of components with no words (a button alone) says nothing to search engines, so it is left out of the data.
        <JsonLdScript data={faqJsonLd(items.map((item) => ({ question: inlinePlain(item.title), answer: answerText(item) })).filter((item) => item.answer !== ""))} />
      )}
    </>
  );
}

/** How the components in an answer are drawn (D208): the site's own drawing, or the canvas's, which can choose them. */
export type ChildRenderer = (blocks: PageBlock[]) => ReactNode;

/** An answer's components as the site draws a column's, each in its box (its id, classes and part styles), one under another. */
const siteChildren: ChildRenderer = (blocks) =>
  blocks.filter(blockHasContent).map((child) => {
    const b = blockBox(child, "site");
    return (
      <div key={child.id} id={b.id} className={b.className || undefined} style={b.style}>
        <PageBlockView block={child} />
      </div>
    );
  });

/** An answer's words for the FAQPage data: its text, then its components' words. */
const answerText = (item: FaqItem) =>
  [richTextPlain(item.body), ...(item.blocks ?? []).map((child) => (child.type === "richText" ? richTextPlain(child.doc) : child.type === "heading" ? inlinePlain(child.text) : ""))]
    .filter((text) => text.trim() !== "")
    .join("\n\n");

/** Titled items that open under their titles: an accordion's sections, or questions and answers. */
function DetailsList({ block, items, renderChildren }: { block: AccordionBlock | FaqBlock; items: (PanelItem | FaqItem)[]; renderChildren?: ChildRenderer }) {
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
            className={`flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-medium [&::-webkit-details-marker]:hidden text-lg`}
          >
            <span>
              <Inline text={item.title} />
            </span>
            <svg aria-hidden viewBox="0 0 24 24" className="size-5 shrink-0 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <div className="pb-4">
            {!richTextIsEmpty(item.body) && <RichText doc={item.body} />}
            {/* An answer's components (D208), under its text. */}
            {renderChildren && "blocks" in item && item.blocks && item.blocks.length > 0 && (
              <div className="kz-answer-parts mt-3 flex flex-col gap-3">{renderChildren(item.blocks)}</div>
            )}
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
      titles={items.map((item) => <Inline key={item.id} text={item.title} />)}
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

/** Testimonials written in by the owner (D91): those with words. */
function Testimonials({ block }: { block: TestimonialsBlock }) {
  return (
    <TestimonialCards
      entries={block.items.filter(testimonialShows).map((item) => ({
        key: item.id,
        quote: item.quote,
        name: item.name,
        role: item.role,
        rating: item.rating,
        picture: item.picture?.url,
      }))}
      columns={block.columns}
      look={block.look}
      showRating={block.showRating !== false}
      carousel={block.display === "carousel"}
      carouselSettings={block.carousel}
    />
  );
}
