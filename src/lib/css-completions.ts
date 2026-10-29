/**
 * What the CSS editor offers beyond CSS itself (D394): the variables a site's theme sets (`themeCss()`), so `var(--` finds them, and the
 * class names the page and the site already use (text styles, the classes given to parts under Advanced), so `.` finds them. Pure, so the
 * browser's editor and its tests read the same lists; `css-completions.test.ts` holds the variables to what `themeCss()` writes.
 */

/** The custom properties every store's and Kaizena Flow's theme sets, with what each is. */
export const THEME_VARIABLES: readonly { name: string; detail: string }[] = [
  { name: "--background", detail: "Page background" },
  { name: "--foreground", detail: "Text" },
  { name: "--muted", detail: "Quiet text" },
  { name: "--surface", detail: "Cards and panels" },
  { name: "--border", detail: "Lines and borders" },
  { name: "--accent", detail: "Accent" },
  { name: "--accent-foreground", detail: "Text on the accent" },
  { name: "--content-width", detail: "Content width" },
  { name: "--button-radius", detail: "Button corners" },
  { name: "--radius-md", detail: "Corners" },
  { name: "--radius-lg", detail: "Large corners" },
  { name: "--heading-weight", detail: "Heading weight" },
  { name: "--card-aspect", detail: "Product picture shape" },
];

const CLASS_NAME = /^-?[A-Za-z_][\w-]*$/;

/** Class names from parts' Advanced settings (`className`, space-separated) and text styles' slugs, each once, in a stable order. */
export function knownClassNames(partClasses: readonly (string | undefined)[], styleSlugs: readonly string[]): string[] {
  const names = new Set<string>();
  for (const slug of styleSlugs) names.add(`ts-${slug}`);
  for (const value of partClasses) for (const name of (value ?? "").split(/\s+/)) if (CLASS_NAME.test(name)) names.add(name);
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Where a class name is being typed: the `.` and the word after it, when the dot starts a class (not `0.5em`, not inside a string or a
 * comment, which the editor's syntax tree rules out before asking). The offset of the dot, or null.
 */
export function classNameStart(lineBefore: string): number | null {
  const match = /(^|[^\w.-])\.(-?[\w-]*)$/.exec(lineBefore);
  if (!match) return null;
  return lineBefore.length - match[2].length - 1;
}
