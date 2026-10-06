import { describe, expect, it } from "vitest";

import { emailText } from "./email-text";
import { t } from "./i18n";
import { templateArguments, templateProblem } from "./icu-lite";
import { catalogOf, CHOOSING, HAND_WRITTEN_ONLY, isHandWrittenOnly, overlayMessages, runTemplate, sourceHash } from "./ui-catalog";

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
    "ui:gift.counter": count,
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

describe("texts that are only ever hand-written (review: the backorder delivery-time sentences)", () => {
  it("keeps the backorder sentences out of the catalogue, so no language gets a machine translation of a delivery time", () => {
    expect(HAND_WRITTEN_ONLY).toContain("ui:backorder.");
    expect(all.filter((e) => e.key.startsWith("ui:backorder.") || e.key.startsWith("email:backorder.")).map((e) => e.key)).toEqual([]);
    expect(all.filter((e) => isHandWrittenOnly(e.key))).toEqual([]);
    expect(Object.keys(CHOOSING).filter(isHandWrittenOnly)).toEqual([]);
    // The messages exist (nb, sv, da and en by hand) and are what the walk skipped, not something that was never there.
    expect(typeof t("en").backorder.page).toBe("function");
  });

  it("never lets an overlay replace them: a stored translation for one is ignored and the English sentence stays", () => {
    const rogue = new Map([
      ["ui:backorder.page", "{0, plural, one {Auf Lieferrückstand: # Tag} other {Auf Lieferrückstand: # Tage}}"],
      ["ui:backorder.line", "{0} {1}"],
      ["ui:backorder.capped", "x"],
    ]);
    const de = overlayMessages("ui", t("en"), rogue, "de-DE");
    expect(de.backorder.page(7)).toBe(t("en").backorder.page(7));
    expect(de.backorder.line(2, 7)).toBe(t("en").backorder.line(2, 7));
    expect(de.backorder.capped(20)).toBe(t("en").backorder.capped(20));
  });

  it("reads the hand-written languages and the English fallback, whatever else is in the store's texts", () => {
    expect(t("nb").backorder.page(7)).not.toBe(t("en").backorder.page(7));
    expect(t("sv").backorder.page(7)).not.toBe(t("en").backorder.page(7));
    expect(t("da").backorder.page(7)).not.toBe(t("en").backorder.page(7));
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

describe("the words of wave 3's orders (D173): gift messages, the pay link's page and email", () => {
  const LANGS = ["nb", "sv", "da", "en"] as const;
  /** Every leaf of a messages object as `path -> value`, the functions called with a name, a number or a word as they take. */
  const leaves = (node: unknown, path: string[] = []): [string, string | ((...a: never[]) => string)][] =>
    typeof node === "string" || typeof node === "function"
      ? [[path.join("."), node as never]]
      : node && typeof node === "object"
        ? Object.entries(node).flatMap(([k, v]) => leaves(v, [...path, k]))
        : [];

  it("has the same words in nb, sv, da and en, all filled in", () => {
    for (const section of ["gift", "draftPay"] as const) {
      const english = leaves(t("en")[section]).map(([k]) => k);
      for (const lang of LANGS) expect(leaves(t(lang)[section]).map(([k]) => k), `${lang} ${section}`).toEqual(english);
    }
    for (const section of ["draft", "giftMessage"] as const) {
      const english = leaves(emailText("en")[section]).map(([k]) => k);
      for (const lang of LANGS) expect(leaves(emailText(lang)[section]).map(([k]) => k), `${lang} ${section}`).toEqual(english);
    }
  });

  it("writes every word by hand: the Nordic languages are not English, and no word is empty", () => {
    for (const lang of LANGS) {
      for (const [path, value] of [...leaves(t(lang).gift), ...leaves(t(lang).draftPay)]) {
        const text = typeof value === "function" ? String((value as (...a: unknown[]) => unknown)("Kari", 3)) : value;
        expect(text.trim().length, `${lang} ${path}`).toBeGreaterThan(1);
        if (lang !== "en" && /\p{L}{4,}/u.test(text) && !/^(Kontakt|Adress|Adresse|Organisationsnummer|Kari)/.test(text)) expect(text, `${lang} ${path}`).not.toBe(String(leaves(t("en").draftPay).concat(leaves(t("en").gift)).find(([k]) => k === path)?.[1] ?? ""));
      }
    }
    expect(t("nb").gift.title).toBe("Dette er en gave");
    expect(t("sv").draftPay.heading("1042")).toBe("Beställning 1042");
    expect(t("da").draftPay.paid).toBe("Denne ordre er betalt. Tak!");
    expect(emailText("nb").draft.subject("Butikken", "1042")).toBe("Butikken: bestillingen din 1042 er klar til betaling");
    expect(emailText("en").draft.subject("Shop", "1042")).toBe("Shop: your order 1042 is ready to pay");
  });

  it("puts the gift box's plain labels in the catalogue and keeps everything about the buyer's text, the pay page and the pay email out of it", () => {
    for (const key of ["ui:gift.title", "ui:gift.to", "ui:gift.from", "ui:gift.message", "ui:gift.counter"]) expect(all.some((e) => e.key === key), key).toBe(true);
    expect(all.filter((e) => /^(ui:gift\.(note|slip)\.|ui:draftPay\.|email:draft\.|email:giftMessage\.)/.test(e.key)).map((e) => e.key)).toEqual([]);
    for (const prefix of ["ui:gift.note.", "ui:gift.slip.", "ui:draftPay.", "email:draft.", "email:giftMessage."]) expect(HAND_WRITTEN_ONLY).toContain(prefix);
    expect(isHandWrittenOnly("ui:gift.counter")).toBe(false);
    expect(isHandWrittenOnly("ui:draftPay.withdrawal")).toBe(true);
  });

  it("never lets an overlay replace the hand-written ones, and may translate the gift box's labels", () => {
    const rogue = new Map([
      ["ui:draftPay.withdrawal", "x"],
      ["ui:draftPay.heading", "{0}"],
      ["ui:gift.note.printed", "x"],
      ["ui:gift.title", "Das ist ein Geschenk"],
      ["ui:gift.counter", "{0, plural, one {# Zeichen übrig} other {# Zeichen übrig}}"],
    ]);
    const de = overlayMessages("ui", t("en"), rogue, "de-DE");
    expect(de.draftPay.withdrawal).toBe(t("en").draftPay.withdrawal);
    expect(de.draftPay.heading("7")).toBe(t("en").draftPay.heading("7"));
    expect(de.gift.note.printed).toBe(t("en").gift.note.printed);
    expect(de.gift.title).toBe("Das ist ein Geschenk");
    expect(de.gift.counter(5)).toBe("5 Zeichen übrig");
  });

  it("counts the characters left with a singular: the message that chooses by a number", () => {
    expect(t("en").gift.counter(1)).toBe("1 character left");
    expect(t("en").gift.counter(250)).toBe("250 characters left");
    expect(runTemplate("ui:gift.counter", ui.find((e) => e.key === "ui:gift.counter")!.source, [1], "en")).toBe("1 character left");
    expect(runTemplate("ui:gift.counter", ui.find((e) => e.key === "ui:gift.counter")!.source, [250], "en")).toBe("250 characters left");
  });
});
