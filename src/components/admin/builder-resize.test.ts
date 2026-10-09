import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { RailTabsHeader } from "./builder-rails";
import { FloatingPanel } from "./floating-panel";
import { RowWidthHandles } from "./row-resize";

/** The builder's resize handles, theme tab header and floating panel as they are first drawn (D182). */

const noop = () => {};

describe("the floating settings panel", () => {
  const panel = (open: boolean) =>
    renderToString(
      createElement(
        FloatingPanel,
        { open, onClose: noop, title: "Heading", footer: createElement("button", null, "Done") } as unknown as ComponentProps<typeof FloatingPanel>,
        createElement("p", null, "Fields"),
      ),
    );

  it("draws nothing while closed", () => {
    expect(panel(false)).toBe("");
  });

  it("is a dialog with a title bar to move it by, a close button, its footer and eight places to resize from", () => {
    const html = panel(true);
    expect(html).toContain('role="dialog"');
    expect(html).not.toContain("<dialog");
    expect(html).toContain("Heading");
    expect(html).toContain('data-edge="move"');
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain("Fields");
    expect(html).toContain("Done");
    for (const edge of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) expect(html).toContain(`data-resize="${edge}"`);
    // Not modal: no backdrop to keep the page behind from being used.
    expect(html).not.toContain("backdrop");
  });
});

describe("the sidebar's header with a Theme tab", () => {
  it("has Building blocks and Theme as tabs and the button that folds the sidebar", () => {
    const html = renderToString(
      createElement(RailTabsHeader, {
        side: "left",
        label: "building blocks",
        controls: "side",
        onFold: noop,
        tabs: [
          { key: "blocks", label: "Building blocks", panel: "p1" },
          { key: "theme", label: "Theme", panel: "p2" },
        ],
        value: "theme",
        onChange: noop,
      }),
    );
    expect(html).toContain('role="tablist"');
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-selected="true"[^>]*aria-controls="p2"|aria-controls="p2"[^>]*aria-selected="true"/);
    expect(html).toContain("Building blocks");
    expect(html).toContain("Theme");
    expect(html).toContain('aria-label="Hide building blocks"');
  });
});

describe("a row's side handles", () => {
  it("are two sliders on the content's edges, with the width they stand for", () => {
    const html = renderToString(createElement(RowWidthHandles, { inset: 16, value: 960, label: "Row 1", onWidth: noop, onReset: noop }));
    expect(html.match(/role="slider"/g)).toHaveLength(2);
    expect(html).toContain('aria-valuenow="960"');
    expect(html).toContain("960 pixels");
    expect(html).toContain("left:10px");
    expect(html).toContain("right:10px");
    expect(html).toContain('data-resize-handle="row-width"');
  });

  it("say the theme's width where the row sets none", () => {
    const html = renderToString(createElement(RowWidthHandles, { inset: 24, value: null, label: "Row 2", onWidth: noop, onReset: noop }));
    expect(html).toContain("The theme&#x27;s content width");
    expect(html).not.toContain("aria-valuenow");
  });
});
