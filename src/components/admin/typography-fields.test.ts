import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Size } from "@/lib/breakpoints";
import type { PageBlock } from "@/lib/page-content";

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
    for (const words of ["Typography", "Font", "Style &amp; spacing", "Text shadow", "Family", "Weight", "Size", "Line height", "Align", "Letter spacing", "Transform", "Decoration", "Style", "Variant"]) {
      expect(html, words).toContain(`>${words}<`);
    }
    // Normal, Tt, TT and tt.
    for (const transform of ["Tt", "TT", "tt"]) expect(html).toContain(`>${transform}</button>`);
    // A device icon by each of the eleven settings.
    expect(html.match(/data-size-switch=""/g)).toHaveLength(11);
    for (const unit of ["px", "em", "rem", "%", "vw"]) expect(html).toContain(`<option value="${unit}">`);
  });

  it("gives a component with several kinds of text a group each, and none to a component without text", () => {
    const html = panel({ id: "a", type: "accordion", items: [] });
    for (const group of ["Text", "Titles", "Texts"]) expect(html).toContain(`${group}`);
    expect(html.match(/data-size-switch=""/g)).toHaveLength(33);
    expect(panel({ id: "s", type: "separator" })).toBe("");
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
