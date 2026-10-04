import { describe, expect, it } from "vitest";

import { ADMIN_PAGES } from "./admin-map";
import { ASSISTANT_SKILLS } from "./assistant-skills";
import { MANAGER_TOOLS, PLATFORM_TOOLS, TOOL_WORDS } from "./manager-tools";
import { OWNER_TOOLS, OWNER_TOOLS_BY_NAME } from "./owner-tools";
import { TOOL_PERMISSIONS } from "./owner-tool-permissions";
import { clockSentence, nextSteps, waitingSentence } from "./privacy-tools";
import type { RequestClock } from "./privacy-request";

const NAMES = ["list_privacy_requests", "explain_privacy_request"] as const;

describe("the privacy tools of the owner assistant (wave 1g, D162)", () => {
  it("are two ungated reads of the owner's tools, with a permission and a line of words each", () => {
    for (const name of NAMES) {
      expect(OWNER_TOOLS.some((t) => t.name === name), name).toBe(true);
      expect(OWNER_TOOLS_BY_NAME[name].gate, name).toBeUndefined();
      expect(TOOL_PERMISSIONS[name], name).toBe("customers:read");
      expect(TOOL_WORDS[name], name).toBeTruthy();
      // The platform's and the manager's tool lists are not the store's.
      expect(MANAGER_TOOLS.some((t) => (t.name as string) === name)).toBe(false);
      expect(PLATFORM_TOOLS.some((t) => (t.name as string) === name)).toBe(false);
    }
  });

  it("has no tool that exports or erases a person's data, or extends or refuses a request: that is done on the pages", () => {
    const named = OWNER_TOOLS.filter((t) => /privacy|erase|erasure|export|gdpr|forget|anonymi/i.test(t.name)).map((t) => t.name);
    expect(named.sort()).toEqual([...NAMES].sort());
    for (const name of NAMES) {
      expect(OWNER_TOOLS_BY_NAME[name].description).toMatch(/Read-only|never shows the person/);
    }
    // The change tools are the ones that are gated; none of the privacy ones is.
    expect(OWNER_TOOLS.filter((t) => t.gate && /privacy|erase|export/i.test(t.name))).toEqual([]);
  });

  it("has a playbook that names tools and pages that exist, and gives no legal advice", () => {
    const skill = ASSISTANT_SKILLS.find((s) => s.id === "privacy-request")!;
    expect(skill.area).toBe("store");
    const steps = skill.steps.join("\n");
    for (const name of NAMES) expect(steps).toContain(name);
    expect(steps).toMatch(/never export, erase, extend or refuse/);
    expect(steps).toMatch(/do not give legal advice/);
    const ids = new Set(ADMIN_PAGES.map((p) => p.id));
    for (const id of ["privacy.new", "customer.erase", "customer", "privacy"]) expect(ids.has(id), id).toBe(true);
  });
});

const DAY = 86_400_000;
const received = new Date("2026-09-10T08:00:00Z");
const clock = (over: Partial<RequestClock> = {}): RequestClock => ({ status: "open", receivedAt: received, dueAt: new Date("2026-10-10T08:00:00Z"), extendedUntil: null, ...over });

describe("the words of the privacy tools", () => {
  it("says the clock in days, overdue, due today and none for an answered request", () => {
    expect(clockSentence(12, false)).toBe("12 days left");
    expect(clockSentence(1, false)).toBe("1 day left");
    expect(clockSentence(0, false)).toBe("Due today");
    expect(clockSentence(-3, true)).toBe("3 days overdue");
    expect(clockSentence(-1, true)).toBe("1 day overdue");
    expect(clockSentence(null, false)).toBe("");
  });

  it("counts what waits in one sentence, and says so when nothing does", () => {
    expect(waitingSentence({ open: 0, overdue: 0, dueSoon: 0 })).toBe("No privacy request is open.");
    expect(waitingSentence({ open: 3, overdue: 1, dueSoon: 1 })).toBe("3 open, 1 past the one-month deadline, 1 due within the week.");
    expect(waitingSentence({ open: 2, overdue: 0, dueSoon: 0 })).toBe("2 open.");
  });

  it("offers the steps of an open request, the extension only while the rules allow it, and nothing for an answered one", () => {
    const early = new Date(received.getTime() + 5 * DAY);
    const erase = nextSteps(clock(), "erasure", early).join("\n");
    expect(erase).toMatch(/erase page/);
    expect(erase).toMatch(/Extend the answer once/);
    expect(nextSteps(clock(), "export", early).join("\n")).toMatch(/never emailed/);
    // Past the first month, or already extended: no extension, and it says why.
    const late = nextSteps(clock(), "export", new Date(received.getTime() + 40 * DAY)).join("\n");
    expect(late).not.toMatch(/Extend the answer once/);
    expect(late).toMatch(/cannot be extended/);
    const extended = nextSteps(clock({ extendedUntil: new Date("2026-12-10T08:00:00Z") }), "export", early).join("\n");
    expect(extended).not.toMatch(/Extend the answer once/);
    expect(nextSteps(clock({ status: "done" }), "export", early)).toEqual([]);
  });
});
