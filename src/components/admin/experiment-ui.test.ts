import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock("@/app/admin/(gated)/[store]/experiments/actions", () => {
  const ok = async () => ({ ok: true as const });
  return {
    addVariantAction: ok,
    applyVariantAction: ok,
    decideExperimentAction: ok,
    deleteDraftAction: ok,
    discardExperimentAction: ok,
    removeVariantAction: ok,
    renameExperimentAction: ok,
    scheduleExperimentAction: ok,
    startExperimentAction: ok,
    stopExperimentAction: ok,
    unscheduleExperimentAction: ok,
    updateDraftAction: ok,
  };
});

import type { ExperimentInfo } from "@/server/experiment-admin";

import { experimentCard } from "@/lib/experiment-card";
import { verdictOf } from "@/lib/experiment-results";

import { DraftPanel, TestActions } from "./experiment-controls";
import { ExperimentResultsView } from "./experiment-results-view";
import { ExperimentForm } from "./experiment-form";

/** What a person reads before any script runs. */
const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element)
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"');

const test = (over: Partial<ExperimentInfo> = {}): ExperimentInfo => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Heading test",
  hypothesis: "",
  status: "draft",
  goal: "orders",
  goalBlock: null,
  trafficShare: 1,
  audience: {},
  minDays: 14,
  minVisitors: 0,
  plannedEnd: null,
  startedAt: null,
  stoppedAt: null,
  stopReason: null,
  appliedVariant: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  scheduledStart: null,
  scheduleProblem: null,
  page: { id: "22222222-2222-4222-8222-222222222222", slug: "om-oss", title: "Om oss", published: true, type: "page", kind: "page" },
  part: null,
  variants: [
    { key: "a", name: "Original", share: 0.5, pageId: null, published: true, changed: false, scope: null },
    { key: "b", name: "Version B", share: 0.5, pageId: "33333333-3333-4333-8333-333333333333", published: true, changed: true, scope: null },
  ],
  ...over,
});

const part = { kind: "block" as const, id: "heading-1", label: "Heading “Welcome” in row 1" };

describe("making a test of a part", () => {
  const create = async () => ({ ok: true as const, id: "x" });
  const pages = [{ id: "22222222-2222-4222-8222-222222222222", slug: "om-oss", title: "Om oss", kind: "page" as const, buttons: [{ id: "b1", label: "Buy now" }] }];

  it("names the part, offers no other page, and fills in a name from it", () => {
    const out = html(createElement(ExperimentForm, { pages, markets: [], create, base: "/admin/demo/experiments", part: { ...part, buttons: [] } }));
    expect(out).toContain("1. What you are testing");
    expect(out).toContain("Heading “Welcome” in row 1");
    expect(out).toContain("about this part only");
    expect(out).toContain('placeholder="Test of Heading “Welcome” in row 1"');
    expect(out).not.toContain("What to test");
  });

  it("asks which page when no part was chosen", () => {
    const out = html(createElement(ExperimentForm, { pages, markets: [], create, base: "/admin/demo/experiments" }));
    expect(out).toContain("1. What do you want to test?");
    expect(out).toContain("What to test");
  });
});

describe("a draft of a part test", () => {
  const draft = test({ part, variants: [test().variants[0], { ...test().variants[1], scope: "outside" }] });

  it("says to change the part only, and warns about a version that changed more", () => {
    const out = html(createElement(DraftPanel, { store: "demo", test: draft, markets: [] }));
    expect(out).toContain("change Heading “Welcome” in row 1");
    expect(out).toContain("Everything else on the page has to stay as it is");
    expect(out).toContain("Changes more than Heading “Welcome” in row 1: put everything else back as it was.");
  });

  it("offers to start now or at a time, and says why a scheduled start did not happen", () => {
    const out = html(createElement(DraftPanel, { store: "demo", test: test({ scheduleProblem: "The scheduled start did not happen. Publish the page." }), markets: [] }));
    expect(out).toContain("Start the test now");
    expect(out).toContain("Or start it at");
    expect(out).toContain("Schedule the start");
    expect(out).toContain("The scheduled start did not happen. Publish the page.");
    expect(out).toContain("How long will it take?");
  });
});

describe("a started test's header (D650)", () => {
  it("offers a scheduled test's start as the one main button, and taking it back under More", () => {
    const out = html(createElement(TestActions, { store: "demo", test: test({ status: "scheduled", scheduledStart: "2026-10-20T08:00:00.000Z" }), next: "start", best: null }));
    expect(out).toContain("Start now");
    expect(out).toContain("Back to a draft");
    expect(out.match(/\bbg-brand(?![-\w])/g)?.length ?? 0).toBe(1);
  });

  it("offers the winner while the test still runs, with stopping and keeping the original under More", () => {
    const out = html(createElement(TestActions, { store: "demo", test: test({ status: "running" }), next: "use", best: "b" }));
    expect(out).toContain("Use Version B");
    expect(out).toContain("Keep the original");
    expect(out).toContain("Stop the test");
    expect(out).toContain("Rename");
  });

  it("asks for no decision while it is still learning: there is no main button", () => {
    const out = html(createElement(TestActions, { store: "demo", test: test({ status: "running" }), next: "wait", best: null }));
    expect(out).not.toMatch(/\bbg-brand(?![-\w])/);
    expect(out).toContain("Stop the test");
  });

  it("offers nothing once the test is decided", () => {
    expect(html(createElement(TestActions, { store: "demo", test: test({ status: "applied", appliedVariant: "b" }), next: "done", best: null }))).toBe("");
  });
});

describe("what a started test found (D650)", () => {
  const rate = (key: string, visitors: number, conversions: number) => ({ key, name: key, visitors, conversions, money: null });
  const results = (figures: ReturnType<typeof rate>[], days: number) => {
    const verdict = verdictOf({ goal: "cart", figures, splitP: 0.6, days, minVisitors: 0, minDays: 14, currency: "NOK", locale: "nb-NO" });
    const funnel = Object.fromEntries(figures.map((f) => [f.key, { visitors: f.visitors, carts: f.conversions, checkouts: Math.round(f.conversions / 2), buyers: 0, clicks: 0, forms: 0 }]));
    const daily = Array.from({ length: days }, (_, i) => ({
      day: `2026-11-${String(i + 1).padStart(2, "0")}`,
      variants: Object.fromEntries(figures.map((f) => [f.key, { visitors: Math.round(f.visitors / days), conversions: Math.round(f.conversions / days) }])),
    }));
    return { figures, funnel, revenue: { a: { sum: 0, plain: 0 }, b: { sum: 0, plain: 0 } }, currency: "NOK", unconverted: 0, daily, weekly: [], splitP: 0.6, days, verdict, harmed: null };
  };
  const view = (figures: ReturnType<typeof rate>[], days: number) => {
    const r = results(figures, days);
    const t = test({ status: "running", goal: "cart", startedAt: "2026-11-01T10:00:00.000Z" });
    const card = experimentCard({ status: "running", goal: "cart", minDays: 14, minVisitors: 0, results: r, now: new Date("2026-11-16T12:00:00Z") });
    return html(createElement(ExperimentResultsView, { test: t, results: r, card, base: "/admin/demo/experiments", locale: "nb-NO", differences: { b: ["Heading: “Welcome” became “New this week”"] }, readyAround: "27 Nov 2026" }));
  };

  it("draws the answer: the range above no change, the progress reached and what B changed", () => {
    const out = view([rate("a", 2400, 218), rate("b", 2380, 279)], 16);
    expect(out).toContain("B is better than the original.");
    expect(out).toContain("data-range-chart");
    expect(out).toMatch(/Version B \+29 %/);
    expect(out).toMatch(/likely \+\d+ % to \+\d+ %/);
    expect(out).toContain("16 of 14");
    expect(out).toContain("Both are reached");
    expect(out).toContain("Heading: “Welcome” became “New this week”");
    expect(out).toContain("How we worked this out");
    expect(out).not.toContain("chance it is better");
  });

  it("shows no change or range while it is too early, and says when it is likely ready", () => {
    const out = view([rate("a", 152, 14), rate("b", 148, 12)], 3);
    expect(out).toContain("Too early to say.");
    expect(out).not.toMatch(/Version B [+−]\d+ %/);
    expect(out).not.toMatch(/likely [+−]/);
    expect(out).toContain("The pictures are drawn once there is an answer");
    expect(out).toContain("Nothing can be said yet");
    expect(out).not.toContain("data-trend-chart");
    expect(out).not.toContain("data-funnel-bars");
    expect(out).not.toMatch(/\d+ % fewer|\d+ % more/);
    expect(out).toContain("Likely ready around 27 Nov 2026");
    expect(out).toContain("Not enough yet");
  });
});
