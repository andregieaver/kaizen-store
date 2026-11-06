import { describe, expect, it } from "vitest";

import {
  EXCERPT_MAX,
  TIMELINE_KINDS,
  TIMELINE_KIND_OF,
  askedKind,
  byDay,
  dayOf,
  excerptOf,
  kindOf,
  kindsPresent,
  mergeTimeline,
  visibleKinds,
  type TimelineEvent,
  type TimelineGates,
  type TimelineWhat,
} from "./customer-timeline";

const event = (what: TimelineWhat, at: string, key = `${what}:${at}`): TimelineEvent => ({ key, what, at, email: "ada@example.com", label: "x", href: null });

const none: TimelineGates = { orders: false, support: false, products: false, reviewsOn: false, bookings: false, bookingsOn: false, settings: false, workOn: false };
const every: TimelineGates = { orders: true, support: true, products: true, reviewsOn: true, bookings: true, bookingsOn: true, settings: true, workOn: true };

describe("the kinds", () => {
  it("gives every event a kind the filter offers, and every kind an event", () => {
    const kinds = new Set(Object.values(TIMELINE_KIND_OF));
    expect([...kinds].sort()).toEqual([...TIMELINE_KINDS].sort());
    expect(kindOf({ what: "withdrawal_requested" })).toBe("return");
  });
});

describe("who sees what", () => {
  it("shows a viewer who only reads customers what the customer page already shows: orders, emails and notes", () => {
    expect(visibleKinds(none)).toEqual(["order", "email", "note"]);
  });

  it("shows everything to a viewer who may open every page, on a store with every feature on, in the filter's order", () => {
    expect(visibleKinds(every)).toEqual([...TIMELINE_KINDS]);
  });

  it("needs the feature as well as the permission for reviews, bookings and Work", () => {
    expect(visibleKinds({ ...every, reviewsOn: false })).not.toContain("review");
    expect(visibleKinds({ ...every, products: false })).not.toContain("review");
    expect(visibleKinds({ ...every, bookingsOn: false })).not.toContain("booking");
    expect(visibleKinds({ ...every, bookings: false })).not.toContain("booking");
    expect(visibleKinds({ ...every, workOn: false })).not.toContain("work_invoice");
    expect(visibleKinds({ ...every, settings: false })).not.toContain("work_invoice");
  });

  it("hides quotes and returns without orders, conversations without support", () => {
    const kinds = visibleKinds({ ...every, orders: false, support: false });
    expect(kinds).not.toContain("quote");
    expect(kinds).not.toContain("return");
    expect(kinds).not.toContain("conversation");
  });
});

describe("the kind a page asks for", () => {
  const visible = visibleKinds(none);

  it("takes a kind the viewer may see", () => {
    expect(askedKind("email", visible)).toBe("email");
    expect(askedKind(["note", "order"], visible)).toBe("note");
  });

  it("shows everything for a kind the viewer may not see, an unknown word or nothing", () => {
    expect(askedKind("conversation", visible)).toBeNull();
    expect(askedKind("everything", visible)).toBeNull();
    expect(askedKind(undefined, visible)).toBeNull();
  });
});

describe("merging the sources", () => {
  it("puts the newest first across sources, and the same moment in key order", () => {
    const { events, more } = mergeTimeline(
      [
        [event("order_placed", "2026-11-01T10:00:00.000Z"), event("order_placed", "2026-10-01T10:00:00.000Z")],
        [event("email_sent", "2026-11-03T08:00:00.000Z"), event("email_sent", "2026-11-01T10:00:00.000Z", "a")],
      ],
      { kinds: TIMELINE_KINDS, limit: 10 },
    );
    expect(events.map((e) => e.key)).toEqual(["email_sent:2026-11-03T08:00:00.000Z", "a", "order_placed:2026-11-01T10:00:00.000Z", "order_placed:2026-10-01T10:00:00.000Z"]);
    expect(more).toBe(false);
  });

  it("keeps only the kinds asked for", () => {
    const { events } = mergeTimeline([[event("order_placed", "2026-11-01T10:00:00.000Z"), event("note_added", "2026-11-02T10:00:00.000Z")]], { kinds: ["note"], limit: 10 });
    expect(events.map((e) => e.what)).toEqual(["note_added"]);
  });

  it("keeps each event once, and leaves out one with no time it can read", () => {
    const twice = event("quote_sent", "2026-11-01T10:00:00.000Z", "quote:1:sent");
    const { events } = mergeTimeline([[twice], [twice, { ...event("quote_requested", "not a time"), key: "q" }]], { kinds: TIMELINE_KINDS, limit: 10 });
    expect(events.map((e) => e.key)).toEqual(["quote:1:sent"]);
  });

  it("stops at the limit and says there is more", () => {
    const many = Array.from({ length: 5 }, (_, i) => event("email_sent", `2026-11-0${i + 1}T10:00:00.000Z`));
    const { events, more } = mergeTimeline([many], { kinds: TIMELINE_KINDS, limit: 3 });
    expect(events.map((e) => e.at.slice(0, 10))).toEqual(["2026-11-05", "2026-11-04", "2026-11-03"]);
    expect(more).toBe(true);
    expect(mergeTimeline([many], { kinds: TIMELINE_KINDS, limit: 5 }).more).toBe(false);
  });
});

describe("the filter's kinds", () => {
  it("names the kinds that have an event, in the filter's order", () => {
    expect(kindsPresent([event("note_added", "2026-11-01T10:00:00.000Z"), event("order_placed", "2026-11-02T10:00:00.000Z"), event("note_added", "2026-11-03T10:00:00.000Z")])).toEqual(["order", "note"]);
    expect(kindsPresent([])).toEqual([]);
  });
});

describe("days", () => {
  it("reads the day in the store's time zone, not in UTC", () => {
    expect(dayOf("2026-11-04T23:30:00.000Z", "Europe/Oslo")).toBe("2026-11-05");
    expect(dayOf("2026-11-04T23:30:00.000Z", "UTC")).toBe("2026-11-04");
  });

  it("groups events under their day, newest day first, keeping their order", () => {
    const days = byDay(
      [event("email_sent", "2026-11-05T09:00:00.000Z"), event("note_added", "2026-11-04T23:30:00.000Z"), event("order_placed", "2026-11-04T08:00:00.000Z")],
      "Europe/Oslo",
    );
    expect(days.map((d) => [d.day, d.events.map((e) => e.what)])).toEqual([
      ["2026-11-05", ["email_sent", "note_added"]],
      ["2026-11-04", ["order_placed"]],
    ]);
  });
});

describe("excerpts", () => {
  it("puts what someone typed on one line", () => {
    expect(excerptOf("  Call back\n\nabout the  invoice ")).toBe("Call back about the invoice");
  });

  it("is null for nothing", () => {
    expect(excerptOf(null)).toBeNull();
    expect(excerptOf(" \n ")).toBeNull();
  });

  it("cuts a long text at the limit with an ellipsis, counting characters as a person does", () => {
    const long = "å".repeat(EXCERPT_MAX + 10);
    const cut = excerptOf(long);
    expect(cut).toBe(`${"å".repeat(EXCERPT_MAX - 1)}…`);
    expect(Array.from(cut ?? "")).toHaveLength(EXCERPT_MAX);
    expect(excerptOf("😀".repeat(5), 3)).toBe("😀😀…");
    expect(excerptOf("short", 10)).toBe("short");
  });
});
