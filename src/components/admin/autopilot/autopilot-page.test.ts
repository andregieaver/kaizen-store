import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import { DEFAULT_AUTONOMY, readAutonomy } from "@/lib/autopilot-autonomy";
import type { AutopilotOverview } from "@/server/autopilot-overview";

import { AutopilotPage, type AutopilotTab } from "./autopilot-page";

/** The Autopilot page (D309, `docs/ai-autopilot.md` 7.5): what waits for the owner first, then plans, goals and settings. */

const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const action = async () => ({ status: "ok" as const, messages: [] });
const actions = { decide: action, answer: action, plan: action, dropGoal: action, settings: action };

const empty: AutopilotOverview = { calls: [], questions: [], ownerOnly: [], plans: [], goals: [], settings: DEFAULT_AUTONOMY, costMicros: 1_250_000 };

const page = (overview: AutopilotOverview, tab: AutopilotTab = "decisions", lang: "en" | "nb" = "en") =>
  html(createElement(AutopilotPage, { overview, base: "/admin/demo/assistant/autopilot", assistantHref: "/admin/demo/assistant", siteName: "Demo", tab, lang, actions, links: { payments: "/admin/demo/settings/payments" } }));

const plan = {
  id: "11111111-1111-4111-8111-111111111111",
  accountId: "a",
  conversationId: "c",
  goalId: null,
  title: "First week",
  summary: "Pages and a product.",
  version: 2,
  status: "running" as const,
  pauseReason: null,
  createdAt: "",
  startedAt: "",
  finishedAt: null,
};
const step = (key: string, status: "done" | "asking" | "pending", extra: object = {}) => ({
  id: key,
  key,
  title: `Step ${key}`,
  spec: { kind: "question" as const, text: "?", options: [] },
  after: [],
  check: { kind: "none" as const },
  status,
  tries: 0,
  result: null,
  question: null,
  answer: null,
  notBefore: null,
  finishedAt: null,
  ...extra,
});

describe("Decisions", () => {
  it("says plainly when nothing waits", () => {
    expect(page(empty)).toContain("Nothing waits for you.");
  });

  it("shows calls kept for a yes with their plan, questions with their options, and what only the owner can do", () => {
    const out = page({
      ...empty,
      calls: [{ id: "x", summary: "Publish the page About us.", category: "public", createdAt: "", plan: { id: plan.id, title: "First week" } }],
      questions: [{ planId: plan.id, planTitle: "First week", step: "s2", stepTitle: "Tone", question: { text: "Calm or playful?", options: ["Calm", "Playful"] } }],
      ownerOnly: ["payments"],
    });
    expect(out).toContain("Decisions (3)");
    expect(out).toContain("Publish the page About us.");
    expect(out).toContain("From the plan First week");
    expect(out).toContain('value="yes" name="approve"');
    expect(out).toContain("Calm or playful?");
    expect(out).toContain('value="Playful" name="answer"');
    expect(out).toContain("Set up payments");
    expect(out).toContain('href="/admin/demo/settings/payments"');
  });

  it("says when the owner has paused the autopilot, in Norwegian too", () => {
    expect(page({ ...empty, settings: readAutonomy({ paused: true }) })).toContain("The autopilot is paused");
    expect(page({ ...empty, settings: readAutonomy({ paused: true }) }, "decisions", "nb")).toContain("Autopiloten er satt på pause");
  });
});

describe("Plans", () => {
  it("shows each step with its status and result, and the buttons the plan's state allows with the version shown", () => {
    const out = page({ ...empty, plans: [{ plan, steps: [step("s1", "done", { result: { done: "Looked at 4 products." } }), step("s2", "pending")] }] }, "plans");
    expect(out).toContain("First week");
    expect(out).toContain("1 of 2 steps done");
    expect(out).toContain("Looked at 4 products.");
    expect(out).toContain('value="pause" name="do"');
    expect(out).toContain('value="stop" name="do"');
    expect(out).not.toMatch(/value="start"/);
    expect(out).toMatch(/name="version" value="2"/);
  });

  it("offers a way to ask for a plan when there is none", () => {
    expect(page(empty, "plans")).toContain("Ask the AI manager for a plan");
  });
});

describe("Goals and settings", () => {
  it("shows a target that cannot be measured as such, with why", () => {
    const out = page(
      {
        ...empty,
        goals: [
          {
            id: "g",
            title: "First sales",
            vision: "",
            targets: [],
            dueOn: null,
            status: "active",
            createdAt: "",
            met: false,
            progress: [{ kind: "conversion_30d", target: "2 % of visits order", now: "not measured", met: null, missing: "Visit counting is off." }],
          },
        ],
      },
      "goals",
    );
    expect(out).toContain("Not measured");
    expect(out).toContain("Visit counting is off.");
  });

  it("shows each area's level, the limits and the month's spend", () => {
    const out = page({ ...empty, settings: readAutonomy({ levels: { website: "auto" } }) }, "settings");
    expect(out).toMatch(/name="level_website"/);
    expect(out).toMatch(/<option value="auto" selected="">Just do it<\/option>/);
    expect(out).toContain("Spent this month: $1.25");
    expect(out).toContain("Always asks, whatever you choose");
  });
});
