import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FormState } from "@/components/admin/action-form";
import { analyticsSettingsText } from "@/lib/analytics-settings";
import { t } from "@/lib/i18n";

import {
  AnalyticsSettingsView,
  dayLabel,
  monthChoices,
  monthLabel,
  settingsFromForm,
  upcomingTargets,
  type AnalyticsSettingsViewProps,
  type SettingsActions,
} from "./settings-forms";

const html = (props: AnalyticsSettingsViewProps) =>
  renderToString(h(AnalyticsSettingsView, props))
    // React adds one small script of its own for a form's action; it is not the page's.
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

const noop = async (): Promise<FormState> => ({ status: "ok", messages: [] });
const actions: SettingsActions = { saveSettings: noop, saveTarget: noop, deleteTarget: noop, setVisitCounting: noop, backfillCosts: noop };

const defaults = { paymentFeeBps: 0, paymentFeeFixedMinor: 0, shippingCostMinor: 0, fixedCostsMonthlyMinor: 0, ltvLifespanYears: 3, saved: false };

const base: AnalyticsSettingsViewProps = {
  base: "/admin/shop",
  currency: "NOK",
  locale: "nb-NO",
  today: "2026-10-02",
  settings: defaults,
  summary: { activeVariants: 0, variantsWithCost: 0, backfillableLines: 0, firstCountedDay: null },
  targets: [],
  visitCounting: false,
  actions,
};

const entered = { paymentFeeBps: 290, paymentFeeFixedMinor: 200, shippingCostMinor: 6000, fixedCostsMonthlyMinor: 2_500_000, ltvLifespanYears: 4, saved: true };

const normal: AnalyticsSettingsViewProps = {
  ...base,
  settings: entered,
  summary: { activeVariants: 40, variantsWithCost: 33, backfillableLines: 214, firstCountedDay: "2026-09-03" },
  targets: [
    { month: "2026-12-01", revenueTargetMinor: 90_000_000 },
    { month: "2026-10-01", revenueTargetMinor: 50_000_000 },
    { month: "2025-01-01", revenueTargetMinor: 1_000_000 },
    { month: "2028-01-01", revenueTargetMinor: 1_000_000 },
  ],
  visitCounting: true,
};

const missingCosts: AnalyticsSettingsViewProps = {
  ...base,
  summary: { activeVariants: 12, variantsWithCost: 0, backfillableLines: 0, firstCountedDay: null },
};

const every: [string, AnalyticsSettingsViewProps][] = [
  ["an empty store", base],
  ["a normal store", normal],
  ["a store with no costs", missingCosts],
  ["a store with every cost", { ...normal, summary: { ...normal.summary, variantsWithCost: 40, backfillableLines: 1 } }],
  ["a member who is not an owner", { ...normal, actions: null }],
  ["a staff member in an empty store", { ...base, actions: null }],
];

describe("the empty store", () => {
  const out = html(base);

  it("opens with what the page answers, as links to its sections", () => {
    expect(out).toContain("This page answers three things:");
    for (const id of ["costs", "targets", "visits"]) {
      expect(out).toContain(`href="#${id}"`);
      expect(out).toContain(`id="${id}"`);
    }
  });

  it("is calm: it says there is nothing yet, not that something is wrong", () => {
    expect(out).toContain("You have no products on sale yet");
    expect(out).toContain("Nothing entered yet");
    expect(out).toContain("No targets set.");
    expect(out).toContain("Not counting. No visits have been counted.");
    expect(out).not.toContain('data-tone="warning"');
  });

  it("keeps the money fields empty, so not entered looks like it, and the lifetime at its default", () => {
    expect(out).toMatch(/name="paymentFeePercent"[^>]*value=""/);
    expect(out).toMatch(/name="shippingCost"[^>]*value=""/);
    expect(out).toMatch(/name="ltvLifespanYears"[^>]*value="3"/);
    expect(out).toContain("Not set yet, so 3 years is used.");
  });

  it("offers to turn visit counting on and nothing to apply to earlier orders", () => {
    expect(out).toContain("Turn on visit counting");
    expect(out).toMatch(/<button(?=[^>]*name="enabled")[^>]*value="on"/);
    expect(out).toContain("Once variants have a cost you can apply it");
    expect(out).not.toContain("Yes, apply costs");
  });
});

describe("a normal store", () => {
  const out = html(normal);

  it("says how many variants have a cost, with the share", () => {
    expect(out).toContain("33");
    expect(out).toContain("40");
    expect(out).toContain("variants on sale have a cost (83 %)");
    expect(out).toContain('href="/admin/shop/products"');
  });

  it("says costs are missing for some, and that profit covers only the rest", () => {
    expect(out).toContain("Some costs are missing");
    expect(out).toContain("says how much of your sales that covers");
  });

  it("puts the confirm step behind a details element, with what it does and the button", () => {
    expect(out).toContain("<details");
    expect(out).toContain("<summary");
    expect(out).toContain("Apply costs to earlier orders");
    expect(out).toContain("This gives <strong");
    expect(out).toContain("214");
    expect(out).toContain("It cannot be undone in one step.");
    expect(out).toContain("Yes, apply costs to 214 order lines");
  });

  it("shows the estimates as they were saved", () => {
    expect(out).toMatch(/name="paymentFeePercent"[^>]*value="2,9"/);
    expect(out).toMatch(/name="paymentFeeFixed"[^>]*value="2,00"/);
    expect(out).toMatch(/name="shippingCost"[^>]*value="60,00"/);
    expect(out).toMatch(/name="fixedCostsMonthly"[^>]*value="25000,00"/);
    expect(out).toMatch(/name="ltvLifespanYears"[^>]*value="4"/);
    expect(out).not.toContain("Nothing entered yet");
    expect(out).toContain("NOK");
  });

  it("lists the next twelve months' targets, earliest first, each with a remove button, and no others", () => {
    expect(out).toContain("October 2026");
    expect(out).toContain("December 2026");
    expect(out.indexOf("October 2026")).toBeLessThan(out.lastIndexOf("December 2026"));
    expect(out).not.toContain("January 2025");
    expect(out).not.toContain("January 2028");
    expect(out).toContain('name="month" value="2026-10"');
    expect(out).toContain("the target for October 2026");
    expect(out).toContain("<caption");
  });

  it("offers the next twelve months to set a target for", () => {
    expect(out).toContain('<option value="2026-10"');
    expect(out).toContain('<option value="2027-09"');
    expect(out).not.toContain('<option value="2027-10"');
  });

  it("says what is counted, what is not, and whose job the privacy policy is", () => {
    expect(out).toContain("Counting visits. The first counted day is 3 September 2026.");
    expect(out).toContain("What is counted");
    expect(out).toContain("What is not counted or kept");
    expect(out).toContain("No cookies and nothing stored in the browser");
    expect(out).toContain("No IP address and no browser details are stored");
    expect(out).toContain("changes every day");
    expect(out).toContain("Bots are not counted");
    expect(out).toContain("Global Privacy Control");
    expect(out).toContain("Mention it in your privacy policy");
    expect(out).toContain("Turn off visit counting");
    expect(out).toMatch(/<button(?=[^>]*name="enabled")[^>]*value="off"/);
  });

  it("does not overclaim: the visit is tied to a cart, the id is not random, and no one is promised the visit can never be linked", () => {
    expect(out).toContain("the visit is tied to that cart, and so to the order made from it");
    expect(out).toContain("It is not random");
    expect(out).toContain("including that a visit is tied to a cart and its order");
    expect(out).toContain("Counts are not tamper-proof");
    expect(out).not.toMatch(/no consent banner is needed/);
    expect(out).not.toMatch(/traced back|personal data|identif/i);
  });

  it("tells shoppers in every language that a cart ties the visit to a sale, and never calls the id random or the data free of personal data", () => {
    for (const lang of ["nb", "sv", "da", "en"]) {
      const text = t(lang).visitCounting;
      expect(text, lang).toBeTruthy();
      expect(text, lang).not.toMatch(/random|tilfældig|slumpmässig|tilfeldig|personal data|personopplysninger|personuppgifter|personoplysninger|traced back|føres tilbake|spåras|føres tilbage/i);
      // The cart: the one place a visit meets a sale.
      expect(text, lang).toMatch(/cart|handlekurven|varukorgen|kurven/);
      expect(text, lang).toMatch(/IP/);
    }
  });

  it("explains its terms where they are used", () => {
    expect(out).toContain('<abbr title="Lifetime value');
    expect(out).toContain('<abbr title="Global Privacy Control');
  });
});

describe("a store whose costs are missing", () => {
  const out = html(missingCosts);

  it("asks for costs honestly and never shows a profit", () => {
    expect(out).toContain("No costs entered yet");
    expect(out).toContain("profit is not shown at all");
    expect(out).toContain("0</span> of");
    expect(out).toContain("(0 %)");
    expect(out).not.toMatch(/profit[^.]{0,20}(0,00|0\.00)/i);
  });

  it("is a warning with an icon and words, not colour alone", () => {
    expect(out).toContain('data-tone="warning"');
    expect(out).toContain(">!<");
  });

  it("offers nothing to apply while there is no cost to apply", () => {
    expect(out).toContain("Once variants have a cost you can apply it");
    expect(out).not.toContain("<details");
  });
});

describe("a store where every cost is entered", () => {
  const out = html({ ...normal, summary: { ...normal.summary, variantsWithCost: 40, backfillableLines: 1 } });

  it("has no missing-cost note and speaks of one line in the singular", () => {
    expect(out).not.toContain("Some costs are missing");
    expect(out).not.toContain("No costs entered yet");
    expect(out).toContain("(100 %)");
    expect(out).toContain("Yes, apply costs to 1 order line<");
  });

  it("says when every earlier line already has its cost", () => {
    const done = html({ ...normal, summary: { ...normal.summary, variantsWithCost: 40, backfillableLines: 0 } });
    expect(done).toContain("No earlier order lines are waiting for a cost");
    expect(done).not.toContain("<details");
  });
});

describe("a member who is not an owner", () => {
  const out = html({ ...normal, actions: null });

  it("is told, politely, who can change it", () => {
    expect(out).toContain("Only owners can change these settings");
    expect(out).toContain("Ask an owner");
  });

  it("sees the set-up but has no form, field or button", () => {
    expect(out).not.toContain("<form");
    expect(out).not.toContain("<input");
    expect(out).not.toContain("<select");
    expect(out).not.toContain("<button");
    expect(out).not.toContain("Yes, apply costs");
    expect(out).toContain("2.90 %");
    expect(out).toContain("4 years");
    expect(out).toContain("October 2026");
    expect(out).toContain("Counting visits.");
  });

  it("sees not entered, not zero, for a cost that is not there", () => {
    const empty = html({ ...base, actions: null });
    expect(empty).toContain("Not entered");
    expect(empty).not.toMatch(/0,00|0\.00/);
  });
});

describe("a switched-off store with visits counted before", () => {
  it("says what was counted is kept", () => {
    const out = html({ ...normal, visitCounting: false });
    expect(out).toContain("Not counting. Visits were counted from 3 September 2026; what was counted is kept.");
  });

  it("says counting is on but has seen nothing yet", () => {
    const out = html({ ...base, visitCounting: true });
    expect(out).toContain("Counting visits, but none has been counted yet.");
  });
});

describe("every state", () => {
  it.each(every)("has no broken figure, no fixed colour and a name for everything that is not text (%s)", (_name, props) => {
    const out = html(props);
    expect(out).not.toMatch(/NaN|Infinity|undefined|\bnull\b|\[object/);
    expect(out).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    expect(out).not.toMatch(/(text|bg|border)-(red|green|amber|yellow|blue|gray|slate)-/);
    // The meter, when there is one, has a name; so has every table.
    for (const meter of out.match(/<div role="meter"[^>]*>/g) ?? []) expect(meter).toContain("aria-label=");
    expect((out.match(/<table/g) ?? []).length).toBe((out.match(/<caption/g) ?? []).length);
    // Every field has a label around it.
    expect((out.match(/<input(?![^>]*type="hidden")/g) ?? []).length).toBeLessThanOrEqual((out.match(/<label/g) ?? []).length);
    // The page uses the whole width: its root has no maximum width.
    expect(out.slice(0, 80)).not.toContain("max-w-");
  });

  it.each(every)("works with no script: every form posts and the confirm step is plain HTML (%s)", (_name, props) => {
    const out = html(props);
    expect(out).not.toContain("onClick");
    expect(out).not.toContain("<script");
  });
});

describe("monthChoices and monthLabel", () => {
  it("gives twelve months from this one, over a year end", () => {
    const months = monthChoices("2026-10-31");
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ value: "2026-10", label: "October 2026" });
    expect(months[3]).toEqual({ value: "2027-01", label: "January 2027" });
    expect(months[11]).toEqual({ value: "2027-09", label: "September 2027" });
  });

  it("names a month from a month or any day in it", () => {
    expect(monthLabel("2026-02")).toBe("February 2026");
    expect(monthLabel("2026-02-28")).toBe("February 2026");
    expect(dayLabel("2026-09-03")).toBe("3 September 2026");
  });
});

describe("upcomingTargets", () => {
  const targets = [
    { month: "2026-09-01", revenueTargetMinor: 1 },
    { month: "2026-10-01", revenueTargetMinor: 2 },
    { month: "2027-09-01", revenueTargetMinor: 3 },
    { month: "2027-10-01", revenueTargetMinor: 4 },
  ];

  it("keeps this month and the eleven after it, earliest first", () => {
    expect(upcomingTargets([...targets].reverse(), "2026-10-15").map((t) => t.month)).toEqual(["2026-10-01", "2027-09-01"]);
  });

  it("is empty with none", () => {
    expect(upcomingTargets([], "2026-10-15")).toEqual([]);
  });
});

describe("settingsFromForm", () => {
  const kept = { paymentFeeBps: 290, paymentFeeFixedMinor: 200, shippingCostMinor: 6000, fixedCostsMonthlyMinor: 2_500_000, ltvLifespanYears: 4 };

  it("lays the costs form over what is kept, leaving the lifetime as it is", () => {
    const input = settingsFromForm({ paymentFeePercent: "3,2", paymentFeeFixed: "", shippingCost: "55", fixedCostsMonthly: "1 000" }, kept, "NOK");
    expect(input).toEqual({ paymentFeePercent: "3,2", paymentFeeFixed: "", shippingCost: "55", fixedCostsMonthly: "1 000", ltvLifespanYears: 4 });
  });

  it("lays the lifetime form over what is kept, leaving the costs as they are", () => {
    const input = settingsFromForm({ ltvLifespanYears: "5" }, kept, "NOK");
    expect(input).toEqual({ ...analyticsSettingsText(kept, "NOK"), ltvLifespanYears: 5 });
    expect(input.paymentFeePercent).toBe("2,9");
  });

  it("turns years that are not a number into 0, which the parser refuses in words", () => {
    expect(settingsFromForm({ ltvLifespanYears: "" }, kept, "NOK").ltvLifespanYears).toBe(0);
    expect(settingsFromForm({ ltvLifespanYears: "abc" }, kept, "NOK").ltvLifespanYears).toBe(0);
    expect(settingsFromForm({ ltvLifespanYears: "2.5" }, kept, "NOK").ltvLifespanYears).toBe(2.5);
  });

  it("ignores what is not text, such as a file or the framework's own fields", () => {
    const input = settingsFromForm({ shippingCost: new File([], "x") }, kept, "NOK");
    expect(input.shippingCost).toBe("60,00");
  });
});
