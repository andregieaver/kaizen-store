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

  it("leads to the site's own page in the page's language, as on Kaizena Flow's own store's pages (D484)", () => {
    expect(html(block({ buttonHref: "/sign-up" }), data, "nb")).toContain('href="/no/sign-up"');
    // Already in the language, another site, or the admin: as written.
    expect(html(block({ buttonHref: "/no/sign-up" }), data, "nb")).toContain('href="/no/sign-up"');
    expect(html(block({ buttonHref: "https://example.com/x" }), data, "nb")).toContain('href="https://example.com/x"');
    expect(html(block({ buttonHref: "/admin" }), data, "nb")).toContain('href="/admin"');
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
    expect(html(block(), data, "nb")).toContain("ekskl. mva.");
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

describe("a plan's limits (D314)", () => {
  it("says one of a kind in the singular, and the amounts, fee and limits in the page's language", () => {
    const limited: PublicPlans = {
      features: [],
      plans: [
        {
          ...data.plans[0],
          saleFeeBps: 199,
          limits: [
            { key: "products", value: 500 },
            { key: "custom_domains", value: 1 },
            { key: "requests_month", value: 1_000_000 },
            { key: "stores_owned", value: 1 },
            { key: "staff_seats", value: null },
            { key: "storage_bytes", value: null },
            { key: "ai_cost_month_micros", value: 5_000_000 },
          ],
        },
      ],
    };
    const en = html(block(), limited);
    expect(en).toContain("500 products");
    expect(en).toContain("1 own domain<");
    expect(en).toContain("1 store<");
    expect(en).toContain("1.99 % fee per sale");
    expect(en).toContain("Unlimited staff");
    // The AI a plan includes is in euros (D481): the page's NOK has no rate here, so it stays in euros.
    expect(en).toContain("€5.00 of AI a month");
    const nb = html(block(), limited, "nb");
    expect(nb).toContain("500 produkter");
    expect(nb).toContain("1 eget domene<");
    expect(nb).toContain("1 butikk<");
    expect(nb).toMatch(/1\s000\s000 besøk i måneden/);
    expect(nb).toContain("1,99 % gebyr per salg");
    expect(nb).toContain("per måned");
    expect(nb).toMatch(/5,00\s€ til KI i måneden/);
    // With the ECB's rate it is in the page's currency, in whole kroner.
    expect(html(block(), { ...limited, euroRates: { NOK: 11.71 } }, "nb")).toMatch(/58,00\skr til KI i måneden/);
    expect(html(block({ decimals: "hide_whole" }), { ...limited, euroRates: { NOK: 11.71 } }, "nb")).toMatch(/>58\skr til KI i måneden/);
    // What is counted has no ceiling in a number; what is not, in itself.
    expect(nb).toContain("Ubegrenset antall ansatte");
    expect(nb).toContain("Ubegrenset lagring");
  });

  it("lists what the plan includes, unlimited ones as such", async () => {
    const { planCards } = await import("@/lib/plan-offer");
    const { cards } = planCards(
      { plans: [{ id: "p", name: "Grow", description: "", saleFeeBps: 0, position: 0, prices: [{ currency: "NOK", interval: "month", amountMinor: 10000 }], featureIds: [], limits: [{ key: "storage_bytes", value: 10 * 1024 ** 3 }, { key: "products", value: null }] }], features: [] },
      {},
    );
    expect(cards[0].limits).toEqual([{ key: "storage_bytes", value: 10 * 1024 ** 3 }, { key: "products", value: null }]);
  });
});

describe("whole amounts and the switch between monthly and yearly (D481)", () => {
  it("leaves the decimals off whole prices only when asked, and keeps an amount's cents", () => {
    expect(html(block())).toMatch(/NOK\s299\.00/);
    const whole = html(block({ decimals: "hide_whole" }));
    expect(whole).toMatch(/NOK\s299 </);
    expect(whole).not.toContain("299.00");
    const cents: PublicPlans = { ...data, plans: [{ ...data.plans[0], prices: [{ currency: "NOK", interval: "month", amountMinor: 29950 }] }] };
    expect(html(block({ decimals: "hide_whole" }), cents)).toMatch(/NOK\s299\.50/);
  });

  it("draws both sets of cards with a radio pair to choose, starting where the component says", () => {
    const out = html(block({ switcher: true }));
    expect(out).toContain("data-plan-switch");
    expect(out).toContain('data-plan-panel="month"');
    expect(out).toContain('data-plan-panel="year"');
    expect(out).toMatch(/<legend class="sr-only">Billing period<\/legend>/);
    expect(out).toMatch(/checked="" value="month"/);
    expect(out).not.toMatch(/checked="" value="year"/);
    // Monthly cards show the month alone; the yearly set leads with the year and what it saves, said once more by the switch.
    expect(out).not.toContain("or NOK");
    expect(out).toContain("Save 17 % with yearly billing");
    expect(out).toContain("Save 17 %</span>");
    // Each set names its own headings: no id twice.
    const ids = [...out.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(html(block({ switcher: true, interval: "year" }))).toMatch(/checked="" value="year"/);
  });

  it("says up to when the plans save differently", () => {
    const differ: PublicPlans = {
      ...data,
      plans: [
        { ...data.plans[0], prices: [{ currency: "NOK", interval: "month", amountMinor: 10000 }, { currency: "NOK", interval: "year", amountMinor: 90000 }] },
        data.plans[1],
      ],
    };
    expect(html(block({ switcher: true }), differ)).toContain("Save up to 25 %");
    expect(html(block({ switcher: true }), differ, "nb")).toContain("Spar opptil 25 %");
  });

  it("is saved and cleaned as the component's other choices", () => {
    expect(pageBlockSchema.safeParse(block({ switcher: true, interval: "year", decimals: "hide_whole" })).success).toBe(true);
    expect(pageBlockSchema.safeParse({ ...block(), decimals: "always" }).success).toBe(false);
  });
});
