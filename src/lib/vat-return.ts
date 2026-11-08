/**
 * The VAT return (B5 of `docs/own-books-and-sales.md`, D496): Norway's *mva-melding* computed from the store's own ledger. Pure: the
 * terms a book reports in and when each is due, the return's lines from VAT by code (`vatByCode()`) as Skatteetaten's form asks for them,
 * the same worked out from Tripletex's postings for the comparison, and the return as Skatteetaten's XML (`mvaMeldingDto`, schema
 * `skattemeldingformerverdiavgift` v1.0, github.com/Skatteetaten/mva-meldingen, read 8 November 2026).
 *
 * The form's rules, from Skatteetaten's examples: a sale (codes 3, 31, 32, 33) has its base, rate and VAT; a sale without VAT (5, 6, 51,
 * 52) its base at rate 0; a purchase (1, 11, 12, 13, 14, 15) only its VAT, negative (a deduction); a purchase with reverse charge (81 to
 * 92) its base, rate and VAT due, and, where it may be deducted, the same VAT again as a deduction. The VAT to pay (*fastsatt
 * merverdiavgift*) is the sum of the lines' VAT: positive to pay, negative to get back. Amounts are in kroner and øre.
 */
import { isVatAccount, type VatRow } from "./ledger";

// ---------------------------------------------------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------------------------------------------------

/** How long a book's VAT terms are: two months (the rule), or a year (a small business Skatteetaten has allowed to report yearly). */
export const VAT_TERM_SIZES = ["two_months", "year"] as const;
export type VatTermSize = (typeof VAT_TERM_SIZES)[number];

export const isVatTermSize = (v: unknown): v is VatTermSize => typeof v === "string" && (VAT_TERM_SIZES as readonly string[]).includes(v);

export type VatTerm = {
  size: VatTermSize;
  year: number;
  /** 1 to 6 for two months; 1 for the year. */
  term: number;
  from: string;
  to: string;
  /** Skatteetaten's name of the period: `januar-februar` … `november-desember`, or `aarlig`. */
  period: string;
  /** The last day to send the return and pay: the 10th of the second month after (31 August for May–June; 10 March for a year), a weekend moved to Monday. */
  due: string;
  /** `2026-6` or `2026-1`: the term in the address. */
  key: string;
};

const TWO_MONTH_NAMES = ["januar-februar", "mars-april", "mai-juni", "juli-august", "september-oktober", "november-desember"] as const;

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** A day moved past a weekend to the Monday after (Norway's public holidays are left to the owner: the form says so). */
function workingDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const weekday = d.getUTCDay();
  if (weekday === 6) d.setUTCDate(d.getUTCDate() + 2);
  if (weekday === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The term of a given size and number. */
export function vatTerm(size: VatTermSize, year: number, term: number): VatTerm {
  if (size === "year") {
    return { size, year, term: 1, from: `${year}-01-01`, to: `${year}-12-31`, period: "aarlig", due: workingDay(`${year + 1}-03-10`), key: `${year}-1` };
  }
  const first = term * 2 - 1;
  const due = term === 3 ? `${year}-08-31` : term === 6 ? `${year + 1}-02-10` : `${year}-${pad(first + 3)}-10`;
  return {
    size,
    year,
    term,
    from: `${year}-${pad(first)}-01`,
    to: `${year}-${pad(first + 1)}-${pad(lastDay(year, first + 1))}`,
    period: TWO_MONTH_NAMES[term - 1],
    due: workingDay(due),
    key: `${year}-${term}`,
  };
}

/** The term a day is in. */
export function vatTermOfDay(size: VatTermSize, day: string): VatTerm {
  const [year, month] = day.split("-").map(Number);
  return vatTerm(size, year, size === "year" ? 1 : Math.ceil(month / 2));
}

/** A term from its key (`2026-6`), or null when the key is no term of that size. */
export function vatTermOfKey(size: VatTermSize, key: unknown): VatTerm | null {
  const m = typeof key === "string" ? /^(\d{4})-(\d)$/.exec(key) : null;
  if (!m) return null;
  const year = Number(m[1]);
  const term = Number(m[2]);
  if (year < 2000 || year > 2100 || term < 1 || term > (size === "year" ? 1 : 6)) return null;
  return vatTerm(size, year, term);
}

/** The terms a book has reported in or reports in now, from the one it opened in to today's, the newest first. */
export function vatTermsOf(size: VatTermSize, openedOn: string, today: string): VatTerm[] {
  const terms: VatTerm[] = [];
  let t = vatTermOfDay(size, today < openedOn ? openedOn : today);
  const first = vatTermOfDay(size, openedOn);
  while (terms.length < 200) {
    terms.push(t);
    if (t.key === first.key) break;
    t = t.size === "year" ? vatTerm(t.size, t.year - 1, 1) : t.term === 1 ? vatTerm(t.size, t.year - 1, 6) : vatTerm(t.size, t.year, t.term - 1);
  }
  return terms;
}

// ---------------------------------------------------------------------------------------------------------------------
// The return's lines
// ---------------------------------------------------------------------------------------------------------------------

type CodeKind = "sale" | "sale_zero" | "purchase" | "reverse";

/** Each code the form takes: what it is and its rate in percent; `deductible` for a reverse charge whose VAT is deducted again. */
export const VAT_RETURN_CODES: Record<string, { kind: CodeKind; rate: number; deductible?: boolean }> = {
  "3": { kind: "sale", rate: 25 },
  "31": { kind: "sale", rate: 15 },
  "32": { kind: "sale", rate: 11.11 },
  "33": { kind: "sale", rate: 12 },
  "5": { kind: "sale_zero", rate: 0 },
  "6": { kind: "sale_zero", rate: 0 },
  "51": { kind: "sale_zero", rate: 0 },
  "52": { kind: "sale_zero", rate: 0 },
  "1": { kind: "purchase", rate: 25 },
  "11": { kind: "purchase", rate: 15 },
  "12": { kind: "purchase", rate: 11.11 },
  "13": { kind: "purchase", rate: 12 },
  "14": { kind: "purchase", rate: 25 },
  "15": { kind: "purchase", rate: 15 },
  "81": { kind: "reverse", rate: 25, deductible: true },
  "82": { kind: "reverse", rate: 25 },
  "83": { kind: "reverse", rate: 15, deductible: true },
  "84": { kind: "reverse", rate: 15 },
  "85": { kind: "reverse", rate: 0 },
  "86": { kind: "reverse", rate: 25, deductible: true },
  "87": { kind: "reverse", rate: 25 },
  "88": { kind: "reverse", rate: 12, deductible: true },
  "89": { kind: "reverse", rate: 12 },
  "91": { kind: "reverse", rate: 25, deductible: true },
  "92": { kind: "reverse", rate: 25 },
};

/** One line of the form: its code, its base and rate where the form asks for them, and its VAT (positive due, negative deducted). */
export type VatReturnLine = { code: string; side: "due" | "deducted"; base: number | null; rate: number | null; vat: number; spec?: "tapPåKrav" };

export type VatReturn = {
  lines: VatReturnLine[];
  /** The VAT to pay (positive) or to get back (negative): the lines' VAT summed. */
  total: number;
  /** Codes the ledger used that the form does not take (an entry by hand with code 0, say): left out, named. */
  unknown: string[];
};

/** The return from VAT by code (`vatByCode()`: sales and output VAT positive, purchases and input VAT negative). */
export function vatReturnOf(rows: readonly VatRow[]): VatReturn {
  const lines: VatReturnLine[] = [];
  const unknown: string[] = [];
  for (const r of [...rows].sort((a, b) => Number(a.code) - Number(b.code))) {
    const known = VAT_RETURN_CODES[r.code];
    if (!known) {
      if (r.base !== 0 || r.vat !== 0) unknown.push(r.code);
      continue;
    }
    if (known.kind === "sale" || known.kind === "sale_zero") {
      lines.push({ code: r.code, side: "due", base: r.base, rate: known.rate, vat: known.kind === "sale_zero" ? 0 : r.vat });
    } else if (known.kind === "purchase") {
      // A lost receivable's VAT taken back is a deduction on a line of its own (`tapPåKrav`, D500).
      if (r.vat !== 0) lines.push({ code: r.code, side: "deducted", base: null, rate: null, vat: r.vat, ...(r.spec ? { spec: r.spec } : {}) });
    } else {
      // A purchase is negative in the ledger: the form takes what was bought as the base, and the VAT due on it.
      const base = -r.base;
      const due = Math.round((base * known.rate) / 100);
      lines.push({ code: r.code, side: "due", base, rate: known.rate, vat: due });
      if (known.deductible && due !== 0) lines.push({ code: r.code, side: "deducted", base: null, rate: null, vat: -due });
    }
  }
  return { lines, total: lines.reduce((sum, l) => sum + l.vat, 0), unknown };
}

/**
 * VAT by code from Tripletex's postings for the comparison, by the ledger's own convention: each posting with a VAT code, its net as the
 * base and its gross less its net as the VAT, sales positive. Postings on the VAT accounts are left out: Tripletex makes them from the
 * others, so counting them again would count the VAT twice.
 */
export function theirVatRows(postings: readonly { account: number; vatCode: string | null; netMinor: number; grossMinor: number }[]): VatRow[] {
  const byCode = new Map<string, VatRow>();
  for (const p of postings) {
    if (!p.vatCode || p.vatCode === "0" || isVatAccount(p.account)) continue;
    const row = byCode.get(p.vatCode) ?? { code: p.vatCode, base: 0, vat: 0 };
    row.base -= p.netMinor;
    row.vat -= p.grossMinor - p.netMinor;
    byCode.set(p.vatCode, row);
  }
  return [...byCode.values()].filter((r) => r.base !== 0 || r.vat !== 0).sort((a, b) => Number(a.code) - Number(b.code));
}

export type VatDifference = { code: string; oursBase: number; theirsBase: number; oursVat: number; theirsVat: number };

/** Where our return and Tripletex's differ, code by code (base or VAT), and by how much in all. */
export function compareVatReturns(ours: readonly VatRow[], theirs: readonly VatRow[]): { differences: VatDifference[]; totalDifference: number } {
  const codes = [...new Set([...ours.map((r) => r.code), ...theirs.map((r) => r.code)])].sort((a, b) => Number(a) - Number(b));
  // A code's rows together (a lost receivable's deduction is a row of its own on the same code).
  const of = (rows: readonly VatRow[], code: string) =>
    rows.filter((r) => r.code === code).reduce((sum, r) => ({ code, base: sum.base + r.base, vat: sum.vat + r.vat }), { code, base: 0, vat: 0 });
  const differences = codes
    .map((code) => ({ code, oursBase: of(ours, code).base, theirsBase: of(theirs, code).base, oursVat: of(ours, code).vat, theirsVat: of(theirs, code).vat }))
    .filter((d) => d.oursBase !== d.theirsBase || d.oursVat !== d.theirsVat);
  return { differences, totalDifference: vatReturnOf(ours).total - vatReturnOf(theirs).total };
}

// ---------------------------------------------------------------------------------------------------------------------
// Skatteetaten's XML
// ---------------------------------------------------------------------------------------------------------------------

const xmlText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Kroner and øre as the form's decimal: `1250`, `1250.5` is written `1250.50`, a deduction `-312.50`. */
export function formAmount(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const kroner = Math.floor(abs / 100);
  const ore = abs % 100;
  return ore === 0 ? `${sign}${kroner}` : `${sign}${kroner}.${String(ore).padStart(2, "0")}`;
}

const rateText = (rate: number) => (Number.isInteger(rate) ? String(rate) : rate.toFixed(2));

/**
 * The return as Skatteetaten takes it (`mvaMeldingDto`): the system that made it and a reference of ours, the term, the VAT to pay and
 * each line, and the business by its organisation number. Sent through Altinn once the store's sign-in with Skatteetaten is set up; until
 * then it is the same figures the owner types into Skatteetaten's form, and a file the accountant can read.
 */
export function mvaMeldingXml(input: { organisationNumber: string; term: VatTerm; ret: VatReturn; reference: string; system: { name: string; version: string } }): string {
  const { term, ret } = input;
  const period = term.size === "year" ? `<skattleggingsperiodeAar>${term.period}</skattleggingsperiodeAar>` : `<skattleggingsperiodeToMaaneder>${term.period}</skattleggingsperiodeToMaaneder>`;
  const lines = ret.lines
    .map((l) =>
      [
        "    <mvaSpesifikasjonslinje>",
        `      <mvaKode>${l.code}</mvaKode>`,
        l.spec ? `      <spesifikasjon>${l.spec}</spesifikasjon>` : null,
        l.base !== null ? `      <grunnlag>${formAmount(l.base)}</grunnlag>` : null,
        l.rate !== null ? `      <sats>${rateText(l.rate)}</sats>` : null,
        `      <merverdiavgift>${formAmount(l.vat)}</merverdiavgift>`,
        "    </mvaSpesifikasjonslinje>",
      ]
        .filter((x): x is string => x !== null)
        .join("\n"),
    )
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<mvaMeldingDto xmlns="no:skatteetaten:fastsetting:avgift:mva:skattemeldingformerverdiavgift:v1.0">',
    "  <innsending>",
    `    <regnskapssystemsreferanse>${xmlText(input.reference)}</regnskapssystemsreferanse>`,
    "    <regnskapssystem>",
    `      <systemnavn>${xmlText(input.system.name)}</systemnavn>`,
    `      <systemversjon>${xmlText(input.system.version)}</systemversjon>`,
    "    </regnskapssystem>",
    "  </innsending>",
    "  <skattegrunnlagOgBeregnetSkatt>",
    "    <skattleggingsperiode>",
    `      <periode>${period}</periode>`,
    `      <aar>${term.year}</aar>`,
    "    </skattleggingsperiode>",
    `    <fastsattMerverdiavgift>${formAmount(ret.total)}</fastsattMerverdiavgift>`,
    lines,
    "  </skattegrunnlagOgBeregnetSkatt>",
    // Required, and empty: a KID for paying back what is owed is Skatteetaten's to give, not ours.
    "  <betalingsinformasjon/>",
    "  <skattepliktig>",
    `    <organisasjonsnummer>${xmlText(input.organisationNumber.replace(/\D/g, ""))}</organisasjonsnummer>`,
    "  </skattepliktig>",
    "  <meldingskategori>alminnelig</meldingskategori>",
    "</mvaMeldingDto>",
    "",
  ]
    .filter((x) => x !== "")
    .join("\n")
    .concat("\n");
}
