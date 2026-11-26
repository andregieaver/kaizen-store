import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { marketCheckEn } from "@/lib/admin-messages/market-check.en";
import { marketCheckNb } from "@/lib/admin-messages/market-check.nb";
import type { KeptSiteSpeed } from "@/server/site-speed";

import { MarketSpeedSection, type MarketSpeedProps } from "./market-speed-section";

/** How fast your site is on Analytics → Markets (D905 M5c): the store's own site and its rivals', each figure rated by Google's thresholds. */

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

const site = (over: Partial<KeptSiteSpeed> = {}): KeptSiteSpeed => ({
  host: "linen.no",
  rivalName: null,
  lcp: 4800,
  inp: 180,
  cls: 120,
  checkedAt: "2026-11-24T10:00:00Z",
  periodEnd: "2026-11-22",
  triedAt: "2026-11-24T10:00:00Z",
  problem: null,
  ...over,
});

const props = (over: Partial<MarketSpeedProps> = {}): MarketSpeedProps => ({
  lang: "en",
  locale: "en-GB",
  timeZone: "Europe/Oslo",
  words: marketCheckEn.speed,
  sites: [site(), site({ host: "linnet.no", rivalName: "Linnet", lcp: 1900, inp: 150, cls: 20 }), site({ host: "furu.no", rivalName: "Furu", checkedAt: null, lcp: null, inp: null, cls: null, problem: "none" })],
  keySet: true,
  ...over,
});

describe("how fast your site is (D905 M5c)", () => {
  it("rates each figure of the store's site and its rivals' by Google's thresholds, with the day they cover", () => {
    const out = html(h(MarketSpeedSection, props()));
    expect(out).toContain("Your site (linen.no)");
    expect(out).toContain("4.8 s · Poor");
    expect(out).toContain("180 ms · Good");
    expect(out).toContain("0.12 · Needs work");
    expect(out).toContain("Linnet (linnet.no)");
    expect(out).toContain("1.9 s · Good");
    expect(out).toContain("22 Nov 2026");
    expect(out).toContain("Too few Chrome visitors to measure");
  });

  it("says when the platform's key is not set, and when a reading failed", () => {
    expect(html(h(MarketSpeedSection, props({ keySet: false, sites: [] })))).toContain("a platform admin adds a free Chrome UX Report key");
    const failed = html(h(MarketSpeedSection, props({ sites: [site({ checkedAt: null, lcp: null, inp: null, cls: null, problem: "failed", triedAt: "2026-11-25T08:00:00Z" })] })));
    expect(failed).toContain("Could not be measured: tried 25 Nov 2026");
  });

  it("reads in Norwegian, with its decimal comma", () => {
    const out = html(h(MarketSpeedSection, props({ lang: "nb", locale: "nb-NO", words: marketCheckNb.speed })));
    expect(out).toContain("Ditt nettsted (linen.no)");
    expect(out).toContain("4,8 s · Dårlig");
  });
});
