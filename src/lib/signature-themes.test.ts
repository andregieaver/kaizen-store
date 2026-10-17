import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { contentPack } from "./content-packs";
import { LAUNCH_THEMES, type LaunchTheme } from "./launch-themes";
import type { PageRow } from "./page-content";
import { signatureCheck, signatureWords } from "./signature-themes";

/** Signature themes (`docs/signature-themes.md`): themes made from scratch, held to the bar code can check. */

const PUBLIC = path.join(__dirname, "..", "..", "public");
const artExists = (url: string) => existsSync(path.join(PUBLIC, url));
const signature = LAUNCH_THEMES.filter((theme) => theme.signature);
const orbit = signature.find((theme) => theme.key === "orbit")!;

/** A copy of a theme with one layout's rows changed. */
const withRows = (theme: LaunchTheme, kind: "header" | "footer" | "productLayout", rows: (rows: PageRow[]) => PageRow[]): LaunchTheme => {
  const layout = theme.snapshot[kind]!;
  return { ...theme, snapshot: { ...theme.snapshot, [kind]: { ...layout, rows: rows(structuredClone(layout.rows)) } } };
};
const dropPart = (rows: PageRow[], part: string): PageRow[] =>
  rows.map((row) => ({ ...row, columns: row.columns.map((column) => ({ ...column, blocks: column.blocks.filter((block) => (block as { part?: string }).part !== part) })) }));

describe("signature themes", () => {
  it("include Orbit, and each meets the bar: its own layouts and CSS, a buy box on the first screen, art bundled, no claims", () => {
    expect(orbit).toBeDefined();
    for (const theme of signature) expect(signatureCheck(theme, { artExists }), theme.key).toEqual([]);
  });

  it("have their own demo store, art for every picture its pages and products use, and words the checks read", () => {
    const pack = contentPack(orbit.listing.pack ?? "")!;
    expect(pack.storeName).toBe("Far Light");
    expect(pack.design).toBe("orbit");
    const words = signatureWords(orbit, pack).join(" ");
    // The designed home page's own words are read, not only the pack's.
    expect(words).toContain("Fresh from the observatory");
    expect(words).toContain("Clear skies.");
  });

  it("refuse a theme that loses the shop's job or its world", () => {
    const noCart = withRows(orbit, "header", (rows) => dropPart(rows, "cart"));
    expect(signatureCheck(noCart, { artExists })).toContain("Its header has no cart.");
    const noBuy = withRows(orbit, "productLayout", (rows) => dropPart(rows, "buy"));
    expect(signatureCheck(noBuy, { artExists })).toContain("Its product page's first row has no buy, so a shopper may have to scroll to buy.");
    const noWithdrawal = withRows(orbit, "footer", (rows) => dropPart(rows, "withdrawal"));
    expect(signatureCheck(noWithdrawal, { artExists }).join(" ")).toContain("no withdrawal part");
    const noCss = { ...orbit, snapshot: { ...orbit.snapshot, css: "" } };
    expect(signatureCheck(noCss, { artExists })).toContain("It has no stylesheet of its own.");
    const noFooter = { ...orbit, snapshot: { ...orbit.snapshot, footer: null } };
    expect(signatureCheck(noFooter, { artExists })).toContain("It has no footer of its own.");
    expect(signatureCheck(orbit, { artExists: () => false }).join(" ")).toContain("is missing: run node scripts/theme-art.mjs orbit");
    const boasting = { ...orbit, summary: "The best price in the galaxy, only today!" };
    expect(signatureCheck(boasting, { artExists }).join(" ")).toContain("makes a claim the filter stops");
    // Every picture of its demo store is photographed from a brief (D270); the pack is the code's, so it is changed and put back here.
    const pack = contentPack("astronomy")!;
    const photos = pack.photos;
    try {
      Object.assign(pack, { photos: { ...photos, hero: undefined } });
      expect(signatureCheck(orbit, { artExists })).toContain("Its demo store has no photographer's brief for hero.");
    } finally {
      Object.assign(pack, { photos });
    }
    const notSignature = { ...orbit, signature: undefined };
    expect(signatureCheck(notSignature, { artExists })).toEqual(["Orbit is not marked as a signature theme."]);
  });
});
