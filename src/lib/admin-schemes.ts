/**
 * The admin's colour schemes and the colour roles every one of them sets (docs/admin-style.md, sections 4 and 7.1). A scheme is a
 * stylesheet in `src/app/admin/schemes/{id}.css`, imported by the admin's root layout, that gives each role in `ADMIN_ROLES` a value
 * in light and in dark; components and `admin.css` read the roles only. `admin-schemes.test.ts` reads every registered scheme's file
 * and holds it to `CONTRAST_RULES`. Pure, and free of anything heavy, so a picker in the browser can read it.
 */

/** The colour roles, by group. A scheme sets every one, in light and in dark. */
export const SURFACE_ROLES = ["canvas", "card", "sunken", "rail", "rail-icon", "ink", "ink-2", "muted", "faint", "line", "edge", "inverse", "inverse-ink"] as const;
export const BRAND_ROLES = ["brand", "brand-ink", "brand-hover", "brand-text", "brand-soft", "focus"] as const;
export const SIGNALS = ["positive", "warning", "danger", "neutral", "insight"] as const;
export const SIGNAL_PARTS = ["solid", "text", "soft", "line"] as const;
/** The chart and tone colours (D152, D216) a scheme sets too, so a chart reads in its colours. */
export const CHART_ROLES = [
  ...[1, 2, 3, 4, 5, 6].map((n) => `chart-${n}`),
  ...[0, 1, 2, 3, 4, 5, 6].flatMap((n) => [`chart-seq-${n}`, `chart-seq-${n}-ink`]),
  "chart-good",
  "chart-bad",
  "chart-warn",
  "chart-grid",
  "chart-axis",
  "chart-compare",
  ...[1, 2, 3, 4, 5].map((n) => `tone-${n}`),
] as const;

export type Signal = (typeof SIGNALS)[number];

/** Every role a scheme sets (custom property names without `--`). Shadows are set too but are not colours. */
export const ADMIN_ROLES: readonly string[] = [
  ...SURFACE_ROLES,
  ...BRAND_ROLES,
  ...SIGNALS.flatMap((signal) => SIGNAL_PARTS.map((part) => `${signal}-${part}`)),
  ...CHART_ROLES,
];

/** The shadows a scheme sets (docs/admin-style.md 4.5). */
export const SHADOW_ROLES = ["shadow-float", "shadow-modal"] as const;

/**
 * The pairs a scheme must keep readable, in light and in dark: [foreground, background, minimum ratio, what it is]. Text is 4.5:1; a
 * focus ring is 3:1 (a non-text mark). A signal's `-solid` is not here: a dot or a bar always comes with its words (section 1.2).
 */
export const CONTRAST_RULES: readonly [string, string, number, string][] = [
  ...(["card", "canvas", "sunken"] as const).flatMap((bg) =>
    (["ink", "ink-2", "muted"] as const).map((fg): [string, string, number, string] => [fg, bg, 4.5, `${fg} text on ${bg}`]),
  ),
  ["brand-ink", "brand", 4.5, "words on the main action"],
  ["brand-ink", "brand-hover", 4.5, "words on the main action under the pointer"],
  ["brand-text", "card", 4.5, "the brand as text on a card"],
  ["brand-text", "brand-soft", 4.5, "the brand as text on its tint (the current sidebar item)"],
  ["inverse-ink", "inverse", 4.5, "words on the inverse (the current tab, a card's strong button)"],
  ["danger-text", "danger-line", 4.5, "a danger button's words under the pointer"],
  ["rail-icon", "rail", 4.5, "the rail's icons"],
  ["focus", "card", 3, "the focus ring on a card"],
  ["focus", "canvas", 3, "the focus ring on the canvas"],
  ...SIGNALS.flatMap((signal): [string, string, number, string][] => [
    [`${signal}-text`, `${signal}-soft`, 4.5, `${signal} words on their tint`],
    [`${signal}-text`, "card", 4.5, `${signal} words on a card`],
  ]),
];

export type AdminScheme = {
  id: string;
  /** Its name where people choose one. */
  name: string;
  /** Three colours for a picker's swatch: the canvas, the rail and the brand, in light. */
  swatch: { canvas: string; rail: string; brand: string };
  /** Offered to people; a scheme being made is registered with `false`, so its tests run before anyone can pick it. */
  offered: boolean;
};

/** The registered schemes; the first is the default (what an <html> without `data-admin-scheme` gets). */
export const ADMIN_SCHEMES: readonly AdminScheme[] = [
  { id: "meadow", name: "Meadow", swatch: { canvas: "#f0f1eb", rail: "#101614", brand: "#3bd968" }, offered: true },
];

export const DEFAULT_ADMIN_SCHEME = ADMIN_SCHEMES[0].id;

/** A scheme by its id, or the default one for an id that is not registered. */
export const adminScheme = (id: string | null | undefined): AdminScheme => ADMIN_SCHEMES.find((s) => s.id === id) ?? ADMIN_SCHEMES[0];
