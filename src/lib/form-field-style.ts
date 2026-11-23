/**
 * How a form's fields look (D878), a setting of the page's form components (`form`, `emailForm`, `newsletter`): the labels (above the
 * field, hidden where a placeholder names the field, or animated), the fields' look (outlined, filled or underlined), their colours and
 * sizes, and the animated labels' motion. Pure and free of zod, so the site's form reads it; the schema is in `form-field-style-schema.ts`.
 * Only what an owner changed is stored: a setting left out is the theme's (colours, corners) or the default below.
 *
 * The site draws it with `FORM_LOOK_CSS` (`form-look-css.ts`), from the data attributes and custom properties `fieldStyleAttrs()` gives the form.
 */

/** Where a question's words are: above the field (the default, left out), hidden where a placeholder is set, or animated. */
export const FIELD_LABEL_MODES = ["above", "placeholder", "animated"] as const;
export type FieldLabelMode = (typeof FIELD_LABEL_MODES)[number];

/** A field's look: a frame all round (the default, left out), a filled box, or a line under it. */
export const FIELD_LOOKS = ["outlined", "filled", "underline"] as const;
export type FieldLook = (typeof FIELD_LOOKS)[number];

/** How an animated label turns to capitals as it moves: the two spellings cross-fade (the default), it switches at once, or it keeps its case. */
export const LABEL_CASES = ["fade", "switch", "keep"] as const;
export type LabelCase = (typeof LABEL_CASES)[number];

/** Where a moved label lines up: with the field's edge (the default) or with the text inside it. */
export const LABEL_ALIGNS = ["edge", "text"] as const;
export type LabelAlign = (typeof LABEL_ALIGNS)[number];

/** The animation's easing, by name: each a CSS timing function. */
export const LABEL_EASINGS = {
  smooth: "cubic-bezier(.2,.7,.2,1)",
  inOut: "ease-in-out",
  bounce: "cubic-bezier(.34,1.56,.64,1)",
  linear: "linear",
} as const;
export type LabelEasing = keyof typeof LABEL_EASINGS;

/** Each number's bounds and default (the defaults are the prototype's the owner chose, 23 November 2026). */
export const FIELD_NUMBERS = {
  borderWidth: { min: 0, max: 4, step: 1 },
  radius: { min: 0, max: 32, step: 1 },
  padY: { min: 0, max: 32, step: 1 },
  padX: { min: 0, max: 40, step: 1 },
  gap: { min: 0, max: 64, step: 1 },
  textSize: { min: 12, max: 24, step: 1 },
} as const;
export type FieldNumber = keyof typeof FIELD_NUMBERS;

export const MOTION_NUMBERS = {
  duration: { min: 100, max: 1000, step: 20, default: 220 },
  movedSize: { min: 9, max: 16, step: 0.5, default: 11 },
  spacing: { min: 0, max: 0.3, step: 0.01, default: 0.08 },
  lift: { min: 0, max: 24, step: 1, default: 6 },
} as const;
export type MotionNumber = keyof typeof MOTION_NUMBERS;

/** An animated label's motion; every setting left out is its default. */
export type LabelMotion = {
  case?: Exclude<LabelCase, "fade">;
  align?: Exclude<LabelAlign, "edge">;
  /** Milliseconds the move takes. */
  duration?: number;
  easing?: Exclude<LabelEasing, "smooth">;
  /** The moved label's size in pixels. */
  movedSize?: number;
  /** The moved label's letter spacing, in em. */
  spacing?: number;
  /** Pixels between the moved label and its field. */
  lift?: number;
  /** The placeholder stays hidden once the label has moved; shown unless false. */
  placeholder?: false;
};

export type FieldStyle = {
  labels?: Exclude<FieldLabelMode, "above">;
  look?: Exclude<FieldLook, "outlined">;
  /** `#rrggbb` colours; the theme's unless set. `focus` also colours ticks and radio buttons. */
  background?: string;
  text?: string;
  border?: string;
  focus?: string;
  label?: string;
  placeholder?: string;
  /** Pixels. */
  borderWidth?: number;
  radius?: number;
  padY?: number;
  padX?: number;
  /** Pixels between questions. */
  gap?: number;
  textSize?: number;
  motion?: LabelMotion;
};

/** What `SiteForm` is handed (D878): the attributes and custom properties of its form, and how its labels show. */
export type FieldLookAttrs = { data: Record<string, string>; vars: Record<string, string>; labels?: FieldStyle["labels"] };

const COLOR_VARS = { background: "--kf-bg", text: "--kf-ink", border: "--kf-line", focus: "--kf-focus", label: "--kf-label", placeholder: "--kf-ph" } as const;
const PIXEL_VARS = { borderWidth: "--kf-bw", radius: "--kf-radius", padY: "--kf-py", padX: "--kf-px", gap: "--kf-gap", textSize: "--kf-size" } as const;

/**
 * What the form's element carries for `FORM_LOOK_CSS`: data attributes for the choices and custom properties for the values an owner set
 * (the stylesheet falls back to the theme's and the defaults). Nothing at all for a form left as it was.
 */
export function fieldStyleAttrs(style: FieldStyle | undefined): FieldLookAttrs {
  const data: Record<string, string> = {};
  const vars: Record<string, string> = {};
  if (!style) return { data, vars };
  if (style.labels) data["data-kf-labels"] = style.labels;
  if (style.look) data["data-kf-look"] = style.look;
  // A colour that replaces a browser's own (the focus ring, the placeholder's grey) is switched on by name: a missing custom property
  // would make the colour inherit, not fall back to the browser's.
  if (style.focus) data["data-kf-focus"] = "";
  if (style.placeholder) data["data-kf-phc"] = "";
  for (const [key, name] of Object.entries(COLOR_VARS)) {
    const value = style[key as keyof typeof COLOR_VARS];
    if (value) vars[name] = value;
  }
  for (const [key, name] of Object.entries(PIXEL_VARS)) {
    const value = style[key as keyof typeof PIXEL_VARS];
    if (value !== undefined) vars[name] = `${value}px`;
  }
  const motion = style.labels === "animated" ? style.motion : undefined;
  if (motion) {
    if (motion.case) data["data-kf-case"] = motion.case;
    if (motion.align) data["data-kf-align"] = motion.align;
    if (motion.placeholder === false) data["data-kf-ph"] = "hidden";
    if (motion.duration !== undefined) vars["--kf-dur"] = `${motion.duration}ms`;
    if (motion.easing) vars["--kf-ease"] = LABEL_EASINGS[motion.easing];
    if (motion.movedSize !== undefined) vars["--kf-moved"] = `${motion.movedSize}px`;
    if (motion.spacing !== undefined) vars["--kf-track"] = `${motion.spacing}em`;
    if (motion.lift !== undefined) vars["--kf-lift"] = `${motion.lift}px`;
  }
  return { data, vars, ...(style.labels ? { labels: style.labels } : {}) };
}

/** A style with what equals the default left out, and nothing when nothing is left: what the editor stores. */
export function trimFieldStyle(style: FieldStyle): FieldStyle | undefined {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style)) if (value !== undefined && key !== "motion") out[key] = value;
  if (style.motion) {
    const motion: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(style.motion)) {
      if (value === undefined) continue;
      const bound = MOTION_NUMBERS[key as MotionNumber];
      if (bound && value === bound.default) continue;
      motion[key] = value;
    }
    if (Object.keys(motion).length) out.motion = motion;
  }
  return Object.keys(out).length ? (out as FieldStyle) : undefined;
}

