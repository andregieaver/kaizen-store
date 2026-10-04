/**
 * The OSS (Union and non-Union scheme, quarterly) and IOSS (monthly) return data (D161, `docs/wave-1c-reports.md` 4.5 and 4.6): the
 * parts of a return per Member State of consumption and rate, in euro. Pure: the groups of `commerce.tax_document_groups()` come in, and
 * the ECB rate of a day is asked for through a callback, so everything here is tested without a database or a network.
 *
 * NOTHING HERE IS LEGAL OR TAX ADVICE; every rule needs review by an accountant (section 8 of the spec). Kaizen files nothing: this is
 * the owner's own data, for the owner's accountant. Sources, read 2026-10-04 (European Commission, One Stop Shop Guidelines of 30 July
 * 2021; the revised guide of 1 January 2027 was NOT read):
 * - Part 2 of a return lists the supplies per Member State of consumption and rate: the taxable amount and the VAT, in euro. Annex 3: 2a
 *   services from the Member State of identification, 2b goods dispatched from it, 2d goods dispatched from another Member State.
 * - Q15: one currency, in general euro, at the ECB's rate of the last day of the tax period.
 * - Q11 and Q12: a correction (a credit note, a return of goods) of an earlier period is made in a subsequent return as a Part 3
 *   correction that carries the period corrected, the Member State of consumption and the VAT amount, within three years; Q13: Part 2
 *   cannot be negative, Part 3 can; Part 4 is the balance per Member State, Part 5 the total, and a negative balance is not set off
 *   against another Member State's (it is not counted in Part 5).
 * Not read, so marked verify: converting a correction at the rate of the period it corrects (done here so the corrected period's total
 * is what that period's return would have shown), netting a credit note of the same period even when the return was already filed.
 *
 * Two modes over the same groups: `filing` is what a return holds (a credit note of the same period reduces Part 2, a later one is a
 * Part 3 correction of its sale's period); `books` is the bookkeeping view (every credit note counts in the period it is issued, as
 * Finance counts a refund, so Part 2 can be negative and there is no Part 3).
 */
import { addYears } from "./analytics-period";
import { toEuroMinor } from "./ecb-history";
import { classOfGroup, type DocGroup } from "./tax-report";
import { reasonText, registrationNotes, type ClassFlag, type ClassReason, type PartCounts, type Place, type RegistrationFacts, type RegistrationNote, type ReturnPart } from "./tax-classes";
import { monthOfDay, quarterOfDay, type TaxPeriod } from "./tax-periods";

export type ReturnScheme = "oss" | "ioss";
export type ReturnMode = "books" | "filing";

/** What the conversion of a currency on a day used: the ECB's published rate, or an owner's own with its reason. */
export type RateChoice = { rate: string; date: string; source: "ecb" | "owner"; reason: string | null };
/** Asks for the rate of a currency on a day (the period's last day or a corrected period's); null when none is stored. */
export type RateLookup = (currency: string, day: string) => RateChoice | null;

export type ReturnInput = {
  scheme: ReturnScheme;
  period: TaxPeriod;
  mode: ReturnMode;
  /** The groups of `commerce.tax_document_groups(store, period.from, period.to)`. */
  groups: readonly DocGroup[];
  registration: RegistrationFacts;
  rateFor: RateLookup;
};

/** One conversion group: `(period, part, Member State, rate, currency)` summed in the document currency and converted once. */
export type ConversionGroup = {
  /** `2a`, `2b`, `2d`, `NU` or `IOSS` for Part 2, and the same for a correction (its `correctionPeriod` is set). */
  part: ReturnPart;
  memberState: string;
  /**
   * The Member State the goods were dispatched from (Directive Art. 369g(2): the return shows the totals per Member State of dispatch,
   * with the number that state allocated). Set for goods in Part 2 (2b: the Member State of identification; 2d: another one), null for
   * services, corrections (a Part 3 line has none) and IOSS.
   */
  dispatchState: string | null;
  rate: number;
  rateKind: "standard" | "reduced";
  currency: string;
  /** Net and VAT in the document currency; negative for a correction and for a credit note in books mode. */
  taxableMinor: number;
  vatMinor: number;
  invoices: number;
  creditNotes: number;
  /** The period a correction belongs to (a quarter or month key), null for Part 2. */
  correctionPeriod: string | null;
  /** The day whose rate was asked for: the last day of the period of the return or of the period corrected. */
  rateDay: string;
  /** Null for euro: no conversion. */
  conversion: RateChoice | null;
  taxableEur: number | null;
  vatEur: number | null;
  complete: boolean;
};

/** A Part 2 line of the return: per part, Member State and rate, in euro (the sum of its conversion groups over currencies). */
export type Part2Line = {
  part: ReturnPart;
  memberState: string;
  /** The Member State of dispatch of goods lines (2b, 2d), else null: see `ConversionGroup.dispatchState`. */
  dispatchState: string | null;
  rate: number;
  rateKind: "standard" | "reduced";
  taxableEur: number | null;
  vatEur: number | null;
  complete: boolean;
};

/** A Part 3 correction: the period corrected, the Member State and the VAT amount (negative for a credit), in euro. */
export type Part3Line = {
  correctionPeriod: string;
  memberState: string;
  vatEur: number | null;
  complete: boolean;
  /** The corrected period ended more than three years before this return's: a correction is then made with the Member State directly. */
  late: boolean;
};

/** Part 4: the balance per Member State (Part 2 plus Part 3); negative means the Member State reimburses it. */
export type BalanceLine = { memberState: string; part2VatEur: number | null; part3VatEur: number | null; balanceEur: number | null; complete: boolean; reimbursed: boolean };

/** What the return leaves out: by reason and currency, as amounts of invoices less every credit note of the window. */
export type NotIncluded = { reason: ClassReason; place: Place; text: string; currency: string; documentLines: number; taxableMinor: number; vatMinor: number };

/** One rate asked for: where it came from, or that it is missing. */
export type RateCard = { currency: string; day: string; for: "period" | "correction"; choice: RateChoice | null };

export type ReturnData = {
  scheme: ReturnScheme;
  period: TaxPeriod;
  mode: ReturnMode;
  /** `union`, `non_union`, `ioss` or `none`: the registration the profile records (the CSV's `registration`). */
  registration: "union" | "non_union" | "ioss" | "none";
  part2: Part2Line[];
  part3: Part3Line[];
  part4: BalanceLine[];
  /** Part 5: the sum of the positive balances; null when a figure behind one is missing. */
  part5Eur: number | null;
  groups: ConversionGroup[];
  notIncluded: NotIncluded[];
  rates: RateCard[];
  /** A conversion group has no rate: the euro figures are incomplete and the return data is refused as a file. */
  incomplete: boolean;
  missing: { currency: string; day: string }[];
  /** Document lines (a document with two rates is two) in the return, per part; for the notes below. */
  partCounts: PartCounts;
  /** Of the documents of every kind found in the period, whatever view is open (a registration that does not fit the sales). */
  foundCounts: PartCounts;
  flagCounts: Record<ClassFlag, number>;
  notes: RegistrationNote[];
  /** The totals the export log keeps: euro VAT and taxable amount of Part 2, and how many invoices and credit notes made them. */
  totals: { vatEur: number | null; taxableEur: number | null; documents: number; creditNotes: number };
};

const KINDS = { oss: ["union", "non_union"] as Place[], ioss: ["ioss"] as Place[] };

const periodOf = (scheme: ReturnScheme, day: string): TaxPeriod => (scheme === "oss" ? quarterOfDay(day) : monthOfDay(day));

export function registrationOf(scheme: ReturnScheme, profile: RegistrationFacts): ReturnData["registration"] {
  if (scheme === "ioss") return profile.iossNumber ? "ioss" : "none";
  return profile.ossScheme;
}

/** Whether the IOSS view is live, shows history, or is off with its reason (the row's criterion 4). */
export function iossState(iossNumber: string | null, hasIossSales: boolean): "on" | "history" | "off" {
  if (iossNumber) return "on";
  return hasIossSales ? "history" : "off";
}

export const IOSS_OFF_TEXT = "IOSS: off. Needs an IOSS number and the markets it applies to (Settings > Tax). Until then no order is marked IOSS and there is nothing to report.";

type Acc = {
  g: ConversionGroup;
};

/** Builds the return data of one period in one mode. */
export function buildReturn(input: ReturnInput): ReturnData {
  const { scheme, period, mode } = input;
  const places = KINDS[scheme];
  const groups = new Map<string, Acc>();
  const notIncluded = new Map<string, NotIncluded>();
  const partCounts: PartCounts = {};
  const foundCounts: PartCounts = {};
  const flagCounts: Record<ClassFlag, number> = { mixed_goods_download: 0, dispatch_assumed: 0, seller_assumed: 0 };
  let invoiceLines = 0;
  let creditLines = 0;

  for (const g of input.groups) {
    const cls = classOfGroup(g);
    if (cls.part) foundCounts[cls.part] = (foundCounts[cls.part] ?? 0) + g.documents;
    const invoice = g.docKind === "invoice";

    if (!places.includes(cls.place) || cls.part === null) {
      const key = `${cls.reason}|${g.currency}`;
      const n = notIncluded.get(key) ?? { reason: cls.reason, place: cls.place, text: reasonText(cls.reason), currency: g.currency, documentLines: 0, taxableMinor: 0, vatMinor: 0 };
      const sign = invoice ? 1 : -1;
      n.documentLines += g.documents;
      n.taxableMinor += sign * g.netMinor;
      n.vatMinor += sign * g.vatMinor;
      notIncluded.set(key, n);
      continue;
    }

    partCounts[cls.part] = (partCounts[cls.part] ?? 0) + g.documents;
    for (const f of cls.flags) flagCounts[f] += g.documents;

    // Where the line goes: Part 2 of this period, or (filing mode, a credit note of an earlier period) a Part 3 correction.
    let correction: TaxPeriod | null = null;
    if (!invoice && mode === "filing" && g.originalTaxDate !== null && g.originalTaxDate < period.from) correction = periodOf(scheme, g.originalTaxDate);
    const sign = invoice ? 1 : -1;
    const rateDay = (correction ?? period).lastDay;
    // Goods in Part 2 are totalled per Member State of dispatch as well (Art. 369g(2)): two dispatch states are two lines.
    const dispatchState = correction === null && (cls.part === "2b" || cls.part === "2d") ? (g.dispatchCountry ?? "").toUpperCase() || null : null;
    const key = [correction?.key ?? "", cls.part, g.marketCode, dispatchState ?? "", g.rate, g.currency].join("|");
    let acc = groups.get(key);
    if (!acc) {
      acc = {
        g: {
          part: cls.part,
          memberState: g.marketCode,
          dispatchState,
          rate: g.rate,
          rateKind: g.standardRate !== null && Math.abs(g.rate - g.standardRate) < 1e-9 ? "standard" : "reduced",
          currency: g.currency,
          taxableMinor: 0,
          vatMinor: 0,
          invoices: 0,
          creditNotes: 0,
          correctionPeriod: correction?.key ?? null,
          rateDay,
          conversion: null,
          taxableEur: null,
          vatEur: null,
          complete: true,
        },
      };
      groups.set(key, acc);
    }
    if (g.standardRate !== null && Math.abs(g.rate - g.standardRate) < 1e-9) acc.g.rateKind = "standard";
    acc.g.taxableMinor += sign * g.netMinor;
    acc.g.vatMinor += sign * g.vatMinor;
    if (invoice) {
      acc.g.invoices += g.documents;
      invoiceLines += g.documents;
    } else {
      acc.g.creditNotes += g.documents;
      creditLines += g.documents;
    }
  }

  // Conversion: once per group, at the rate of its period's (or its corrected period's) last day; euro is not converted.
  const asked = new Map<string, RateCard>();
  const missing = new Map<string, { currency: string; day: string }>();
  for (const { g } of groups.values()) {
    if (g.currency === "EUR") {
      g.taxableEur = g.taxableMinor;
      g.vatEur = g.vatMinor;
      continue;
    }
    const key = `${g.currency}|${g.rateDay}`;
    let card = asked.get(key);
    if (!card) {
      card = { currency: g.currency, day: g.rateDay, for: g.correctionPeriod ? "correction" : "period", choice: input.rateFor(g.currency, g.rateDay) };
      asked.set(key, card);
    } else if (card.for === "correction" && !g.correctionPeriod) card.for = "period";
    if (!card.choice) {
      g.complete = false;
      missing.set(key, { currency: g.currency, day: g.rateDay });
      continue;
    }
    g.conversion = card.choice;
    g.taxableEur = toEuroMinor(g.taxableMinor, card.choice.rate);
    g.vatEur = toEuroMinor(g.vatMinor, card.choice.rate);
  }

  const list = [...groups.values()].map((a) => a.g).sort(compareGroups);

  // Part 2: per part, Member State and rate (the sum of the conversion groups over currencies).
  const part2 = new Map<string, Part2Line>();
  const part3 = new Map<string, Part3Line>();
  for (const g of list) {
    if (g.correctionPeriod === null) {
      const key = `${g.part}|${g.memberState}|${g.dispatchState ?? ""}|${g.rate}`;
      const line = part2.get(key) ?? { part: g.part, memberState: g.memberState, dispatchState: g.dispatchState, rate: g.rate, rateKind: g.rateKind, taxableEur: 0, vatEur: 0, complete: true };
      if (g.rateKind === "standard") line.rateKind = "standard";
      if (!g.complete || g.taxableEur === null || g.vatEur === null) {
        line.complete = false;
        line.taxableEur = null;
        line.vatEur = null;
      } else if (line.complete) {
        line.taxableEur = (line.taxableEur ?? 0) + g.taxableEur;
        line.vatEur = (line.vatEur ?? 0) + g.vatEur;
      }
      part2.set(key, line);
    } else {
      const key = `${g.correctionPeriod}|${g.memberState}`;
      const corrected = periodOf(scheme, g.rateDay);
      const line = part3.get(key) ?? { correctionPeriod: g.correctionPeriod, memberState: g.memberState, vatEur: 0, complete: true, late: addYears(corrected.lastDay, 3) < period.lastDay };
      if (!g.complete || g.vatEur === null) {
        line.complete = false;
        line.vatEur = null;
      } else if (line.complete) {
        line.vatEur = (line.vatEur ?? 0) + g.vatEur;
      }
      part3.set(key, line);
    }
  }
  const part2Lines = [...part2.values()].sort((a, b) => a.part.localeCompare(b.part) || a.memberState.localeCompare(b.memberState) || (a.dispatchState ?? "").localeCompare(b.dispatchState ?? "") || b.rate - a.rate);
  const part3Lines = [...part3.values()].sort((a, b) => a.correctionPeriod.localeCompare(b.correctionPeriod) || a.memberState.localeCompare(b.memberState));

  // Part 4: the balance per Member State; Part 5: the sum of the positive balances (a negative one is never set off against another).
  const balances = new Map<string, BalanceLine>();
  const balance = (ms: string) => balances.get(ms) ?? { memberState: ms, part2VatEur: 0, part3VatEur: 0, balanceEur: 0, complete: true, reimbursed: false };
  for (const l of part2Lines) {
    const b = balance(l.memberState);
    if (!l.complete) b.complete = false;
    else b.part2VatEur = (b.part2VatEur ?? 0) + (l.vatEur ?? 0);
    balances.set(l.memberState, b);
  }
  for (const l of part3Lines) {
    const b = balance(l.memberState);
    if (!l.complete) b.complete = false;
    else b.part3VatEur = (b.part3VatEur ?? 0) + (l.vatEur ?? 0);
    balances.set(l.memberState, b);
  }
  const part4: BalanceLine[] = [...balances.values()]
    .map((b) => {
      if (!b.complete) return { ...b, part2VatEur: null, part3VatEur: null, balanceEur: null, reimbursed: false };
      const total = (b.part2VatEur ?? 0) + (b.part3VatEur ?? 0);
      return { ...b, balanceEur: total, reimbursed: total < 0 };
    })
    .sort((a, b) => a.memberState.localeCompare(b.memberState));
  const incomplete = missing.size > 0;
  const part5Eur = part4.some((b) => b.balanceEur === null) ? null : part4.reduce((s, b) => s + Math.max(b.balanceEur ?? 0, 0), 0);

  const part2Known = part2Lines.every((l) => l.complete);
  const totals = {
    vatEur: part2Known ? part2Lines.reduce((s, l) => s + (l.vatEur ?? 0), 0) : null,
    taxableEur: part2Known ? part2Lines.reduce((s, l) => s + (l.taxableEur ?? 0), 0) : null,
    documents: invoiceLines,
    creditNotes: creditLines,
  };

  const rates = [...asked.values()].sort((a, b) => a.currency.localeCompare(b.currency) || a.day.localeCompare(b.day));
  const notes = registrationNotes(input.registration, foundCounts);

  return {
    scheme,
    period,
    mode,
    registration: registrationOf(scheme, input.registration),
    part2: part2Lines,
    part3: part3Lines,
    part4,
    part5Eur,
    groups: list,
    notIncluded: [...notIncluded.values()].sort((a, b) => a.reason.localeCompare(b.reason) || a.currency.localeCompare(b.currency)),
    rates,
    incomplete,
    missing: [...missing.values()].sort((a, b) => a.currency.localeCompare(b.currency) || a.day.localeCompare(b.day)),
    partCounts,
    foundCounts,
    flagCounts,
    notes,
    totals,
  };
}

function compareGroups(a: ConversionGroup, b: ConversionGroup): number {
  return (
    (a.correctionPeriod ?? "").localeCompare(b.correctionPeriod ?? "") ||
    a.part.localeCompare(b.part) ||
    a.memberState.localeCompare(b.memberState) ||
    (a.dispatchState ?? "").localeCompare(b.dispatchState ?? "") ||
    b.rate - a.rate ||
    a.currency.localeCompare(b.currency)
  );
}
