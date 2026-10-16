import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import { DesignProfilePanel, type PanelDesign } from "./design-profile-panel";

/** Design settings' themes (`docs/theme-phase-3.md` step 2): *Add to my themes* beside *Apply* where the store has a library and may change. */

const design: PanelDesign = { id: "p1", title: "Hearth", summary: "Warm.", description: "", pictureUrl: null, previewHref: "/preview" };
const action = async () => ({ status: "idle" as const, messages: [] });
const draw = (props: Partial<Parameters<typeof DesignProfilePanel>[0]>) =>
  renderToString(createElement(DesignProfilePanel, { designs: [design], latest: null, apply: action, restore: null, canChange: true, ...props }));

describe("the themes panel", () => {
  it("offers adding a theme to the library, naming it, and links the theme store", () => {
    const html = draw({ install: action });
    expect(html).toContain("Add to my themes");
    expect(html).toMatch(/name="design" value="p1"/);
    expect(html).toContain('href="http://localhost:3000/themes"');
  });

  it("offers each of a theme's presets as a look of its own, previewed and added by its key (docs/theme-showcase-phase-1.md)", () => {
    const html = draw({ install: action, designs: [{ ...design, presets: [{ key: "coast", name: "Coast" }] }] }).replaceAll("<!-- -->", "");
    expect(html).toContain("Hearth · Coast");
    expect(html).toMatch(/name="preset" value="coast"/);
    expect(html).toContain('href="/preview?preset=coast"');
    // The theme's own look stays first, with no preset sent.
    expect(html.indexOf(">Hearth<")).toBeLessThan(html.indexOf("Hearth · Coast"));
    expect(html.match(/name="preset"/g)?.length).toBe(2);
  });

  it("offers no adding where there is no library or the person may not change", () => {
    expect(draw({})).not.toContain("Add to my themes");
    expect(draw({ install: action, canChange: false })).not.toContain("Add to my themes");
  });
});
