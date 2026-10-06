import { describe, expect, it } from "vitest";

import { ARCHIVE_REASONS, ARCHIVE_REASON_TEXT, archiveBlock, autoArchiveCutoff, autoArchiveDue, isAutoArchiveDays, type ArchiveFacts } from "./order-archive";

const order = (over: Partial<ArchiveFacts> = {}): ArchiveFacts => ({ status: "fulfilled", paid: true, physical: true, copied: false, archived: false, openReturn: false, ...over });

describe("when an order may be archived", () => {
  it("may be, when it is sent, closed, or cancelled after payment", () => {
    expect(archiveBlock(order({ status: "fulfilled" }))).toBeNull();
    expect(archiveBlock(order({ status: "closed" }))).toBeNull();
    expect(archiveBlock(order({ status: "cancelled", paid: true }))).toBeNull();
  });

  it("may be, when it is paid with nothing to ship (a download, a service, a booking): its own queue is not this list", () => {
    expect(archiveBlock(order({ status: "paid", physical: false }))).toBeNull();
  });

  it("is refused for an unfinished checkout: waiting for payment, or cancelled and never paid", () => {
    expect(archiveBlock(order({ status: "pending_payment", paid: false }))).toBe("unfinished_checkout");
    expect(archiveBlock(order({ status: "cancelled", paid: false }))).toBe("unfinished_checkout");
  });

  it("is refused for a paid order that still has to be sent: hiding it would hide work", () => {
    expect(archiveBlock(order({ status: "paid", physical: true }))).toBe("needs_sending");
  });

  it("is refused while a return is open, and for an order already archived", () => {
    expect(archiveBlock(order({ openReturn: true }))).toBe("open_return");
    expect(archiveBlock(order({ archived: true }))).toBe("already_archived");
  });

  it("names the first reason that holds: already archived before the others", () => {
    expect(archiveBlock(order({ archived: true, status: "paid", openReturn: true }))).toBe("already_archived");
    expect(archiveBlock(order({ status: "paid", physical: true, openReturn: true }))).toBe("needs_sending");
  });

  it("lets copied history be archived: it never needs sending and a copy has no payment", () => {
    expect(archiveBlock(order({ copied: true, status: "paid", physical: true, paid: false }))).toBeNull();
    expect(archiveBlock(order({ copied: true, status: "cancelled", paid: false }))).toBeNull();
    // The database refuses to archive an order that waits for payment, copied or not.
    expect(archiveBlock(order({ copied: true, status: "pending_payment", paid: false }))).toBe("unfinished_checkout");
  });

  it("has words for every reason", () => {
    for (const reason of ARCHIVE_REASONS) expect(ARCHIVE_REASON_TEXT[reason].length, reason).toBeGreaterThan(5);
  });
});

describe("automatic archiving", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000);

  it("accepts 14 to 365 days and nothing else", () => {
    expect([13, 14, 15, 365, 366, 0, -1, 14.5, null, "30"].map(isAutoArchiveDays)).toEqual([false, true, true, true, false, false, false, false, false, false]);
  });

  it("takes an order that may be archived and whose last event is older than the setting", () => {
    expect(autoArchiveDue({ ...order(), lastEventAt: days(30) }, now, 14)).toBe(true);
    expect(autoArchiveDue({ ...order(), lastEventAt: days(13) }, now, 14)).toBe(false);
    expect(autoArchiveDue({ ...order(), lastEventAt: days(14) }, now, 14)).toBe(false);
    expect(autoArchiveDue({ ...order(), lastEventAt: new Date(autoArchiveCutoff(now, 14).getTime() - 1) }, now, 14)).toBe(true);
  });

  it("never takes what may not be archived, and does nothing when the store has not set it", () => {
    expect(autoArchiveDue({ ...order({ status: "paid" }), lastEventAt: days(100) }, now, 14)).toBe(false);
    expect(autoArchiveDue({ ...order({ openReturn: true }), lastEventAt: days(100) }, now, 14)).toBe(false);
    expect(autoArchiveDue({ ...order(), lastEventAt: days(100) }, now, null)).toBe(false);
    expect(autoArchiveDue({ ...order(), lastEventAt: days(100) }, now, 7)).toBe(false);
  });
});
