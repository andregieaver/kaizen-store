import { describe, expect, it } from "vitest";

import { PERMISSION_KEYS } from "./permission-keys";
import {
  ALERT_KEYS,
  ALERT_NEEDS,
  STAFF_ALERT_EVENTS,
  addDays,
  defaultRecipients,
  localNow,
  memberMayReceive,
  recipientsFor,
  summaryChoiceProblem,
  summaryDue,
  type AlertChoices,
  type AlertMember,
} from "./staff-alerts";

const owner: AlertMember = { accountId: "owner-1", owner: true, permissions: [] };
const owner2: AlertMember = { accountId: "owner-2", owner: true, permissions: [] };
const packer: AlertMember = { accountId: "packer", owner: false, permissions: ["orders:read", "orders:write"] };
const writer: AlertMember = { accountId: "writer", owner: false, permissions: ["website:read", "website:write"] };

const defaults = (hasContact: boolean): AlertChoices => ({ configuredAt: null, recipients: [], contactEvents: [], hasContact });

describe("the events and what each needs (4.7)", () => {
  it("pins the events and their keys", () => {
    expect(STAFF_ALERT_EVENTS).toEqual(["new_order", "return_requested", "refund_overdue", "low_stock", "summary", "automation"]);
    expect(ALERT_NEEDS).toEqual({
      new_order: "orders:read",
      return_requested: "orders:read",
      refund_overdue: "orders:read",
      low_stock: "products:read",
      summary: "analytics:read",
      automation: "orders:read",
    });
    for (const key of Object.values(ALERT_NEEDS)) expect(PERMISSION_KEYS).toContain(key);
  });

  it("lets owners receive everything and others only what their role reads", () => {
    for (const event of STAFF_ALERT_EVENTS) expect(memberMayReceive(owner, event)).toBe(true);
    expect(memberMayReceive(packer, "new_order")).toBe(true);
    expect(memberMayReceive(packer, "low_stock")).toBe(false);
    expect(memberMayReceive(packer, "summary")).toBe(false);
    expect(memberMayReceive(writer, "new_order")).toBe(false);
  });
});

describe("defaults (today's behaviour until the owner saves)", () => {
  it("sends owners new orders, returns requested and low stock, and refunds overdue to the contact address", () => {
    const d = defaultRecipients([owner, packer], true);
    expect([...d.accounts]).toEqual([["owner-1", ["new_order", "return_requested", "low_stock"]]]);
    expect(d.contact).toEqual(["refund_overdue"]);
  });

  it("sends refunds overdue to the owners when there is no contact address", () => {
    expect(recipientsFor("refund_overdue", [owner, owner2, packer], defaults(false))).toEqual([
      { kind: "account", accountId: "owner-1" },
      { kind: "account", accountId: "owner-2" },
    ]);
    expect(recipientsFor("refund_overdue", [owner], defaults(true))).toEqual([{ kind: "contact" }]);
  });

  it("sends nobody the summary or automation emails", () => {
    expect(recipientsFor("summary", [owner, packer], defaults(true))).toEqual([]);
    expect(recipientsFor("automation", [owner, packer], defaults(true))).toEqual([]);
    expect(recipientsFor("new_order", [owner, packer], defaults(true))).toEqual([{ kind: "account", accountId: "owner-1" }]);
  });
});

describe("chosen recipients", () => {
  const chosen: AlertChoices = {
    configuredAt: "2026-10-14T00:00:00Z",
    recipients: [
      { accountId: "packer", events: ["new_order", "low_stock", "summary"] },
      { accountId: "writer", events: ["new_order"] },
      { accountId: "gone", events: ["new_order"] },
      { accountId: "packer", events: ["new_order"] },
    ],
    contactEvents: ["new_order", "refund_overdue"],
    hasContact: true,
  };

  it("gives each event to the chosen members whose role still reads it, once, and the contact address", () => {
    expect(recipientsFor("new_order", [owner, packer, writer], chosen)).toEqual([{ kind: "account", accountId: "packer" }, { kind: "contact" }]);
    // The packer chose low stock and the summary, but the role reads neither: nothing.
    expect(recipientsFor("low_stock", [owner, packer, writer], chosen)).toEqual([]);
    expect(recipientsFor("summary", [owner, packer, writer], chosen)).toEqual([]);
    // The owner did not choose themselves: no default once the page is saved.
    expect(recipientsFor("return_requested", [owner, packer], chosen)).toEqual([]);
  });

  it("drops the contact address when the store has none", () => {
    expect(recipientsFor("refund_overdue", [owner], { ...chosen, hasContact: false })).toEqual([]);
  });
});

describe("the emails' keys (2.8)", () => {
  it("are per thing and recipient, and keep today's key for the contact address's overdue reminder", () => {
    const contact = { kind: "contact" } as const;
    const account = { kind: "account", accountId: "a1" } as const;
    expect(ALERT_KEYS.newOrder("o1", account)).toBe("staff-order:o1:a1");
    expect(ALERT_KEYS.newOrder("o1", contact)).toBe("staff-order:o1:contact");
    expect(ALERT_KEYS.returnRequested("r1", account)).toBe("staff-return:r1:a1");
    expect(ALERT_KEYS.refundOverdue("r1", contact)).toBe("return.r1.overdue");
    expect(ALERT_KEYS.refundOverdue("r1", account)).toBe("return.r1.overdue:a1");
    expect(ALERT_KEYS.lowStock("stock-low:s1:2026-10-14", account)).toBe("stock-low:s1:2026-10-14:a1");
    expect(ALERT_KEYS.summary("s1", "daily:2026-10-13", account)).toBe("staff-summary:s1:daily:2026-10-13:a1");
    expect(ALERT_KEYS.ruleNotify("run1", account)).toBe("rule-notify:run1:a1");
  });
});

describe("the summary's period", () => {
  it("reads the store's local date, weekday and hour", () => {
    // 22:30 UTC on Sunday 11 October 2026 is 00:30 on Monday 12 October in Oslo (summer time).
    expect(localNow(new Date("2026-10-11T22:30:00Z"), "Europe/Oslo")).toEqual({ date: "2026-10-12", weekday: 1, hour: 0 });
    expect(localNow(new Date("2026-10-11T22:30:00Z"), "UTC")).toEqual({ date: "2026-10-11", weekday: 7, hour: 22 });
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("sends a daily summary for yesterday once the hour has come, once", () => {
    const base = { summary: "daily" as const, weekday: 1, hour: 8, lastPeriod: null };
    expect(summaryDue({ ...base, now: { date: "2026-10-14", weekday: 3, hour: 7 } })).toBeNull();
    expect(summaryDue({ ...base, now: { date: "2026-10-14", weekday: 3, hour: 8 } })).toEqual({ key: "daily:2026-10-13", from: "2026-10-13", to: "2026-10-13" });
    expect(summaryDue({ ...base, lastPeriod: "daily:2026-10-13", now: { date: "2026-10-14", weekday: 3, hour: 23 } })).toBeNull();
    expect(summaryDue({ ...base, summary: "off", now: { date: "2026-10-14", weekday: 3, hour: 9 } })).toBeNull();
  });

  it("sends a weekly summary only on its day, for the seven days ending yesterday", () => {
    const base = { summary: "weekly" as const, weekday: 1, hour: 8, lastPeriod: null };
    expect(summaryDue({ ...base, now: { date: "2026-10-13", weekday: 2, hour: 9 } })).toBeNull();
    expect(summaryDue({ ...base, now: { date: "2026-10-12", weekday: 1, hour: 9 } })).toEqual({ key: "weekly:2026-10-11", from: "2026-10-05", to: "2026-10-11" });
    expect(summaryDue({ ...base, lastPeriod: "weekly:2026-10-11", now: { date: "2026-10-12", weekday: 1, hour: 9 } })).toBeNull();
  });

  it("checks the choice on the page", () => {
    expect(summaryChoiceProblem({ summary: "weekly", weekday: 7, hour: 0 })).toBeNull();
    expect(summaryChoiceProblem({ summary: "hourly", weekday: 1, hour: 8 })).not.toBeNull();
    expect(summaryChoiceProblem({ summary: "daily", weekday: 0, hour: 8 })).not.toBeNull();
    expect(summaryChoiceProblem({ summary: "daily", weekday: 1, hour: 24 })).not.toBeNull();
    expect(summaryChoiceProblem({ summary: "daily", weekday: 1, hour: 8.5 })).not.toBeNull();
  });
});
