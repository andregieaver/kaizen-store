import { describe, expect, it } from "vitest";

import { ORDER_OPS_EVENTS } from "./order-ops-events";
import { opsEventText } from "./order-ops-events-text";

const money = (minor: number) => `${(minor / 100).toFixed(2)} kr`;

describe("the history of the wave 3 order operations", () => {
  it("says which draft made the order", () => {
    expect(opsEventText("order.placed", { draft: "D-12" }, money)).toBe("Draft D-12 sent to the customer: the order was made and its stock is held until the pay link expires");
    // An ordinary checkout's event is not ours.
    expect(opsEventText("order.placed", {}, money)).toBeNull();
  });

  it("carries the words of a tag change and an archive in data.note and nothing else", () => {
    expect(opsEventText(ORDER_OPS_EVENTS.tagsChanged, { note: "Added: vip. Removed: test", other: "secret" }, money)).toBe("Tags changed: Added: vip. Removed: test");
    expect(opsEventText(ORDER_OPS_EVENTS.archived, {}, money)).toBe("Archived");
    expect(opsEventText(ORDER_OPS_EVENTS.unarchived, { note: "A return was started" }, money)).toBe("Unarchived: A return was started");
  });

  it("names how it was paid outside Kaizen and keeps the reference as the note", () => {
    expect(opsEventText(ORDER_OPS_EVENTS.paidOutside, { method: "bank_transfer", note: "KID 123" }, money)).toBe("Payment recorded outside Kaizen: bank transfer · KID 123");
    expect(opsEventText(ORDER_OPS_EVENTS.paidOutside, { method: "cash" }, money)).toBe("Payment recorded outside Kaizen: cash");
    expect(opsEventText(ORDER_OPS_EVENTS.paidOutside, { method: "something else" }, money)).toBe("Payment recorded outside Kaizen");
  });

  it("says a recorded refund sent nothing", () => {
    expect(opsEventText(ORDER_OPS_EVENTS.refundedOutside, { amount: 12500, note: "Wrong size" }, money)).toBe("Refund recorded outside Kaizen 125.00 kr · Wrong size: nothing was sent, the store paid the customer back");
  });

  it("is null for every other event", () => {
    for (const type of ["order.paid", "order.sent", "note.added", "order.refunded"]) expect(opsEventText(type, { note: "x", draft: "D-1" }, money)).toBeNull();
  });
});
