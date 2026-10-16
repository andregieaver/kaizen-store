import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DemoHomePages } from "./demo-home-pages";

/** Home pages from the demo stores on a store's Pages list (`docs/theme-showcase-phase-1.md` step 4c). */

const action = async () => ({ status: "ok" as const, messages: [] });
const offers = [
  { pack: "food", name: "Harbour Pantry", trade: "Food and drink", previewHref: "/s/pack-food" },
  { pack: "home", name: "Still House", trade: "Home", previewHref: "/s/pack-home" },
];
const props = { offers, take: null, editBase: "/admin/kaffe/pages", use: action, undo: action };
/** The page's HTML without React's markers between texts. */
const draw = (extra: Partial<typeof props> | Record<string, unknown> = {}) => renderToString(createElement(DemoHomePages, { ...props, ...extra })).replaceAll("<!-- -->", "");

describe("the demo stores' home pages", () => {
  it("offers each to look at in a new window and to use in one press, saying the words are the demo store's", () => {
    const html = draw();
    expect(html).toContain("its words and pictures are the demo store&#x27;s until you change them");
    expect(html).toContain("Harbour Pantry");
    expect(html).toMatch(/<a [^>]*target="_blank"[^>]*href="\/s\/pack-food"/);
    expect(html.match(/Use this home page/g)).toHaveLength(2);
    expect(html).toContain('name="pack" value="home"');
    expect(html).not.toContain("Put back your front page");
  });

  it("after one is taken, says what the store opens with now and before, with its words to put in and a way back", () => {
    const take = { id: "7d1c4c9e-1a0b-4c43-9d5e-3b8e1f2a6c10", name: "Harbour Pantry", pageId: "page-1", previousTitle: "Forside", copyIsFront: true };
    const html = draw({ take });
    expect(html).toContain("Your store opens with the home page from Harbour Pantry.");
    expect(html).toContain("Before, it opened with Forside.");
    expect(html).toContain('href="/admin/kaffe/pages/page-1"');
    expect(html).toContain("Put back your front page");
    expect(html).toContain(`value="${take.id}"`);
  });

  it("shows nothing when no demo store is offered and nothing was taken", () => {
    expect(draw({ offers: [] })).toBe("");
  });
});
