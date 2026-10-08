import { createElement } from "react";
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

import { DEFAULT_BREAKPOINTS } from "@/lib/breakpoints";
import type { PageBlock, PageRow } from "@/lib/page-content";
import { canvasHiddenCss } from "@/lib/part-css";
import { KAIZEN_FACTS, factsOffered, type Show, type VisibilityChoices } from "@/lib/visibility";

import { DisplayBadge, DisplayFields, DisplayLegend, IdChoice, RuleBuilder, displayMark, showPatch, type DisplaySetup } from "./display-fields";
import { PageBuilder } from "./page-builder";
import { VisibilityFields } from "./responsive-edit";

/**
 * The Advanced tab's Display (D179 phase 4), drawn on the server as the builder's other settings are tested: the select of
 * Beaver's five, the rule builder with its groups and the store's real choices, an id no longer the store's shown as
 * removed, and the canvas's blue and red eyes with their legend.
 */

const clean = (html: string) => html.replace(/<!-- -->/g, "").replace(/&#x27;/g, "'");
const store: DisplaySetup = { kaizen: false, facts: factsOffered("store", "page") };
const choices: VisibilityChoices = {
  owner: "store",
  timeZone: "Europe/Oslo",
  currency: "NOK",
  groups: [{ id: "11111111-1111-4111-8111-111111111111", name: "VIP" }],
  companies: [{ id: "33333333-3333-4333-8333-333333333333", name: "Fjord AS" }],
  products: [{ id: "44444444-4444-4444-8444-444444444444", name: "Mug" }],
  categories: [{ id: "55555555-5555-4555-8555-555555555555", name: "Cups" }],
  countries: [{ code: "NO", name: "Norway" }, { code: "SE", name: "Sweden" }],
  languages: [{ code: "nb", name: "Norwegian Bokmål" }],
  currencies: ["NOK", "EUR"],
};

describe("Display", () => {
  it("offers Beaver's five under Breakpoint, Always when nothing is set", () => {
    const out = clean(renderToString(createElement(VisibilityFields, { part: {}, onChange: () => {}, display: { setup: store } })));
    expect(out.indexOf("Breakpoint")).toBeLessThan(out.indexOf("Display"));
    for (const label of ["Always", "Never", "Signed-out visitors", "Signed-in visitors", "Conditional logic"]) expect(out).toContain(`>${label}</option>`);
    expect(out).toMatch(/<option value="always" selected="">Always<\/option>/);
    expect(out).toContain("left out of the page by the server");
  });

  it("is locked on what every buyer must see, and says why", () => {
    const out = clean(renderToString(createElement(DisplayFields, { show: undefined, onChange: () => {}, setup: store, locked: "The checkout's payment form and terms are for every buyer, so they are always shown." })));
    expect(out).toMatch(/<select[^>]*disabled=""/);
    expect(out).toContain("always shown");
  });

  it("says what signed in means on Kaizen's pages", () => {
    const out = clean(renderToString(createElement(DisplayFields, { show: "signedIn", onChange: () => {}, setup: { kaizen: true, facts: KAIZEN_FACTS } })));
    expect(out).toMatch(/<option value="signedIn" selected="">/);
    expect(out).toContain("signed in to Kaizen");
  });

  it("writes Always as nothing and keeps the size visibility beside a display", () => {
    expect(showPatch({ hideAt: ["sm"] }, "never")).toEqual({ visibility: { hideAt: ["sm"], show: "never" } });
    expect(showPatch({ hideAt: ["sm"], show: "never" }, undefined)).toEqual({ visibility: { hideAt: ["sm"] } });
    expect(showPatch({ show: "never" }, "always")).toEqual({ visibility: undefined });
  });
});

describe("the rule builder", () => {
  const rules: Show = {
    rules: [
      [
        { fact: "customerGroup", op: "in", value: ["11111111-1111-4111-8111-111111111111", "99999999-9999-4999-8999-999999999999"] },
        { fact: "hour", op: "between", value: { from: "22:00", to: "06:00" } },
      ],
      [{ fact: "cartValue", op: "between", value: { currency: "NOK", min: 50_000, max: 10_000 } }],
    ],
  };
  const draw = (setup: DisplaySetup = store, given: VisibilityChoices | null = choices) =>
    clean(renderToString(createElement(RuleBuilder, { rules: (rules as { rules: never }).rules, onChange: () => {}, setup, choices: given })));

  it("draws groups joined by Or, conditions joined by And, with the store's time zone", () => {
    const out = draw();
    expect(out).toContain('aria-label="Group 1, condition 1"');
    expect(out).toContain('aria-label="Group 2, condition 1"');
    // One "Or" between the two groups, and the button that adds a group.
    expect(out.match(/>Or</g)?.length).toBe(1);
    expect(out).toContain("> Or</button>");
    expect(out).toContain("> And</button>");
    expect(out).toContain("the store's time zone, Europe/Oslo");
  });

  it("offers the store's facts by group, and only Kaizen's on Kaizen's pages", () => {
    const out = draw();
    for (const group of ["Visitor", "Place and language", "Time", "Cart and address"]) expect(out).toContain(`<optgroup label="${group}">`);
    expect(out).toContain(">Cart contains a product in category</option>");
    const kaizen = draw({ kaizen: true, facts: KAIZEN_FACTS }, { ...choices, owner: "kaizen" });
    expect(kaizen).not.toContain(">Customer group</option>");
    expect(kaizen).toContain(">Address parameter</option>");
  });

  it("chooses from the store's real groups, shows a deleted one as removed, and says what is wrong", () => {
    const out = draw();
    expect(out).toContain("VIP");
    expect(out).toMatch(/aria-label="Group 1, condition 1: removed"/);
    expect(out).toContain("Removed");
    expect(out).toContain("A cart value's lower amount must not be above its upper amount.");
    // The amount is typed in kroner and kept in øre.
    expect(out).toContain('value="500"');
    expect(out).toContain('value="100"');
  });

  it("waits for the store's choices before listing them", () => {
    expect(draw(store, null)).toContain("Loading the store");
  });

  it("asks only yes or no about companies for staff who may not see customers", () => {
    const out = clean(
      renderToString(
        createElement(RuleBuilder, {
          rules: [[{ fact: "company", op: "in", value: [] }]],
          onChange: () => {},
          setup: store,
          choices: { ...choices, companies: null },
        }),
      ),
    );
    expect(out).toContain("Only staff who may see customers can choose companies");
  });

  it("a choice of the store's things", () => {
    const out = clean(renderToString(createElement(IdChoice, { label: "L", options: choices.products, value: [], onChange: () => {}, empty: "None." })));
    expect(out).toContain("Mug");
    expect(out).toContain("holds for nobody");
  });
});

describe("the canvas's eyes", () => {
  it("blue for Never, signed in and signed out; red for conditions", () => {
    expect(displayMark(undefined)).toBeNull();
    expect(displayMark("never")).toEqual({ tone: "plain", text: "Never shown" });
    expect(displayMark("signedIn")).toEqual({ tone: "plain", text: "Signed-in visitors" });
    expect(displayMark({ rules: [[{ fact: "signedIn", op: "is", value: true }]] })).toEqual({ tone: "rules", text: "Shown by conditions" });
    const blue = renderToString(createElement(DisplayBadge, { show: "signedOut" }));
    expect(blue).toContain('data-builder-display="plain"');
    expect(blue).toContain("text-(--chart-1)");
    const red = renderToString(createElement(DisplayBadge, { show: { rules: [[{ fact: "weekday", op: "in", value: [1] }]] } }));
    expect(red).toContain("text-(--danger)");
  });

  it("fades a Never part, and the Hidden parts switch leaves out every part some visitors do not see", () => {
    const never = { id: "b1", type: "separator", visibility: { show: "never" } } as PageBlock;
    const signedIn = { id: "b2", type: "separator", visibility: { show: "signedIn" } } as PageBlock;
    const row: PageRow = { id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [never, signedIn] }] };
    const faded = canvasHiddenCss([row], DEFAULT_BREAKPOINTS, false);
    expect(faded).toContain('[data-builder-id="b1"] > [class~="kz-b1"]{opacity:.4}');
    expect(faded).not.toContain('"b2"');
    const left = canvasHiddenCss([row], DEFAULT_BREAKPOINTS, true);
    expect(left).toContain('[data-builder-id="b1"]{display:none}');
    expect(left).toContain('[data-builder-id="b2"]{display:none}');
    expect(left).not.toContain("@container");
  });

  it("puts the eyes on the canvas and a legend over it", () => {
    const rows: PageRow[] = [
      {
        id: "r-1",
        type: "row",
        layout: "1",
        visibility: { show: { rules: [[{ fact: "signedIn", op: "is", value: true }]] } },
        columns: [{ id: "c-1", blocks: [{ id: "b-1", type: "heading", text: "Hi", level: 2, visibility: { show: "never" } } as PageBlock] }],
      },
    ];
    const out = clean(
      renderToString(
        createElement(PageBuilder, {
          pageType: "page",
          rows,
          onRows: () => {},
          saved: [],
          onSaved: () => {},
          upload: null,
          aside: null,
          grid: { pageId: null, owner: "s", pageTerms: [], articleTerms: [], stores: [], menus: [], menusHref: "/menus", plans: null, actions: {} as never },
          fonts: { site: { heading: null, body: null } as never, style: undefined, install: async () => ({ ok: true as const }), theme: null },
        }),
      ),
    );
    expect(out).toContain('data-builder-display="rules"');
    expect(out).toContain('data-builder-display="plain"');
    expect(out).toContain("Who sees what (2)");
    const legend = clean(renderToString(createElement(DisplayLegend, { parts: [{ id: "x", name: "Row 1", show: "never" }], onOpen: () => {} })));
    expect(legend).toContain('aria-expanded="false"');
  });
});
