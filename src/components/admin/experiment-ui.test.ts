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
    saveLearningAction: ok,
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

import { DraftActions, DraftPanel, LearningCard, TestActions } from "./experiment-controls";
import { ExperimentResultsView, type BehaviourProps } from "./experiment-results-view";
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
  answeredAt: null,
  learning: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  scheduledStart: null,
  scheduleProblem: null,
  page: { id: "22222222-2222-4222-8222-222222222222", slug: "om-oss", title: "Om oss", published: true, type: "page", kind: "page" },
  part: null,
  variants: [
    { key: "a", name: "Original", share: 0.5, pageId: null, published: true, changed: false, unpublished: false, scope: null },
    { key: "b", name: "Version B", share: 0.5, pageId: "33333333-3333-4333-8333-333333333333", published: true, changed: true, unpublished: false, scope: null },
  ],
  ...over,
});

const part = { kind: "block" as const, id: "heading-1", label: "Heading “Welcome” in row 1" };

describe("making a test on one screen (D660)", () => {
  const create = async () => ({ ok: true as const, id: "x" });
  const pages = [
    { id: "22222222-2222-4222-8222-222222222222", slug: "om-oss", title: "Om oss", kind: "page" as const, buttons: [{ id: "b1", label: "Buy now" }] },
    { id: "44444444-4444-4444-8444-444444444444", slug: "forside", title: "Forside", kind: "role" as const, role: "front", buttons: [] },
  ];
  const traffic = {
    counting: true,
    days: 30,
    consentShare: 0.6,
    baselines: { orders: 0.02, cart: 0.09, checkout: 0.04 },
    targets: { [pages[0].id]: { visitsPerDay: 250, basis: "landing" as const }, [pages[1].id]: { visitsPerDay: 0.5, basis: "landing" as const } },
  };

  it("names the part, offers no other page, and fills in a name from it", () => {
    const out = html(createElement(ExperimentForm, { pages: [pages[0]], markets: [], create, base: "/admin/demo/experiments", part: { ...part, buttons: [] } }));
    expect(out).toContain("What you are testing");
    expect(out).toContain("Heading “Welcome” in row 1");
    expect(out).toContain("about this part only");
    expect(out).toContain('placeholder="Test of Heading “Welcome” in row 1"');
    expect(out).not.toContain("Where?");
  });

  it("says how soon each goal answers at the shop's traffic, recommends one, and draws the time to an answer", () => {
    const out = html(createElement(ExperimentForm, { pages, markets: [], create, base: "/admin/demo/experiments", traffic, history: { [pages[0].id]: { status: "applied" as const, winner: "Version B" } } }));
    expect(out).toContain("What do you want more of?");
    expect(out).toMatch(/About \d+ weeks?( at your traffic|: long for your traffic| for a change of \d+ % or more)/);
    expect(out).toContain("Recommended");
    expect(out).toContain("You pick the button on the page");
    expect(out).toContain("Where?");
    expect(out).toContain("≈ 150 a day");
    expect(out).toContain("fewer than 1 a day");
    expect(out).toContain("Version B won");
    expect(out).toContain("Never tested");
    expect(out).toContain("data-estimate-days");
    expect(out).toContain("14 days: the shortest run");
    expect(out).toContain("Customise");
    expect(out).toContain("Make version B");
  });

  it("says why there is no estimate, and asks for nothing before the main button", () => {
    const out = html(createElement(ExperimentForm, { pages, markets: [], create, base: "/admin/demo/experiments" }));
    expect(out).toContain("not counting visits for this shop");
    expect(out).not.toContain("data-estimate-days");
    // Name, idea, share and devices wait under Customise; the main button needs none of them.
    expect(out.indexOf("Customise")).toBeLessThan(out.indexOf("Share of visitors in the test"));
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

  it("says why a scheduled start did not happen, and keeps the settings under Customise", () => {
    const out = html(createElement(DraftPanel, { store: "demo", test: test({ scheduleProblem: "The scheduled start did not happen. Publish the page." }), markets: [] }));
    expect(out).toContain("The scheduled start did not happen. Publish the page.");
    expect(out).toContain("Ready to start?");
    expect(out).toContain("Customise");
    expect(out).toContain("How long will it take?");
  });
});

describe("a draft as a record (D660)", () => {
  it("makes changing an unchanged version the next step, and keeps scheduling and deleting under More", () => {
    const unchanged = test({ variants: [test().variants[0], { ...test().variants[1], changed: false }] });
    const out = html(createElement(DraftActions, { store: "demo", test: unchanged, ready: false }));
    expect(out).toContain("Change Version B");
    expect(out).toContain("href=\"/admin/demo/experiments/variants/33333333-3333-4333-8333-333333333333\"");
    expect(out).not.toContain("Start the test");
    expect(out).not.toContain("Schedule the start");
    expect(out).toContain("Delete the draft");
  });

  it("offers the start as the one main button once it is ready, with scheduling under More", () => {
    const out = html(createElement(DraftActions, { store: "demo", test: test(), ready: true }));
    expect(out).toContain("Start the test");
    expect(out).toContain("Schedule the start");
    expect(out.match(/\bbg-brand(?![-\w])/g)?.length ?? 0).toBe(1);
  });

  it("ticks what is ready, says what is not, and lists what each version changes", () => {
    const unchanged = test({ variants: [test().variants[0], { ...test().variants[1], changed: false }] });
    const out = html(createElement(DraftPanel, { store: "demo", test: unchanged, markets: [], problems: ["Version B is still the same as the original: change it first, or the test has nothing to find.", "Five tests are running already."] }));
    expect(out).toContain("Version B is still the same as the original: change it first");
    expect(out).toContain("The page is published");
    expect(out).toContain("Five tests are running already.");
    expect(out).not.toContain("Everything is ready");
    const ready = html(createElement(DraftPanel, { store: "demo", test: test(), markets: [], differences: { b: ["Heading: “Om oss” became “Kort fortalt”"] } }));
    expect(ready).toContain("Version B differs from the original");
    expect(ready).toContain("Everything is ready");
    expect(ready).toContain("Heading: “Om oss” became “Kort fortalt”");
  });

  it("asks for a version's changes to be published when they are saved only as a draft, not to change it", () => {
    const saved = test({ variants: [test().variants[0], { ...test().variants[1], changed: false, unpublished: true }] });
    const panel = html(createElement(DraftPanel, { store: "demo", test: saved, markets: [] }));
    expect(panel).toContain("Version B's latest changes are saved but not published");
    expect(panel).toContain("changes saved in the builder and not published yet");
    expect(panel).not.toContain("still the same as the original");
    expect(panel).not.toContain("Nothing differs from the original");
    expect(panel).not.toContain("Everything is ready");
    const actions = html(createElement(DraftActions, { store: "demo", test: saved, ready: false }));
    expect(actions).toContain("Publish Version B's changes");
    expect(actions).not.toContain("Start the test");
  });
});

describe("a started test's header (D659)", () => {
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

describe("what a started test found (D659)", () => {
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
  const view = (figures: ReturnType<typeof rate>[], days: number, behaviour: BehaviourProps | null = null) => {
    const r = results(figures, days);
    const t = test({ status: "running", goal: "cart", startedAt: "2026-11-01T10:00:00.000Z" });
    const card = experimentCard({ status: "running", goal: "cart", minDays: 14, minVisitors: 0, results: r, now: new Date("2026-11-16T12:00:00Z") });
    return html(createElement(ExperimentResultsView, { test: t, results: r, card, base: "/admin/demo/experiments", locale: "nb-NO", differences: { b: ["Heading: “Welcome” became “New this week”"] }, readyAround: "27 Nov 2026", behaviour }));
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
    // If everyone saw B (D662): worked out by the store, with its likely range.
    expect(out).toContain("data-impact");
    expect(out).toMatch(/If everyone saw Version B/);
    expect(out).toMatch(/About \d+ more visitors a week who added to the cart \(likely between \d+ and \d+\)/);
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
    expect(out).not.toContain("data-impact");
  });

  describe("how visitors behaved in each version (D656 step 12)", () => {
    const behaviourRow = (version: string, views: number, rage: number, dead: number) => ({
      version, views, reachedHalf: 0.62, rageShare: rage / views, deadShare: dead / views, rageViews: rage, deadViews: dead, topPage: "/no/sale",
    });
    const behaviour = (over: Partial<BehaviourProps> = {}): BehaviourProps => ({
      rows: [behaviourRow("a", 2400, 48, 120), behaviourRow("b", 60, 9, 3)],
      frustrated: null,
      storeBase: "/admin/demo",
      heatmaps: true,
      recordings: true,
      ...over,
    });
    const figures = () => [rate("a", 2400, 218), rate("b", 2380, 279)];

    it("draws a row per version, says too few below the minimum, and links to each version's heatmap and recordings", () => {
      const out = view(figures(), 16, behaviour());
      expect(out).toContain('id="ab-behaviour"');
      expect(out).toContain("How visitors behaved");
      expect(out).toMatch(/data-version="a"[\s\S]*?2 %[\s\S]*?5 %/);
      expect(out).toMatch(/data-version="b"[\s\S]*?Too few page views yet/);
      const tagOf = (key: string) => encodeURIComponent(`${test().id}:${key}`);
      expect(out.replace(/&amp;/g, "&")).toContain(`/admin/demo/analytics/heatmaps?page=%2Fno%2Fsale&tag=${tagOf("a")}`);
      expect(out).toContain(`/admin/demo/analytics/recordings?tag=${tagOf("b")}`);
      expect(out).not.toContain("data-frustrated");
    });

    it("hides the links a member cannot open, and draws nothing without behaviour", () => {
      const out = view(figures(), 16, behaviour({ heatmaps: false, recordings: false }));
      expect(out).toContain("How visitors behaved");
      expect(out).not.toContain("/analytics/heatmaps?");
      expect(out).not.toContain("/analytics/recordings?");
      expect(view(figures(), 16)).not.toContain("ab-behaviour");
    });

    it("warns, above the details, when a version meets clearly more rage or dead clicks", () => {
      const out = view(figures(), 16, behaviour({ frustrated: "b" }));
      expect(out).toContain("data-frustrated");
      expect(out).toMatch(/Version B gets clearly more rage or dead clicks than the original/);
      expect(out.indexOf("data-frustrated")).toBeLessThan(out.indexOf("How we worked this out"));
    });
  });

  it("asks a decided test what it taught, with what was written before (D662)", () => {
    const out = html(createElement(LearningCard, { store: "demo", test: test({ status: "applied", appliedVariant: "b", learning: "Short headings win" }) }));
    expect(out).toContain("What did this test teach?");
    expect(out).toContain('value="Short headings win"');
  });
});
