import { SMALLER_SIZES } from "./breakpoints";
import { canonicalJson } from "./lifecycle";
import type { PageBlock, PageColumn, PageRow } from "./page-content";
import { TYPOGRAPHY_KEYS } from "./typography";
import type { SectionStyles } from "./section-styles";
import { themedRows, type ThemeElements } from "./theme-elements";

/**
 * The one-time migration of `docs/theme-store.md` 4.4 (D241; phase 1 runs it as a dry run only): a page's parts carry style settings written
 * in directly, many of them what the theme gives anyway. A setting whose removal leaves the page drawn exactly as before (the theme laid under
 * it gives the same, at every size, `themedRows()`) *follows the theme* once removed; any other setting is the owner's own and stays.
 *
 * Exact by construction: a setting is taken out only when the row it is in, laid under the theme, comes out identical without it, compared
 * as canonical JSON, one setting at a time against the row as it was, so the settings taken out together never change it either. Pure; the
 * page given is never changed.
 */

type Part = Record<string, unknown>;

/** A setting of a part: where it is, as a path of keys. */
type Path = readonly string[];

/** The settings of a part the theme can give (what `layerUnder()` lays under it), as paths that are set. */
function themableSettings(part: Part, isRow: boolean): Path[] {
  const paths: Path[] = [];
  const add = (path: Path) => {
    if (valueAt(part, path) !== undefined) paths.push(path);
  };
  const box = (prefix: Path) => {
    for (const key of TYPOGRAPHY_KEYS) add([...prefix, "typography", "text", key]);
    add([...prefix, "style", "margin"]);
    add([...prefix, "style", "padding"]);
    for (const key of ["border", "radius", "shadow", "contentMax", ...(isRow ? ["background"] : [])]) add([...prefix, key]);
  };
  box([]);
  for (const size of SMALLER_SIZES) box(["at", size]);
  if (isRow) for (const key of ["width", "contentWidth"]) add([key]);
  return paths;
}

function valueAt(part: Part, path: Path): unknown {
  let at: unknown = part;
  for (const key of path) {
    if (!at || typeof at !== "object") return undefined;
    at = (at as Part)[key];
  }
  return at;
}

/** `part` without the setting at `path`, with the boxes it leaves empty taken out too. */
function without(part: Part, path: Path): Part {
  const copy = structuredClone(part);
  const trail: Part[] = [copy];
  for (const key of path.slice(0, -1)) {
    const next = trail.at(-1)![key];
    if (!next || typeof next !== "object") return copy;
    trail.push(next as Part);
  }
  delete trail.at(-1)![path.at(-1)!];
  for (let i = trail.length - 1; i > 0; i -= 1) {
    if (Object.keys(trail[i]).length > 0) break;
    delete trail[i - 1][path[i - 1]];
  }
  return copy;
}

export type DetachResult = {
  rows: PageRow[];
  /** Settings taken out: they follow the theme from then on. */
  followed: number;
  /** Settings the theme can give that stay, because they are not what it gives: the owner's own. */
  own: number;
};

/** One part's place in a row, to read and write it back. */
type Where = { kind: "row" } | { kind: "column"; column: number } | { kind: "block"; column: number; block: number } | { kind: "child"; column: number; block: number; child: number };

function partsOf(row: PageRow): { where: Where; part: Part; isRow: boolean }[] {
  const out: { where: Where; part: Part; isRow: boolean }[] = [{ where: { kind: "row" }, part: row as unknown as Part, isRow: true }];
  row.columns.forEach((column, c) => {
    out.push({ where: { kind: "column", column: c }, part: column as unknown as Part, isRow: false });
    column.blocks.forEach((block, b) => {
      out.push({ where: { kind: "block", column: c, block: b }, part: block as unknown as Part, isRow: false });
      const children = (block as { items?: { blocks?: PageBlock[] }[] }).items;
      if (block.type === "faq" && Array.isArray(children)) {
        // An FAQ's answers' components (D208) are laid under the theme too; numbered across its items.
        let k = 0;
        for (const item of children) for (const child of item.blocks ?? []) out.push({ where: { kind: "child", column: c, block: b, child: k++ }, part: child as unknown as Part, isRow: false });
      }
    });
  });
  return out;
}

function put(row: PageRow, where: Where, part: Part): PageRow {
  if (where.kind === "row") return { ...(part as unknown as PageRow), columns: row.columns };
  const columns = row.columns.map((column, c): PageColumn => {
    if (c !== where.column) return column;
    if (where.kind === "column") return { ...(part as unknown as PageColumn), blocks: column.blocks };
    return {
      ...column,
      blocks: column.blocks.map((block, b) => {
        if (b !== where.block) return block;
        if (where.kind === "block") {
          const items = (block as { items?: unknown }).items;
          return { ...(part as unknown as PageBlock), ...(block.type === "faq" && { items }) } as PageBlock;
        }
        let k = 0;
        const items = ((block as { items?: { blocks?: PageBlock[] }[] }).items ?? []).map((item) => ({
          ...item,
          blocks: (item.blocks ?? []).map((child) => (k++ === where.child ? (part as unknown as PageBlock) : child)),
        }));
        return { ...block, items } as PageBlock;
      }),
    };
  });
  return { ...row, columns };
}

function current(row: PageRow, where: Where): Part {
  return partsOf(row).find((p) => canonicalJson(p.where) === canonicalJson(where))!.part;
}

/**
 * The components a theme element is laid under (`elementOfBlock()` in `theme-elements.ts`): their box and text, or (a dual button) only its
 * text. A column and any other component take nothing from the theme, so nothing of theirs is counted.
 */
const THEMED: Record<string, "box" | "text"> = { heading: "box", button: "box", dualButton: "text" };

/** A page's rows with every setting that only repeats the theme taken out, and the counts (`docs/theme-store.md` 4.4). */
export function detachThemeValues(rows: PageRow[], elements: ThemeElements | undefined, sections?: SectionStyles): DetachResult {
  if ((!elements || Object.keys(elements).length === 0) && !sections) return { rows, followed: 0, own: 0 };
  let followed = 0;
  let own = 0;
  const out = rows.map((original) => {
    // A global part (D98) is the same on every page that uses it: it is left as it is here, so no page differs from its source.
    if ((original as { global?: string }).global) return original;
    const drawn = canonicalJson(themedRows([original], elements, sections));
    let row = original;
    for (const { where, part, isRow } of partsOf(original)) {
      const kind = THEMED[String(part.type)];
      if (!isRow && !kind) continue;
      if (!isRow && (part as { global?: string }).global) continue;
      const settings = themableSettings(part, isRow).filter((path) => kind !== "text" || path.includes("typography"));
      for (const path of settings) {
        const next = put(row, where, without(current(row, where), path));
        if (canonicalJson(themedRows([next], elements, sections)) === drawn) {
          row = next;
          followed += 1;
        } else {
          own += 1;
        }
      }
    }
    return row;
  });
  return { rows: out, followed, own };
}
