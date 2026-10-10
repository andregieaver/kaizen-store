import { ICONS, type IconName } from "./icons";

/**
 * Icons in a table's cells (D201): a cell's words may hold `{{check}}`, `{{x}}` and so on (the names of `ICONS`), drawn as the icon in its
 * place. Pure, so the view, the editor, the checks and search all read a cell the same way.
 */

const TOKEN = /\{\{([A-Za-z]+)\}\}/g;

/** The token that puts an icon in a cell. */
export const iconToken = (name: IconName) => `{{${name}}}`;

const known = (name: string): name is IconName => Object.hasOwn(ICONS, name);

export type CellPart = { text: string } | { icon: IconName };

/** A cell's words in order: its text and its icons; a token of a name that is no icon stays the text typed. */
export function cellParts(text: string): CellPart[] {
  const out: CellPart[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (!known(match[1])) continue;
    if (match.index > last) out.push({ text: text.slice(last, match.index) });
    out.push({ icon: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** A cell's words without its icons, or with each named (what a reader of the words alone needs). */
export function withoutIcons(text: string, named = false): string {
  return cellParts(text)
    .map((part) => ("icon" in part ? (named ? ICONS[part.icon] : "") : part.text))
    .join(named ? " " : "")
    .replace(/\s+/g, " ")
    .trim();
}
