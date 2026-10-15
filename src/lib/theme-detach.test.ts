import { describe, expect, it } from "vitest";

import { DEFAULT_BREAKPOINTS } from "./breakpoints";
import { canonicalJson } from "./lifecycle";
import type { PageBlock, PageRow } from "./page-content";
import { partCss } from "./part-css";
import { detachThemeValues } from "./theme-detach";
import { themedRows, type ThemeElements } from "./theme-elements";

/**
 * The migration of docs/theme-store.md 4.4 (D241, a dry run in phase 1): a setting that only repeats the theme is taken out and follows the
 * theme from then on; one that differs is the owner's and stays; and the page is drawn exactly as before.
 */

const heading = (extra: Record<string, unknown> = {}): PageBlock => ({ id: "h", type: "heading", text: "Hello", level: 2, ...extra }) as PageBlock;
const rowOf = (blocks: PageBlock[], extra: Partial<PageRow> = {}): PageRow => ({ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks }], ...extra });

const elements: ThemeElements = {
  h2: { typography: { text: { size: { value: 2, unit: "rem" }, weight: 700 } }, at: { sm: { typography: { text: { size: { value: 1.5, unit: "rem" } } } } } },
  h3: { typography: { text: { size: { value: 2, unit: "rem" }, weight: 700 } } },
  row: { radius: 8 },
};
const drawn = (rows: PageRow[]) => canonicalJson(themedRows(rows, elements));
const sheet = (rows: PageRow[]) => partCss(themedRows(rows, elements), "site", DEFAULT_BREAKPOINTS);

describe("detachThemeValues()", () => {
  it("takes out what the theme gives anyway and keeps what is the owner's own", () => {
    const rows = [
      rowOf(
        [
          // The size the theme gives, and a colour of the owner's.
          heading({ level: 3, typography: { text: { size: { value: 2, unit: "rem" }, color: "#ff0000" } } }),
          // A weight that differs from the theme's.
          heading({ id: "h2", level: 3, typography: { text: { weight: 400 } } }),
        ],
        { radius: 8 },
      ),
    ];
    const result = detachThemeValues(rows, elements);
    expect(result.followed).toBe(2);
    expect(result.own).toBe(2);
    const [row] = result.rows;
    expect(row.radius).toBeUndefined();
    expect((row.columns[0].blocks[0] as { typography?: unknown }).typography).toEqual({ text: { color: "#ff0000" } });
    expect((row.columns[0].blocks[1] as { typography?: unknown }).typography).toEqual({ text: { weight: 400 } });
    // Drawn exactly as before, rules and all; the rows given are not changed.
    expect(drawn(result.rows)).toBe(drawn(rows));
    expect(sheet(result.rows)).toBe(sheet(rows));
    expect(rows[0].radius).toBe(8);
  });

  it("keeps a value set at a larger size that a smaller size of the theme would otherwise change", () => {
    // 2rem at every size is the owner's: the theme says 1.5rem on phones, so taking it out would change phones.
    const rows = [rowOf([heading({ typography: { text: { size: { value: 2, unit: "rem" } } } })])];
    const result = detachThemeValues(rows, elements);
    expect(result).toMatchObject({ followed: 0, own: 1 });
    expect(drawn(result.rows)).toBe(drawn(rows));
  });

  it("takes out a smaller size's value that repeats the theme's at that size, and empty boxes with it", () => {
    const rows = [rowOf([heading({ at: { sm: { typography: { text: { size: { value: 1.5, unit: "rem" } } } } } })])];
    const result = detachThemeValues(rows, elements);
    expect(result).toMatchObject({ followed: 1, own: 0 });
    expect((result.rows[0].columns[0].blocks[0] as { at?: unknown }).at).toBeUndefined();
    expect(drawn(result.rows)).toBe(drawn(rows));
  });

  it("changes nothing when the theme says nothing, and counts nothing of parts the theme does not style", () => {
    const rows = [rowOf([{ id: "t", type: "richText", doc: { type: "doc", content: [] }, radius: 4 } as unknown as PageBlock], { radius: 8 })];
    expect(detachThemeValues(rows, undefined)).toEqual({ rows, followed: 0, own: 0 });
    expect(detachThemeValues(rows, { h1: { radius: 2 } })).toMatchObject({ followed: 0, own: 1 });
  });

  it("leaves a global row as it is, so no page differs from its source (D243)", () => {
    const rows = [rowOf([heading({ level: 3, typography: { text: { size: { value: 2, unit: "rem" } } } })], { radius: 8, global: "g1" } as Partial<PageRow>)];
    const result = detachThemeValues(rows, elements);
    expect(result).toMatchObject({ followed: 0, own: 0 });
    expect(result.rows[0]).toBe(rows[0]);
  });

  it("measures a row naming a section style against that style (D242, D243)", () => {
    const sections = { hero: { h3: { typography: { text: { size: { value: 4, unit: "rem" } } } } } };
    // 4rem is what the hero style gives a row naming it, not what the site gives.
    const big = heading({ level: 3, typography: { text: { size: { value: 4, unit: "rem" } } } });
    const named = detachThemeValues([rowOf([big], { sectionStyle: "hero" })], elements, sections);
    expect(named.followed).toBe(1);
    const plain = detachThemeValues([rowOf([big])], elements, sections);
    expect(plain).toMatchObject({ followed: 0, own: 1 });
  });
});
