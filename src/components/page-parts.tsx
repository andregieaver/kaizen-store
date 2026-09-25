import Image from "next/image";
import type { CSSProperties } from "react";

import {
  ROW_LAYOUTS,
  blockText,
  frameStyle,
  spacingStyle,
  type Background,
  type PageBlock,
  type PageColumn,
  type PageRow,
  type TextAlignments,
  type VerticalAlign,
} from "@/lib/page-content";
import { summarize } from "@/lib/seo";

/**
 * How a page's rows, columns and blocks are drawn with their settings (D47,
 * D48), shared by the site (`PageArticle`) and the page builder's canvas so
 * both look the same. The canvas leaves out custom ids, classes and column
 * links, and its "full width" is the canvas's.
 */
export type PartsMode = "site" | "canvas";

type Box = { id?: string; className: string; style: CSSProperties };

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

// Written out whole so Tailwind finds every class.
const JUSTIFY: Record<VerticalAlign, string> = {
  top: "[justify-content:start]",
  middle: "[justify-content:center]",
  bottom: "[justify-content:end]",
};
const MD_ITEMS: Record<VerticalAlign, string> = { top: "md:items-start", middle: "md:items-center", bottom: "md:items-end" };
const TEXT_ALIGN = {
  mobile: { left: "text-left", center: "text-center", right: "text-right" },
  tablet: { left: "md:text-left", center: "md:text-center", right: "md:text-right" },
  desktop: { left: "lg:text-left", center: "lg:text-center", right: "lg:text-right" },
} as const;

/** Rounded corners over a background picture clip it. */
const clips = (part: PageRow | PageColumn) => Boolean(part.radius) && part.background?.type === "image";

const colorStyle = (background: Background | undefined): CSSProperties =>
  background?.type === "color" ? { backgroundColor: background.color } : {};

/** The row itself: its background, height, margin and padding. */
export function rowBox(row: PageRow, mode: PartsMode): Box {
  return {
    id: mode === "site" ? row.htmlId : undefined,
    className: cx(
      "relative isolate flex flex-col",
      row.fullHeight && "min-h-svh",
      clips(row) && "overflow-hidden",
      mode === "site" && row.className,
    ),
    style: { ...spacingStyle(row.style), ...frameStyle(row), ...colorStyle(row.background) },
  };
}

/** Inside the row: in a full-width row, what it holds keeps to the content's width unless set to spread. */
export function rowInnerClass(row: PageRow, mode: PartsMode): string {
  const keep = row.width === "full" && row.contentWidth !== "full";
  return cx("flex flex-1 flex-col", keep && (mode === "site" ? "mx-auto w-full max-w-5xl px-4" : "px-6"));
}

/** The row's columns: side by side by its layout, stacked on phones (last first when reversed). */
export function rowGrid(row: PageRow): Box {
  const align = row.align ?? "top";
  return {
    className: cx(
      "flex gap-8 md:grid md:[grid-template-columns:var(--columns)]",
      row.reverseOnMobile ? "flex-col-reverse" : "flex-col",
      row.fullHeight && "flex-1",
      JUSTIFY[align],
      row.equalHeight ? "md:items-stretch" : MD_ITEMS[align],
    ),
    style: { "--columns": ROW_LAYOUTS[row.layout].widths.map((w) => `minmax(0, ${w}fr)`).join(" ") } as CSSProperties,
  };
}

/** A column: its background, margin and padding, and where its content sits when columns are equally tall. */
export function columnBox(column: PageColumn, row: PageRow, mode: PartsMode): Box {
  return {
    id: mode === "site" ? column.htmlId : undefined,
    className: cx(
      "relative isolate flex min-w-0 flex-col gap-6",
      row.equalHeight && JUSTIFY[row.align ?? "top"],
      // In the canvas the column sits inside its pointing band, which it fills.
      mode === "canvas" && "flex-1",
      clips(column) && "overflow-hidden",
      // Links in the text stay usable above the column's own link.
      mode === "site" && column.link && "[&_.rich-text_a]:relative [&_.rich-text_a]:z-[2]",
      mode === "site" && column.className,
    ),
    style: { ...spacingStyle(column.style), ...frameStyle(column), ...colorStyle(column.background) },
  };
}

function alignClasses(align: TextAlignments | undefined): string | false {
  return (
    Boolean(align) &&
    cx(
      align?.mobile && TEXT_ALIGN.mobile[align.mobile],
      align?.tablet && TEXT_ALIGN.tablet[align.tablet],
      align?.desktop && TEXT_ALIGN.desktop[align.desktop],
    )
  );
}

/**
 * Around a block: its margin, padding, border and shadow, and the alignment
 * by screen of rich text, a heading or a button. Rounded corners clip what
 * it holds, such as a picture. A button takes its frame itself.
 */
export function blockBox(block: PageBlock, mode: PartsMode): Box {
  return {
    id: mode === "site" ? block.htmlId : undefined,
    className: cx(
      block.type !== "image" && alignClasses(block.align),
      block.type !== "button" && Boolean(block.radius) && "overflow-hidden",
      mode === "site" && block.className,
    ),
    // A button's border, corners and shadow are the button's own (`PageBlockView`).
    style: { ...spacingStyle(block.style), ...(block.type === "button" ? {} : frameStyle(block)) },
  };
}

/** A background picture, and the colour over it, behind what the row or column holds. */
export function PartBackground({ background }: { background: Background | undefined }) {
  if (background?.type !== "image") return null;
  return (
    <>
      <Image
        src={background.image.url}
        alt=""
        width={background.image.width}
        height={background.image.height}
        unoptimized
        className="absolute inset-0 -z-10 size-full object-cover"
      />
      {background.overlay && (
        <div
          aria-hidden
          className="absolute inset-0 -z-10"
          style={{ backgroundColor: background.overlay.color, opacity: background.overlay.opacity / 100 }}
        />
      )}
    </>
  );
}

/** The link over a whole column (D48), named by its description or else the column's words. */
export function ColumnLinkCover({ column }: { column: PageColumn }) {
  if (!column.link) return null;
  const name = column.link.label || summarize(column.blocks.map(blockText).join(" "), 100) || column.link.href;
  return (
    <a
      href={column.link.href}
      aria-label={name}
      className="absolute inset-0 z-[1] rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
    />
  );
}
