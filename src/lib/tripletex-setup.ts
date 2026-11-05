import { BOOKING_KEYS, DEFAULT_BOOKING, DEFAULT_RECEIVABLE, type BookingKey, type TripletexSettings } from "./tripletex-settings";

/**
 * Tripletex (D453): setting a connection up without asking an owner about accounts. `planSetup()` reads the company's own
 * chart of accounts and VAT codes, takes Norway's standard choice where the company has it and it fits, the nearest fitting
 * account where it does not, and asks a person only what it cannot choose (a question with the accounts that would do).
 * `checkSettings()` holds any settings, chosen here or by hand, to the same rules, so a voucher Tripletex would refuse is
 * caught on the settings page, not in the sync. Pure: the server reads the chart and passes it in.
 */

/** An account as Tripletex describes it (`GET /ledger/account`), only what is checked. */
export type ChartAccount = {
  id: number;
  number: number;
  name: string;
  isInactive?: boolean;
  /** `GENERAL`, `CUSTOMER`, `VENDOR`, `EMPLOYEE` or `ASSET`. */
  ledgerType?: string | null;
  vatLocked?: boolean;
  vatType?: { id: number } | null;
  legalVatTypes?: { id: number }[] | null;
  requiresDepartment?: boolean;
  requiresProject?: boolean;
  requiresFreeDimension1?: boolean;
  requiresFreeDimension2?: boolean;
  requiresFreeDimension3?: boolean;
};

/** A VAT code (`GET /ledger/vatType`). `number` is the code people use: `3`, `31`, `5`. */
export type ChartVatType = { id: number; number: string; name: string; percentage?: number | null };

export type Chart = { accounts: readonly ChartAccount[]; vatTypes: readonly ChartVatType[] };

/** Why an account cannot take a bucket's bookings. */
export type AccountProblem =
  | "missing"
  | "inactive"
  | "not_customer_ledger"
  | "is_customer_ledger"
  | "needs_department"
  | "needs_project"
  | "needs_dimension"
  | "vat_code_missing"
  | "vat_code_not_allowed";

const ledgerOf = (a: ChartAccount) => (a.ledgerType ?? "GENERAL").toUpperCase();

function demands(account: ChartAccount): AccountProblem | null {
  if (account.isInactive) return "inactive";
  if (account.requiresDepartment) return "needs_department";
  if (account.requiresProject) return "needs_project";
  if (account.requiresFreeDimension1 || account.requiresFreeDimension2 || account.requiresFreeDimension3) return "needs_dimension";
  return null;
}

/**
 * Whether an account takes a VAT code. A VAT-locked account takes only its own; otherwise its legal codes. An account that
 * lists none is taken as open (unverified in Tripletex's sandbox; the sync's read-back catches a refusal).
 */
export function accountTakesVat(account: ChartAccount, vat: ChartVatType): boolean {
  if (account.vatLocked) return account.vatType?.id === vat.id;
  const legal = account.legalVatTypes ?? [];
  return legal.length === 0 || legal.some((one) => one.id === vat.id);
}

/** Whether an account can carry one bucket's income (or, for gift cards, the debt). `null` when it can. */
export function bookingProblem(account: ChartAccount | undefined, vat: ChartVatType | undefined): AccountProblem | null {
  if (!account) return "missing";
  if (!vat) return "vat_code_missing";
  const demand = demands(account);
  if (demand) return demand;
  if (ledgerOf(account) !== "GENERAL") return "is_customer_ledger";
  if (!accountTakesVat(account, vat)) return "vat_code_not_allowed";
  return null;
}

/** Whether an account can be the receivable: a customer ledger account that asks for nothing else. */
export function receivableProblem(account: ChartAccount | undefined): AccountProblem | null {
  if (!account) return "missing";
  const demand = demands(account);
  if (demand) return demand;
  return ledgerOf(account) === "CUSTOMER" ? null : "not_customer_ledger";
}

/** Where the nearest account for a bucket is looked for: sales income for sales, short-term debt for gift cards. */
const RANGE: Record<BookingKey, [number, number]> = {
  standard_25: [3000, 3999],
  standard_15: [3000, 3999],
  standard_12: [3000, 3999],
  standard_0: [3000, 3999],
  exempt: [3000, 3999],
  outside_scope: [3000, 3999],
  reverse_charge: [3000, 3999],
  gift_card: [2000, 2999],
};

/** Words in an account's name that mark it as the place for a bucket, before its number is considered. */
const NAMED: Partial<Record<BookingKey, RegExp>> = { gift_card: /gavekort|gift ?card/i };

/** How each choice was made: Norway's standard, or the nearest account that fits (to be looked at by the accountant). */
export type SetupPick = { key: BookingKey | "receivable"; account: { number: number; name: string }; vatCode: { number: string; name: string } | null; how: "standard" | "nearest" };

/** Something only a person can choose, with the accounts that would do (empty when none fits and one must be made in Tripletex). */
export type SetupQuestion =
  | { key: BookingKey; problem: "vat_code_missing"; vatCode: string }
  | { key: BookingKey | "receivable"; problem: "no_account"; options: { number: number; name: string }[] };

export type SetupPlan = {
  /** Every bucket that could be chosen; the questions' buckets are left out until answered. */
  bookings: TripletexSettings["bookings"];
  receivableAccount: number | null;
  picks: SetupPick[];
  questions: SetupQuestion[];
};

const byNumber = (a: ChartAccount, b: ChartAccount) => a.number - b.number;

/**
 * The setup for the buckets a store needs. For each: the standard account and code when it fits; else, in the bucket's range,
 * an account named for it, then one locked to the code, then the lowest that takes it. A bucket with no fitting account, or a
 * code the company does not have, becomes a question.
 */
export function planSetup(chart: Chart, keys: readonly BookingKey[]): SetupPlan {
  const accounts = [...chart.accounts].sort(byNumber);
  const byNum = new Map(accounts.map((a) => [a.number, a]));
  const vatByNumber = new Map(chart.vatTypes.map((v) => [v.number.trim(), v]));
  const picks: SetupPick[] = [];
  const questions: SetupQuestion[] = [];
  const bookings: TripletexSettings["bookings"] = {};

  const wanted = BOOKING_KEYS.filter((key) => keys.includes(key));
  for (const key of wanted) {
    const standard = DEFAULT_BOOKING[key];
    const vat = vatByNumber.get(standard.vatCode);
    if (!vat) {
      questions.push({ key, problem: "vat_code_missing", vatCode: standard.vatCode });
      continue;
    }
    const vatWords = { number: vat.number, name: vat.name };
    const first = byNum.get(standard.account);
    if (bookingProblem(first, vat) === null && first) {
      bookings[key] = { account: first.number, vatCode: vat.number };
      picks.push({ key, account: { number: first.number, name: first.name }, vatCode: vatWords, how: "standard" });
      continue;
    }
    const [low, high] = RANGE[key];
    const fits = accounts.filter((a) => a.number >= low && a.number <= high && bookingProblem(a, vat) === null);
    const named = NAMED[key];
    const chosen =
      (named && fits.find((a) => named.test(a.name))) ??
      (key === "gift_card" ? undefined : (fits.find((a) => a.vatLocked && a.vatType?.id === vat.id) ?? fits[0]));
    if (chosen) {
      bookings[key] = { account: chosen.number, vatCode: vat.number };
      picks.push({ key, account: { number: chosen.number, name: chosen.name }, vatCode: vatWords, how: "nearest" });
    } else {
      questions.push({ key, problem: "no_account", options: fits.map((a) => ({ number: a.number, name: a.name })) });
    }
  }

  let receivableAccount: number | null = null;
  const standardReceivable = byNum.get(DEFAULT_RECEIVABLE);
  if (receivableProblem(standardReceivable) === null && standardReceivable) {
    receivableAccount = standardReceivable.number;
    picks.push({ key: "receivable", account: { number: standardReceivable.number, name: standardReceivable.name }, vatCode: null, how: "standard" });
  } else {
    const fits = accounts.filter((a) => receivableProblem(a) === null);
    if (fits.length > 0) {
      receivableAccount = fits[0].number;
      picks.push({ key: "receivable", account: { number: fits[0].number, name: fits[0].name }, vatCode: null, how: "nearest" });
    } else {
      questions.push({ key: "receivable", problem: "no_account", options: [] });
    }
  }

  return { bookings, receivableAccount, picks, questions };
}

export type SettingsProblem = { key: BookingKey | "receivable"; problem: AccountProblem; account: number | null; vatCode: string | null };

/** Every way kept settings would be refused by this company: the settings page shows them, and the sync waits on them. */
export function checkSettings(settings: Pick<TripletexSettings, "bookings" | "receivableAccount">, chart: Chart, needed: readonly BookingKey[]): SettingsProblem[] {
  const byNum = new Map(chart.accounts.map((a) => [a.number, a]));
  const vatByNumber = new Map(chart.vatTypes.map((v) => [v.number.trim(), v]));
  const problems: SettingsProblem[] = [];
  const receivable = receivableProblem(byNum.get(settings.receivableAccount));
  if (receivable) problems.push({ key: "receivable", problem: receivable, account: settings.receivableAccount, vatCode: null });
  for (const key of BOOKING_KEYS) {
    const booking = settings.bookings[key];
    if (!booking) {
      if (needed.includes(key)) problems.push({ key, problem: "missing", account: null, vatCode: null });
      continue;
    }
    const problem = bookingProblem(byNum.get(booking.account), vatByNumber.get(booking.vatCode));
    if (problem) problems.push({ key, problem, account: booking.account, vatCode: booking.vatCode });
  }
  return problems;
}

/** What each problem says to an owner, in plain words (the accountant's summary uses the same). */
export const PROBLEM_WORDS: Record<AccountProblem, string> = {
  missing: "The account is not in your Tripletex chart of accounts.",
  inactive: "The account is switched off in Tripletex.",
  not_customer_ledger: "The account is not a customer account (kundereskontro) in Tripletex.",
  is_customer_ledger: "The account is a customer account; income needs an ordinary account.",
  needs_department: "Tripletex asks for a department on every posting to this account.",
  needs_project: "Tripletex asks for a project on every posting to this account.",
  needs_dimension: "Tripletex asks for a free dimension on every posting to this account.",
  vat_code_missing: "Your Tripletex company does not have this VAT code.",
  vat_code_not_allowed: "Tripletex does not allow this VAT code on the account.",
};
