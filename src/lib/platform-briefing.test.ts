import { describe, expect, it } from "vitest";

import { signalAlertsFor, type SignalSnapshot } from "./analytics-alerts";
import { analyticsWordsIn } from "./analytics-words";
import { adminSpeedAlerts, briefingDue, houseSignalAlerts, platformAlertsFor, SITE_ALERT_HREF, targetProgress, type PlatformSnapshot } from "./platform-briefing";
import { speedRow } from "./speed";

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

  it("says when a kind of admin screen with 100 loads or more is not fast (step 1.15)", () => {
    const loads = (n: number, lcp: number | null, inp: number | null) => Array.from({ length: n }, () => ({ lcp, inp, cls: 50, ttfb: 300 }));
    const slow = speedRow("category", "computer", loads(120, 4_000, null));
    const found = adminSpeedAlerts([slow]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: "admin_slow", severity: "warning", values: { kind: "category", screen: "computer", metric: "lcp", value: 4_000 } });
    expect(adminSpeedAlerts([speedRow("home", "computer", loads(120, 1_800, 120))])).toEqual([]);
    expect(adminSpeedAlerts([speedRow("category", "computer", loads(99, 4_000, null))])).toEqual([]);
    const inpOnly = adminSpeedAlerts([speedRow("list", "computer", loads(120, 1_800, 350))]);
    expect(inpOnly).toHaveLength(1);
    expect(inpOnly[0].values.metric).toBe("inp");
    expect(platformAlertsFor(snapshot()).some((a) => a.id === "admin_slow")).toBe(false);
    expect(platformAlertsFor(snapshot({ adminSpeed: [slow] })).filter((a) => a.id === "admin_slow")).toHaveLength(1);
    // The page builder and the product editor are told apart: one slow, one good, one line, for the slow one.
    const both = platformAlertsFor(snapshot({ adminSpeed: [slow, speedRow("product", "computer", loads(120, 1_800, 120))] })).filter((a) => a.id === "admin_slow");
    expect(both).toHaveLength(1);
    expect(both[0].values.kind).toBe("category");
  });

  it("a snapshot with database flags gives one database_flag line that leads to Usage and limits (step 1.13)", () => {
    const flags = [{ id: "costly_statement", subject: "select 1" }, { id: "cron_schema_large", subject: "cron" }];
    const found = platformAlertsFor(snapshot({ flags })).filter((a) => a.id === "database_flag");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "warning", values: { n: 2, first: "costly_statement" }, href: "/admin/platform/capacity" });
  });

  it("gives no database_flag line with no flags, or without the field", () => {
    expect(platformAlertsFor(snapshot({ flags: [] })).some((a) => a.id === "database_flag")).toBe(false);
    expect(platformAlertsFor(snapshot()).some((a) => a.id === "database_flag")).toBe(false);
  });
});

describe("what Kaizena Flow's own site raises (ecosystem plan E5.2, D757)", () => {
  const stuck = { page: "/pricing", views7: 400, frustrated7: 100, viewsBefore: 1600, frustratedBefore: 80 };
  const away = (hostname: string, primary: boolean) => ({
    hostname,
    status: "active" as const,
    primary,
    ageDays: 0,
    findings: [{ code: "points_away" as const, severity: "error" as const, values: { domain: hostname, date: "2026-11-14" } }],
  });
  const house = (signals: Partial<SignalSnapshot>, siteHost: string | null = "kaizenaflow.com"): PlatformSnapshot["house"] => ({
    slug: "kaizenaflow",
    siteHost,
    signals: { today: "2026-11-15", locale: "en", ...signals },
  });

  it("are the store's own rules, linked to the store's page that fixes each, in each admin language", () => {
    const alerts = platformAlertsFor(snapshot({ house: house({ pageFrustration: [stuck] }) }));
    expect(alerts).toHaveLength(1);
    const [alert] = alerts;
    // The same rule decides as on the store's Home: 25 % against 5 % is 20 points, urgent from 25.
    const own = signalAlertsFor({ today: "2026-11-15", pageFrustration: [stuck] })[0];
    expect(alert).toMatchObject({ id: "house_signal", severity: own.severity, values: { signal: "page-frustration" }, href: `/admin/kaizenaflow${own.href}` });
    expect(alert.href).toBe("/admin/kaizenaflow/analytics/heatmaps?page=%2Fpricing");
    expect(alert.text?.en).toBe(own.text);
    expect(alert.text?.nb).toBe(signalAlertsFor({ today: "2026-11-15", locale: "nb-NO", pageFrustration: [stuck] }, analyticsWordsIn("nb").alertText)[0].text);
    expect(alert.text?.nb).not.toBe(alert.text?.en);
  });

  it("says when kaizenaflow.com itself fails, most pressing first, and leads to the status page as no store page holds it", () => {
    const alerts = platformAlertsFor(snapshot({ trialsEnding: 1, house: house({ domains: [away("kaizenaflow.com", true), away("old.example.no", false)] }) }));
    expect(alerts.map((a) => [a.id, a.severity])).toEqual([
      ["house_signal", "urgent"],
      ["trials_ending", "info"],
    ]);
    expect(alerts[0]).toMatchObject({ values: { signal: "domain-problem" }, href: SITE_ALERT_HREF });
    expect(alerts[0].text?.en).toMatch(/^kaizenaflow\.com no longer reaches your store: when it was checked on 2026-11-14/);
    // A store domain of the house store first leads to its Domains page.
    const store = platformAlertsFor(snapshot({ house: house({ domains: [away("shop.kaizenaflow.example", true)] }) }));
    expect(store[0].href).toBe("/admin/kaizenaflow/settings/domains");
  });

  it("raises nothing where the site measures nothing to say, or the store could not be read", () => {
    expect(platformAlertsFor(snapshot({ house: house({ pageFrustration: [], speed: [], domains: [] }) }))).toEqual([]);
    expect(platformAlertsFor(snapshot({ house: null }))).toEqual([]);
    expect(houseSignalAlerts(undefined)).toEqual([]);
  });
});
