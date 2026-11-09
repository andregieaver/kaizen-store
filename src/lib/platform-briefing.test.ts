import { describe, expect, it } from "vitest";

import { briefingDue, platformAlertsFor, targetProgress, type PlatformSnapshot } from "./platform-briefing";

const snapshot = (over: Partial<PlatformSnapshot> = {}): PlatformSnapshot => ({
  today: "2026-11-15",
  mrr: [{ currency: "NOK", minor: 500_000, monthMovedMinor: 20_000, weekMovedMinor: 5_000 }],
  paying: 10,
  trialing: 2,
  late: 0,
  trialsEnding: 0,
  sales: [{ currency: "NOK", monthMinor: 250_000, lastMonthToDateMinor: 200_000 }],
  newStores: 3,
  signUpsToday: { asked: 1, opened: 0 },
  requests: { waiting: 0, oldestHours: null },
  targets: [],
  ...over,
});

describe("the platform's targets, alerts and briefing (D513)", () => {
  it("holds a sum against an even share of the month, and a level against the target itself", () => {
    const sales = { metric: "sales" as const, month: "2026-11-01", targetValue: 600_000 };
    // 15 of 30 days: 300 000 expected by today.
    expect(targetProgress(sales, 300_000, "2026-11-15")).toMatchObject({ expected: 300_000, status: "on_track", pct: 50 });
    expect(targetProgress(sales, 330_000, "2026-11-15").status).toBe("ahead");
    expect(targetProgress(sales, 250_000, "2026-11-15").status).toBe("behind");
    expect(targetProgress(sales, 600_000, "2026-11-15").status).toBe("reached");
    // The month over: the whole of it was expected.
    expect(targetProgress(sales, 500_000, "2026-12-02")).toMatchObject({ expected: 600_000, status: "behind" });
    const paying = { metric: "paying" as const, month: "2026-11-01", targetValue: 12 };
    expect(targetProgress(paying, 10, "2026-11-15")).toMatchObject({ status: "to_go", pct: 83 });
    expect(targetProgress(paying, 12, "2026-11-15").status).toBe("reached");
  });

  it("raises what needs a look, the most pressing first", () => {
    expect(platformAlertsFor(snapshot())).toEqual([]);
    const target = { id: "t", metric: "sales" as const, month: "2026-11-01", currency: "NOK", targetValue: 600_000 };
    const alerts = platformAlertsFor(
      snapshot({
        requests: { waiting: 2, oldestHours: 60 },
        late: 1,
        trialsEnding: 2,
        mrr: [{ currency: "NOK", minor: 480_000, monthMovedMinor: 0, weekMovedMinor: -20_000 }],
        targets: [{ target, progress: targetProgress(target, 200_000, "2026-11-15") }],
      }),
    );
    expect(alerts.map((a) => [a.id, a.severity])).toEqual([
      ["requests_old", "urgent"],
      ["late_payments", "warning"],
      ["mrr_down", "warning"],
      ["target_behind", "warning"],
      ["trials_ending", "info"],
    ]);
    expect(alerts.find((a) => a.id === "mrr_down")?.values).toEqual({ currency: "NOK", minor: 20_000 });
    expect(platformAlertsFor(snapshot({ late: 3 }))[0]).toMatchObject({ id: "late_payments", severity: "urgent" });
  });

  it("is due once a period, at seven in the morning, weekly on Mondays", () => {
    const monday = { date: "2026-11-16", hour: 7, weekday: 1 };
    expect(briefingDue("off", null, monday)).toBeNull();
    expect(briefingDue("daily", null, { ...monday, hour: 6 })).toBeNull();
    expect(briefingDue("daily", null, monday)).toEqual({ key: "daily:2026-11-15", from: "2026-11-15", to: "2026-11-15" });
    expect(briefingDue("daily", "daily:2026-11-15", monday)).toBeNull();
    expect(briefingDue("weekly", null, monday)).toEqual({ key: "weekly:2026-11-15", from: "2026-11-09", to: "2026-11-15" });
    expect(briefingDue("weekly", null, { date: "2026-11-17", hour: 9, weekday: 2 })).toBeNull();
  });
});
