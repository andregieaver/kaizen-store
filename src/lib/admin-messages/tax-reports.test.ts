import { describe, expect, it } from "vitest";

import { NOT_A_RETURN } from "@/components/admin/analytics/tax-parts";

import { forbiddenUses } from "../i18n-glossary";
import { IOSS_OFF_TEXT } from "../oss-return";
import { EXPORT_PROBLEMS, TAX_VIEW_LABEL } from "../tax-admin";
import { CLASS_REASONS, placeLabel, reasonText, registrationNotes, type ClassReason, type Place, type ReturnPart } from "../tax-classes";
import { deadlineSentence, longDate, monthPeriod, periodLabel, quarterPeriod } from "../tax-periods";
import { CAUSE_LABEL, CAUSE_TEXT, CAUSES, reconcile, refundsLine } from "../tax-reconciliation";
import { deadlineText, exportProblemText, lineWords, longDateIn, noteWords, periodText, placeText, rateProblemText, reasonWords } from "../tax-report-words";
import { taxReportsEn } from "./tax-reports.en";
import { taxReportsNb } from "./tax-reports.nb";

/** Every string of a catalogue with its path. */
function strings(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${path}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k));
  return [];
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("the VAT, OSS and IOSS catalogue (D312 A9)", () => {
  it("has every English text in Norwegian with the same placeholders", () => {
    const nb = new Map(strings(taxReportsNb));
    for (const [path, english] of strings(taxReportsEn)) {
      expect(nb.has(path), path).toBe(true);
      expect(placeholders(nb.get(path) ?? ""), path).toEqual(placeholders(english));
    }
  });

  it("uses no word the glossary avoids", () => {
    for (const [path, text] of strings(taxReportsNb)) expect(forbiddenUses(text), path).toEqual([]);
  });

  it("says in English what the libraries say", () => {
    expect(taxReportsEn.parts.notReturn).toBe(NOT_A_RETURN);
    expect(taxReportsEn.parts.views).toEqual(TAX_VIEW_LABEL);
    expect(taxReportsEn.exportProblems).toEqual(EXPORT_PROBLEMS);
    expect(taxReportsEn.oss.iossOff).toBe(IOSS_OFF_TEXT);
    for (const reason of CLASS_REASONS) expect(reasonWords(reason)).toBe(reasonText(reason));
    for (const cause of CAUSES) expect(taxReportsEn.recon.causes[cause]).toEqual({ label: CAUSE_LABEL[cause], text: CAUSE_TEXT[cause] });
  });

  it("writes places, periods, dates and deadlines as the libraries do in English", () => {
    const places: { place: Place; part: ReturnPart | null; reason: ClassReason }[] = [
      { place: "ioss", part: "IOSS", reason: "ioss" },
      { place: "union", part: "2b", reason: "union_goods_msi" },
      { place: "non_union", part: "NU", reason: "non_union_services" },
      { place: "national", part: null, reason: "non_eu_market" },
      { place: "national", part: null, reason: "domestic" },
      ...CLASS_REASONS.map((reason) => ({ place: "none" as const, part: null, reason })),
    ];
    for (const p of places) expect(placeText(p)).toBe(placeLabel(p));
    for (const period of [quarterPeriod(2026, 3), monthPeriod(2026, 9)]) {
      expect(periodText(period)).toBe(periodLabel(period));
      for (const today of ["2026-09-15", "2026-10-20", "2026-11-25", "2027-03-01"]) expect(deadlineText(period, today)).toBe(deadlineSentence(period, today));
    }
    expect(longDateIn("2026-10-31")).toBe(longDate("2026-10-31"));
  });

  it("says the registration notes, the reconciliation's lines and the refunds' line in English as the libraries do", () => {
    const notes = [
      ...registrationNotes({ ossScheme: "none", iossNumber: null }, { "2a": 1, NU: 1, IOSS: 1 }),
      ...registrationNotes({ ossScheme: "non_union", iossNumber: null }, { "2b": 1 }),
      ...registrationNotes({ ossScheme: "union", iossNumber: null }, { NU: 1 }),
    ];
    expect(notes.length).toBe(5);
    for (const n of notes) expect(noteWords(n)).toBe(n.message);
    const causes = Object.fromEntries(CAUSES.map((c) => [c, { orders: 1, taxMinor: 10 }]));
    const bridge = reconcile({ currency: "NOK", finance: { orders: 3, taxMinor: 100 }, report: { orders: 2, taxMinor: 90 }, causes });
    for (const line of bridge.lines) expect(lineWords(line, false)).toEqual({ label: line.label, text: line.text });
    expect(taxReportsEn.recon.refundsAgree).toBe(refundsLine(100, 100, 1).text);
    expect(taxReportsEn.recon.refundsDiffer).toBe(refundsLine(100, 500, 1).text);
  });

  it("says them in Norwegian", () => {
    expect(longDateIn("2026-10-31", taxReportsNb)).toBe("31. oktober 2026");
    expect(periodText(quarterPeriod(2026, 3), taxReportsNb)).toBe("3. kvartal 2026");
    expect(periodText(monthPeriod(2026, 9), taxReportsNb)).toBe("september 2026");
    expect(deadlineText(quarterPeriod(2026, 3), "2026-11-25", taxReportsNb)).toBe(
      "3. kvartal 2026: send inn og betal innen 31. oktober 2026. Den dagen er passert; Kaizena Flow vet ikke hva som ble sendt inn.",
    );
    expect(placeText({ place: "union", part: "2d", reason: "union_goods_other" }, taxReportsNb)).toBe("OSS «Union scheme», del 2d");
    expect(placeText({ place: "none", part: null, reason: "reverse_charge" }, taxReportsNb)).toBe("Ikke i en melding: omvendt avgiftsplikt");
    expect(exportProblemText("failed", taxReportsNb)).toBe(taxReportsNb.exportProblems.failed);
    expect(exportProblemText("nonsense", taxReportsNb)).toBeNull();
    expect(rateProblemText("The euro needs no rate.", taxReportsNb)).toBe("Euro trenger ingen kurs.");
    expect(rateProblemText("Say why, in at least 10 characters (it is shown wherever the rate is used).", taxReportsNb)).toBe(
      "Skriv hvorfor, med minst 10 tegn (det vises overalt der kursen brukes).",
    );
    expect(rateProblemText("Something nobody listed.", taxReportsNb)).toBe("Something nobody listed.");
  });
});
