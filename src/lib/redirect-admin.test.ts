import { describe, expect, it } from "vitest";

import { finding } from "./data-job";
import {
  EXISTING_WORDS,
  FILTER_CHOICES,
  REDIRECT_TABS,
  WINDOW_ORDER,
  addressChangeWords,
  deleteSelectedWords,
  emptyListWords,
  existingWords,
  hasError,
  helpLine,
  importConfirmation,
  kindWords,
  lineResultWords,
  listHref,
  madeByWords,
  manualCountWords,
  pageOf,
  productAddressChange,
  redirectPaths,
  reportHref,
  reportSummaryWords,
  requestsWords,
  splitFindings,
  termAddressChange,
  uncountedWords,
  usedWords,
  windowWords,
} from "./redirect-admin";

describe("the addresses of the pages", () => {
  it("are the store's, one for each tab", () => {
    expect(redirectPaths("demo")).toEqual({
      list: "/admin/demo/redirects",
      report: "/admin/demo/redirects/404s",
      import: "/admin/demo/redirects/import",
      export: "/admin/demo/redirects/export",
    });
    expect(REDIRECT_TABS.map((t) => t.id)).toEqual(["list", "report", "import", "export"]);
  });

  it("leave the defaults out of the list's and the report's addresses", () => {
    const base = "/admin/demo/redirects";
    expect(listHref(base, {})).toBe(base);
    expect(listHref(base, { q: "  shoes ", filter: "manual", page: 3 })).toBe(`${base}?q=shoes&filter=manual&page=3`);
    expect(listHref(base, { filter: "all", page: 1 })).toBe(base);
    expect(reportHref(`${base}/404s`, {})).toBe(`${base}/404s`);
    expect(reportHref(`${base}/404s`, { days: 30 })).toBe(`${base}/404s`);
    expect(reportHref(`${base}/404s`, { days: 7, covered: true, ignored: true })).toBe(`${base}/404s?days=7&covered=1&ignored=1`);
  });

  it("read a page number from the address and fall back to the first", () => {
    expect(pageOf("4")).toBe(4);
    for (const bad of ["0", "-2", "x", "", undefined, "1e9", "99999999999"]) expect(pageOf(bad)).toBe(1);
  });
});

describe("the list's words", () => {
  it("names every kind of redirect and every filter", () => {
    expect(kindWords("manual")).toBe("Manual");
    expect(kindWords("article")).toBe("Article");
    expect(FILTER_CHOICES.map((c) => c.value)).toEqual(["all", "manual", "products", "terms", "pages"]);
  });

  it("says who made a redirect: automatic ones need no name", () => {
    expect(madeByWords({ kind: "product", origin: "system", createdBy: null })).toBe("Automatic");
    expect(madeByWords({ kind: "manual", origin: "editor", createdBy: "Kari" })).toBe("Added by Kari");
    expect(madeByWords({ kind: "manual", origin: "import", createdBy: "Kari" })).toBe("Imported by Kari");
    expect(madeByWords({ kind: "manual", origin: "report", createdBy: null })).toBe("From the pages-not-found report");
    expect(madeByWords({ kind: "manual", origin: "assistant", createdBy: "Kari" })).toBe("By the AI manager by Kari");
  });

  it("tells use as a lower bound, and never as a figure for a page's own redirect", () => {
    expect(usedWords(null, null, "UTC")).toBe("Not counted");
    expect(usedWords(0, null, "UTC")).toBe("Not used yet");
    expect(usedWords(1200, "2026-10-05T10:00:00Z", "UTC")).toBe("At least 1,200, last 5 Oct 2026, 10:00");
    expect(usedWords(3, null, "UTC")).toBe("At least 3");
  });

  it("writes the count against the limit", () => {
    expect(manualCountWords(12, 100_000)).toBe("12 of 100,000 manual redirects");
  });

  it("says why a list is empty, by what was asked", () => {
    expect(emptyListWords("shoes", "all")).toBe("No redirect matches the search.");
    expect(emptyListWords("", "manual")).toContain("no redirects of your own");
    expect(emptyListWords("", "all")).toContain("Kaizen makes one");
    expect(emptyListWords("", "terms")).toBe("No redirects of this kind yet.");
  });

  it("refuses a selection over the limit in words", () => {
    expect(deleteSelectedWords(3, 200)).toBe("Delete 3 selected");
    expect(deleteSelectedWords(201, 200)).toBe("Choose at most 200 at a time.");
  });
});

describe("the form's findings", () => {
  const error = finding("source.live", { address: "/p/cup" });
  const warn = finding("target.not_found", { address: "/p/none" });
  const note = finding("source.query_dropped");

  it("sort under the field each is about", () => {
    const by = splitFindings([error, warn, note, finding("limit.reached")]);
    expect(by.from.map((f) => f.code)).toEqual(["source.live", "source.query_dropped"]);
    expect(by.to.map((f) => f.code)).toEqual(["target.not_found"]);
    expect(by.line.map((f) => f.code)).toEqual(["limit.reached"]);
  });

  it("know an error from a warning", () => {
    expect(hasError([warn, note])).toBe(false);
    expect(hasError([warn, error])).toBe(true);
  });

  it("explain where shoppers go only when both addresses are readable", () => {
    expect(helpLine("/collections/shoes", "/category/shoes")).toBe("Shoppers who open /collections/shoes in any country go to /category/shoes in the same country.");
    expect(helpLine(null, "/x")).toBeNull();
    expect(helpLine("/x", null)).toBeNull();
  });

  it("ask before replacing a redirect, and say an automatic one is replaced", () => {
    expect(existingWords(null, "/a")).toBeNull();
    expect(existingWords({ kind: "manual", target: "/b" }, null)).toBeNull();
    expect(existingWords({ kind: "manual", target: "/b" }, "/a")).toBe("Replace the redirect from /a? It goes to /b now.");
    expect(existingWords({ kind: "automatic" }, "/p/old")).toContain("Saving this one replaces it");
  });
});

describe("after a save changed an address", () => {
  it("names the pair only when the address changed and a redirect was left", () => {
    expect(productAddressChange("old-cup", "new-cup", true)).toEqual({ from: "/p/old-cup", to: "/p/new-cup" });
    expect(productAddressChange("old-cup", "old-cup", true)).toBeNull();
    expect(productAddressChange(null, "new-cup", true)).toBeNull();
    // A product that was never live leaves no redirect: nothing is claimed.
    expect(productAddressChange("old-cup", "new-cup", false)).toBeNull();
    expect(termAddressChange("category", "shoes", "footwear", true)).toEqual({ from: "/category/shoes", to: "/category/footwear" });
    expect(termAddressChange("tag", "sale", "sale", true)).toBeNull();
    expect(termAddressChange("tag", "sale", "deals", false)).toBeNull();
  });

  it("says it in one sentence", () => {
    expect(addressChangeWords({ from: "/p/a", to: "/p/b" })).toBe("The old address /p/a now redirects to /p/b.");
  });
});

describe("the import's words", () => {
  it("offer two choices, each with what it does", () => {
    expect(Object.keys(EXISTING_WORDS)).toEqual(["replace", "skip"]);
    expect(EXISTING_WORDS.replace.help).toContain("Shopify");
  });

  it("confirm what is written and what never is", () => {
    const text = importConfirmation(1200, 30);
    expect(text).toContain("create 1,200 and replace 30");
    expect(text).toContain("nothing is deleted");
    expect(text).toContain("checked again as it is written");
  });

  it("tell a dry run's prediction apart from what happened", () => {
    expect(lineResultWords("checked", "created")).toBe("Would be created");
    expect(lineResultWords("checked", "updated")).toBe("Would replace the redirect");
    expect(lineResultWords("checked", "failed")).toBe("Would not be imported");
    expect(lineResultWords("checked", null)).toBe("Checked");
    expect(lineResultWords("created", null)).toBe("Created");
    expect(lineResultWords("updated", null)).toBe("Replaced");
    expect(lineResultWords("failed", null)).toBe("Not imported");
    expect(lineResultWords("unchanged", null)).toBe("Already there");
  });
});

describe("the report's words", () => {
  it("offers 7, 30 and 90 days, in that order", () => {
    expect(WINDOW_ORDER).toEqual([7, 30, 90]);
    expect(windowWords(30)).toBe("Last 30 days");
  });

  it("adds shoppers and robots together and names the robots' share", () => {
    expect(requestsWords(1, 0)).toBe("1 request");
    expect(requestsWords(12, 0)).toBe("12 requests");
    expect(requestsWords(12, 5)).toBe("12 requests, 5 by robots");
  });

  it("sums up what is shown from the report's own numbers", () => {
    expect(reportSummaryWords(0, 0, 30)).toBe("No missing address was asked for in the last 30 days.");
    expect(reportSummaryWords(1, 1, 7)).toBe("1 different address asked for in the last 7 days.");
    expect(reportSummaryWords(500, 1200, 90)).toBe("Showing 500 of 1,200 different addresses asked for in the last 90 days.");
  });

  it("says what a day's cap left uncounted, or nothing", () => {
    expect(uncountedWords({ requests: 0, days: 0 })).toBeNull();
    expect(uncountedWords({ requests: 40, days: 2 })).toBe("On 2 days more different addresses were asked for than a day can list, so 40 requests are not counted by address.");
    expect(uncountedWords({ requests: 1, days: 1 })).toContain("1 request is not counted");
  });
});
