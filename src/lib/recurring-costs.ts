import { isPurchaseKind, isPurchaseVatRate, PURCHASE_KINDS, type PurchaseKind, type PurchaseVatRate } from "./purchases";

/**
 * Subscriptions (D503, step 2 of the owner's ask of 8 November 2026): what a business pays again and again, licences and services such as
 * Claude, Vercel or Supabase, kept as a register. Each says what it is, the words its charge carries in the bank's statement, what it was (a
 * purchase's kind), its VAT (or bought abroad, D502), whether it comes every month or every year, and about what it costs in the books'
 * currency. Pure: a bank line is known as a subscription's charge by its words; the register says what a month costs; a charge that has not
 * come when it should have is said; and charges that come back each month in the statement, not yet in the register, are offered to add.
 */

export const RECURRING_EVERY = ["month", "year"] as const;
export type RecurringEvery = (typeof RECURRING_EVERY)[number];

export type RecurringCost = {
  id: string;
  name: string;
  matchText: string;
  kind: PurchaseKind;
  vatRate: PurchaseVatRate;
  abroad: boolean;
  every: RecurringEvery;
  amountMinor: number;
  startedOn: string;
  endedOn: string | null;
};

export type RecurringLine = { id: string; day: string; amountMinor: number; text: string; counterparty: string | null; reference: string | null };

/** Days of grace after a charge was due before it is said to be late. */
export const LATE_AFTER_DAYS = 7;

/** Words as they are compared: no case, anything that is not a letter or a digit a space. */
export const plainWords = (text: string): string =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const lineWords = (line: RecurringLine): string => plainWords([line.counterparty, line.text, line.reference].filter(Boolean).join(" "));

/** Whether a bank line is the subscription's charge: money out, on a day it ran, carrying its words as whole words. */
export function isChargeOf(line: RecurringLine, cost: RecurringCost): boolean {
  if (line.amountMinor >= 0) return false;
  if (line.day < cost.startedOn || (cost.endedOn !== null && line.day > cost.endedOn)) return false;
  const words = plainWords(cost.matchText);
  return words.length >= 3 && ` ${lineWords(line)} `.includes(` ${words} `);
}

/** The subscription a line most likely is: of those whose words it carries, the one whose usual amount is nearest what was paid. */
export function chargeOf(line: RecurringLine, costs: readonly RecurringCost[]): RecurringCost | null {
  const paid = -line.amountMinor;
  const found = costs.filter((c) => isChargeOf(line, c));
  if (found.length === 0) return null;
  return found.reduce((best, c) => (Math.abs(c.amountMinor - paid) < Math.abs(best.amountMinor - paid) ? c : best));
}

/** What a subscription costs a month in the books' currency: a year's a twelfth, rounded. */
export const monthlyMinor = (cost: Pick<RecurringCost, "every" | "amountMinor">): number => (cost.every === "month" ? cost.amountMinor : Math.round(cost.amountMinor / 12));

/** A day moved by whole months or years, the day of the month kept where the month has it (31 January and a month is 28 or 29 February). */
export function addPeriod(day: string, every: RecurringEvery, count = 1): string {
  const [y, m, d] = day.split("-").map(Number);
  const months = every === "month" ? count : count * 12;
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export type RecurringRow = { cost: RecurringCost; running: boolean; lastDay: string | null; lastMinor: number | null; nextDay: string | null; late: boolean };

/**
 * The register as it stands on a day: each subscription with its last charge in the statements, when the next is due and whether one is
 * late (running, and no charge within a period and a week of grace, counted from its last charge or its start); and what those running cost
 * a month together. Lines are every line of the statements, matched in the books or not.
 */
export function recurringState(costs: readonly RecurringCost[], lines: readonly RecurringLine[], today: string): { rows: RecurringRow[]; monthlyMinor: number } {
  const rows = costs.map((cost) => {
    const running = cost.startedOn <= today && (cost.endedOn === null || cost.endedOn >= today);
    const charges = lines.filter((l) => chargeOf(l, costs) === cost).sort((a, b) => a.day.localeCompare(b.day));
    const last = charges.at(-1) ?? null;
    const from = last?.day ?? cost.startedOn;
    const nextDay = running ? addPeriod(from, cost.every) : null;
    const late = running && nextDay !== null && addDays(nextDay, LATE_AFTER_DAYS) < today;
    return { cost, running, lastDay: last?.day ?? null, lastMinor: last ? -last.amountMinor : null, nextDay, late };
  });
  const order = (r: RecurringRow) => (r.running ? 0 : 1);
  rows.sort((a, b) => order(a) - order(b) || a.cost.name.localeCompare(b.cost.name));
  return { rows, monthlyMinor: rows.filter((r) => r.running).reduce((sum, r) => sum + monthlyMinor(r.cost), 0) };
}

/** Words a bank puts on any card charge, and so never a subscription's own. */
const BANK_WORDS = new Set([
  "varekjøp",
  "varekjop",
  "visa",
  "mastercard",
  "kortkjøp",
  "kortkjop",
  "kurs",
  "dato",
  "reservert",
  "transaksjon",
  "betaling",
  "nettgiro",
  "giro",
  "avtalegiro",
  "efaktura",
  "overføring",
  "overforing",
  "innland",
  "utland",
  "kontoregulering",
  "mobil",
  "mobilbank",
  "nok",
  "usd",
  "eur",
  "sek",
  "dkk",
  "gbp",
  "www",
  "com",
  "inc",
  "ltd",
  "as",
  "ab",
  "pbc",
]);

/** A line's words as a charge's own: its words without digits, the bank's words and single letters, the first three left. */
export function chargeWords(line: RecurringLine): string {
  return lineWords(line)
    .split(" ")
    .filter((w) => w.length > 1 && !/\d/.test(w) && !BANK_WORDS.has(w))
    .slice(0, 3)
    .join(" ");
}

export type LikelySubscription = { matchText: string; name: string; amountMinor: number; firstDay: string; lastDay: string; count: number };

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

/**
 * Charges that come back each month in the statements and are not in the register yet, offered as subscriptions to add: the same words
 * (`chargeWords()`) in three months or more, once a month or about (never more than one charge a month on average and a spare), each within
 * a quarter of their usual amount, and the last within six weeks of the day. A transfer made many times a month is not one.
 */
export function likelySubscriptions(lines: readonly RecurringLine[], costs: readonly RecurringCost[], today: string): LikelySubscription[] {
  const groups = new Map<string, RecurringLine[]>();
  for (const l of lines) {
    if (l.amountMinor >= 0 || chargeOf(l, costs)) continue;
    const words = chargeWords(l);
    if (words.length < 3) continue;
    groups.set(words, [...(groups.get(words) ?? []), l]);
  }
  const found: LikelySubscription[] = [];
  for (const [words, group] of groups) {
    const months = new Set(group.map((l) => l.day.slice(0, 7)));
    if (months.size < 3 || group.length > months.size + 1) continue;
    const amounts = group.map((l) => -l.amountMinor);
    const usual = median(amounts);
    if (amounts.some((a) => Math.abs(a - usual) > usual / 4)) continue;
    const days = group.map((l) => l.day).sort();
    if (addDays(days.at(-1)!, 42) < today) continue;
    const name = words.replace(/\p{L}+/gu, (w) => w[0].toUpperCase() + w.slice(1));
    found.push({ matchText: words, name, amountMinor: usual, firstDay: days[0], lastDay: days.at(-1)!, count: group.length });
  }
  return found.sort((a, b) => b.amountMinor - a.amountMinor || a.name.localeCompare(b.name));
}

export type RecurringInput = {
  name: string;
  matchText: string;
  kind: PurchaseKind;
  vatRate: PurchaseVatRate;
  abroad: boolean;
  every: RecurringEvery;
  amountMinor: number;
  startedOn: string;
};

export type RecurringProblem = "name" | "words" | "kind" | "vat" | "every" | "amount" | "day";

/**
 * A subscription as the form sent it: a name, the words its charge carries (three letters or more once plain), what it was, its VAT (the
 * kind's usual, a rate, or bought abroad), every month or year, about what it costs (more than nought, in the books' currency) and from when.
 */
export function recurringInputOf(
  raw: { name: unknown; matchText: unknown; kind: unknown; vat: unknown; every: unknown; amount: unknown; startedOn: unknown },
  currency: string,
  parse: (text: string, currency: string) => number | null,
): { ok: true; input: RecurringInput } | { ok: false; problems: RecurringProblem[] } {
  const problems: RecurringProblem[] = [];
  const name = String(raw.name ?? "").trim();
  if (name.length < 1 || name.length > 80) problems.push("name");
  const matchText = String(raw.matchText ?? "").trim();
  if (plainWords(matchText).length < 3 || matchText.length > 60) problems.push("words");
  const kind = raw.kind;
  if (!isPurchaseKind(kind)) problems.push("kind");
  const vat = String(raw.vat ?? "");
  const abroad = vat === "abroad";
  const vatRate = abroad ? 0 : vat === "usual" && isPurchaseKind(kind) ? PURCHASE_KINDS[kind].vat : isPurchaseVatRate(vat) ? (Number(vat) as PurchaseVatRate) : null;
  if (vatRate === null) problems.push("vat");
  const every = raw.every;
  if (!(RECURRING_EVERY as readonly unknown[]).includes(every)) problems.push("every");
  const amountMinor = parse(String(raw.amount ?? "").trim(), currency);
  if (amountMinor === null || amountMinor <= 0) problems.push("amount");
  const startedOn = String(raw.startedOn ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startedOn) || Number.isNaN(Date.parse(`${startedOn}T00:00:00Z`))) problems.push("day");
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, input: { name, matchText, kind: kind as PurchaseKind, vatRate: vatRate!, abroad, every: every as RecurringEvery, amountMinor: amountMinor!, startedOn } };
}
