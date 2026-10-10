import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { pageBlockSchema, type IconListBlock } from "@/lib/page-content";

import { IconListView } from "./icon-list-view";

const block = (over: Partial<IconListBlock> = {}): IconListBlock => ({
  id: "i1",
  type: "iconList",
  items: [{ id: "a", icon: "check", text: "One", href: "" }, { id: "b", icon: "star", text: "Two", href: "" }],
  ...over,
});
const draw = (b: IconListBlock) => renderToString(createElement(IconListView, { block: b }));

describe("an icon list's icon colour and gradient (D199)", () => {
  it("uses the theme's accent unless a colour is chosen", () => {
    expect(draw(block())).toContain("text-accent");
    expect(draw(block({ iconColor: "#112233" }))).toContain("color:#112233");
  });

  it("fills every icon's strokes with the gradient, one shared definition at the angle", () => {
    const html = draw(block({ iconColor: "#112233", iconGradient: { colors: ["#ff0000", "#0000ff"], angle: 90 } }));
    expect(html.match(/stroke="url\(#icon-gradient-90-ff00000000ff\)"/g)).toHaveLength(2);
    expect(html).toContain('id="icon-gradient-90-ff00000000ff"');
    expect(html).toContain('stop-color="#ff0000"');
    // At 90 degrees the gradient runs left to right across the 24 unit drawing.
    expect(html).toMatch(/x1="0"[^>]*x2="24"/);
    expect(html).not.toContain("text-accent");
  });

  it("is checked by the page's schema: two to four colours, hex only", () => {
    const ok = pageBlockSchema.safeParse(block({ iconGradient: { colors: ["#ff0000", "#00ff00", "#0000ff"], angle: 45 } }));
    expect(ok.success).toBe(true);
    expect(pageBlockSchema.safeParse(block({ iconGradient: { colors: ["#ff0000"], angle: 45 } })).success).toBe(false);
    expect(pageBlockSchema.safeParse(block({ iconGradient: { colors: ["red", "blue"], angle: 45 } })).success).toBe(false);
  });
});
