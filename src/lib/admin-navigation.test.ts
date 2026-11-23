import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { NAV_DOC, navDocProblems, navSections, writeNavDoc } from "./admin-navigation";
import { ACCOUNT_ITEMS } from "./owner-nav";
import { PLATFORM_SECTIONS, platformItemsOf } from "./platform-nav";
import { STORE_SECTIONS } from "./store-nav";

const doc = readFileSync(path.join(process.cwd(), NAV_DOC), "utf8");

/** The doc without what lies between its markers: the words written by hand. */
const prose = (text: string) => text.replace(/(<!-- nav:generated:start ([a-z-]+) -->)[\s\S]*?(<!-- nav:generated:end \2 -->)/g, "$1$3");

/** The addresses in a block's tables' Address column, each once per row. */
const addresses = (block: string) => block.split("\n").filter((line) => line.startsWith("| ") && line.includes("`/admin")).map((line) => line.split(" | ")[2]);

describe("the navigation doc (code review step 4.3, D885)", () => {
  it("has the menu's tables at all three levels: run pnpm nav:write when this fails", () => {
    expect(navDocProblems(doc)).toEqual({ markers: [], stale: [] });
  });

  it("lists every page of every sidebar once, at its address", () => {
    const sections = navSections();
    const store = STORE_SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.items));
    expect(addresses(sections["store-pages"])).toEqual(store.map((i) => [i.path, ...(i.also ?? [])].map((p) => `\`/admin/{store}${p}\``).join(", also ")));
    expect(addresses(sections["platform-pages"])).toEqual(PLATFORM_SECTIONS.flatMap(platformItemsOf).map((i) => `\`/admin/platform${i.path}\``));
    expect(addresses(sections["owner-pages"])).toEqual(ACCOUNT_ITEMS.map((i) => `\`/admin${i.path}\``));
  });

  it("goes out of date when a label changes, and is written back with the words around the tables kept", () => {
    const store = STORE_SECTIONS.map((s) => ({ ...s, groups: s.groups.map((g) => ({ ...g, items: g.items.map((i) => (i.path === "/returns" ? { ...i, label: "Withdrawals" } : i)) })) }));
    const renamed = navSections({ store });
    expect(navDocProblems(doc, renamed)).toEqual({ markers: [], stale: ["store-pages"] });
    const written = writeNavDoc(doc, renamed);
    expect(written).toContain("|  | Withdrawals | `/admin/{store}/returns` | Basic |  |");
    expect(prose(written)).toBe(prose(doc));
    expect(navDocProblems(written, renamed)).toEqual({ markers: [], stale: [] });
  });

  it("refuses a doc whose markers are broken rather than writing around them", () => {
    const broken = doc.replace("<!-- nav:generated:end owner-pages -->", "");
    const problems = navDocProblems(broken);
    expect(problems.markers.join()).toContain('section "store-pages" starts inside "owner-pages"');
    expect(problems.stale).toEqual([]);
  });
});
