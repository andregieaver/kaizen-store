import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { pageBlockSchema, blockHasContent, type PlansBlock } from "@/lib/page-content";
import { mapBlockTexts } from "@/lib/page-translation";
import type { PublicPlans } from "@/lib/plan-offer";
import { sanitizeTemplate } from "@/lib/template-content";

import { PlansView } from "./plans-view";

const data: PublicPlans = {
  features: [
    { id: "f1", category: "Selling", name: "Unlimited products", description: "", position: 1 },
    { id: "f2", category: "AI", name: "AI manager", description: "Ask for what you want done", position: 2 },
  ],
  plans: [
    {
      id: "00000000-0000-4000-8000-0000000000a1",
      name: "Start",
      description: "To begin with",
      saleFeeBps: 200,
      position: 1,
      prices: [{ currency: "NOK", interval: "month", amountMinor: 29900 }],
      featureIds: ["f1"],
    },
    {
      id: "00000000-0000-4000-8000-0000000000a2",
      name: "Grow",
      description: "",
      saleFeeBps: 100,
      position: 2,
      prices: [
        { currency: "NOK", interval: "month", amountMinor: 79900 },
        { currency: "NOK", interval: "year", amountMinor: 799000 },
      ],
      featureIds: ["f1", "f2"],
    },
  ],
};
const block = (over: Partial<PlansBlock> = {}): PlansBlock => ({ id: "pl", type: "plans", buttonLabel: "", buttonHref: "", ...over });
const html = (b: PlansBlock, d = data, lang = "en") => renderToStaticMarkup(createElement(PlansView, { block: b, data: d, lang }));

describe("the plans component (D142)", () => {
  it("draws a card for each plan with its price without VAT, its fee and what it includes", () => {
    const out = html(block());
    expect(out).toContain("Start");
    expect(out).toContain("Grow");
    expect(out).toMatch(/NOK[^<]*299|299[^<]*NOK|kr[^<]*299/);
    expect(out).toContain("excl. VAT");
    expect(out).toContain("2 % fee per sale");
    expect(out).toContain("1 % fee per sale");
    expect(out).toContain("Unlimited products");
    // Grow has a yearly price too, and says what it saves.
    expect(out).toContain("per year");
    expect(out).toContain("Save 17 % with yearly billing");
  });

  it("leads each button to sign-up unless told, with the plan named for screen readers", () => {
    expect(html(block())).toContain('href="/sign-up"');
    expect(html(block())).toContain("Get started");
    const own = html(block({ buttonHref: "/contact", buttonLabel: "Talk to us" }));
    expect(own).toContain('href="/contact"');
    expect(own).toContain("Talk to us");
    expect(own).toContain("Talk to us<span class=\"sr-only\"> – Start</span>");
  });

  it("marks the recommended plan, once", () => {
    const out = html(block({ highlightId: "00000000-0000-4000-8000-0000000000a2" }));
    expect(out.match(/Most popular/g)).toHaveLength(1);
    expect(html(block())).not.toContain("Most popular");
  });

  it("shows the comparison table only when asked, with the features by category and who includes them", () => {
    expect(html(block())).not.toContain("<table");
    const out = html(block({ comparison: true }));
    expect(out).toContain("<table");
    expect(out).toContain("Compare plans");
    expect(out).toContain("Selling");
    expect(out).toContain("Ask for what you want done");
    // Start lacks the AI manager: its cell says so to a screen reader.
    expect(out).toContain("Not included");
  });

  it("speaks the page's language, and draws nothing when no plan can be bought", () => {
    expect(html(block(), data, "nb")).toContain("eks. mva.");
    expect(html(block(), { ...data, plans: [] })).toBe("");
    expect(html(block({ currency: "SEK" }), { ...data, plans: [{ ...data.plans[0], prices: [] }] })).toBe("");
  });

  it("is saved with the page: checked, kept in the page's texts, and cleaned for another owner", () => {
    expect(pageBlockSchema.safeParse(block({ interval: "year", currency: "EUR", comparison: true })).success).toBe(true);
    expect(pageBlockSchema.safeParse(block({ currency: "euro" })).success).toBe(false);
    expect(pageBlockSchema.safeParse(block({ buttonHref: "javascript:alert(1)" })).success).toBe(false);
    expect(blockHasContent(block())).toBe(true);
    const seen: string[] = [];
    mapBlockTexts(block({ buttonLabel: "Join" }), (key, value) => {
      seen.push(key);
      return value;
    });
    expect(seen).toEqual(["block.pl.buttonLabel"]);
    const cleaned = sanitizeTemplate("block", block({ highlightId: "00000000-0000-4000-8000-0000000000a2" }), { id: "s", slug: "kaizen" } as never) as PlansBlock;
    expect(cleaned.highlightId).toBeUndefined();
  });
});
