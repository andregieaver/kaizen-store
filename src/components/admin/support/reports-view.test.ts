import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { supportReport, type ReportConversation } from "@/lib/support-reports";

import { ReportsView } from "./reports-view";
import { StoreTotalsView } from "./store-totals-view";

const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const T = Date.UTC(2026, 9, 1, 10);
const c = (over: Partial<ReportConversation> = {}): ReportConversation => ({
  mode: "ai_first",
  status: "ended",
  createdAt: T,
  queuedAt: null,
  claimedAt: null,
  firstAgentAt: null,
  endedAt: T + 300_000,
  handoffReason: null,
  rating: null,
  tone: null,
  outcome: null,
  topics: [],
  anonymised: false,
  ...over,
});
const times = <X,>(n: number, make: (i: number) => X) => Array.from({ length: n }, (_, i) => make(i));

describe("the support report's view (D216, step 14)", () => {
  it("shows a rate below ten as what is missing, never a percentage, and counts always", () => {
    const text = html(h(ReportsView, { report: supportReport(times(4, () => c({ rating: "good" }))), periodLabel: "Last 30 days" }));
    expect(text).toContain("Started");
    expect(text).toContain("4 of the 10 needed");
    expect(text).not.toContain("100.0 %");
    expect(text).toContain("For the desk, never per person.");
  });

  it("shows the figures from ten, the hand-over reasons, tone bands with not measured, topics and the deleted transcripts' note", () => {
    const rows = [
      ...times(10, () => c({ rating: "good", tone: 70, topics: ["delivery"], outcome: "resolved" })),
      ...times(10, (i) => c({ queuedAt: T, firstAgentAt: T + (i + 1) * 60_000, handoffReason: "customer", anonymised: i === 0 })),
    ];
    const text = html(h(ReportsView, { report: supportReport(rows), periodLabel: "Last 30 days" }));
    expect(text).toContain("50.0 %");
    expect(text).toContain("The customer asked for a person");
    expect(text).toContain("5 min 30 s");
    expect(text).toContain("Very good");
    expect(text).toContain("Not measured");
    expect(text).toContain("Delivery");
    expect(text).toContain("The AI's own judgement in its summaries.");
    expect(text).toContain("1 of these conversations are past their transcript's period");
  });

  it("draws the platform's totals per store with counts and rates only, and no link to a conversation", () => {
    const report = supportReport(times(3, () => c()));
    const text = html(h(StoreTotalsView, { stores: [{ store: { id: "1", slug: "fjell", name: "Fjell" }, mode: "ai_first", waiting: 2, report }], periodLabel: "Last 30 days" }));
    expect(text).toContain("Fjell");
    expect(text).toContain("AI first");
    expect(text).toContain("– (3)");
    expect(text).not.toMatch(/support\/c\/|\?c=/);
    expect(html(h(StoreTotalsView, { stores: [], periodLabel: "x" }))).toContain("No store has a support desk");
  });
});
