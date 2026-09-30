import Image from "next/image";
import type { CSSProperties } from "react";

import {
  ROW_LAYOUTS,
  blockText,
  frameStyle,
  rowSpacing,
  spacingStyle,
  type PageBlock,
  type PageColumn,
  type ColumnJustify,
  type GradientBackground,
  type PageRow,
  type RowBackground,
  type TextAlignments,
  type VerticalAlign,
} from "@/lib/page-content";
import { fontClass } from "@/lib/fonts";
import type { BackgroundMotion } from "@/lib/motion";
import { backgroundFx } from "@/lib/motion-attrs";
import { summarize } from "@/lib/seo";

import { BackgroundVideo } from "./background-video";

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
const ITEMS: Record<VerticalAlign, string> = { top: "items-start", middle: "items-center", bottom: "items-end" };
const INLINE_JUSTIFY: Record<ColumnJustify, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
};
const TEXT_ALIGN = {
  mobile: { left: "text-left", center: "text-center", right: "text-right" },
  tablet: { left: "md:text-left", center: "md:text-center", right: "md:text-right" },
  desktop: { left: "lg:text-left", center: "lg:text-center", right: "lg:text-right" },
} as const;

/** Rounded corners over a background picture, video or gradient clip it. */
const clips = (part: PageRow | PageColumn) =>
  Boolean(part.radius) && (part.background?.type === "image" || part.background?.type === "video" || part.background?.type === "gradient");

/**
 * A part's colour, see-through if it has an opacity, and what is behind it
 * blurred (D86): frosted glass, such as a header over a picture.
 */
const colorStyle = (part: PageRow | PageColumn): CSSProperties => {
  const background = part.background;
  const css: CSSProperties =
    background?.type === "color"
      ? {
          backgroundColor:
            background.opacity === undefined ? background.color : `color-mix(in srgb, ${background.color} ${background.opacity}%, transparent)`,
        }
      : {};
  if (part.backdropBlur && (!background || background.type === "color")) {
    css.backdropFilter = `blur(${part.backdropBlur}px)`;
    css.WebkitBackdropFilter = `blur(${part.backdropBlur}px)`;
  }
  return css;
};

/**
 * The row itself: its background, height, margin and padding. A modal's row
 * (D121) is drawn `inPanel`: its border, corners, shadow and margin are the
 * panel's (`modalPanelStyle()`), which it fills.
 */
export function rowBox(row: PageRow, mode: PartsMode, inPanel = false): Box {
  const spacing = spacingStyle(rowSpacing(row.style));
  if (inPanel) for (const side of ["Top", "Right", "Bottom", "Left"]) delete spacing[`margin${side}`];
  return {
    id: mode === "site" ? row.htmlId : undefined,
    className: cx(
      "relative isolate flex flex-col",
      row.fullHeight && "min-h-svh",
      clips(row) && !inPanel && "overflow-hidden",
      mode === "site" && row.className,
    ),
    style: { ...spacing, ...(inPanel ? {} : frameStyle(row)), ...colorStyle(row) },
  };
}

/** A modal's panel (D121): the row's border, rounded corners and shadow, which it clips its content to. */
export function modalPanelStyle(row: PageRow): CSSProperties {
  return frameStyle(row) as CSSProperties;
}

/** Inside the row: in a full-width row, what it holds keeps to the content's width unless set to spread. */
export function rowInnerClass(row: PageRow, mode: PartsMode): string {
  const keep = row.width === "full" && row.contentWidth !== "full";
  return cx("flex flex-1 flex-col", keep && (mode === "site" ? "mx-auto w-full max-w-(--content-width)" : "px-6"));
}

/** The row's columns: side by side by its layout, stacked on phones (last first when reversed) unless kept side by side (D80). */
export function rowGrid(row: PageRow): Box {
  const align = row.align ?? "top";
  return {
    className: row.sideBySide
      ? cx(
          "grid gap-2 [grid-template-columns:var(--columns)] md:gap-8",
          row.fullHeight && "flex-1",
          row.equalHeight ? "items-stretch" : ITEMS[align],
        )
      : cx(
          "flex gap-8 md:grid md:[grid-template-columns:var(--columns)]",
          row.reverseOnMobile ? "flex-col-reverse" : "flex-col",
          row.fullHeight && "flex-1",
          JUSTIFY[align],
          row.equalHeight ? "md:items-stretch" : MD_ITEMS[align],
        ),
    // A width of 0 is a column as wide as what it holds (D80), narrower only when the row has no more room.
    style: {
      "--columns": ROW_LAYOUTS[row.layout].widths.map((w: number) => (w === 0 ? "minmax(0, max-content)" : `minmax(0, ${w}fr)`)).join(" "),
    } as CSSProperties,
  };
}

/** A column: its background, margin and padding, and where its content sits when columns are equally tall. */
export function columnBox(column: PageColumn, row: PageRow, mode: PartsMode): Box {
  return {
    id: mode === "site" ? column.htmlId : undefined,
    className: cx(
      // Side by side (D80): its components in a line that wraps, centred on each other, placed by `justify`.
      // In a row kept side by side (a header's), they stay on one line, the widest (a logo) narrowing first.
      column.inline
        ? cx(
            "relative isolate flex min-w-0 flex-row items-center gap-x-2 gap-y-2 [&>*]:min-w-0",
            row.sideBySide ? "flex-nowrap" : "flex-wrap",
            INLINE_JUSTIFY[column.justify ?? "start"],
          )
        : "relative isolate flex min-w-0 flex-col gap-6",
      !column.inline && row.equalHeight && JUSTIFY[row.align ?? "top"],
      // In the canvas the column sits inside its pointing band, which it fills.
      mode === "canvas" && "flex-1",
      clips(column) && "overflow-hidden",
      // Links in the text stay usable above the column's own link.
      mode === "site" && column.link && "[&_.rich-text_a]:relative [&_.rich-text_a]:z-[2]",
      mode === "site" && column.className,
    ),
    style: { ...spacingStyle(column.style), ...frameStyle(column), ...colorStyle(column) },
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
      "align" in block && alignClasses(block.align),
      // Its own font (D59) for all its text; the stylesheet comes with `FontLinks`.
      "font" in block && block.font && fontClass(block.font),
      block.type !== "button" && Boolean(block.radius) && "overflow-hidden",
      // A site's phone menu button is for phones; a part set so is left out on them, leaving no gap (D80).
      mode === "site" && block.type === "site" && (block.part === "menuButton" ? "md:hidden" : block.hideOnPhones && "max-md:hidden"),
      mode === "site" && block.type === "menu" && block.hideOnPhones && "max-md:hidden",
      mode === "site" && block.className,
    ),
    // A button's border, corners and shadow are the button's own (`PageBlockView`).
    style: { ...spacingStyle(block.style), ...(block.type === "button" ? {} : frameStyle(block)) },
  };
}

/** A blurred picture or video reaches past the edges by twice its blur, cut off there, so its soft rim does not show. */
const blurredMedia = (blur: number): CSSProperties | undefined =>
  blur
    ? { inset: -2 * blur, width: `calc(100% + ${4 * blur}px)`, height: `calc(100% + ${4 * blur}px)`, filter: `blur(${blur}px)` }
    : undefined;

const HEX = /^#[0-9a-f]{6}$/i;
const BACKGROUND_FRAME = "absolute inset-0 -z-10 overflow-hidden [border-radius:inherit]";

/** A gradient's colours as custom properties, from the colours the page holds (only `#rrggbb`, whatever else is dropped). */
function gradientVars(gradient: GradientBackground): CSSProperties | null {
  const colors = gradient.colors.filter((c) => HEX.test(c));
  if (colors.length < 2) return null;
  const angle = Number.isFinite(gradient.angle) ? Math.max(0, Math.min(360, gradient.angle as number)) : 135;
  return {
    "--fx-c1": colors[0],
    "--fx-c2": colors[1 % colors.length],
    "--fx-c3": colors[2 % colors.length],
    "--fx-c4": colors[3 % colors.length],
    // Round and back to the first, so a flowing or turning gradient has no seam.
    "--fx-stops": [...colors, colors[0]].join(", "),
    "--fx-angle": `${angle}deg`,
  } as CSSProperties;
}

/** Colours that move, drawn with CSS alone (motion.css): no picture to load, behind the part's content like any background. */
function GradientLayer({ gradient, motion, firstRow, preview }: { gradient: GradientBackground; motion?: BackgroundMotion; firstRow?: boolean; preview?: boolean }) {
  const vars = gradientVars(gradient);
  if (!vars) return null;
  const fx = backgroundFx(motion, { firstRow, preview });
  return (
    <div aria-hidden className={BACKGROUND_FRAME} data-fx-bgroot="" data-fx-gradient="" data-fx-flow={gradient.flow ?? "slow"} style={vars}>
      <div data-fx-layer="" {...fx.attrs} style={fx.style}>
        <div data-fx-grad={gradient.style}>
          {gradient.style === "aurora" && (
            <>
              <span data-fx-blob="1" />
              <span data-fx-blob="2" />
              <span data-fx-blob="3" />
            </>
          )}
        </div>
      </div>
      {gradient.grain && <div data-fx-grain="" />}
    </div>
  );
}

/**
 * A background picture, video or gradient, softened if blurred, and the
 * colour over it, behind what the row or column holds. A video shows its
 * still until it plays, and instead of it for people who prefer less
 * motion. With `motion` (D128) the picture or video sits on a layer larger
 * than its frame that moves with the scroll or by itself; without it the
 * markup is the plain one. `firstRow` is the page's first row, and `preview`
 * the builder's canvas.
 */
export function PartBackground({
  background,
  motion,
  firstRow,
  preview,
}: {
  background: RowBackground | undefined;
  motion?: BackgroundMotion;
  firstRow?: boolean;
  preview?: boolean;
}) {
  if (background?.type === "gradient") return <GradientLayer gradient={background} motion={motion} firstRow={firstRow} preview={preview} />;
  if (background?.type !== "image" && background?.type !== "video") return null;
  const fx = backgroundFx(motion, { firstRow, preview });
  const layered = Object.keys(fx.attrs).length > 0;
  const blur = background.blur ?? 0;
  const media = cx("absolute object-cover", blur ? "max-w-none" : "inset-0 size-full");
  const still = background.type === "image" ? background.image : background.poster;
  const picture = still && (
    <Image src={still.url} alt="" width={still.width} height={still.height} unoptimized className={media} style={blurredMedia(blur)} />
  );
  return (
    <>
      <div aria-hidden className={BACKGROUND_FRAME} {...(layered ? { "data-fx-bgroot": "" } : {})}>
        {layered ? (
          <div data-fx-layer="" {...fx.attrs} style={fx.style}>
            {picture}
          </div>
        ) : (
          picture
        )}
      </div>
      {background.type === "video" && (
        <BackgroundVideo
          src={background.video.url}
          poster={background.poster?.url}
          className={media}
          style={blurredMedia(blur)}
          layer={layered ? fx : undefined}
        />
      )}
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
