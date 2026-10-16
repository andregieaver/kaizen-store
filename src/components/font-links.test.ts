import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FontLinks } from "./font-links";

describe("FontLinks (D59)", () => {
  it("links each family once, and never a name the stylesheet route would refuse", () => {
    const html = renderToStaticMarkup(createElement(FontLinks, { families: ["Lora", "Lora", undefined, null, "", "Comic Sans!", "Open Sans"] }));
    expect([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(["/api/fonts/css/lora?v=1", "/api/fonts/css/open-sans?v=1"]);
  });
});
