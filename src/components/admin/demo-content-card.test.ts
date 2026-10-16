import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DemoContentCard, type DemoCardSummary } from "./demo-content-card";

/** *Remove demo content* on a store's Home (`docs/theme-showcase-phase-1.md` step 4b): one sentence and one press, the list a step away. */

const action = async () => ({ status: "ok" as const, messages: [] });
const summary: DemoCardSummary = {
  words: "6 products and 2 pages",
  items: [
    { noun: "product", title: "Linen shirt" },
    { noun: "page", title: "Front page" },
  ],
  changed: [{ noun: "page", title: "About us" }],
};

describe("the demo content card", () => {
  it("says what the store came with and offers one press, with what goes and what stays behind What it removes", () => {
    const html = renderToString(createElement(DemoContentCard, { summary, action }));
    expect(html).toContain("6 products and 2 pages");
    expect(html).toContain("Anything you changed stays.");
    expect(html.match(/<button[^>]*type="submit"/g)).toHaveLength(1);
    expect(html).toContain("Remove demo content");
    const details = html.slice(html.indexOf("<details"));
    expect(details).toContain("What it removes");
    expect(details).toContain("Linen shirt");
    expect(details).toContain("You changed these, so they stay:");
    expect(details).toContain("About us");
  });

  it("shows nothing when the store has no demo content", () => {
    expect(renderToString(createElement(DemoContentCard, { summary: null, action }))).toBe("");
  });
});
