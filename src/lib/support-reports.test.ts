import { describe, expect, it } from "vitest";

import { duration, durationFigureWords, durationWords, nearestRank, rate, rateWords, supportReport, type ReportConversation } from "./support-reports";

const T = Date.UTC(2026, 9, 1, 10);
const min = (n: number) => T + n * 60_000;

function c(over: Partial<ReportConversation> = {}): ReportConversation {
  return {
    mode: "ai_first",
    status: "ended",
    createdAt: T,
    queuedAt: null,
    claimedAt: null,
    firstAgentAt: null,
    endedAt: min(5),
    handoffReason: null,
    rating: null,
    tone: null,
    outcome: null,
    topics: [],
    anonymised: false,
    ...over,
  };
}
const times = <T,>(n: number, make: (i: number) => T) => Array.from({ length: n }, (_, i) => make(i));

describe("support's report figures (D216, step 14; docs/analytics.md)", () => {
  it("shows a rate only from ten cases, and counts always", () => {
    expect(rate(3, 9)).toEqual({ count: 3, of: 9, share: null });
    expect(rate(3, 10)).toEqual({ count: 3, of: 10, share: 0.3 });
    expect(rate(0, 0)).toEqual({ count: 0, of: 0, share: null });
    expect(rateWords(rate(3, 9))).toBe("Not shown: 9 of the 10 needed");
    expect(rateWords(rate(0, 0))).toBe("Not shown: None yet");
    expect(rateWords(rate(1, 3, 1))).toBe("33.3 % (1 of 3)");
  });

  it("takes the median (the middle two's mean) and the slowest tenth by nearest rank, only from ten", () => {
    expect(duration([5, 1, 3])).toEqual({ n: 3, median: null, slowestTenth: null });
    const ten = [10, 20, 30, 40, 50, 60, 70, 80, 90, 1000];
    expect(duration(ten)).toEqual({ n: 10, median: 55, slowestTenth: 90 });
    expect(nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 0.9)).toBe(10);
    expect(nearestRank([], 0.5)).toBeNull();
    expect(durationFigureWords(duration(ten))).toBe("median 55 s, slowest tenth 1 min 30 s (10)");
    expect(durationWords(3 * 3600 + 20 * 60)).toBe("3 h 20 min");
    expect(durationWords(50 * 3600)).toBe("2 d 2 h");
  });

  it("counts the AI alone only among ended AI-first conversations, a fact; resolved is the AI's judgement over the rest but spam", () => {
    const rows = [
      ...times(8, () => c({ outcome: "resolved" })),
      c({ outcome: "unresolved" }),
      c({ outcome: "spam" }),
      // Handed to a person: queued, or taken over unasked.
      c({ queuedAt: min(1), firstAgentAt: min(2), handoffReason: "customer" }),
      c({ claimedAt: min(1), firstAgentAt: min(1) }),
      // Not counted for the AI: still open, another mode, mode not recorded.
      c({ status: "open", endedAt: null }),
      c({ mode: "people", queuedAt: T, firstAgentAt: min(3) }),
      c({ mode: null }),
    ];
    const report = supportReport(rows);
    expect(report.conversations).toBe(15);
    expect(report.byMode).toEqual({ off: 0, ai_first: 13, people: 1, unknown: 1 });
    expect(report.aiAlone).toEqual({ count: 10, of: 12, share: 10 / 12 });
    expect(report.handover).toEqual({ count: 2, of: 12, share: 2 / 12 });
    expect(report.handoverWhy).toMatchObject({ customer: 1, taken_over: 1 });
    // Nine judged (spam is not), so not shown yet.
    expect(report.aiResolved).toEqual({ count: 8, of: 9, share: null });
  });

  it("measures the first answer from the last time it was queued, missed ones and the time to the end", () => {
    const answered = times(10, (i) => c({ mode: "people", queuedAt: min(0), firstAgentAt: min(i + 1), endedAt: min(30) }));
    const report = supportReport([
      ...answered,
      // Queued again after a person answered: left out of the first answer.
      c({ mode: "people", queuedAt: min(10), firstAgentAt: min(5), endedAt: min(30) }),
      // Missed: queued, ended, nobody answered.
      c({ mode: "people", queuedAt: min(0), endedAt: min(20) }),
      // Waiting now: not missed.
      c({ mode: "people", status: "open", queuedAt: min(0), endedAt: null }),
    ]);
    expect(report.firstAnswer).toEqual({ n: 10, median: 330, slowestTenth: 540 });
    expect(report.missed).toEqual({ count: 1, of: 12, share: 1 / 12 });
    expect(report.timeToEnd.n).toBe(12);
    expect(report.timeToEnd.median).toBe(1800);
  });

  it("counts ratings, tone bands at the end (not measured on its own), topics and outcomes", () => {
    const report = supportReport([
      ...times(9, () => c({ rating: "good", tone: 70, topics: ["order", "order"], outcome: "resolved" })),
      c({ rating: "bad", tone: -70, topics: ["returns", "order"], outcome: "unresolved" }),
      c({ tone: null }),
    ]);
    expect(report.rating).toEqual({ count: 9, of: 10, share: 0.9 });
    expect(report.tone).toMatchObject({ very_good: 9, very_bad: 1, not_measured: 1, neutral: 0 });
    expect(report.topics).toEqual([
      { topic: "order", count: 10 },
      { topic: "returns", count: 1 },
    ]);
    expect(report.outcomes).toMatchObject({ resolved: 9, unresolved: 1 });
  });

  it("counts requests and the time to decide them, and the partner's drafts for the desk", () => {
    const decided = times(10, (i) => ({ status: (i % 2 ? "done" : "declined") as "done" | "declined", createdAt: T, decidedAt: min(10 + i) }));
    const report = supportReport([c({ anonymised: true })], [...decided, { status: "proposed", createdAt: T, decidedAt: null }, { status: "failed", createdAt: T, decidedAt: null }], { offered: 12, used: 6 });
    expect(report.requests).toMatchObject({ opened: 12, done: 5, declined: 5, open: 1, other: 1 });
    expect(report.requests.timeToDecide).toEqual({ n: 10, median: 870, slowestTenth: 1080 });
    expect(report.drafts).toEqual({ offered: 12, used: 6, share: 0.5 });
    expect(supportReport([], [], { offered: 4, used: 4 }).drafts.share).toBeNull();
    expect(report.anonymised).toBe(1);
  });
});
