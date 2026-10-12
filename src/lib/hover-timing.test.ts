import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BrandsView } from "@/components/brands-view";
import { PageBlockView } from "@/components/page-block";
import { hoverTimingSchema, hoverTimingVars, themeHoverSchema } from "./hover-timing";
import { partFx } from "./motion-attrs";
import { partMotionSchema } from "./motion";
import { setHoverTime } from "./motion-edit";
import { pageBlockSchema, type BrandsBlock, type PageBlock } from "./page-content";
import { THEME_TEMPLATES, themeAttributes, themeCss, themeTabValue, withThemeTab, type ThemeSettings } from "./theme";

const theme = (): ThemeSettings => structuredClone(THEME_TEMPLATES.minimal.settings) as ThemeSettings;

describe("hover timing (D206)", () => {
  it("writes only what is set, from the closed list of easings", () => {
    expect(hoverTimingVars(undefined)).toEqual({});
    expect(hoverTimingVars({ duration: 350, ease: "snappy" })).toEqual({ "--kz-hover-dur": "350ms", "--kz-hover-ease": "cubic-bezier(0.22, 1, 0.36, 1)" });
    expect(hoverTimingSchema.safeParse({ duration: 5000 }).success).toBe(false);
    expect(hoverTimingSchema.safeParse({ ease: "url(x)" }).success).toBe(false);
    expect(hoverTimingSchema.parse({})).toBeUndefined();
  });

  it("is the theme's for the whole site, with the buttons' default effect, kept by the Theme tab", () => {
    const settings = withThemeTab(theme(), { ...themeTabValue(theme()), hover: { duration: 400, ease: "springy", button: "lift" } });
    expect(themeCss(settings, ":root")).toContain("--kz-hover-dur: 400ms");
    expect(themeAttributes(settings)["data-button-hover"]).toBe("lift");
    expect(themeCss(theme(), ":root")).not.toContain("--kz-hover-dur");
    expect(themeHoverSchema.safeParse({ button: "explode" }).success).toBe(false);
  });

  it("is a part's own for itself and what it holds, kept in its motion even with no effect", () => {
    const motion = setHoverTime(undefined, { duration: 600 });
    expect(partMotionSchema.parse(motion)).toEqual({ hoverTime: { duration: 600 } });
    expect(partFx(motion, "block").style).toMatchObject({ "--kz-hover-dur": "600ms" });
    expect(setHoverTime(motion, undefined)).toBeUndefined();
  });

  it("gives a button its own hover effect, else leaves it to the theme", () => {
    const button = (hover?: string) =>
      renderToStaticMarkup(createElement(PageBlockView, { block: pageBlockSchema.parse({ id: "b1", type: "button", label: "Go", href: "/x", ...(hover && { hover }) }) as PageBlock }));
    expect(button("sweep")).toContain('data-hover="sweep"');
    expect(button()).not.toContain("data-hover");
    expect(button()).toContain("kz-btn-filled");
    expect(pageBlockSchema.safeParse({ id: "b1", type: "button", label: "Go", href: "/x", hover: "wobble" }).success).toBe(false);
  });
});

describe("brand logos in one colour (D206)", () => {
  const block = (patch: Partial<BrandsBlock>): BrandsBlock =>
    pageBlockSchema.parse({ id: "b", type: "brands", items: [{ id: "i", name: "Acme", picture: { url: "https://example.com/a.png", width: 10, height: 5 } }], ...patch }) as BrandsBlock;

  it("fills each logo's shape with the brand colour, white or a chosen colour", () => {
    const html = renderToStaticMarkup(createElement(BrandsView, { block: block({ tint: "brand", colourOnHover: true }) }));
    expect(html).toContain('data-tint="brand"');
    expect(html).toContain("--brand-tint:var(--accent)");
    expect(html).toContain("kz-brand-mask");
    expect(html).toContain("data-tint-hover");
    expect(renderToStaticMarkup(createElement(BrandsView, { block: block({ tint: "custom", tintColor: "#FF0000" }) }))).toContain("--brand-tint:#ff0000");
  });

  it("inverts without a mask, and a custom colour without a colour is left as uploaded", () => {
    const inverted = renderToStaticMarkup(createElement(BrandsView, { block: block({ tint: "invert" }) }));
    expect(inverted).toContain('data-tint="invert"');
    expect(inverted).not.toContain("kz-brand-mask");
    expect(renderToStaticMarkup(createElement(BrandsView, { block: block({ tint: "custom" }) }))).not.toContain("data-tint");
  });
});
