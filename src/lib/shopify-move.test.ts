import { describe, expect, it } from "vitest";

import { EMPTY_MOVE, closeReady, moveDue, moveStateOf, nextMoveStep, readiness, scheduleProblem, watchDay, watchDue, watchShown } from "./shopify-move";

describe("move day", () => {
  it("reads back only what it wrote, and a scheduled move without its time or owner is none", () => {
    const by = "8a7b0f8e-3a77-4f43-9b51-6f5a8a7d6d11";
    expect(moveStateOf({ status: "moving", by, startedAt: "2026-11-04T08:00:00Z", steps: { catch_up: { stage: "done", done: 3 }, links: { stage: "boom" }, open: { stage: "failed", problem: "setup" } }, lease: "x" })).toEqual({
      ...EMPTY_MOVE,
      status: "moving",
      by,
      startedAt: "2026-11-04T08:00:00.000Z",
      steps: { catch_up: { stage: "done", done: 3 }, links: { stage: "waiting" }, gift_cards: { stage: "waiting" }, open: { stage: "failed", problem: "setup" } },
    });
    expect(moveStateOf({ status: "scheduled", by }).status).toBe("none");
    expect(moveStateOf({ status: "nope", by: "x" })).toEqual(EMPTY_MOVE);
    expect(moveStateOf(null)).toEqual(EMPTY_MOVE);
  });

  it("runs its steps in order, a failed one settled, and is due only at its time", () => {
    const at = (catchUp: "waiting" | "running" | "done" | "failed", links: "waiting" | "done" | "failed", open: "waiting" | "done") => ({ ...EMPTY_MOVE, steps: { catch_up: { stage: catchUp }, links: { stage: links }, gift_cards: { stage: links === "waiting" ? ("waiting" as const) : ("done" as const) }, open: { stage: open } } });
    expect(nextMoveStep(at("waiting", "waiting", "waiting"))).toBe("catch_up");
    expect(nextMoveStep(at("running", "waiting", "waiting"))).toBe("catch_up");
    expect(nextMoveStep(at("failed", "waiting", "waiting"))).toBe("links");
    expect(nextMoveStep(at("done", "failed", "waiting"))).toBe("open");
    expect(nextMoveStep(at("done", "done", "done"))).toBeNull();
    const scheduled = { ...EMPTY_MOVE, status: "scheduled" as const, at: "2026-11-04T20:00:00.000Z", by: "x" };
    expect([moveDue(scheduled, new Date("2026-11-04T19:59:00Z")), moveDue(scheduled, new Date("2026-11-04T20:00:00Z"))]).toEqual([false, true]);
  });

  it("is held back by payments and an unfinished copy, never by old links or makers", () => {
    const ready = { payments: true, copyDone: true, copyFailed: 0, links: { total: 10, working: 10 }, makersLeft: 0 };
    expect(readiness(ready)).toMatchObject({ canMove: true });
    expect(readiness({ ...ready, payments: false }).canMove).toBe(false);
    expect(readiness({ ...ready, copyDone: false }).canMove).toBe(false);
    const said = readiness({ ...ready, links: { total: 10, working: 7 }, makersLeft: 4 });
    expect(said.canMove).toBe(true);
    expect(said.checks.filter((c) => !c.ok).map((c) => [c.key, c.n, c.of])).toEqual([
      ["links", 7, 10],
      ["waiting", 4, undefined],
    ]);
    expect(readiness({ ...ready, links: null }).checks.find((c) => c.key === "links")).toMatchObject({ ok: false, of: 0 });
  });

  it("takes a time at least five minutes and at most 30 days ahead", () => {
    const now = new Date("2026-11-04T08:00:00Z");
    expect([
      scheduleProblem(null, now),
      scheduleProblem("2026-11-04T08:03:00.000Z", now),
      scheduleProblem("2026-11-04T08:10:00.000Z", now),
      scheduleProblem("2026-12-05T08:10:00.000Z", now),
    ]).toEqual(["invalid", "past", null, "far"]);
  });
});

describe("the 14 days after", () => {
  const moved = (over: Partial<typeof EMPTY_MOVE.watch> = {}) => ({ ...EMPTY_MOVE, status: "moved" as const, finishedAt: "2026-11-04T10:00:00.000Z", watch: { ...EMPTY_MOVE.watch, ...over } });
  const at = (iso: string) => new Date(iso);

  it("counts the days from the move, and looks at Shopify once a day for 14 of them", () => {
    expect(watchDay(EMPTY_MOVE, at("2026-11-04T12:00:00Z"))).toBeNull();
    expect([watchDay(moved(), at("2026-11-04T12:00:00Z")), watchDay(moved(), at("2026-11-05T10:00:00Z")), watchDay(moved(), at("2026-11-17T10:00:00Z"))]).toEqual([1, 2, 14]);
    expect(watchDue(moved(), at("2026-11-05T09:59:00Z"))).toBe(false);
    expect(watchDue(moved(), at("2026-11-05T10:00:00Z"))).toBe(true);
    expect(watchDue(moved({ checkedAt: "2026-11-06T10:00:00.000Z" }), at("2026-11-06T20:00:00Z"))).toBe(false);
    expect(watchDue(moved({ running: true }), at("2026-11-08T10:00:00Z"))).toBe(false);
    expect(watchDue(moved({ checkedAt: "2026-11-17T10:00:00.000Z" }), at("2026-11-18T10:00:00Z"))).toBe(false);
    expect(watchDue(moved({ closedAt: "2026-11-06T10:00:00.000Z" }), at("2026-11-08T10:00:00Z"))).toBe(false);
  });

  it("says Shopify can close on day 14, or sooner once everything is green after a quiet look", () => {
    const green = { addressDone: true, linksMissing: 0 };
    expect(closeReady(moved(), green, at("2026-11-05T12:00:00Z"))).toBe(false);
    expect(closeReady(moved({ checkedAt: "2026-11-05T10:00:00.000Z", lastFound: 0 }), green, at("2026-11-05T12:00:00Z"))).toBe(true);
    // An order on an earlier day does not hold it back once the latest look is quiet.
    expect(closeReady(moved({ checkedAt: "2026-11-06T10:00:00.000Z", found: 2, lastFound: 0 }), green, at("2026-11-06T12:00:00Z"))).toBe(true);
    expect(closeReady(moved({ checkedAt: "2026-11-06T10:00:00.000Z", found: 2, lastFound: 2 }), green, at("2026-11-06T12:00:00Z"))).toBe(false);
    expect(closeReady(moved({ checkedAt: "2026-11-05T10:00:00.000Z" }), { addressDone: false, linksMissing: 0 }, at("2026-11-05T12:00:00Z"))).toBe(false);
    expect(closeReady(moved({ checkedAt: "2026-11-05T10:00:00.000Z" }), { addressDone: null, linksMissing: 3 }, at("2026-11-05T12:00:00Z"))).toBe(false);
    expect(closeReady(moved(), { addressDone: false, linksMissing: 3 }, at("2026-11-17T10:00:00Z"))).toBe(true);
    expect(closeReady(moved({ closedAt: "2026-11-10T10:00:00.000Z" }), green, at("2026-11-17T10:00:00Z"))).toBe(false);
    expect([watchShown(moved()), watchShown(moved({ closedAt: "2026-11-10T10:00:00.000Z" })), watchShown(EMPTY_MOVE)]).toEqual([true, false, false]);
  });
});

describe("gift cards left for the owner", () => {
  it("keeps only cards it can name, at most 200", () => {
    const good = { id: "gid://shopify/GiftCard/7", last4: "AB12", amount: "40", currency: "EUR", expiresOn: "2027-01-31" };
    const read = moveStateOf({ status: "moved", steps: { gift_cards: { stage: "done", done: 2, failed: 3, left: [good, { ...good, id: "x" }, { ...good, amount: "-1" }, { ...good, expiresOn: "soon" }] } } });
    expect(read.steps.gift_cards).toEqual({ stage: "done", done: 2, failed: 3, left: [good, { ...good, expiresOn: null }] });
    const many = moveStateOf({ status: "moved", steps: { gift_cards: { stage: "done", left: Array.from({ length: 250 }, () => good) } } });
    expect(many.steps.gift_cards.left).toHaveLength(200);
  });
});
