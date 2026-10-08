import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Size } from "@/lib/breakpoints";
import type { PageBlock } from "@/lib/page-content";

import { ColourSwatches } from "./colour-field";
import { AnimationFields } from "./motion-fields";
import { SizeEditContext } from "./responsive-edit";
import { TypographyFields } from "./typography-fields";

/**
 * The Typography panel and Animation (D179 phase 3), drawn on the server as the builder's other settings are tested (the
 * builder is only reached signed in): its groups per kind of text, its three sections, a device icon on every setting,
 * where a size's value comes from, and the entrance's delay and duration in seconds.
 */

const clean = (html: string) => html.replace(/<!-- -->/g, "");
const atSize = (size: Size, element: ReactElement) =>
  clean(renderToString(createElement(SizeEditContext, { value: { size, active: size !== "xl", choose: () => {} } }, element)));
const install = async () => ({ ok: true as const });
const panel = (part: object, size: Size = "xl") =>
  atSize(size, createElement(TypographyFields, { part: part as PageBlock, onChange: () => {}, install }));

describe("the Typography panel", () => {
  it("has Beaver's sections and every setting, each with its device icon", () => {
    const html = panel({ id: "t", type: "richText", doc: { type: "doc", content: [] } });
    for (const words of ["Typography", "Font", "Style &amp; spacing", "Text shadow", "Colour", "Opacity", "Family", "Weight", "Size", "Line height", "Align", "Letter spacing", "Transform", "Decoration", "Style", "Variant"]) {
      expect(html, words).toContain(`>${words}<`);
    }
    // Normal, Tt, TT and tt.
    for (const transform of ["Tt", "TT", "tt"]) expect(html).toContain(`>${transform}</button>`);
    // A device icon by each of the thirteen settings (D180's colour and opacity among them).
    expect(html.match(/data-size-switch=""/g)).toHaveLength(13);
    for (const unit of ["px", "em", "rem", "%", "vw"]) expect(html).toContain(`<option value="${unit}">`);
  });

  it("gives a component with several kinds of text a group each, and none to a component without text", () => {
    const html = panel({ id: "a", type: "accordion", items: [] });
    for (const group of ["Text", "Titles", "Texts"]) expect(html).toContain(`${group}`);
    expect(html.match(/data-size-switch=""/g)).toHaveLength(39);
    expect(panel({ id: "s", type: "separator" })).toBe("");
  });

  it("opens the Font section with the colour (D180): the theme's swatches, an opacity off until a colour is chosen, a × to clear", () => {
    const swatches = [{ name: "Text", colour: "#171717" }, { name: "Accent", colour: "#1d4ed8" }];
    const drawn = (part: object, size: Size = "xl") =>
      atSize(size, createElement(ColourSwatches, { value: swatches }, createElement(TypographyFields, { part: part as PageBlock, onChange: () => {}, install })));
    const none = drawn({ id: "h", type: "heading", text: "x", level: 2 });
    // Colour comes before Family.
    expect(none.indexOf(">Colour<")).toBeLessThan(none.indexOf(">Family<"));
    expect(none).toContain('aria-label="Text (#171717)"');
    expect(none).toContain('aria-label="Accent (#1d4ed8)"');
    expect(none).toContain("Choose a colour first.");
    expect(none).not.toContain("Clear colour");
    const set = drawn({ id: "h", type: "heading", text: "x", level: 2, typography: { text: { color: "#1d4ed8", opacity: 60 } } });
    expect(set).toContain('value="#1d4ed8"');
    expect(set).toContain('value="60"');
    expect(set).toContain('aria-label="Clear colour"');
    expect(set).toMatch(/aria-label="Accent \(#1d4ed8\)" aria-pressed="true"/);
    // On Small, inherited from Extra large, greyed with where it comes from.
    expect(drawn({ id: "h", type: "heading", text: "x", level: 2, typography: { text: { color: "#1d4ed8" } } }, "sm")).toContain("From Extra large");
    // A dual button: the buttons' text, and each button's own.
    const dual = drawn({ id: "d", type: "dualButton", first: { label: "A", href: "/" }, second: { label: "B", href: "/" } });
    for (const group of ["Buttons&#x27; text", "First button", "Second button"]) expect(dual).toContain(group);
  });

  it("offers no alignment where the component's Position places it", () => {
    expect(panel({ id: "b", type: "button", label: "Go", href: "/" })).not.toContain(">Align<");
  });

  it("shows a size's inherited value greyed with where it comes from, and its own with a ×", () => {
    const part = { id: "h", type: "heading", text: "x", level: 2, typography: { text: { size: { value: 40, unit: "px" } } }, at: { sm: { typography: { text: { weight: 700 } } } } };
    const md = panel(part, "md");
    expect(md).toContain("From Extra large");
    expect(md).toContain('value="40"');
    const sm = panel(part, "sm");
    expect(sm).toContain("Set for Small");
    expect(sm).toContain("Clear weight for Small");
  });
});

describe("Animation in the Advanced tab", () => {
  it("sets an entrance's delay and duration in seconds", () => {
    const html = atSize("xl", createElement(AnimationFields, { part: { kind: "row" }, motion: { enter: { effect: "fade", delay: 1500, duration: 2500 } }, onChange: () => {} }));
    expect(html).toContain(">Animation<");
    expect(html).toContain(">Delay<");
    expect(html).toContain(">Duration<");
    expect(html).toContain('value="1.5"');
    expect(html).toContain('value="2.5"');
    expect(html).toContain('step="0.1"');
    expect(html).toContain('max="10"');
    expect(html).toContain('max="5"');
  });

  it("asks for an entrance first", () => {
    const html = atSize("xl", createElement(AnimationFields, { part: { kind: "row" }, motion: undefined, onChange: () => {} }));
    expect(html).toContain("Choose an entrance under Motion");
  });
});
