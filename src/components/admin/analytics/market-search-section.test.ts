import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { marketCheckEn } from "@/lib/admin-messages/market-check.en";
import { marketCheckNb } from "@/lib/admin-messages/market-check.nb";
import type { KeptSearchTerm } from "@/server/market-search";

import { MarketSearchSection, type MarketSearchProps } from "./market-search-section";

/** Where you come up in search on Analytics → Markets (D905 M5b): each followed word with the store's place and its rivals', counted by code. */

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const action = async () => ({ status: "ok" as const, messages: [] });

const term = (over: Partial<KeptSearchTerm> = {}): KeptSearchTerm => ({
  id: "11111111-1111-4111-8111-111111111111",
  term: "linen apron",
  market: "NO",
  checkedAt: "2026-11-24T10:00:00Z",
  own: 4,
  rivals: [
    { name: "Linnet", host: "linnet.no", position: 2 },
    { name: "Furu", host: "furu.no", position: null },
  ],
  previous: 7,
  previousAt: "2026-10-24T10:00:00Z",
  triedAt: "2026-11-24T10:00:00Z",
  problem: null,
  ...over,
});

const props = (over: Partial<MarketSearchProps> = {}): MarketSearchProps => ({
  lang: "en",
  timeZone: "Europe/Oslo",
  words: marketCheckEn.search,
  terms: [term()],
  countries: [{ code: "NO", name: "Norway" }],
  ideas: ["linforkle", "lin"],
  searchOn: true,
  actions: { add: action, remove: action },
  ...over,
});

describe("where you come up in search (D905 M5b)", () => {
  it("shows each word with the store's place and its change, each rival's place, and when it was searched", () => {
    const out = html(h(MarketSearchSection, props()));
    expect(out).toContain('data-search-term="linen apron"');
    expect(out).toContain("You: number 4 (up 3) · Linnet: number 2 · Furu: not on the first page · Checked 24 Nov 2026");
    expect(out).toContain('list="search-term-ideas"');
    expect(out).toContain('<option value="linforkle">');
    expect(out).toContain("Follow the word");
  });

  it("says when a word waits for its first search, or the last one failed, and when search is not set up", () => {
    const waiting = html(h(MarketSearchSection, props({ terms: [term({ checkedAt: null, own: null, previous: null, triedAt: null })] })));
    expect(waiting).toContain("Searched within a few minutes.");
    const failed = html(h(MarketSearchSection, props({ terms: [term({ checkedAt: null, problem: "failed", triedAt: "2026-11-25T08:00:00Z" })] })));
    expect(failed).toContain("The last search could not be made: tried 25 Nov 2026.");
    const off = html(h(MarketSearchSection, props({ searchOn: false })));
    expect(off).toContain("Web search is not set up yet");
  });

  it("asks for words while there are none, and leaves the forms out for a reader", () => {
    expect(html(h(MarketSearchSection, props({ terms: [] })))).toContain("No words yet.");
    const reader = html(h(MarketSearchSection, props({ actions: null })));
    expect(reader).not.toContain("Follow the word");
    expect(reader).not.toContain(">Remove<");
  });

  it("reads in Norwegian", () => {
    const out = html(h(MarketSearchSection, props({ lang: "nb", words: marketCheckNb.search })));
    expect(out).toContain("Du: nummer 4 (opp 3) · Linnet: nummer 2 · Furu: ikke på første side");
  });
});
