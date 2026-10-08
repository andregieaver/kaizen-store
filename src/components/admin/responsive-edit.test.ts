import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock("@/lib/motion-attrs", () => ({
  partFx: vi.fn(() => ({ attrs: {}, style: {} })),
  backgroundFx: vi.fn(() => ({ attrs: {}, style: {} })),
  pageUsesMotion: vi.fn(() => false),
}));
vi.mock("@/lib/motion-runtime", () => ({ initMotion: vi.fn(() => () => {}) }));

import { DEFAULT_BREAKPOINTS, type Size } from "@/lib/breakpoints";
import type { PageBlock, PageRow } from "@/lib/page-content";

import { TextAlignFields } from "./block-fields";
import { PageBuilder } from "./page-builder";
import { ResponsiveBar, SizeEditContext, VisibilityFields, isResponsiveShortcut, sizeNote, typingIn } from "./responsive-edit";
import { BreakpointFields } from "./theme-editor";

/**
 * The builder's responsive mode (D179 phase 2), drawn on the server as the other settings are tested: the bar over the
 * canvas, a field with its device icon at a size, the Advanced tab's Visibility, the toolbar's switches and the theme's
 * screen sizes. (The builder is only reached signed in, which the e2e suite cannot be, so its behaviour is held here and in
 * `src/lib/responsive-edit.test.ts`.)
 */

const clean = (html: string) => html.replace(/<!-- -->/g, "");
const atSize = (size: Size, element: ReactElement) =>
  clean(renderToString(createElement(SizeEditContext, { value: { size, active: size !== "xl", choose: () => {} } }, element)));

describe("the responsive bar", () => {
  const bar = (size: Size, width: number, zoom = 100) =>
    clean(
      renderToString(
        createElement(ResponsiveBar, {
          view: { size, width, height: 844, zoom },
          breakpoints: DEFAULT_BREAKPOINTS,
          onSize: () => {},
          onWidth: () => {},
          onHeight: () => {},
          onZoom: () => {},
          onExit: () => {},
        }),
      ),
    );

  it("offers the four sizes with their widths, the width × height, a zoom and Exit", () => {
    const out = bar("sm", 390);
    expect(out).toContain('role="toolbar"');
    expect(out).toContain('aria-label="Responsive editing"');
    for (const label of ["Extra large (1280 px and wider)", "Large (1024–1279 px)", "Medium (768–1023 px)", "Small (under 768 px)"]) {
      expect(out).toContain(`>${label}</option>`);
    }
    expect(out).toMatch(/<option value="sm" selected="">Small/);
    expect(out).toMatch(/aria-label="Width in pixels"[^>]*min="320"[^>]*max="767"[^>]*value="390"/);
    expect(out).toMatch(/aria-label="Height in pixels"[^>]*value="844"/);
    for (const zoom of [100, 90, 75, 67, 50]) expect(out).toContain(`>${zoom} %</option>`);
    expect(out).toMatch(/<option value="100" selected="">100 %/);
    expect(out).toMatch(/aria-keyshortcuts="Control\+Shift\+R Meta\+Shift\+R"[^>]*>Exit<\/button>/);
  });

  it("says the size's range and keeps a zoom it does not list", () => {
    const out = bar("md", 820, 80);
    expect(out).toContain("The width stays between 768 and 1023 pixels for Medium.");
    expect(out).toMatch(/<option value="80" selected="">80 %/);
  });
});

describe("a field at a size", () => {
  const block = { align: "right", at: { md: { align: "center" } } } as const;
  const field = (size: Size) => atSize(size, createElement(TextAlignFields, { value: block, onChange: () => {} }));
  const chosen = (out: string) => out.match(/<input[^>]*type="radio"[^>]*checked=""[^>]*value="([^"]+)"/)?.[1];

  it("has its device icon at every size, showing the size edited", () => {
    for (const size of ["xl", "lg", "md", "sm"] as const) expect(field(size)).toContain("data-size-switch");
    expect(field("xl")).toContain('aria-label="Text alignment: edited at Extra large. Choose a screen size"');
    expect(field("sm")).toContain('aria-label="Text alignment: edited at Small. Choose a screen size"');
    expect(field("sm")).toContain("lucide-smartphone");
  });

  it("shows an inherited value greyed with where it is from", () => {
    const out = field("lg");
    expect(chosen(out)).toBe("right");
    expect(out).toMatch(/data-size-from=""[^>]*>From Extra large<\/span>/);
    expect(out).toContain("[&amp;_label]:text-muted");
    expect(field("sm")).toContain(">From Medium</span>");
  });

  it("marks the size's own value, with a × that gives it back", () => {
    const out = field("md");
    expect(chosen(out)).toBe("center");
    expect(out).toMatch(/data-size-own=""[^>]*>Set for Medium<\/span>/);
    expect(out).toContain('aria-label="Clear text alignment for Medium, to take it from the larger sizes again"');
    expect(out).not.toContain("[&amp;_label]:text-muted");
  });

  it("says nothing of other sizes at Extra large, where the part's own value is edited", () => {
    const out = field("xl");
    expect(out).not.toContain("data-size-from");
    expect(out).not.toContain("data-size-own");
    expect(sizeNote({ own: false, from: null }, "sm")).toBe("Default");
  });
});

describe("Visibility in the Advanced tab", () => {
  it("is four sizes, pressed where the part shows", () => {
    const out = clean(renderToString(createElement(VisibilityFields, { part: { visibility: { hideAt: ["sm"] } }, onChange: () => {} })));
    expect(out).toContain(">Visibility</legend>");
    expect(out).toContain(">Breakpoint</span>");
    const pressed = [...out.matchAll(/aria-pressed="(true|false)"[^>]*title="([^:]+):/g)].map((m) => [m[2], m[1]]);
    expect(pressed).toEqual([
      ["Extra large", "true"],
      ["Large", "true"],
      ["Medium", "true"],
      ["Small", "false"],
    ]);
  });

  it("is locked, with the reason, for a part every visitor must see", () => {
    const out = clean(renderToString(createElement(VisibilityFields, { part: {}, onChange: () => {}, locked: "Shows at every size." })));
    expect((out.match(/disabled=""/g) ?? []).length).toBe(4);
    expect(out).toContain("Shows at every size.");
  });
});

describe("the builder's toolbar and canvas", () => {
  const rows: PageRow[] = [
    {
      id: "row-1",
      type: "row",
      layout: "1",
      columns: [{ id: "c-1", blocks: [{ id: "b-1", type: "heading", text: "Hello", level: 2, visibility: { hideAt: ["sm"] } } as PageBlock] }],
    },
  ];
  const builder = (over: Partial<ComponentProps<typeof PageBuilder>> = {}) =>
    clean(
      renderToString(
        createElement(PageBuilder, {
          pageType: "page",
          rows,
          onRows: () => {},
          saved: [],
          onSaved: () => {},
          upload: null,
          aside: createElement("p", null, "Page title"),
          grid: { pageId: null, owner: null, pageTerms: [], articleTerms: [], stores: [], menus: [], menusHref: "/menus", plans: null, actions: {} as never },
          fonts: { site: { heading: null, body: null } as never, style: undefined, install: async () => ({ ok: true as const }), theme: null },
          ...over,
        }),
      ),
    );

  it("has the Responsive switch and the hidden parts switch, and no bar until responsive mode is on", () => {
    const out = builder();
    expect(out).toMatch(/aria-pressed="false"[^>]*aria-keyshortcuts="Control\+Shift\+R Meta\+Shift\+R"[^>]*>.*Responsive<\/button>/);
    expect(out).toContain(">Hidden parts shown faded</button>");
    expect(out).not.toContain('data-responsive-bar=""');
  });

  it("draws a part hidden at a size with its grey eye, which the canvas's rules show at that size only", () => {
    const out = builder();
    expect(out).toContain('data-builder-hidden=""');
    expect(out).toContain('title="Hidden on the site at: Small"');
    const style = [...out.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).find((css) => css.includes("data-builder-hidden")) ?? "";
    expect(style).toContain("@container kz-page (width < 768px){");
    expect(style).toContain('[data-builder-id="b-1"] > [data-builder-hidden]{display:inline-flex}');
  });

  it("keeps the canvas as wide as it can be outside responsive mode", () => {
    const out = builder();
    expect(out).not.toContain("data-builder-frame");
    expect(out).toMatch(/class="kz-page flex flex-col gap-8" style="container-type:inline-size;container-name:kz-page"/);
  });
});

describe("the shortcut", () => {
  it("is Ctrl or Cmd with Shift and R, never while typing", () => {
    const key = (over: Partial<KeyboardEvent>) => ({ key: "R", ctrlKey: false, metaKey: false, shiftKey: true, altKey: false, ...over });
    expect(isResponsiveShortcut(key({ ctrlKey: true }))).toBe(true);
    expect(isResponsiveShortcut(key({ metaKey: true, key: "r" }))).toBe(true);
    expect(isResponsiveShortcut(key({ ctrlKey: true, shiftKey: false }))).toBe(false);
    expect(isResponsiveShortcut(key({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isResponsiveShortcut(key({}))).toBe(false);
    expect(typingIn(null)).toBe(false);
    expect(typingIn({ closest: (selector: string) => (selector.includes("input") ? {} : null) } as unknown as EventTarget)).toBe(true);
    expect(typingIn({ closest: () => null } as unknown as EventTarget)).toBe(false);
  });
});

describe("the theme's screen sizes", () => {
  const fields = (value = DEFAULT_BREAKPOINTS) => clean(renderToString(createElement(BreakpointFields, { value, onChange: () => {} })));

  it("are three widths, where Medium, Large and Extra large start, with the rule", () => {
    const out = fields();
    for (const label of ["Medium from", "Large from", "Extra large from"]) expect(out).toContain(label);
    expect([...out.matchAll(/inputMode="numeric"[^>]*value="(\d+)"/g)].map((m) => m[1])).toEqual(["768", "1024", "1280"]);
    expect(out).toContain("Between 480 and 2560 pixels, each at least 160 after the one before.");
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Use the standard sizes/);
  });

  it("show a store's own widths, with the standard ones a press away", () => {
    const out = fields({ md: 800, lg: 1100, xl: 1400 });
    expect([...out.matchAll(/inputMode="numeric"[^>]*value="(\d+)"/g)].map((m) => m[1])).toEqual(["800", "1100", "1400"]);
    expect(out).not.toMatch(/<button[^>]*disabled=""[^>]*>Use the standard sizes/);
  });
});
