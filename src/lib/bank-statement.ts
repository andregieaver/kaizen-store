import { parseCsv, recordsOf } from "./csv";
import { minorUnitDigits } from "./money";
import { at, descendants, kids, parseXml, textAt, type XmlElement } from "./xml-read";

/**
 * A bank's statement, read from the file the owner uploads (B4 of `docs/own-books-and-sales.md`, route 1, D486): ISO 20022 camt.053, which
 * banks in Norway and the EU export for accounting systems, or the CSV a netbank exports (DNB, SpareBank 1, Nordea and the like, whose
 * columns are found by their names). Pure: the file's bytes in, its lines out, or why it cannot be read. Each line is the money as the
 * bank booked it on the account (in positive, out negative, in minor units) with its day, its words and, where the bank gives them, its
 * reference (a KID or the payer's reference) and the other party's name. A line's key is what the bank calls it, else made from what the
 * line says and how many identical lines came before it in the file, so the same file read twice gives the same keys.
 */

export type BankLine = {
  key: string;
  bookedOn: string;
  amountMinor: number;
  currency: string;
  text: string;
  reference: string | null;
  counterparty: string | null;
};

export type BankStatement = {
  format: "camt053" | "csv";
  /** The account as the file names it (an IBAN or account number), when it does. */
  account: string | null;
  currency: string;
  fromDay: string;
  toDay: string;
  /** What the bank says the account held as the period began and ended (camt.053's OPBD and CLBD), when it says. */
  openingMinor: number | null;
  closingMinor: number | null;
  lines: BankLine[];
};

export type StatementProblem = "unreadable" | "format" | "currency" | "empty" | "mixed";

const clip = (text: string | undefined | null, max: number) => (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** An amount the bank writes (`1234.56`, `1 234,56`, `-1.234,56`, `1234`) in minor units of its currency, or null. */
export function bankAmount(text: string, currency: string): number | null {
  let t = text.replace(/[\s  ']/g, "").replace(/^\+/, "");
  if (!/^-?[\d.,]+$/.test(t)) return null;
  const negative = t.startsWith("-");
  if (negative) t = t.slice(1);
  const comma = t.lastIndexOf(",");
  const dot = t.lastIndexOf(".");
  // The last mark is the decimal one when both are there; a lone one is decimal when two digits or fewer follow it, and a thousands mark
  // when three do (`1.000` and `1,000` are a thousand: a bank writes its amounts in whole øre or cents, never to three places).
  const mark = comma > dot ? "," : dot > comma ? "." : null;
  let whole = t;
  let fraction = "";
  if (mark) {
    const i = t.lastIndexOf(mark);
    const after = t.slice(i + 1);
    const other = mark === "," ? "." : ",";
    if (t.includes(other) || after.length <= 2) {
      whole = t.slice(0, i);
      fraction = after;
    }
  }
  // What is left of the whole part may only group thousands: every group after the first of three digits (`1.234.567`, `1 234`).
  const groups = whole.split(/[.,]/);
  if (groups.slice(1).some((g) => g.length !== 3) || (groups.length > 1 && (groups[0].length === 0 || groups[0].length > 3))) return null;
  whole = groups.join("");
  if (!/^\d+$/.test(whole || "0") || !/^\d*$/.test(fraction)) return null;
  let digits: number;
  try {
    digits = minorUnitDigits(currency);
  } catch {
    return null;
  }
  if (fraction.length > digits) return null;
  const minor = Number(`${whole || "0"}${fraction.padEnd(digits, "0")}`);
  if (!Number.isSafeInteger(minor)) return null;
  return negative ? -minor : minor;
}

/** A day the bank writes (`2027-01-31`, `31.01.2027`, `31/01/2027`, `31.01.27`, a camt.053 time) as `YYYY-MM-DD`, or null. */
export function bankDay(text: string): string | null {
  const t = text.trim();
  let y: number;
  let m: number;
  let d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(t);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})$/.exec(t))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (match[3].length === 2) y += 2000;
  } else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** Keys for lines the bank gave no reference of its own: what the line says, and how many identical lines came before it. */
function keyed(lines: Omit<BankLine, "key">[], own: (string | null)[]): BankLine[] {
  const seen = new Map<string, number>();
  return lines.map((line, i) => {
    if (own[i]) return { ...line, key: `ref:${own[i]}`.slice(0, 200) };
    const base = `${line.bookedOn}|${line.amountMinor}|${line.text}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...line, key: `line:${base}|${n}`.slice(0, 200) };
  });
}

function period(lines: readonly { bookedOn: string }[]): { fromDay: string; toDay: string } {
  const days = lines.map((l) => l.bookedOn).sort();
  return { fromDay: days[0], toDay: days[days.length - 1] };
}

/** camt.053: each statement's booked entries (a pending one is not money yet), its account, and its opening and closing balances. */
function readCamt053(root: XmlElement): { ok: true; statement: BankStatement } | { ok: false; problem: StatementProblem } {
  const statements = descendants(root, "Stmt");
  if (statements.length === 0) return { ok: false, problem: "format" };
  const lines: Omit<BankLine, "key">[] = [];
  const own: (string | null)[] = [];
  let account: string | null = null;
  let currency: string | null = null;
  let openingMinor: number | null = null;
  let closingMinor: number | null = null;
  let from: string | null = null;
  let to: string | null = null;
  for (const stmt of statements) {
    const id = textAt(stmt, "Acct", "Id", "IBAN") ?? textAt(stmt, "Acct", "Id", "Othr", "Id") ?? null;
    if (account && id && id !== account) return { ok: false, problem: "mixed" };
    account = account ?? id;
    const ccy = textAt(stmt, "Acct", "Ccy") ?? kids(stmt, "Ntry").map((e) => at(e, "Amt")?.attributes.Ccy).find(Boolean) ?? null;
    if (ccy && currency && ccy !== currency) return { ok: false, problem: "mixed" };
    currency = currency ?? ccy;
    if (!currency) return { ok: false, problem: "currency" };
    for (const bal of kids(stmt, "Bal")) {
      const kind = textAt(bal, "Tp", "CdOrPrtry", "Cd");
      const amount = bankAmount(textAt(bal, "Amt") ?? "", currency);
      if (amount === null) continue;
      const signed = textAt(bal, "CdtDbtInd") === "DBIT" ? -amount : amount;
      const day = bankDay(textAt(bal, "Dt", "Dt") ?? textAt(bal, "Dt", "DtTm") ?? "");
      if (kind === "OPBD" && openingMinor === null) {
        openingMinor = signed;
        from = from ?? day;
      }
      if (kind === "CLBD") {
        closingMinor = signed;
        to = day ?? to;
      }
    }
    for (const entry of kids(stmt, "Ntry")) {
      const status = textAt(entry, "Sts", "Cd") ?? textAt(entry, "Sts");
      if (status && status !== "BOOK") continue;
      const amount = bankAmount(textAt(entry, "Amt") ?? "", currency);
      const day = bankDay(textAt(entry, "BookgDt", "Dt") ?? textAt(entry, "BookgDt", "DtTm") ?? textAt(entry, "ValDt", "Dt") ?? "");
      const entryCcy = at(entry, "Amt")?.attributes.Ccy;
      if (amount === null || amount === 0 || !day || (entryCcy && entryCcy !== currency)) return { ok: false, problem: "unreadable" };
      const credit = textAt(entry, "CdtDbtInd") === "CRDT";
      const tx = descendants(entry, "TxDtls");
      const first = tx[0];
      const words = [
        ...tx.flatMap((t) => kids(at(t, "RmtInf"), "Ustrd").map((u) => u.text.trim())),
        textAt(first, "AddtlTxInf"),
        textAt(entry, "AddtlNtryInf"),
      ].filter((w): w is string => Boolean(w));
      const reference = textAt(first, "RmtInf", "Strd", "CdtrRefInf", "Ref") ?? textAt(first, "Refs", "EndToEndId") ?? null;
      const party = credit
        ? (textAt(first, "RltdPties", "Dbtr", "Nm") ?? textAt(first, "RltdPties", "Dbtr", "Pty", "Nm"))
        : (textAt(first, "RltdPties", "Cdtr", "Nm") ?? textAt(first, "RltdPties", "Cdtr", "Pty", "Nm"));
      lines.push({
        bookedOn: day,
        amountMinor: credit ? amount : -amount,
        currency,
        text: clip([...new Set(words)].join(" · "), 500),
        reference: reference && reference !== "NOTPROVIDED" ? clip(reference, 140) : null,
        counterparty: party ? clip(party, 140) : null,
      });
      own.push(textAt(entry, "AcctSvcrRef") ?? textAt(entry, "NtryRef") ?? null);
    }
  }
  if (lines.length === 0 || !currency) return { ok: false, problem: "empty" };
  const days = period(lines);
  return {
    ok: true,
    statement: {
      format: "camt053",
      account,
      currency,
      fromDay: from && from < days.fromDay ? from : days.fromDay,
      toDay: to && to > days.toDay ? to : days.toDay,
      openingMinor,
      closingMinor,
      lines: keyed(lines, own),
    },
  };
}

/** The header names a netbank's CSV uses, lower case: the first column found of each is read. */
const CSV_COLUMNS = {
  day: ["bokført dato", "bokføringsdato", "bokført", "dato", "transaksjonsdato", "utført dato", "booking date", "date"],
  text: ["forklaring", "beskrivelse", "tekst", "tittel", "melding/kid/fakturanr", "melding", "description", "text"],
  amount: ["beløp", "beløp nok", "amount", "sum"],
  in: ["inn på konto", "inn", "innskudd", "credit"],
  out: ["ut fra konto", "ut", "uttak", "debit"],
  reference: ["kid", "referanse", "arkivreferanse", "arkivref", "reference"],
  party: ["navn", "motpart", "avsender", "mottaker", "name"],
  currency: ["valuta", "currency"],
} as const;

/** A netbank's CSV: its columns found by their names, an amount in one column or in and out apart, in the books' currency unless it says. */
function readBankCsv(bytes: Uint8Array, bookCurrency: string): { ok: true; statement: BankStatement } | { ok: false; problem: StatementProblem } {
  const parsed = parseCsv(bytes);
  if (parsed.unterminated) return { ok: false, problem: "unreadable" };
  const { header, records } = recordsOf(parsed.rows);
  const names = header.map((h) => h.toLowerCase().replace(/\s+/g, " ").trim());
  const find = (options: readonly string[]) => {
    for (const option of options) {
      const i = names.indexOf(option);
      if (i !== -1) return header[i];
    }
    return null;
  };
  const day = find(CSV_COLUMNS.day);
  const text = find(CSV_COLUMNS.text);
  const amount = find(CSV_COLUMNS.amount);
  const inCol = find(CSV_COLUMNS.in);
  const outCol = find(CSV_COLUMNS.out);
  if (!day || (!amount && !(inCol && outCol))) return { ok: false, problem: "format" };
  const reference = find(CSV_COLUMNS.reference);
  const party = find(CSV_COLUMNS.party);
  const currencyCol = find(CSV_COLUMNS.currency);
  const lines: Omit<BankLine, "key">[] = [];
  for (const record of records) {
    if (Object.values(record).every((v) => v.trim() === "")) continue;
    const currency = (currencyCol && record[currencyCol]?.trim().toUpperCase()) || bookCurrency;
    if (currency !== bookCurrency && lines.length > 0 && lines[0].currency !== currency) return { ok: false, problem: "mixed" };
    const bookedOn = bankDay(record[day] ?? "");
    let minor: number | null;
    if (amount) minor = bankAmount(record[amount] ?? "", currency);
    else {
      const got = (record[inCol!] ?? "").trim() ? bankAmount(record[inCol!], currency) : 0;
      const paid = (record[outCol!] ?? "").trim() ? bankAmount(record[outCol!], currency) : 0;
      minor = got === null || paid === null ? null : Math.abs(got) - Math.abs(paid);
    }
    if (!bookedOn || minor === null) return { ok: false, problem: "unreadable" };
    if (minor === 0) continue;
    lines.push({
      bookedOn,
      amountMinor: minor,
      currency,
      text: clip(text ? record[text] : "", 500),
      reference: reference && record[reference]?.trim() ? clip(record[reference], 140) : null,
      counterparty: party && record[party]?.trim() ? clip(record[party], 140) : null,
    });
  }
  if (lines.length === 0) return { ok: false, problem: "empty" };
  return {
    ok: true,
    statement: { format: "csv", account: null, currency: lines[0].currency, ...period(lines), openingMinor: null, closingMinor: null, lines: keyed(lines, lines.map(() => null)) },
  };
}

/**
 * The statement in a file: camt.053 when it is XML, else a netbank's CSV. A CSV that says no currency is in the books' currency. A file
 * that is neither, or whose lines cannot all be read, is refused as a whole, so a statement is never read in part.
 */
export function readStatement(bytes: Uint8Array, bookCurrency: string): { ok: true; statement: BankStatement } | { ok: false; problem: StatementProblem } {
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 512)).replace(/^﻿/, "").trimStart();
  if (head.startsWith("<")) {
    let root: XmlElement;
    try {
      root = parseXml(new TextDecoder("utf-8").decode(bytes));
    } catch {
      return { ok: false, problem: "unreadable" };
    }
    return readCamt053(root);
  }
  return readBankCsv(bytes, bookCurrency);
}

/** A line of the books on the bank's account: its entry, day and amount (debit, money in, positive). */
export type BookBankLine = { entryId: string; day: string; amountMinor: number };

/** How many days a bank line's day and its entry's may lie apart: a payout booked by the bank a few days after its arrival day. */
export const MATCH_DAYS = 4;

const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);

/**
 * Bank lines matched to the books' lines on the bank's account, one to one: the same amount to the øre, the days at most `MATCH_DAYS`
 * apart, the nearest day first and, between equals, the earliest. What is left on either side is what the owner looks at: money in the
 * bank the books do not have, and the books' money the bank has not shown.
 */
export function matchBankLines(bank: readonly { id: string; day: string; amountMinor: number }[], books: readonly BookBankLine[]): { bankId: string; entryId: string }[] {
  const candidates: { bankId: string; entryId: string; gap: number; bankDay: number; bookDay: number }[] = [];
  for (const b of bank) {
    for (const l of books) {
      if (l.amountMinor !== b.amountMinor) continue;
      const gap = Math.abs(dayNumber(l.day) - dayNumber(b.day));
      if (gap <= MATCH_DAYS) candidates.push({ bankId: b.id, entryId: l.entryId, gap, bankDay: dayNumber(b.day), bookDay: dayNumber(l.day) });
    }
  }
  candidates.sort((a, z) => a.gap - z.gap || a.bankDay - z.bankDay || a.bookDay - z.bookDay || a.bankId.localeCompare(z.bankId) || a.entryId.localeCompare(z.entryId));
  const usedBank = new Set<string>();
  const usedBook = new Set<string>();
  const pairs: { bankId: string; entryId: string }[] = [];
  for (const c of candidates) {
    if (usedBank.has(c.bankId) || usedBook.has(c.entryId)) continue;
    usedBank.add(c.bankId);
    usedBook.add(c.entryId);
    pairs.push({ bankId: c.bankId, entryId: c.entryId });
  }
  return pairs;
}
