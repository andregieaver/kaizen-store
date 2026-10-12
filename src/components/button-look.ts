import type { CSSProperties } from "react";

import type { ButtonBlock, ButtonShape, ButtonSize, FontWeight, ImageShape } from "@/lib/page-content";

/**
 * How buttons and cropped pictures look on the site (D49, D206): only classes and colours, with no page model or schema, so the
 * browser's own parts (a form's button, a grid's tiles) use them without loading zod.
 */

/** Crops (D48). */
export const SHAPES: Record<ImageShape, string> = {
  landscape: "aspect-[4/3] object-cover rounded-lg",
  portrait: "aspect-[3/4] object-cover rounded-lg",
  panorama: "aspect-[3/1] object-cover rounded-lg",
  square: "aspect-square object-cover rounded-lg",
  circle: "aspect-square object-cover rounded-full",
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

/** How a button looks (D49): its kind, size, corners and colours; also a content grid's tile buttons (D51). */
export type ButtonLook = Pick<ButtonBlock, "variant" | "size" | "shape" | "fill" | "hover">;

/** The classes and colours of a link that looks like a button. */
export function buttonLook(
  look: ButtonLook | undefined,
  fullWidth = false,
  weight: FontWeight = "medium",
): { className: string; style: CSSProperties; hover?: ButtonLook["hover"] } {
  const variant = look?.variant ?? "filled";
  const size = look?.size ?? "md";
  // How it answers the pointer is `kz-btn` and its variant's class, with the button's own or the theme's effect (D206, globals.css).
  const colors =
    variant === "filled"
      ? "kz-btn-filled border-2 border-transparent bg-accent text-accent-foreground"
      : variant === "outline"
        ? "kz-btn-outline border-2 border-current text-foreground"
        : "kz-btn-text text-foreground underline underline-offset-4";
  return {
    className: `kz-btn relative z-[2] inline-flex items-center justify-center text-center ${WEIGHTS[weight]} focus-visible:outline-2 focus-visible:outline-offset-2 ${
      BUTTON_SIZES[size]
    } ${variant === "text" ? "" : `${BUTTON_PADDING[size]} ${BUTTON_SHAPES[look?.shape ?? "rounded"]}`} ${fullWidth ? "w-full" : ""} ${colors}`,
    // Its text colour is its block's typography (D180), which beats this as the inline colour it was.
    style: {
      ...(variant === "filled" ? { backgroundColor: look?.fill } : { color: look?.fill, borderColor: look?.fill }),
      ...(look?.fill && { "--kz-btn-fill": look.fill }),
    } as CSSProperties,
    ...(look?.hover && { hover: look.hover }),
  };
}
