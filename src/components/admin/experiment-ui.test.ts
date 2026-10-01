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

import { DraftPanel, RunPanel } from "./experiment-controls";
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

describe("a test that has been scheduled, stopped or applied", () => {
  it("shows when a scheduled test starts, and that it can be started or taken back", () => {
    const out = html(createElement(RunPanel, { store: "demo", test: test({ status: "scheduled", scheduledStart: "2026-10-20T08:00:00.000Z" }) }));
    expect(out).toContain("Starts 20 Oct 2026");
    expect(out).toContain("Start now");
    expect(out).toContain("Back to a draft");
  });

  it("says a part winner replaces the part only", () => {
    const out = html(createElement(RunPanel, { store: "demo", test: test({ status: "stopped", part }) }));
    expect(out).toContain("replaces Heading “Welcome” in row 1 in the page at once, and nothing else");
    expect(out).toContain("Use Version B");
    const whole = html(createElement(RunPanel, { store: "demo", test: test({ status: "stopped" }) }));
    expect(whole).toContain("replaces the page&#x27;s content at once".replace("&#x27;", "'"));
  });
});
