import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ThemeCheckResult } from "@/lib/theme-check";

import { ThemeChecks } from "./theme-checks";

/** The theme checks on a theme's Details tab (D246): passed, or each finding by check, what blocks first. */
const draw = (result: ThemeCheckResult | null) => renderToStaticMarkup(createElement(ThemeChecks, { result })).replaceAll("<!-- -->", "");

describe("Theme checks (D246)", () => {
  it("says a draft that passes can be published", () => {
    const html = draw({ findings: [], blocking: 0 });
    expect(html).toContain("Passes");
    expect(html).toContain("the draft can be published");
  });

  it("groups findings by check, what blocks first, with a count", () => {
    const html = draw({
      findings: [
        { check: "contrast", blocking: false, where: "Colours (light)", message: "Secondary text is hard to read." },
        { check: "contrast", blocking: true, where: "Colours (dark)", message: "Text on the background is hard to read." },
        { check: "sections", blocking: true, where: "Section style Quote", message: "Missing." },
      ],
      blocking: 2,
    });
    expect(html).toContain("2 to fix");
    expect(html).toContain('aria-label="Contrast"');
    expect(html.indexOf("Colours (dark)")).toBeLessThan(html.indexOf("Colours (light)"));
    expect(html).toContain("Section styles");
  });

  it("draws nothing without a result", () => {
    expect(draw(null)).toBe("");
  });
});
