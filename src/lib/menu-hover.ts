/**
 * How a menu's links answer the pointer and show the page the visitor is on (D207): a line above, below or both, or a
 * background, either growing from the link's centre (`grow`, CSS only) or one marker gliding from link to link
 * (`slide`, `MenuGlide` measures where it goes), with the owner's text colour and line or background colour or
 * gradient. The link of the page shown carries it too (`aria-current="page"`, marked in the browser so a cached page
 * stays the same for all) unless `active` is off. Only names and checked colours are kept; `menuHoverStyle()` alone
 * turns them into custom properties the rules in `globals.css` read, and every move takes the hover timing (D206).
 */

export const MENU_HOVER_KINDS = { line: "Line", background: "Background" } as const;
export type MenuHoverKind = keyof typeof MENU_HOVER_KINDS;
export const MENU_HOVER_EDGES = { below: "Below", above: "Above", both: "Above and below" } as const;
export type MenuHoverEdge = keyof typeof MENU_HOVER_EDGES;
export const MENU_HOVER_TRAVEL = { grow: "Grows from the centre", slide: "Glides between links" } as const;
export type MenuHoverTravel = keyof typeof MENU_HOVER_TRAVEL;

export const MENU_LINE_MAX = 8;
export const MENU_RADIUS_MAX = 40;

export type MenuHover = {
  kind: MenuHoverKind;
  /** Where the line is; below unless set. */
  edge?: MenuHoverEdge;
  /** Grows from the centre unless set. */
  travel?: MenuHoverTravel;
  /** The line's thickness in pixels; 2 unless set. */
  thickness?: number;
  /** The line's colour, or a background's; the theme's accent unless set. */
  color?: string;
  /** A background as a gradient (2–4 colours and an angle), over `color`. */
  gradient?: { colors: string[]; angle: number };
  /** The links' text colour under the pointer and on the page shown. */
  textColor?: string;
  /** A background's corners in pixels. */
  radius?: number;
  /** The page shown is marked the same way; on unless false. */
  active?: boolean;
};

/**
 * The attributes and custom properties a menu with an effect is drawn with, or none (the links' own grey hover).
 * Colours are checked `#rrggbb` and the rest numbers or names, so nothing the owner typed reaches CSS as text.
 */
export function menuHoverStyle(hover: MenuHover | undefined): { attrs: Record<string, string>; style: Record<string, string> } | null {
  if (!hover) return null;
  const colour = hover.color ?? "var(--accent)";
  const fill =
    hover.kind === "background" && hover.gradient ? `linear-gradient(${hover.gradient.angle}deg, ${hover.gradient.colors.join(", ")})` : `linear-gradient(${colour}, ${colour})`;
  return {
    attrs: {
      "data-mh": hover.kind,
      "data-mh-travel": hover.travel ?? "grow",
      ...(hover.kind === "line" && { "data-mh-edge": hover.edge ?? "below" }),
      ...(hover.textColor && { "data-mh-text": "" }),
      ...(hover.active !== false && { "data-mh-active": "" }),
    },
    style: {
      "--mh-fill": fill,
      "--mh-thick": `${hover.thickness ?? 2}px`,
      "--mh-radius": `${hover.kind === "background" ? (hover.radius ?? 6) : 0}px`,
      ...(hover.textColor && { "--mh-text": hover.textColor }),
    },
  };
}

/** Whether an address in a menu is the page shown: the same path, a trailing slash aside (the front page only for itself). */
export function isCurrentPath(href: string, pathname: string, origin = "http://x"): boolean {
  try {
    const url = new URL(href, origin);
    if (url.origin !== new URL(origin).origin) return false;
    const strip = (path: string) => (path.length > 1 ? path.replace(/\/+$/, "") : path);
    return strip(url.pathname) === strip(pathname);
  } catch {
    return false;
  }
}
