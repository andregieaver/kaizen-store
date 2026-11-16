import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { recordingsEn as words } from "@/lib/admin-messages/recordings.en";
import type { RecordingRow } from "@/server/recordings-read";

import { entryName, lengthText, RecordingsList, recordingsHref } from "./recordings-view";

/** The recordings list (D656 step 11): off, not available, empty, grouped by day, watched rows dimmed, chips only where not zero. */

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const BASE = "/admin/shop";
const NOW = new Date("2026-11-16T15:00:00Z");
const row = (over: Partial<RecordingRow> = {}): RecordingRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  startedAt: "2026-11-16T13:00:00Z",
  durationMs: 125_000,
  device: "mobile",
  pages: ["/no", "/no/p/mug"],
  entryPage: "/no",
  clicks: 9,
  deadClicks: 2,
  rageClicks: 1,
  tags: [],
  viewedAt: null,
  ...over,
});
const counts = { all: 3, rage: 1, dead: 2, mobile: 3, tablet: 0, desktop: 0 };
const list = (over: Partial<Parameters<typeof RecordingsList>[0]> = {}) =>
  html(h(RecordingsList, { base: BASE, rows: [row()], counts, filters: { sort: "frustrated" }, on: true, available: true, more: false, page: 0, timeZone: "Europe/Oslo", locale: "en-GB", now: NOW, words, ...over }));

describe("the recordings list (D656)", () => {
  it("says when recordings are off, or not available yet, above what is kept", () => {
    expect(list({ on: false })).toContain(words.off);
    expect(list({ on: false })).toContain(`${BASE}/analytics/settings#signals`);
    const held = list({ on: false, available: false });
    expect(held).toContain(words.notAvailable);
    expect(held).not.toContain("#signals");
    expect(list()).not.toContain(words.off);
  });

  it("says when there is nothing yet", () => {
    expect(list({ rows: [], counts: { all: 0, rage: 0, dead: 0, mobile: 0, tablet: 0, desktop: 0 } })).toContain(words.empty);
  });

  it("groups by day, says when coarsely, and dims a watched row", () => {
    const markup = list({ rows: [row(), row({ id: "22222222-2222-4222-8222-222222222222", startedAt: "2026-11-15T09:00:00Z", viewedAt: "2026-11-16T10:00:00Z" }), row({ id: "33333333-3333-4333-8333-333333333333", startedAt: "2026-11-10T09:00:00Z" })] });
    expect(markup.indexOf(words.today)).toBeLessThan(markup.indexOf(words.yesterday));
    expect(markup).toContain("10 November 2026");
    expect(markup).toContain("around 14:00 · Phone · 2 min · 2 pages");
    expect(markup).toMatch(/data-watched=""[^>]*opacity-60/);
    expect(markup).toContain(`${BASE}/analytics/recordings/11111111-1111-4111-8111-111111111111`);
    expect(markup).toContain("1 rage");
  });

  it("shows only the chips that have recordings, and keeps the filters in the address", () => {
    const markup = list();
    expect(markup).toContain(words.chips.rage);
    expect(markup).not.toContain(words.chips.tablet);
    expect(recordingsHref(BASE, { device: "mobile", sort: "frustrated" }, { has: "rage" })).toBe(`${BASE}/analytics/recordings?device=mobile&has=rage`);
    expect(recordingsHref(BASE, { sort: "newest" }, { p: 2 })).toBe(`${BASE}/analytics/recordings?sort=newest&p=2`);
  });

  it("writes lengths and entry pages in words", () => {
    expect(lengthText(45_000, words)).toBe("45 s");
    expect(lengthText(600_000, words)).toBe("10 min");
    expect(entryName("/no", words)).toBe("Front page");
    expect(entryName("/no/p/mug", words)).toBe("/p/mug");
  });
});
