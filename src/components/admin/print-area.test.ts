import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PRINT_AREA_CSS } from "./print-area";

/** Every file under a folder, recursively. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

const ADMIN = path.join(process.cwd(), "src", "app", "admin");
const PRINT_PAGES = [
  "(gated)/[store]/orders/pick-list/page.tsx",
  "(gated)/[store]/orders/packing-slips/page.tsx",
  "(gated)/[store]/orders/[orderId]/packing-slip/page.tsx",
];

describe("printing an admin page (D174: the packing slips and the pick list printed empty)", () => {
  it("leaves out only what is neither the print area, inside it, nor around it", () => {
    expect(PRINT_AREA_CSS).toContain("@media print");
    expect(PRINT_AREA_CSS).toContain("body *:not(:has([data-print-area])):not([data-print-area]):not([data-print-area] *)");
  });

  it("is how the slips and the pick list print", () => {
    for (const page of PRINT_PAGES) {
      const source = readFileSync(path.join(ADMIN, page), "utf8");
      expect(source, page).toContain("<PrintArea");
    }
  });

  it("never hides the body's children but <main>: in the admin's frame <main> sits in a wrapper beside the sidebar, so nothing printed", () => {
    const offenders = files(ADMIN)
      .filter((f) => /\.(tsx?|css)$/.test(f))
      .filter((f) => readFileSync(f, "utf8").includes("body > *:not(main)"));
    expect(offenders).toEqual([]);
  });
});
