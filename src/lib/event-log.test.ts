import { describe, expect, it } from "vitest";

import {
  CLAIM_SECONDS_DEFAULT,
  CLAIM_SECONDS_MAX,
  CLAIM_SECONDS_MIN,
  EVENT_READ_DEFAULT,
  EVENT_READ_MAX,
  claimSeconds,
  eventFilter,
  isConsumerName,
  isEventName,
  nextCursor,
  readLimit,
} from "./event-log";
import { EVENTS } from "./integrations";

describe("the event log's pure parts (ecosystem plan E3.1, D718)", () => {
  it("knows a reader's name as the database checks it", () => {
    for (const name of ["workflows", "autopilot:6f1c2d3e-0000-4000-8000-000000000001", "segments.v2", "a"]) expect(isConsumerName(name), name).toBe(true);
    for (const name of ["", "Workflows", "1st", "with space", "x".repeat(101), "a/b"]) expect(isConsumerName(name), name).toBe(false);
  });

  it("knows every event the store queues as an event's name, and nothing else", () => {
    for (const e of EVENTS) expect(isEventName(e.id), e.id).toBe(true);
    for (const name of ["store.created", "plan.payment_failed", "work_invoice.credited"]) expect(isEventName(name), name).toBe(true);
    for (const name of ["order", "Order.paid", "order.", ".paid", "order paid", `a.${"b".repeat(80)}`]) expect(isEventName(name), name).toBe(false);
  });

  it("checks the events asked for, once each, and refuses a name that is not one", () => {
    expect(eventFilter(undefined)).toEqual([]);
    expect(eventFilter([" order.paid", "order.paid", "deal.won"])).toEqual(["order.paid", "deal.won"]);
    expect(() => eventFilter(["order.paid", "drop table"])).toThrow(/drop table/);
  });

  it("keeps a read's size and a claim's time within bounds", () => {
    expect(readLimit()).toBe(EVENT_READ_DEFAULT);
    expect(readLimit(0)).toBe(1);
    expect(readLimit(10.7)).toBe(10);
    expect(readLimit(1e9)).toBe(EVENT_READ_MAX);
    expect(readLimit(Number.NaN)).toBe(EVENT_READ_DEFAULT);
    expect(claimSeconds()).toBe(CLAIM_SECONDS_DEFAULT);
    expect(claimSeconds(1)).toBe(CLAIM_SECONDS_MIN);
    expect(claimSeconds(1e6)).toBe(CLAIM_SECONDS_MAX);
  });

  it("moves the cursor to a full batch's last event, else past everything settled, else nowhere", () => {
    const batch = [{ id: 4 }, { id: 9 }];
    // Full: there may be more of the reader's after it.
    expect(nextCursor(batch, 2, { id: 30, isNew: true })).toBe(9);
    // Not full: every event the reader asked for up to the newest is in it, so the rest need not be read again.
    expect(nextCursor(batch, 5, { id: 30, isNew: true })).toBe(30);
    expect(nextCursor([], 5, { id: 30, isNew: true })).toBe(30);
    // Nothing new in the log.
    expect(nextCursor([], 5, { id: 30, isNew: false })).toBeNull();
    expect(nextCursor([], 5, null)).toBeNull();
  });
});
