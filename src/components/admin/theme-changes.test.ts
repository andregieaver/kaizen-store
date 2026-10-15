import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { WhatChanges } from "@/lib/theme-changes";

import { ThemeChanges } from "./theme-changes";

/** *What changes* (D244): the sentences as a list, and a plain sentence when there is nothing to say. */
const empty: WhatChanges = { layouts: [], styles: [], own: { settings: 0, pages: 0 }, repeating: { settings: 0, pages: 0 }, fontsAdded: [], css: { live: false, target: false }, lines: [] };
const draw = (changes: WhatChanges) => renderToStaticMarkup(createElement(ThemeChanges, { live: "Custom", target: "Calm", changes })).replaceAll("<!-- -->", "");

describe("What changes (D244)", () => {
  it("lists each sentence", () => {
    const html = draw({ ...empty, lines: ["The header changes from “A” to the standard header.", "2 pages use the section style Hero; “Calm” has it."] });
    expect(html).toContain("What changes");
    expect(html).toContain("from “Custom” to “Calm”");
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(html).toContain("The header changes from “A” to the standard header.");
  });

  it("says plainly when nothing it can know changes", () => {
    expect(draw(empty)).toContain("they take “Calm” as it is");
  });
});
