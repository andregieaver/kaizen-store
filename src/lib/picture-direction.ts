/**
 * Pictures made by prompt in the page builder (D283, `src/server/picture-maker.ts`, `MakePictureButton`): what the person asks for, in the
 * site's own look. The look is worked out in code from the site's live theme (its photographer's brief, `ContentPack.look`, when the theme
 * has one; its colours and its light or dark mood always), so every picture a site makes sits with the others, and the model is told the look
 * sets the style, light and colour, never what is in the picture. No server code: the builder's dialog reads the shapes and limits too.
 */

import { baseScheme } from "./color-mode";
import type { ThemeSettings } from "./theme";

/** Every made picture, a pack's or a person's: no words, so nothing in it can mislead or need a licence. */
export const NO_TEXT = "No text, letters, numbers, logos, labels or watermarks anywhere in the picture.";

/** What every picture a person makes is held to, besides no words: anyone in it is invented. */
export const MADE_PICTURE_RULES = `${NO_TEXT} Any people in it are invented, never a real or famous person, in plain clothing without any branding.`;

/** How long a person's description may be. */
export const BRIEF_MAX = 1000;
/** The longest brief a theme content picture may be made again from (D283): a photographer's brief is a paragraph. */
export const SLOT_BRIEF_MAX = 2000;
/** And how short: a word or two says too little for a picture. */
export const BRIEF_MIN = 3;

export const PICTURE_SHAPES = ["landscape", "portrait", "square"] as const;
export type PictureShape = (typeof PICTURE_SHAPES)[number];
export const SHAPE_WORDS: Record<PictureShape, string> = { landscape: "Wide", portrait: "Tall", square: "Square" };

/** The shape nearest a picture's own, so a picture made again fits where the one before was. */
export function shapeOf(width: number, height: number): PictureShape {
  if (!(width > 0 && height > 0)) return "landscape";
  const ratio = width / height;
  return ratio > 1.15 ? "landscape" : ratio < 0.87 ? "portrait" : "square";
}

const HEX = /^#([0-9a-f]{6})$/i;

/** Hues by where each ends, in degrees round the colour wheel. */
const HUES: readonly [number, string][] = [
  [15, "red"],
  [40, "orange"],
  [65, "yellow"],
  [85, "lime"],
  [160, "green"],
  [195, "teal"],
  [255, "blue"],
  [290, "violet"],
  [345, "pink"],
  [360, "red"],
];

/** A colour in the words a picture model reads well ("deep blue", "warm off-white"), from `#rrggbb`; null for anything else. */
export function colourWords(hex: string): string | null {
  const match = HEX.exec(hex.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((part) => part / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  const chroma = max - min;
  const saturation = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * light - 1));
  if (saturation < 0.12 || chroma < 0.04) {
    if (light > 0.97) return "white";
    if (light > 0.85) return "off-white";
    if (light > 0.62) return "light grey";
    if (light > 0.38) return "grey";
    if (light > 0.14) return "charcoal";
    return "near-black";
  }
  let hue = 0;
  if (max === r) hue = ((g - b) / chroma) % 6;
  else if (max === g) hue = (b - r) / chroma + 2;
  else hue = (r - g) / chroma + 4;
  hue = (hue * 60 + 360) % 360;
  const hued = HUES.find(([below]) => hue < below)?.[1] ?? "red";
  // A dark orange reads as brown and a dark yellow as olive.
  const name = hued === "orange" && light < 0.4 ? "brown" : hued === "yellow" && light < 0.35 ? "olive" : hued;
  const shade = light > 0.85 ? "pale " : light > 0.68 ? "light " : light < 0.18 ? "very dark " : light < 0.32 ? "deep " : "";
  const tone = saturation < 0.35 && shade !== "very dark " ? "muted " : "";
  return `${shade}${tone}${name}`.trim();
}

/** What the site is, for the direction: its live theme's photographer's brief, its theme's settings, and a line about it. */
export type SiteLook = { look: string | null; settings: ThemeSettings | null; about: string | null };

const cut = (text: string, most: number) => {
  const plain = text.replace(/\s+/g, " ").trim();
  return plain.length <= most ? plain : `${plain.slice(0, most).replace(/\s+\S*$/, "")}…`;
};

/**
 * The site's look in words for the picture model, or null when nothing is known of it: the theme's photography (its pack's `look`), the
 * colours the site is shown in (its dark palette when it is always dark, `baseScheme()`) and its mood, and what the site is about.
 */
export function pictureDirection(site: SiteLook): string | null {
  const parts: string[] = [];
  if (site.look?.trim()) parts.push(cut(site.look, 1400));
  if (site.settings) {
    const scheme = baseScheme(site.settings);
    const palette = site.settings[scheme];
    const background = colourWords(palette.background);
    const text = colourWords(palette.text);
    const accent = colourWords(palette.accent);
    if (background && accent) {
      parts.push(
        `The website is ${background}${text ? ` with ${text} text` : ""} and ${accent} accents: the picture's colours sit well with them, ${
          scheme === "dark" ? "in a dark, low-key mood with deep shadows" : "without copying them onto everything"
        }.`,
      );
    }
  }
  if (site.about?.trim()) parts.push(`The website is about: ${cut(site.about, 300)}`);
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * The picture model's prompt: the person's description first, then the site's look (when it is followed), which sets the style, light and
 * colour and never adds anything the description does not ask for, then the rules.
 */
export function sitePicturePrompt(brief: string, direction: string | null): string {
  const said = brief.replace(/\s+/g, " ").trim();
  const ended = /[.!?]$/.test(said) ? said : `${said}.`;
  const look = direction
    ? ` Make it in the website's look, which sets the style, light and colour, never what is in the picture: ${direction}`
    : "";
  return `${ended}${look} ${MADE_PICTURE_RULES}`.slice(0, 4000);
}

/** A made picture's description for people who cannot see it, from what was asked for: its first sentence, as the library keeps alt text. */
export function altFromBrief(brief: string, most = 300): string {
  const said = brief.replace(/\s+/g, " ").trim();
  const first = /^(.+?[.!?])(\s|$)/.exec(said)?.[1] ?? said;
  return cut(first.replace(/[.!?]$/, ""), most);
}
