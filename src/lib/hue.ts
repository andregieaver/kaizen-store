/**
 * Turning a colour's hue (D534): the one slider that recolours a row's or column's whole background, its layers with it. The colour is
 * turned in Oklab, where a turn keeps how light and how strong the colour is, so a dark backdrop stays dark and the text over it stays
 * readable; a grey has no hue and stays as it is. What comes out is always a `#rrggbb` the screen can show: a turned colour too strong for
 * sRGB is brought in by its strength alone. Pure, no zod: the site draws with it.
 */

/** How far a hue may be turned either way, in degrees; a full turn is the colour itself. */
export const HUE_MAX = 180;

const HEX = /^#[0-9a-f]{6}$/i;

/** Below this strength a colour is a grey: it has no hue to turn or to match. */
const GREY_BELOW = 0.02;

type Triple = [number, number, number];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function oklabOf(hex: string): Triple {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(Number.parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function linearRgbOf([L, a, b]: Triple): Triple {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** A little outside 0 to 1 is rounding, not a colour the screen cannot show. */
const SLACK = 0.0005;
const shows = (rgb: Triple) => rgb.every((c) => c >= -SLACK && c <= 1 + SLACK);

const hexOf = (rgb: Triple) =>
  `#${rgb
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, c))))) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

/** A turn as stored: whole degrees from -180 to 180, and none for no turn (or anything that is not a number). */
export function cleanHue(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const turn = Math.round(Math.min(HUE_MAX, Math.max(-HUE_MAX, value)));
  return turn === 0 ? undefined : turn;
}

/**
 * The colour with its hue turned by `degrees`, as light and as strong as it was. Anything that is not `#rrggbb` comes back as it was
 * given, as does every colour when there is no turn.
 */
export function shiftHue(colour: string, degrees: number | undefined): string {
  if (!degrees || !Number.isFinite(degrees) || degrees % 360 === 0 || !HEX.test(colour)) return colour;
  const [L, a, b] = oklabOf(colour);
  const strength = Math.hypot(a, b);
  if (strength < GREY_BELOW / 4) return colour;
  const angle = Math.atan2(b, a) + (degrees * Math.PI) / 180;
  const at = (c: number): Triple => linearRgbOf([L, c * Math.cos(angle), c * Math.sin(angle)]);
  let rgb = at(strength);
  if (!shows(rgb)) {
    // Too strong for the screen at this hue: the strongest it can show, found by halving.
    let low = 0;
    let high = strength;
    for (let i = 0; i < 18; i++) {
      const mid = (low + high) / 2;
      if (shows(at(mid))) low = mid;
      else high = mid;
    }
    rgb = at(low);
  }
  return hexOf(rgb);
}

/** A colour's hue in degrees (0 to 360), or null for a grey and for anything that is not `#rrggbb`. */
export function hueOf(colour: string): number | null {
  if (!HEX.test(colour)) return null;
  const [, a, b] = oklabOf(colour);
  if (Math.hypot(a, b) < GREY_BELOW) return null;
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
}

/**
 * The turn that gives `from` the hue of `to`, the short way round, in whole degrees; null when either is a grey (there is no hue to
 * match). "Match my theme": the turn that takes a backdrop's main colour to the theme's accent.
 */
export function hueBetween(from: string, to: string): number | null {
  const start = hueOf(from);
  const end = hueOf(to);
  if (start === null || end === null) return null;
  const turn = Math.round(((end - start + 540) % 360) - 180);
  return turn === -180 ? 180 : turn;
}
