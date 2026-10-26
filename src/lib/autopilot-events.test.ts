import { describe, expect, it } from "vitest";

import { readAutonomy } from "./autopilot-autonomy";
import { EVENT_KINDS, EVENT_LINES, EVENT_TOOLS, eventMessage, eventRef, isoWeek, type EventFacts } from "./autopilot-events";
import { MANAGER_TOOLS_BY_NAME } from "./manager-tools";
import { OWNER_TOOLS_BY_NAME } from "./owner-tools";

/** Reacting to events (D331, `docs/ai-autopilot.md` 15.5): the settings, the tools each event may use and the turn's message. */

const support: EventFacts = { kind: "support_waiting", conversation: "c1", waitedMinutes: 22, handoffReason: "customer" };
const test: EventFacts = { kind: "test_ended", experiment: "x1", name: "Bigger photos", stopReason: "guardrail", stoppedAt: "2026-10-25T10:00:00Z" };
const alert: EventFacts = { kind: "alert", alert: "conversion", severity: "urgent", text: "Conversion fell by half.", evidence: ["Conversion: 1.1% (against 2.3%)"] };

describe("the settings", () => {
  it("react to nothing until switched on, and wait 15 minutes for a person by default", () => {
    const planning = readAutonomy({}).planning;
    expect(planning.reacts).toBe(false);
    expect(planning.waitMinutes).toBe(15);
    expect(readAutonomy({ planning: { reacts: true, waitMinutes: 2 } }).planning.reacts).toBe(false); // out of range: the defaults
    expect(readAutonomy({ planning: { reacts: true, waitMinutes: 30 } }).planning).toMatchObject({ reacts: true, waitMinutes: 30 });
  });
});

describe("each event's tools", () => {
  it("are all real tools, and none writes to a customer or decides a plan's start", () => {
    for (const kind of EVENT_KINDS) {
      for (const name of EVENT_TOOLS[kind]) expect([kind, name, Boolean(OWNER_TOOLS_BY_NAME[name] ?? MANAGER_TOOLS_BY_NAME[name])]).toEqual([kind, name, true]);
      for (const never of ["reply_to_support", "end_support_conversation", "email_customer", "send_broadcast", "start_autopilot_plan", "decide_approval"]) {
        expect(EVENT_TOOLS[kind]).not.toContain(never);
      }
    }
    expect(EVENT_TOOLS.support_waiting).toContain("add_support_note");
    expect(EVENT_TOOLS.test_ended).toContain("apply_winner");
    expect(EVENT_TOOLS.alert).toContain("make_autopilot_plan");
  });

  it("come with lines that say nobody is reading along", () => {
    for (const kind of EVENT_KINDS) expect(EVENT_LINES[kind]).toContain("Nobody is reading along");
    expect(EVENT_LINES.support_waiting).toContain("Never write to the customer");
  });
});

describe("the turn's message", () => {
  it("carries each event's facts as code wrote them", () => {
    expect(eventMessage(support)).toContain("waited 22 minutes");
    expect(eventMessage(support)).toContain("get_support_conversation (c1)");
    expect(eventMessage(test)).toContain('"Bigger photos" (id x1)');
    expect(eventMessage(test)).toContain("guardrail");
    const withGoals = eventMessage(alert, [{ id: "g1", title: "Double sales" }]);
    expect(withGoals).toContain("Conversion fell by half.");
    expect(withGoals).toContain("Conversion: 1.1% (against 2.3%)");
    expect(withGoals).toContain('"Double sales" (id g1)');
  });

  it("makes an alert once a week and the others once", () => {
    expect(eventRef(support, "2026-10-26")).toBe("c1");
    expect(eventRef(test, "2026-10-26")).toBe("x1");
    expect(eventRef(alert, "2026-10-26")).toBe("conversion:2026-W44");
    expect(eventRef(alert, "2026-11-01")).toBe("conversion:2026-W44");
    expect(eventRef(alert, "2026-11-02")).toBe("conversion:2026-W45");
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
    expect(isoWeek("2024-12-30")).toBe("2025-W01");
  });
});
