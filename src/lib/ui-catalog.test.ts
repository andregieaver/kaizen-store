import { describe, expect, it } from "vitest";

import { emailText } from "./email-text";
import { t } from "./i18n";
import { templateArguments, templateProblem } from "./icu-lite";
import { catalogOf, CHOOSING, overlayMessages, runTemplate, sourceHash } from "./ui-catalog";

const ui = catalogOf("ui", t("en"));
const email = catalogOf("email", emailText("en"));
const all = [...ui, ...email];

describe("the catalogue", () => {
  it("has every text and every message with arguments, with a template for each", () => {
    expect(ui.filter((e) => e.kind === "text").length).toBeGreaterThan(500);
    expect(ui.filter((e) => e.kind === "template").length).toBeGreaterThan(100);
    expect(email.length).toBeGreaterThan(90);
    expect(new Set(all.map((e) => e.key)).size).toBe(all.length);
    for (const entry of all) expect(entry.source.trim(), entry.key).not.toBe("");
  });

  it("keeps plain texts free of braces, except named placeholders the site fills in itself", () => {
    for (const entry of all.filter((e) => e.kind === "text")) expect(entry.source.replace(/\{[A-Za-z]+\}/g, ""), entry.key).not.toMatch(/[{}]/);
  });

  it("has a template that uses as many arguments as its function takes (or fewer, for a plural on one)", () => {
    for (const entry of all.filter((e) => e.kind === "template")) {
      const used = templateArguments(entry.source);
      expect(used.length, entry.key).toBeLessThanOrEqual(Math.max(entry.arity, 4));
      expect(templateProblem(entry.source, entry.source, "en"), entry.key).toBeNull();
    }
  });

  it("names every message that is chosen by its arguments, and only real ones", () => {
    const keys = new Set(all.map((e) => e.key));
    for (const key of Object.keys(CHOOSING)) expect(keys.has(key), key).toBe(true);
  });
});

describe("a template gives the English message", () => {
  /** How each message that is chosen by its arguments is called: numbers where it counts, yes or no where it chooses. */
  const leftOut = [["Tea", 3, 2], ["Tea", 3, 0]];
  const count = [[1], [3], [22]];
  const CASES: Record<string, unknown[][]> = {
    "ui:deliveries.leftOutLine": leftOut,
    "email:deliveries.leftOutLine": leftOut,
    "ui:companyAccount.sent": count,
    "ui:companyAccount.resent": count,
    "ui:companyAccount.alreadyMember": count,
    "ui:days": [[365], [730], [30], [7]],
    "ui:downloadsLeft": count,
    "ui:bonus.dayCount": count,
    "ui:bonus.monthCount": count,
    "ui:planEvery": [["week", 1], ["week", 2], ["month", 1], ["month", 3], ["year", 1], ["year", 2]],
    "ui:search.results": [[1, "tea"], [4, "tea"]],
    "ui:listing.count": count,
    "ui:wishlist.added": count,
    "ui:wishlist.moved": [[1, "Wishlist"], [3, "Wishlist"]],
    "ui:account.hello": [["Kari"], [""]],
    "ui:account.items": count,
    "ui:booking.freeCancel": [[0], [24]],
    "ui:stay.nights": count,
    "ui:stay.days": count,
    "ui:stay.hours": count,
    "ui:stay.perBooking": [[true], [false]],
    "ui:stay.feeIncluded": [[true], [false]],
    "ui:stay.perNight": [[true], [false]],
    "ui:stay.noWithdrawal": [[true], [false]],
    "ui:stay.tooShort": [[2, true], [2, false], [1, true], [1, false]],
    "ui:stay.tooLong": [[2, true], [2, false], [1, true], [1, false]],
    "ui:stay.times": [["15:00", "11:00", true], ["15:00", "11:00", false]],
    "ui:stay.freeCancel": [[0, true], [24, true], [24, false]],
    "email:bookingCancelledByYouIntro": [["Massage", "Monday", "€ 10"], ["Massage", "Monday", null]],
  };

  function english(namespace: "ui" | "email"): Map<string, (...a: unknown[]) => unknown> {
    const found = new Map<string, (...a: unknown[]) => unknown>();
    const walk = (node: unknown, path: string[]) => {
      if (typeof node === "function") found.set(`${namespace}:${path.join(".")}`, node as never);
      else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, [...path, k]);
    };
    walk(namespace === "ui" ? t("en") : emailText("en"), []);
    return found;
  }

  it("for every function-valued message, whichever way it is chosen", () => {
    let checked = 0;
    for (const [namespace, entries] of [["ui", ui], ["email", email]] as const) {
      const fns = english(namespace);
      for (const entry of entries.filter((e) => e.kind === "template")) {
        const fn = fns.get(entry.key)!;
        // A message that is not chosen by its arguments is its text with them in place.
        const cases = CASES[entry.key] ?? [Array.from({ length: entry.arity }, (_, i) => `«${i}»`)];
        for (const args of cases) {
          const expected = String(fn(...args));
          expect(runTemplate(entry.key, entry.source, args, "en"), `${entry.key}(${JSON.stringify(args)})`).toBe(expected);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(150);
  });

  it("covers every message that is chosen by its arguments", () => {
    for (const key of Object.keys(CHOOSING)) {
      if (key !== "email:tracking") expect(CASES[key], key).toBeDefined();
    }
  });
});

describe("the overlay", () => {
  it("replaces what a language has, keeps English for the rest, and turns templates into functions", () => {
    const first = ui.find((e) => e.kind === "text")!;
    const days = "{0, plural, one {# Tag} other {# Tage}}";
    const texts = new Map([
      [first.key, "Übersetzt"],
      ["ui:stay.nights", days],
      ["email:tracking", "Sendungsverfolgung: {0} {1}"],
    ]);
    const de = overlayMessages("ui", t("en"), texts, "de-DE");
    const path = first.key.slice(3).split(".");
    const at = (root: unknown) => path.reduce<unknown>((node, k) => (node as Record<string, unknown>)[k], root);
    expect(at(de)).toBe("Übersetzt");
    expect(de.stay.nights(2)).toBe("2 Tage");
    expect(de.stay.nights(1)).toBe("1 Tag");
    // Not translated: English, still a working function.
    expect(de.stay.days(3)).toBe("3 days");
    expect(overlayMessages("email", emailText("en"), texts, "de-DE").tracking("DHL", "123")).toBe("Sendungsverfolgung: DHL 123");
    // The English messages themselves are untouched.
    expect(t("en").stay.nights(2)).toBe("2 nights");
  });

  it("fingerprints a source so a changed original is noticed", () => {
    expect(sourceHash("Add to cart")).toBe(sourceHash("Add to cart"));
    expect(sourceHash("Add to cart")).not.toBe(sourceHash("Add to basket"));
  });
});
