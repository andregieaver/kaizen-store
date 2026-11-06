import { describe, expect, it } from "vitest";

import { fillWords } from "./admin-fill";
import { screensEn } from "./admin-messages/screens.en";
import { screensNb } from "./admin-messages/screens.nb";
import { cohortTrend, type CohortRow } from "./analytics-customers";
import { exchangeShare, gatedRate, maturityNote, reasonBreakdown, timingOf } from "./analytics-returns";
import { asWritten, noteIn, sayIn, type NoteTree } from "./analytics-notes";

const EN = screensEn.analyticsNotes;
const NB = screensNb.analyticsNotes;

function leaves(tree: NoteTree, prefix = ""): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [[prefix + key, value] as [string, string]] : leaves(value, `${prefix}${key}.`),
  );
}
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const nb = new Map(leaves(NB));

describe("the analytics notes' templates", () => {
  it("are all in Norwegian, with the same placeholders", () => {
    for (const [path, en] of leaves(EN)) {
      expect(nb.has(path), path).toBe(true);
      expect(placeholders(nb.get(path)!), path).toEqual(placeholders(en));
      expect(nb.get(path), path).not.toBe(en);
    }
    expect([...nb.keys()].sort()).toEqual(leaves(EN).map(([path]) => path).sort());
  });

  it("are each said by their own Norwegian, never by another template's", () => {
    const english = leaves(EN).map(([, text]) => text);
    expect(new Set(english).size).toBe(english.length);
    for (const [path, en] of leaves(EN)) {
      const values = Object.fromEntries(placeholders(en).map((name, i) => [name, `X${i}Y`]));
      expect(noteIn(fillWords(en, values), EN, NB, "nb-NO"), path).toBe(fillWords(nb.get(path)!, values));
    }
  });
});

describe("noteIn", () => {
  it("fills the other language's template with the values the note carried", () => {
    const note = "Visits have been counted since 2026-09-20, so these figures cover only the days from then.";
    expect(noteIn(note, EN, NB)).toBe("Besøk er telt siden 2026-09-20, så disse tallene gjelder bare dagene fra da.");
    expect(noteIn("3 refunds in DKK, SEK are left out: the store has no exchange rate for it.", EN, NB)).toBe(
      "3 refusjoner i DKK, SEK er utelatt: butikken har ingen valutakurs for dem.",
    );
  });

  it("says a phrase given as a value in the other language too, and writes numbers the locale's way", () => {
    expect(noteIn("No return was refunded in this period that has a request date.", EN, NB)).toBe("Ingen retur som har en forespørselsdato, ble refundert i denne perioden.");
    expect(noteIn("More than 5,000 returns were refunded in this period: the times are made of the latest ones.", EN, NB, "nb-NO")).toBe(
      `Mer enn ${new Intl.NumberFormat("nb-NO").format(5000)} returer ble refundert i denne perioden: tidene er regnet ut fra de siste.`,
    );
  });

  it("leaves a note no template knows as it is, and English as it is", () => {
    expect(noteIn("Something a report says that no template has.", EN, NB)).toBe("Something a report says that no template has.");
    expect(sayIn(EN, EN, "en")).toBe(asWritten);
  });
});

describe("what the reports write, said in Norwegian", () => {
  const say = sayIn(EN, NB, "nb-NO");
  const known = (note: string | null) => {
    expect(note).not.toBeNull();
    expect(say(note!), note!).not.toBe(note);
  };

  it("knows every reason a returns figure can be missing", () => {
    known(gatedRate({ part: 0, whole: 10, min: 30, unit: "orders", tracked: false }).missing);
    known(gatedRate({ part: 0, whole: 0, min: 30, unit: "units", tracked: true }).missing);
    known(gatedRate({ part: 0, whole: 1, min: 30, unit: "orders", tracked: true }).missing);
    known(gatedRate({ part: 0, whole: 12, min: 30, unit: "units", tracked: true }).missing);
    known(timingOf([], EN.phrases.requestDate).missing);
    known(timingOf([1, 2], EN.phrases.goodsReceivedFirst).missing);
    known(timingOf([1], EN.phrases.requestDate).missing);
    known(maturityNote({ to: "2026-11-01" }, "2026-11-03", 14));
    known(exchangeShare({ exchanged: 0, returns: 0, tracked: false }).missing);
    known(exchangeShare({ exchanged: 0, returns: 0, tracked: true }).missing);
    known(exchangeShare({ exchanged: 0, returns: 3, tracked: true }).missing);
    known(reasonBreakdown([{ reason: null, returns: 2, units: 2 }]).note);
    known(reasonBreakdown([{ reason: "damaged", returns: 1, units: 1 }]).note);
    known(reasonBreakdown([...Array.from({ length: 10 }, () => ({ reason: "damaged", returns: 1, units: 1 })), { reason: null, returns: 1, units: 1 }]).note);
    expect(say(reasonBreakdown([{ reason: null, returns: 2, units: 2 }]).rows[0].label)).toBe("Ingen årsak oppgitt");
  });

  it("knows every cohort sentence, which the customers lib writes itself", () => {
    const OFFSETS = [0, 1, 2, 3];
    const cohort = (month: string, size: number, repeaters: number): CohortRow => ({
      cohort: month,
      size,
      repeaters: OFFSETS.map(() => repeaters),
      retention: OFFSETS.map(() => repeaters / size),
      revenuePerCustomerMinor: OFFSETS.map(() => null),
    });
    const trend = (older: number, newer: number) =>
      cohortTrend({
        offsets: OFFSETS,
        rows: ["01", "02", "03"].map((m) => cohort(`2026-${m}`, 50, older)).concat(["04", "05", "06"].map((m) => cohort(`2026-${m}`, 50, newer))),
      });
    expect(say(trend(5, 15).sentence)).toBe(
      `Nyere kunder kommer oftere tilbake: ${new Intl.NumberFormat("nb-NO", { style: "percent" }).format(0.3)} av de nyere kundene hadde kjøpt igjen innen måned 3, mot ${new Intl.NumberFormat("nb-NO", { style: "percent" }).format(0.1)} av de eldre.`,
    );
    known(trend(15, 5).sentence);
    known(trend(10, 11).sentence);
    known(cohortTrend({ offsets: OFFSETS, rows: [] }).sentence);
  });
});
