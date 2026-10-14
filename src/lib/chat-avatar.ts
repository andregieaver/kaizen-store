import type { CSSProperties } from "react";

/**
 * How the chat agent's picture is framed on the site (D233): a fill behind it (a colour or a gradient, seen through a picture with
 * see-through parts and in place of the accent behind the chat icon when there is no picture), a border and a shadow. Read only
 * through `cleanAvatarStyle()` (it keeps only `#rrggbb` colours, whole numbers in range and the shadows of `AVATAR_SHADOWS`, so owner
 * data never becomes CSS of its own) and drawn only through `avatarFrameStyle()`. No zod here: the visitor's widget imports it (D211).
 */

export const AVATAR_FILLS = ["none", "colour", "gradient"] as const;
export type AvatarFill = (typeof AVATAR_FILLS)[number];

export const AVATAR_SHADOWS = ["none", "soft", "medium", "strong", "glow"] as const;
export type AvatarShadow = (typeof AVATAR_SHADOWS)[number];

export const AVATAR_BORDER_MAX = 8;

export type AvatarStyle = {
  fill: AvatarFill;
  /** The fill's colour, or the gradient's first. */
  colour: string;
  /** The gradient's second colour. */
  colour2: string;
  /** The gradient's direction in degrees (0 is upwards, 90 to the right). */
  angle: number;
  /** In pixels, 0 to `AVATAR_BORDER_MAX`; 0 is none. */
  border: number;
  borderColour: string;
  shadow: AvatarShadow;
  shadowColour: string;
};

export const DEFAULT_AVATAR_STYLE: AvatarStyle = {
  fill: "none",
  colour: "#e5e7eb",
  colour2: "#9ca3af",
  angle: 135,
  border: 0,
  borderColour: "#ffffff",
  shadow: "none",
  shadowColour: "#000000",
};

const HEX = /^#[0-9a-f]{6}$/i;

function colourOr(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX.test(value) ? value.toLowerCase() : fallback;
}

function wholeIn(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

function oneOf<T extends string>(list: readonly T[], value: unknown, fallback: T): T {
  return list.includes(value as T) ? (value as T) : fallback;
}

/** A saved or sent style as it may be drawn: anything unknown or out of range falls back to the standard look. Null for none. */
export function cleanAvatarStyle(raw: unknown): AvatarStyle | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const d = DEFAULT_AVATAR_STYLE;
  const style: AvatarStyle = {
    fill: oneOf(AVATAR_FILLS, r.fill, d.fill),
    colour: colourOr(r.colour, d.colour),
    colour2: colourOr(r.colour2, d.colour2),
    angle: wholeIn(r.angle, 0, 360, d.angle),
    border: wholeIn(r.border, 0, AVATAR_BORDER_MAX, d.border),
    borderColour: colourOr(r.borderColour, d.borderColour),
    shadow: oneOf(AVATAR_SHADOWS, r.shadow, d.shadow),
    shadowColour: colourOr(r.shadowColour, d.shadowColour),
  };
  return isPlain(style) ? null : style;
}

/** Whether a style changes nothing (kept as null). */
export function isPlain(style: AvatarStyle): boolean {
  return style.fill === "none" && style.border === 0 && style.shadow === "none";
}

/** A shadow in its colour, at the preset's strength (`#rrggbb` with two hex digits of alpha). */
function shadowCss(shadow: AvatarShadow, colour: string): string | undefined {
  switch (shadow) {
    case "none":
      return undefined;
    case "soft":
      return `0 1px 3px ${colour}40`;
    case "medium":
      return `0 4px 12px ${colour}59`;
    case "strong":
      return `0 10px 28px ${colour}73`;
    case "glow":
      return `0 0 0 3px ${colour}33, 0 0 16px ${colour}99`;
  }
}

/** The fill as a CSS background, or undefined for none. */
export function avatarFill(style: AvatarStyle): string | undefined {
  if (style.fill === "colour") return style.colour;
  if (style.fill === "gradient") return `linear-gradient(${style.angle}deg, ${style.colour}, ${style.colour2})`;
  return undefined;
}

/** The inline style of the picture's frame: its fill, border and shadow. Empty for none. */
export function avatarFrameStyle(style: AvatarStyle | null | undefined): CSSProperties {
  if (!style) return {};
  const css: CSSProperties = {};
  const fill = avatarFill(style);
  if (fill) css.background = fill;
  if (style.border > 0) css.border = `${style.border}px solid ${style.borderColour}`;
  const shadow = shadowCss(style.shadow, style.shadowColour);
  if (shadow) css.boxShadow = shadow;
  return css;
}
