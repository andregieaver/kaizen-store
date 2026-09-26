import Image from "next/image";
import type { CSSProperties } from "react";

import {
  HEADING_DEFAULT_SIZE,
  frameStyle,
  type ButtonBlock,
  type ButtonShape,
  type ButtonSize,
  type FontWeight,
  type HeadingBlock,
  type HeadingSize,
  type ImageShape,
  type PageBlock,
} from "@/lib/page-content";

import { RichText } from "./rich-text";

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
