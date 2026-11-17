import { describe, expect, it } from "vitest";

import { ALERT_RULES, alertsFor, type Alert, type AlertSnapshot, type DomainAlertRow, type PageFrustrationRow, type SpeedWindowRow } from "./analytics-alerts";
import { analyticsWordsIn } from "./analytics-words";
import { domainHealth, type DomainFacts } from "./domain-health";

/**
 * The alerts of ecosystem plan E4.2 (D729): a page where visitors get stuck more often (heatmaps, D656), a kind of page that turned slow
 * (speed, D336) and a store domain whose health check fails (D315). Each threshold and minimum volume of `ALERT_RULES` is held at, below
 * and above; small or unknown numbers raise nothing.
 */

// 2026-09-30 is a Wednesday.
const TODAY = "2026-09-30";
const NOW = new Date(`${TODAY}T12:00:00Z`);
const snap = (over: Partial<AlertSnapshot> = {}): AlertSnapshot => ({ currency: "EUR", locale: "en", today: TODAY, dayShare: 0.3, daily: [], ...over });
const only = (alerts: Alert[], id: string) => alerts.find((a) => a.id === id);

describe("a page where visitors get stuck more often", () => {
  const r = ALERT_RULES.frustration;
  const page = (frustrated7: number, over: Partial<PageFrustrationRow> = {}): PageFrustrationRow => ({ page: "/no/p/mug", views7: 200, frustrated7, viewsBefore: 800, frustratedBefore: 40, ...over });
  const stuck = (...rows: PageFrustrationRow[]) => only(alertsFor(snap({ pageFrustration: rows })), "page-frustration");

  it("fires at ten points more: 15 % of page views against 5 %, with its heatmap to open", () => {
    expect(r.minRisePoints).toBe(0.1);
    const a = stuck(page(30))!;
    expect(a.severity).toBe("warning");
    expect(a.text).toBe("Visitors get stuck more often on /no/p/mug: 15 % of its page views had a dead or rage click over the last 7 days, against 5 % over the four weeks before.");
    expect(a.href).toBe("/analytics/heatmaps?page=%2Fno%2Fp%2Fmug");
    expect(a.action).toBe("See its heatmap");
    expect(a.evidence).toEqual([{ label: "Page views with a dead or rage click, /no/p/mug, last 7 days", value: "30 of 200 (15.0 %)", baseline: "5.0 % over the four weeks before" }]);
  });

  it("is quiet just under ten points (14.5 %) and speaks over them (15.5 %)", () => {
    expect(stuck(page(29))).toBeUndefined();
    expect(stuck(page(31))).toBeDefined();
  });

  it("needs half as much again as before, so a page that was always hard to use is not news", () => {
    expect(r.minRatio).toBe(1.5);
    // 20 % before: 30 % is ten points and exactly 1.5 times.
    expect(stuck(page(60, { frustratedBefore: 160 }))).toBeDefined();
    // 20.5 % before: 30.5 % is ten points but under 1.5 times.
    expect(stuck(page(61, { frustratedBefore: 164 }))).toBeUndefined();
    // 25 % before: 37.5 % is 1.5 times and 12.5 points.
    expect(stuck(page(75, { frustratedBefore: 200 }))).toBeDefined();
  });

  it("compares a page that never had a dead or rage click on the points alone", () => {
    expect(stuck(page(20, { frustratedBefore: 0 }))?.text).toContain("10 % of its page views");
    expect(stuck(page(19, { frustratedBefore: 0 }))).toBeUndefined();
  });

  it("is urgent from 25 points more: 30 % against 5 %; 29.5 % is a warning", () => {
    expect(r.urgentRisePoints).toBe(0.25);
    expect(stuck(page(60))?.severity).toBe("urgent");
    expect(stuck(page(59))?.severity).toBe("warning");
  });

  it("needs 100 page views in the last 7 days and 200 in the four weeks before", () => {
    expect([r.minViews7d, r.minViewsBefore]).toEqual([100, 200]);
    const at = { views7: 100, frustrated7: 15, viewsBefore: 200, frustratedBefore: 10 };
    expect(stuck(page(15, at))).toBeDefined();
    expect(stuck(page(15, { ...at, views7: 99 }))).toBeUndefined();
    expect(stuck(page(15, { ...at, viewsBefore: 199 }))).toBeUndefined();
    expect(stuck(page(16, { ...at, frustrated7: 16, views7: 101, viewsBefore: 201 }))).toBeDefined();
  });

  it("names the page that rose most and counts the others", () => {
    const a = stuck(page(30, { page: "/no" }), page(60, { page: "/no/p/mug" }), page(40, { page: "/no/om-oss" }))!;
    expect(a.text).toContain("on /no/p/mug:");
    expect(a.text).toMatch(/ 2 other pages are also up by 10 points or more\.$/);
    expect(a.evidence.map((e) => e.label)).toEqual([
      "Page views with a dead or rage click, /no/p/mug, last 7 days",
      "Page views with a dead or rage click, /no/om-oss, last 7 days",
      "Page views with a dead or rage click, /no, last 7 days",
    ]);
  });

  it("is quiet when the share fell, and skips rows with figures that cannot be read", () => {
    expect(stuck(page(5))).toBeUndefined();
    expect(stuck(page(Number.NaN), { ...page(30), views7: Number.NaN })).toBeUndefined();
    expect(alertsFor(snap({ pageFrustration: null }))).toEqual([]);
  });

  it("never counts more frustrated views than views", () => {
    expect(stuck(page(500))?.evidence[0].value).toBe("500 of 200 (100.0 %)");
  });
});

describe("a kind of page that turned slow", () => {
  const r = ALERT_RULES.slowPage;
  const row = (over: Partial<SpeedWindowRow> = {}): SpeedWindowRow => ({ kind: "product", screen: "phone", metric: "lcp", recent: { n: 50, p75: 4100 }, before: { n: 100, p75: 2900 }, ...over });
  const slow = (...rows: SpeedWindowRow[]) => only(alertsFor(snap({ speed: rows })), "page-slow");

  it("fires when a figure turned poor on Google's line: the main content shown at 4.10 s against 2.90 s", () => {
    const a = slow(row())!;
    expect(a.severity).toBe("warning");
    expect(a.text).toBe("Product pages on phones turned slow over the last 7 days: main content shown at 4.10 s, against 2.90 s over the three weeks before (above 4.00 s is poor).");
    expect(a.href).toBe("/analytics/speed");
    expect(a.evidence).toEqual([{ label: "Product pages on phones, main content shown, last 7 days", value: "4.10 s", baseline: "2.90 s over the three weeks before (100 page loads)" }]);
  });

  it("is quiet at the line itself (4.00 s is not poor) and speaks just past it", () => {
    expect(slow(row({ recent: { n: 50, p75: 4000 } }))).toBeUndefined();
    expect(slow(row({ recent: { n: 50, p75: 4001 } }))).toBeDefined();
  });

  it("is quiet for a page that was poor before too: that is the Speed page's to say, not news", () => {
    expect(slow(row({ before: { n: 100, p75: 4001 } }))).toBeUndefined();
    expect(slow(row({ before: { n: 100, p75: 4000 } }))).toBeDefined();
  });

  it("needs 50 measurements in the last 7 days and 100 in the three weeks before", () => {
    expect([r.minSamples7d, r.minSamplesBefore]).toEqual([50, 100]);
    expect(slow(row({ recent: { n: 49, p75: 4100 } }))).toBeUndefined();
    expect(slow(row({ before: { n: 99, p75: 2900 } }))).toBeUndefined();
    expect(slow(row({ recent: { n: 51, p75: 4100 }, before: { n: 101, p75: 2900 } }))).toBeDefined();
  });

  it("is urgent from twice the poor line: 8.00 s; 7.99 s is a warning", () => {
    expect(r.urgentRatio).toBe(2);
    expect(slow(row({ recent: { n: 50, p75: 8000 } }))?.severity).toBe("urgent");
    expect(slow(row({ recent: { n: 50, p75: 7999 } }))?.severity).toBe("warning");
  });

  it("reads the response to a press and the layout moving too, never the server's first answer", () => {
    expect(slow(row({ metric: "inp", recent: { n: 50, p75: 520 }, before: { n: 100, p75: 180 } }))?.text).toContain("response to a press at 520 ms, against 180 ms");
    expect(slow(row({ kind: "home", screen: "computer", metric: "cls", recent: { n: 50, p75: 300 }, before: { n: 100, p75: 80 } }))?.text).toBe(
      "The front page on computers turned slow over the last 7 days: layout moving at 0.30, against 0.08 over the three weeks before (above 0.25 is poor).",
    );
    expect(slow(row({ metric: "ttfb", recent: { n: 50, p75: 5000 }, before: { n: 100, p75: 300 } }))).toBeUndefined();
  });

  it("names the figure furthest past its line and counts the others", () => {
    const a = slow(row(), row({ kind: "category", recent: { n: 60, p75: 6000 } }), row({ screen: "computer", recent: { n: 80, p75: 4500 } }))!;
    expect(a.text).toMatch(/^Category and tag pages on phones turned slow/);
    expect(a.text).toMatch(/ 2 other figures also turned poor\.$/);
    expect(a.evidence).toHaveLength(3);
  });

  it("raises nothing when a figure is not known", () => {
    expect(slow(row({ recent: { n: 0, p75: null } }))).toBeUndefined();
    expect(slow(row({ before: { n: 100, p75: null } }))).toBeUndefined();
    expect(alertsFor(snap({ speed: null }))).toEqual([]);
  });

  it("speaks Norwegian with Norwegian numbers", () => {
    const a = only(alertsFor(snap({ locale: "nb", speed: [row()] }), analyticsWordsIn("nb").alertText), "page-slow")!;
    expect(a.text).toBe("Farten på produktsidene på telefon er blitt dårlig de siste 7 dagene: hovedinnhold vist på 4,10 s, mot 2,90 s de tre ukene før (over 4,00 s er dårlig).");
  });
});

describe("a store domain whose health check fails", () => {
  const r = ALERT_RULES.domain;
  const facts = (over: Partial<DomainFacts> = {}): DomainFacts => ({
    hostname: "shop.example.no",
    apex: "example.no",
    connection: { status: "active", isPrimary: true, txt: true, misconfigured: false },
    dnsHost: "unknown",
    registration: { withUs: false, registrar: null, expiresAt: null, renews: null, contactVerified: null },
    email: null,
    caa: null,
    ...over,
  });
  /** A row as the server reads it: the health check's own findings over the stored facts. */
  const row = (f: DomainFacts, over: Partial<DomainAlertRow> = {}): DomainAlertRow => ({
    hostname: f.hostname,
    status: f.connection?.status ?? null,
    primary: f.connection?.isPrimary ?? false,
    ageDays: 40,
    findings: domainHealth(f, NOW),
    ...over,
  });
  const domain = (...rows: DomainAlertRow[]) => only(alertsFor(snap({ domains: rows })), "domain-problem");
  const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000 + 3_600_000).toISOString();

  it("is urgent when the store's address no longer reaches it, and opens the Domains page", () => {
    const a = domain(row(facts({ connection: { status: "active", isPrimary: true, serving: { state: "elsewhere", at: "2026-09-29T08:00:00.000Z" } } })))!;
    expect(a.severity).toBe("urgent");
    expect(a.text).toBe("shop.example.no no longer reaches your store: when it was checked on 2026-09-29, it answered with another site or not at all.");
    expect(a.href).toBe("/settings/domains");
    expect(a.evidence).toEqual([{ label: "shop.example.no", value: "No longer reaches the store", baseline: null }]);
  });

  it("is urgent when its certificate fails", () => {
    const a = domain(row(facts({ connection: { status: "active", isPrimary: false, serving: { state: "certificate", at: "2026-09-29T08:00:00.000Z" } } })))!;
    expect(a.severity).toBe("urgent");
    expect(a.text).toContain("https certificate failed when it was checked on 2026-09-29");
  });

  it("says nothing of a domain that serves its store, or whose watch is not known", () => {
    expect(domain(row(facts()))).toBeUndefined();
    expect(domain(row(facts({ connection: { status: "active", isPrimary: true, serving: null } })))).toBeUndefined();
  });

  it("gives a domain being set up two days before it speaks of it, as a warning", () => {
    expect(r.minPendingDays).toBe(2);
    const pending = facts({ connection: { status: "pending", isPrimary: false, txt: true, misconfigured: true } });
    expect(domain(row(pending, { ageDays: 1 }))).toBeUndefined();
    const at = domain(row(pending, { ageDays: 2 }))!;
    expect(at.severity).toBe("warning");
    expect(at.text).toBe("shop.example.no was added 2 days ago and still does not reach your store: its DNS does not point here.");
    expect(domain(row(pending, { ageDays: 3 }))?.severity).toBe("warning");
    expect(domain(row(pending, { ageDays: null }))).toBeUndefined();
  });

  it("speaks of a lapsed domain for 30 days after it expired, urgently, then leaves it to the Domains page", () => {
    expect(r.lapsedDays).toBe(30);
    const lapsed = (days: number) => row(facts({ registration: { withUs: true, registrar: "Kaizena Flow", expiresAt: `${new Date(NOW.getTime() - days * 86_400_000).toISOString().slice(0, 10)}T00:00:00.000Z`, renews: false, contactVerified: true } }));
    expect(domain(lapsed(30))?.severity).toBe("urgent");
    expect(domain(lapsed(29))?.text).toBe("shop.example.no expired on 2026-09-01. Renew it, or it stops working for good.");
    expect(domain(lapsed(31))).toBeUndefined();
  });

  it("warns of an expiry within 30 days without renewal, urgently within 14, and says where to renew one registered elsewhere", () => {
    const ours = (days: number, renews = false) => row(facts({ registration: { withUs: true, registrar: "Kaizena Flow", expiresAt: inDays(days), renews, contactVerified: true } }));
    expect(domain(ours(20))?.severity).toBe("warning");
    expect(domain(ours(20))?.text).toMatch(/^shop\.example\.no expires on \d{4}-\d{2}-\d{2}, in 20 days, and does not renew by itself\.$/);
    expect(domain(ours(10))?.severity).toBe("urgent");
    expect(domain(ours(31))).toBeUndefined();
    expect(domain(ours(10, true))).toBeUndefined();
    const elsewhere = row(facts({ registration: { withUs: false, registrar: "Domeneshop AS", expiresAt: inDays(20), renews: null, contactVerified: null } }));
    expect(domain(elsewhere)?.text).toMatch(/in 20 days, at Domeneshop AS: make sure it renews there\.$/);
  });

  it("is urgent while the registrant's email is not confirmed", () => {
    const a = domain(row(facts({ registration: { withUs: true, registrar: "Kaizena Flow", expiresAt: inDays(300), renews: true, contactVerified: false } })))!;
    expect(a.severity).toBe("urgent");
    expect(a.text).toBe("Confirm the registrant's email for shop.example.no, or the registry stops the domain.");
  });

  it("leaves email records and advice to the Domains page", () => {
    const mail = row(facts({ email: { mx: ["mx.example.no"], spf: [], dmarc: null }, caa: [] }));
    expect(mail.findings.map((f) => f.code)).toEqual(expect.arrayContaining(["spf_missing", "dmarc_missing"]));
    expect(domain(mail)).toBeUndefined();
  });

  it("gives one line to each domain, the store's address and the most serious first, and counts the others", () => {
    const address = row(facts({ connection: { status: "active", isPrimary: true, serving: { state: "elsewhere", at: "2026-09-29T08:00:00.000Z" } }, registration: { withUs: true, registrar: "Kaizena Flow", expiresAt: inDays(20), renews: false, contactVerified: true } }));
    const other = row(facts({ hostname: "www.example.no", connection: { status: "pending", isPrimary: false, misconfigured: true } }), { ageDays: 5 });
    const a = domain(other, address)!;
    expect(a.text).toMatch(/^shop\.example\.no no longer reaches your store/);
    expect(a.text).toMatch(/ Another domain needs a look too\.$/);
    expect(a.evidence.map((e) => [e.label, e.value])).toEqual([
      ["shop.example.no", "No longer reaches the store"],
      ["www.example.no", "Not pointed at the store"],
    ]);
  });

  it("speaks Norwegian", () => {
    const a = only(alertsFor(snap({ locale: "nb", domains: [row(facts({ connection: { status: "active", isPrimary: true, serving: { state: "elsewhere", at: "2026-09-29T08:00:00.000Z" } } }))] }), analyticsWordsIn("nb").alertText), "domain-problem")!;
    expect(a.text).toBe("shop.example.no når ikke butikken din lenger: da det ble sjekket 2026-09-29, svarte det med en annen side eller ikke i det hele tatt.");
    expect(a.action).toBe("Se domener");
  });
});
