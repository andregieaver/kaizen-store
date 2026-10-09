import Image from "next/image";
import type { CSSProperties } from "react";

import {
  blockText,
  type PageBlock,
  type PageColumn,
  type ColumnJustify,
  type GradientBackground,
  type PageRow,
  type RowBackground,
  type VerticalAlign,
} from "@/lib/page-content";
import { fontClass } from "@/lib/fonts";
import type { BackgroundMotion } from "@/lib/motion";
import { backgroundFx } from "@/lib/motion-attrs";
import { blockStyle, clipsAnywhere, columnStyle, inlineNowrap, panelStyle, partClass, rowGridStyle, rowStyle, rowWidthStyle, type PartsMode } from "@/lib/part-css";
import { SIZES } from "@/lib/breakpoints";
import { valueAt } from "@/lib/responsive";
import { summarize } from "@/lib/seo";
import { boxFamilies } from "@/lib/typography";

import { BackgroundVideo } from "./background-video";

/**
 * How a page's rows, columns and blocks are drawn with their settings (D47,
 * D48), shared by the site (`PageArticle`) and the page builder's canvas so
 * both look the same. The canvas leaves out custom ids, classes and column
 * links, and its "full width" is the canvas's. What can differ by screen size
 * (D179) is drawn by the part stylesheet (`src/lib/part-css.ts`, `PartStyles`):
 * these give each element its classes, and the stylesheet says the rest.
 */
export type { PartsMode };

type Box = { id?: string; className: string; style: CSSProperties };

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

// Written out whole so Tailwind finds every class.
const JUSTIFY: Record<VerticalAlign, string> = {
  top: "[justify-content:start]",
  middle: "[justify-content:center]",
  bottom: "[justify-content:end]",
};
const INLINE_JUSTIFY: Record<ColumnJustify, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
};

/**
 * The row itself: its background, height, margin and padding. A modal's row
 * (D121) is drawn `inPanel`: its border, corners, shadow and margin are the
 * panel's (`modalPanelBox()`), which it fills.
 */
export function rowBox(row: PageRow, mode: PartsMode, inPanel = false): Box {
  return {
    id: mode === "site" ? row.htmlId : undefined,
    className: cx(
      partClass(row),
      rowStyle(row, inPanel, mode).className,
      // Its font (D179), which what it holds inherits.
      ...boxFamilies(row).map(fontClass),
      "relative isolate flex flex-col",
      row.fullHeight && "min-h-svh",
      clipsAnywhere(row) && !inPanel && "overflow-hidden",
      mode === "site" && row.className,
    ),
    style: {},
  };
}

/** A modal's panel (D121): the row's border, rounded corners and shadow, which it clips its content to. */
export function modalPanelClass(row: PageRow): string {
  return panelStyle(row).className;
}

/**
 * Inside the row: in a full-width row, what it holds keeps to the content's width unless set to spread. On the canvas the
 * same, in the room the content width leaves (`rowInnerStyle()`), and the frame the resize handles sit in (D182).
 */
export function rowInnerClass(row: PageRow, mode: PartsMode): string {
  const keep = row.width === "full" && row.contentWidth !== "full";
  return cx(
    "flex flex-1 flex-col",
    keep && (mode === "site" ? `mx-auto w-full max-w-(--content-width) ${rowWidthStyle(row).className}` : `relative mx-auto w-full px-6 ${rowWidthStyle(row).className}`),
  );
}

/** What the canvas adds to a full-width row's inside (its content width, as the site's `max-w-(--content-width)`; the canvas's room is 3rem in from its edges). */
export function rowInnerStyle(row: PageRow, mode: PartsMode): CSSProperties | undefined {
  const keep = row.width === "full" && row.contentWidth !== "full";
  return mode === "canvas" && keep ? { maxWidth: "calc(var(--content-width, 64rem) + 3rem)" } : undefined;
}

/**
 * The canvas's band around a row, where it is pointed at (D44): a full-width row reaches the canvas's edges; any other
 * is as wide as its content may be (the theme's, or its own, D182), centred, with a margin of room for its tools.
 */
export function rowFrame(row: PageRow): { className: string; style: CSSProperties | undefined } {
  if (row.width === "full") return { className: "-mx-6 -my-4 py-4", style: undefined };
  return {
    className: cx("-my-4 px-4 py-4", rowWidthStyle(row).className),
    style: {
      width: "min(calc(100% + 2rem), calc(var(--content-width, 64rem) + 2rem))",
      marginInline: "max(-1rem, calc((100% - var(--content-width, 64rem) - 2rem) / 2))",
    },
  };
}

/** The row's columns: side by side by its layout, or stacked where it stacks (Small unless set, D179; last first when reversed). */
export function rowGrid(row: PageRow): Box {
  return { className: cx(rowGridStyle(row).className, row.fullHeight && "flex-1"), style: {} };
}

/** A column: its background, margin and padding, and where its content sits when columns are equally tall. */
export function columnBox(column: PageColumn, row: PageRow, mode: PartsMode): Box {
  return {
    id: mode === "site" ? column.htmlId : undefined,
    className: cx(
      partClass(column),
      columnStyle(column, mode).className,
      ...boxFamilies(column).map(fontClass),
      // Side by side (D80): its components in a line that wraps, centred on each other, placed by `justify`.
      // In a row that never stacks (a header's), they stay on one line, the widest (a logo) narrowing first.
      column.inline
        ? cx(
            "relative isolate flex min-w-0 flex-row items-center gap-x-2 gap-y-2 [&>*]:min-w-0",
            inlineNowrap(row) ? "flex-nowrap" : "flex-wrap",
            INLINE_JUSTIFY[column.justify ?? "start"],
          )
        : "relative isolate flex min-w-0 flex-col gap-6",
      !column.inline && row.equalHeight && JUSTIFY[row.align ?? "top"],
      // In the canvas the column sits inside its pointing band, which it fills.
      mode === "canvas" && "flex-1",
      clipsAnywhere(column) && "overflow-hidden",
      // Links in the text stay usable above the column's own link.
      mode === "site" && column.link && "[&_.rich-text_a]:relative [&_.rich-text_a]:z-[2]",
      mode === "site" && column.className,
    ),
    style: {},
  };
}

/**
 * Around a block: its margin, padding, border and shadow, and the alignment
 * of rich text, a heading or a button, by screen size (the part stylesheet).
 * Rounded corners clip what it holds, such as a picture. A button takes its
 * frame itself.
 */
export function blockBox(block: PageBlock, mode: PartsMode): Box {
  // A picture's box is the picture's own width (D151), so its frame, effects, id and classes hug it, not the empty column beside
  // it; none without a picture, so the empty block keeps the whole column. The limit is a class and a custom property
  // (`--picture-width`, by size in the part stylesheet), never an inline width: owner CSS and the page replicator's `#id`
  // rules can still say otherwise.
  const picture = block.type === "image" && block.image !== null;
  return {
    id: mode === "site" ? block.htmlId : undefined,
    className: cx(
      partClass(block),
      blockStyle(block, mode).className,
      // `box-content` makes the limit the picture's width however much padding and border the block has.
      picture && "box-content max-w-(--picture-width)",
      // Its own font (D59) for all its text, from its typography (D179); the stylesheet comes with `FontLinks`.
      ...boxFamilies(block).map(fontClass),
      block.type !== "button" && SIZES.some((size) => Boolean(valueAt(block, "radius", size))) && "overflow-hidden",
      mode === "site" && block.className,
    ),
    style: {},
  };
}

/** A blurred picture or video reaches past the edges by twice its blur, cut off there, so its soft rim does not show. */
const blurredMedia = (blur: number): CSSProperties | undefined =>
  blur
    ? { inset: -2 * blur, width: `calc(100% + ${4 * blur}px)`, height: `calc(100% + ${4 * blur}px)`, filter: `blur(${blur}px)` }
    : undefined;

const HEX = /^#[0-9a-f]{6}$/i;
/** A fixed background (D184): its frame clips the layer that stays on the screen, so only the row's window of it shows. */
const FIXED_FRAME = "[clip-path:inset(0)]";
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
function GradientLayer({
  gradient,
  motion,
  firstRow,
  preview,
  fixed = false,
}: {
  gradient: GradientBackground;
  motion?: BackgroundMotion;
  firstRow?: boolean;
  preview?: boolean;
  fixed?: boolean;
}) {
  const vars = gradientVars(gradient);
  if (!vars) return null;
  // A fixed background (D184) stays still on the screen, so it does not move with the scroll; its colours still flow.
  const fx = backgroundFx(fixed ? undefined : motion, { firstRow, preview });
  return (
    <>
      <div
        aria-hidden
        className={cx(BACKGROUND_FRAME, fixed && FIXED_FRAME)}
        data-fx-bgroot=""
        data-fx-gradient=""
        data-fx-flow={gradient.flow ?? "slow"}
        // How solid it is (D183): what is behind the part shows through the rest. A fixed one's frame is no container (that would hold the fixed layer in it): its layer is.
        style={{
          ...vars,
          ...(gradient.opacity !== undefined && gradient.opacity < 100 && { opacity: gradient.opacity / 100 }),
          ...(fixed && { containerType: "normal" }),
        }}
      >
        <div data-fx-layer="" {...fx.attrs} className={fixed ? "fixed inset-0" : undefined} style={{ ...fx.style, ...(fixed && { containerType: "size" }) }}>
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
      {gradient.overlay && (
        <div aria-hidden className="absolute inset-0 -z-10" style={{ backgroundColor: gradient.overlay.color, opacity: gradient.overlay.opacity / 100 }} />
      )}
    </>
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
  fixed = false,
}: {
  background: RowBackground | undefined;
  motion?: BackgroundMotion;
  firstRow?: boolean;
  preview?: boolean;
  /** The picture, video or gradient stays where it is on the screen while the page scrolls, and what is over it moves (D184). */
  fixed?: boolean;
}) {
  if (background?.type === "gradient") return <GradientLayer gradient={background} motion={motion} firstRow={firstRow} preview={preview} fixed={fixed} />;
  if (background?.type !== "image" && background?.type !== "video") return null;
  // A fixed one is not moved by the scroll or by effects: a layer that moves would hold it in the row.
  const fx = backgroundFx(fixed ? undefined : motion, { firstRow, preview });
  const layered = Object.keys(fx.attrs).length > 0;
  const blur = background.blur ?? 0;
  const media = cx(fixed ? "fixed object-cover" : "absolute object-cover", blur ? "max-w-none" : "inset-0 size-full");
  const still = background.type === "image" ? background.image : background.poster;
  const picture = still && (
    <Image src={still.url} alt="" width={still.width} height={still.height} unoptimized className={media} style={blurredMedia(blur)} />
  );
  return (
    <>
      <div aria-hidden className={cx(BACKGROUND_FRAME, fixed && FIXED_FRAME)} {...(layered ? { "data-fx-bgroot": "" } : {})}>
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
          clipped={fixed}
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
