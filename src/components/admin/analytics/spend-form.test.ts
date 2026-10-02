import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FormState } from "@/components/admin/action-form";
import { CHANNELS } from "@/lib/analytics-channels";
import type { StoredSpend } from "@/server/analytics-settings";

import { moneyWriter } from "./overview-view";
import { SpendSection, type SpendSectionProps } from "./spend-form";

const money = (minor: number) => moneyWriter("NOK", "nb-NO")(minor).replace(/[\u00a0\u202f]/g, " ");

const text = (props: SpendSectionProps) =>
  renderToString(h(SpendSection, props))
    // React adds one small script of its own for a form's action; it is not the page's.
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ");

const noop = async (): Promise<FormState> => ({ status: "ok", messages: [] });

const ID_A = "6b0f7a36-0a63-4c4a-9d57-0a2f0f6d9c11";
const ID_B = "0d3d2a3e-85f5-45c2-a8de-6a1e0d4ed2aa";

const entries: StoredSpend[] = [
  { id: ID_A, day: "2026-10-01", channel: "paid_search", campaign: "Autumn sale", amountMinor: 150_000, note: "Invoice 4411" },
  { id: ID_B, day: "2026-09-30", channel: "paid_social", campaign: "", amountMinor: 80_000, note: null },
];

const base: SpendSectionProps = { currency: "NOK", locale: "nb-NO", today: "2026-10-02", entries, limit: 25, actions: { add: noop, remove: noop } };

const BAD = /\bNaN\b|Infinity|undefined|\[object|\bnull\b/;

describe("SpendSection", () => {
  it("has the form's fields: day, channel from the shared list, campaign, amount and note", () => {
    const out = text(base);
    expect(out).toMatch(/<input type="date" required="" max="2026-10-02"[^>]*name="day" value="2026-10-02"/);
    expect(out).toContain('name="channel"');
    for (const c of CHANNELS) expect(out).toContain(`<option value="${c.key}">${c.label}</option>`);
    expect(out).toContain('name="campaign"');
    expect(out).toContain('name="amount"');
    expect(out).toContain('name="note"');
    expect(out).toContain("Add spend");
  });

  it("makes the channel a choice the owner has to make, so nothing is guessed", () => {
    const out = text(base);
    expect(out).toMatch(/<option value="" disabled="" selected="">Choose a channel<\/option>/);
    expect(out).toMatch(/<select name="channel" required=""/);
  });

  it("says what to enter and in what currency, without VAT", () => {
    const out = text(base);
    expect(out).toContain("In NOK, without VAT, like the sales figures.");
    expect(out).toContain("entering it again replaces the earlier amount");
    expect(out).toContain("CAC and ROAS come from what you enter here");
  });

  it("lists the latest entries with their amounts and a remove button for each, named for a screen reader", () => {
    const out = text(base);
    expect(out).toContain("Autumn sale");
    expect(out).toContain("Whole channel");
    expect(out).toContain("Invoice 4411");
    expect(out).toContain("1 Oct 2026");
    expect(out).toMatch(new RegExp(`name="id" value="${ID_A}"`));
    expect(out).toMatch(new RegExp(`name="id" value="${ID_B}"`));
    expect(out).toContain(`Remove<span class="sr-only"> the ${money(150_000)} entered for Paid search on 1 Oct 2026</span>`);
    expect(out).toMatch(/<caption[^>]*>Latest ad spend entries<\/caption>/);
    expect(out).not.toMatch(BAD);
  });

  it("is calm with no entries: the form and an invitation to add the first one", () => {
    const out = text({ ...base, entries: [] });
    expect(out).toContain("No ad spend entered yet. Add the first one above.");
    expect(out).toContain("Add spend");
    expect(out).not.toMatch(BAD);
  });

  it("says when the list may hold more than it shows", () => {
    expect(text({ ...base, limit: 2 })).toContain("Showing the 2 latest entries.");
    expect(text(base)).not.toContain("latest entries.");
  });

  it("is a form that posts with no script, with its section findable from the headline", () => {
    const out = text(base);
    expect(out).toContain('aria-labelledby="spend"');
    expect(out).toContain('id="spend"');
    expect(out).toMatch(/<form[^>]*>/);
  });
});
