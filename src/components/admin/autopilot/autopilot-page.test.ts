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
const actions = { decide: action, answer: action, plan: action, dropGoal: action, settings: action, cancelFollowUp: action };

const empty: AutopilotOverview = { calls: [], questions: [], ownerOnly: [], plans: [], goals: [], reviews: [], events: [], settings: DEFAULT_AUTONOMY, costMicros: 1_250_000, unpricedCalls: 0, report: null, followUps: [], effects: null };

const page = (overview: AutopilotOverview, tab: AutopilotTab = "decisions", lang: "en" | "nb" = "en") =>
  html(createElement(AutopilotPage, { overview, base: "/admin/demo/assistant/autopilot", assistantHref: "/admin/demo/assistant", siteName: "Demo", tab, lang, actions, links: { payments: "/admin/demo/settings/payments" } }));

describe("follow-ups on the Autopilot page (PSI AGT-04)", () => {
  it("lists what the AI manager will come back to, when in the store's time, each with Cancel, and counts it as waiting", () => {
    const followUps = [{ id: "f1", task: "Check this week's orders", dueAt: "2026-11-02T07:00:00.000Z", repeat: "weekly" as const, timeZone: "Europe/Oslo" }];
    const shown = page({ ...empty, followUps });
    expect(shown).toContain("What the AI manager will come back to");
    expect(shown).toContain("Check this week's orders");
    expect(shown).toContain("08:00");
    expect(shown).toContain("then every week");
    expect(shown).toContain(">Cancel<");
    expect(shown).not.toContain("Nothing waits for you");
    expect(page({ ...empty, followUps }, "decisions", "nb")).toContain("Det KI-assistenten skal komme tilbake til");
  });
});

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

  it("shows what a step changed at Do it and tell me: a task's changes under its answer, a tool step's one change once (D309 7.4)", () => {
    const task = step("s1", "done", { result: { done: "Wrote two descriptions.", told: ["Change the description of Mug.", "Change the description of Bowl."] } });
    const tool = step("s2", "done", { result: { done: "Order 1042 is marked as sent.", told: ["Order 1042 is marked as sent."] } });
    const out = page({ ...empty, plans: [{ plan, steps: [task, tool] }] }, "plans");
    expect(out).toContain("Wrote two descriptions.");
    expect(out).toContain("Change the description of Mug.");
    expect(out).toContain("Change the description of Bowl.");
    expect(out.match(/Done, as you asked to be told:/g)).toHaveLength(2);
    expect(out.match(/Order 1042 is marked as sent\./g)).toHaveLength(1);
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

describe("What the autopilot reacted to (D331)", () => {
  const event = { id: "e1", kind: "support_waiting" as const, status: "done", outcome: "Left a note about a late parcel.", at: "2026-10-26T08:00:00Z", told: [] };

  it("lists the store's events under the decisions, and says nothing when there are none", () => {
    expect(page({ ...empty, events: [event] })).toContain("What the autopilot reacted to");
    expect(page({ ...empty, events: [event] })).toContain("A customer waited for a person");
    expect(page({ ...empty, events: [event] })).toContain("Left a note about a late parcel.");
    expect(page(empty)).not.toContain("What the autopilot reacted to");
    expect(page({ ...empty, events: [event] }, "decisions", "nb")).toContain("En kunde ventet på et menneske");
    expect(page({ ...empty, events: [event] })).not.toContain("as you asked to be told");
  });

  it("lists what an event changed at Do it and tell me (D309 7.4)", () => {
    const told = { ...event, told: ["Add a note to the conversation, for the store's staff only."] };
    expect(page({ ...empty, events: [told] })).toContain("Done, as you asked to be told:");
    expect(page({ ...empty, events: [told] })).toContain("Add a note to the conversation, for the store's staff only.");
    expect(page({ ...empty, events: [told] }, "decisions", "nb")).toContain("Gjort, og du ba om å få vite om det:");
  });

  it("offers the switch on a store's settings, never on the platform's", () => {
    expect(page(empty, "settings")).toContain("React to what happens");
    expect(page(empty, "settings")).toContain('name="wait_minutes"');
    expect(page({ ...empty, events: null }, "settings")).not.toContain("React to what happens");
  });
});


describe("Results on the Autopilot page (D418)", () => {
  const month = (over: Record<string, unknown> = {}) => ({ month: "2026-11", actions: 5, measured: 2, products: 1, beforeMinor: 100_000, afterMinor: 150_000, liftMinor: 40_000, above: 1, below: 0, currency: "NOK", ...over });
  const effects = {
    thisMonth: month(),
    lastMonth: month({ month: "2026-10", actions: 0, measured: 0, products: 0, beforeMinor: 0, afterMinor: 0, liftMinor: null, above: 0, below: 0 }),
    recent: [
      { auditId: 7, tool: "set_prices", targetKind: "product" as const, targetLabel: "Blue mug", actedAt: "2026-10-10T09:00:00.000Z", currency: "NOK", beforeMinor: 100_000, afterMinor: 150_000, beforeUnits: 10, afterUnits: 14, storeBeforeMinor: 1_000_000, storeAfterMinor: 1_100_000 },
      { auditId: 8, tool: "build_page", targetKind: "store" as const, targetLabel: "", actedAt: "2026-10-11T09:00:00.000Z", currency: "NOK", beforeMinor: 1_000_000, afterMinor: 1_100_000, beforeUnits: null, afterUnits: null, storeBeforeMinor: 1_000_000, storeAfterMinor: 1_100_000 },
    ],
    locale: "nb-NO",
  };

  it("is a tab for a store, never for Kaizena Flow's site, with the month's figures, each change and the caution", () => {
    expect(page(empty)).not.toContain("?tab=results");
    expect(page({ ...empty, effects })).toContain("?tab=results");
    const shown = page({ ...empty, effects }, "results");
    expect(shown).toContain("What the AI did");
    expect(shown).toContain("not proof that the change caused it");
    expect(shown).toContain("This month so far");
    expect(shown).toContain("Set prices");
    expect(shown).toContain("Product: Blue mug");
    expect(shown).toContain("Beyond the store's own trend");
    expect(shown).toContain("1 sold more than the store's trend, 0 less");
    expect(shown).toContain("Build page");
    expect(shown).toContain("The store");
    expect(page({ ...empty, effects: { ...effects, recent: [] } }, "results")).toContain("Nothing measured yet");
    expect(page({ ...empty, effects }, "results", "nb")).toContain("Det KI gjorde");
  });
});
