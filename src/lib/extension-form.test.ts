import { describe, expect, it } from "vitest";

import { parseBundleForm, parseExtensionForm, parseFoundingForm, parseGrantsForm } from "./extension-form";

/** The extension catalogue's forms (D748 step E2). */

const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};

const SIZE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PLAN = "33333333-3333-4333-8333-333333333333";

describe("parseExtensionForm", () => {
  const context = { sizeIds: [SIZE], allowanceKeys: ["contacts", "emails_per_contact"] as const, currencies: ["EUR", "NOK"] };

  it("reads the words, the boxes, each size's allowances and prices, and a new size with a label", () => {
    const parsed = parseExtensionForm(
      form({
        name: " Email automation ",
        description: "Flows",
        standalone: "on",
        active: "on",
        position: "2",
        [`size:${SIZE}:label`]: "Up to 2,500 contacts",
        [`size:${SIZE}:allowance:contacts`]: "2 500",
        [`size:${SIZE}:allowance:emails_per_contact`]: "10",
        [`size:${SIZE}:offered`]: "on",
        [`size:${SIZE}:position`]: "0",
        [`size:${SIZE}:price:EUR:month`]: "25",
        [`size:${SIZE}:price:NOK:year`]: "2 500,00",
        "size:new:label": "Up to 100,000 contacts",
        "size:new:allowance:contacts": "100000",
        "size:new:price:EUR:month": "299",
      }),
      context,
    );
    expect(parsed).toEqual({
      ok: true,
      input: {
        name: "Email automation",
        description: "Flows",
        standalone: true,
        position: 2,
        active: true,
        sizes: [
          {
            id: SIZE,
            label: "Up to 2,500 contacts",
            allowances: { contacts: 2500, emails_per_contact: 10 },
            position: 0,
            active: true,
            prices: [
              { currency: "EUR", interval: "month", amountMinor: 2500 , foundingMinor: null },
              { currency: "NOK", interval: "year", amountMinor: 250000 , foundingMinor: null },
            ],
          },
          { id: null, label: "Up to 100,000 contacts", allowances: { contacts: 100000 }, position: 1, active: true, prices: [{ currency: "EUR", interval: "month", amountMinor: 29900 , foundingMinor: null }] },
        ],
      },
    });
  });

  it("lets a size go off offer without prices, skips an empty new size, and ignores allowances the extension does not count", () => {
    const parsed = parseExtensionForm(form({ name: "Work", [`size:${SIZE}:label`]: "3 people", [`size:${SIZE}:allowance:people`]: "3" }), context);
    expect(parsed.ok && parsed.input.sizes).toEqual([{ id: SIZE, label: "3 people", allowances: {}, position: 0, active: false, prices: [] }]);
    expect(parsed.ok && parsed.input.active).toBe(false);
  });

  it("names what is wrong: no name, a size without a label or a price, an amount or a count it cannot read", () => {
    const parsed = parseExtensionForm(
      form({
        [`size:${SIZE}:label`]: "",
        [`size:${SIZE}:offered`]: "on",
        [`size:${SIZE}:price:EUR:month`]: "abc",
        "size:new:label": "Big",
        "size:new:allowance:contacts": "lots",
      }),
      context,
    );
    expect(parsed).toEqual({
      ok: false,
      problems: [
        { key: "giveAName" },
        { key: "giveASizeAName", values: { n: 1 } },
        { key: "notAmount", values: { text: "abc", currency: "EUR" } },
        { key: "notCount", values: { text: "lots" } },
        { key: "sizeNeedsAPrice", values: { size: "Big" } },
      ],
    });
  });
});

describe("parseBundleForm", () => {
  it("reads two or more known members and the prices", () => {
    const parsed = parseBundleForm(
      form({ name: "Customers", active: "on", "member:support_desk": "on", "member:deals": "on", "member:seo": "on", "price:EUR:month": "85" }),
      { currencies: ["EUR"] },
    );
    expect(parsed).toEqual({
      ok: true,
      input: { name: "Customers", description: "", position: 0, active: true, members: ["support_desk", "deals"], prices: [{ currency: "EUR", interval: "month", amountMinor: 8500 , foundingMinor: null }] },
    });
  });

  it("asks for two members and a price while it is offered", () => {
    expect(parseBundleForm(form({ name: "One", active: "on", "member:work": "on" }), { currencies: ["EUR"] })).toEqual({
      ok: false,
      problems: [{ key: "bundleNeedsTwo" }, { key: "bundleNeedsAPrice" }],
    });
  });
});

describe("founding prices (D748 E6)", () => {
  it("reads a founding price beside its price, below it", () => {
    expect(parseBundleForm(form({ name: "Customers", "member:support_desk": "on", "member:deals": "on", "price:EUR:month": "85", "founding:EUR:month": "59" }), { currencies: ["EUR"] })).toMatchObject({
      ok: true,
      input: { prices: [{ currency: "EUR", interval: "month", amountMinor: 8500, foundingMinor: 5900 }] },
    });
  });

  it("refuses a founding price at or above its price, or without one", () => {
    expect(parseBundleForm(form({ name: "C", "member:work": "on", "member:deals": "on", "price:EUR:month": "85", "founding:EUR:month": "85" }), { currencies: ["EUR"] })).toEqual({
      ok: false,
      problems: [{ key: "foundingNotBelow", values: { currency: "EUR" } }],
    });
    expect(parseBundleForm(form({ name: "C", "member:work": "on", "member:deals": "on", "founding:EUR:year": "590" }), { currencies: ["EUR"] })).toEqual({
      ok: false,
      problems: [{ key: "foundingWithoutPrice", values: { currency: "EUR" } }],
    });
  });

  it("reads the offer's last day and months, an empty day being no offer", () => {
    expect(parseFoundingForm(form({ until: "2027-03-31", months: "12" }))).toEqual({ ok: true, input: { until: "2027-03-31", months: 12 } });
    expect(parseFoundingForm(form({ until: "", months: "6" }))).toEqual({ ok: true, input: { until: null, months: 6 } });
    expect(parseFoundingForm(form({ until: "31.03.2027", months: "40" }))).toEqual({ ok: false, problems: [{ key: "foundingDate" }, { key: "foundingMonths" }] });
  });
});

describe("parseGrantsForm", () => {
  const context = { planIds: [PLAN], sizesOf: { ab_testing: [SIZE], support_desk: [], email_automation: [OTHER], work: [], deals: [] } };

  it("reads a size per plan and extension, nothing for not included", () => {
    expect(parseGrantsForm(form({ [`grant:${PLAN}:ab_testing`]: SIZE, [`grant:${PLAN}:email_automation`]: "" }), context)).toEqual({
      ok: true,
      input: [{ planId: PLAN, extensionId: "ab_testing", sizeId: SIZE }],
    });
  });

  it("refuses a size that is not the extension's own", () => {
    expect(parseGrantsForm(form({ [`grant:${PLAN}:ab_testing`]: OTHER }), context)).toEqual({ ok: false, problems: [{ key: "unknownSize" }] });
  });
});
