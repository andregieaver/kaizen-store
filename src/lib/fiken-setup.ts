import { BOOKING_KEYS, type BookingKey } from "./accounting-docs";
import { DEFAULT_FIKEN_BOOKING, type FikenSettings } from "./fiken-settings";

/**
 * Fiken (D460): setting a connection up without asking an owner about accounts. `planFikenSetup()` reads the company's own accounts, takes
 * Fiken's standard account where the company has it, the nearest fitting one where it does not, and asks a person only what it cannot choose.
 * `checkFikenSettings()` holds any settings, chosen here or by hand, to the same rules, so a sale Fiken would refuse is caught on the settings
 * page, not in the sync. Fiken says less about an account than Tripletex does (a code and a name), so the check is that the account is there
 * and in the range a sale may use; Fiken's own answer at the first sale says the rest. Pure: the server reads the accounts and passes them in.
 */

/** An account as Fiken lists it (`GET /accounts`): `3000`, or a ledger account `1500:10001` (never chosen here). */
export type FikenAccount = { code: string; name: string };

export type FikenAccountProblem = "missing" | "account_missing" | "wrong_range";

/** Where an account for a bucket may be: sales income for sales, short-term debt for gift cards. */
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

const plain = (accounts: readonly FikenAccount[]) =>
  accounts.filter((a) => /^\d{4}$/.test(a.code)).sort((a, b) => Number(a.code) - Number(b.code));

/** Whether an account can carry a bucket: in the company's chart, an ordinary account, in the bucket's range. `null` when it can. */
export function fikenAccountProblem(key: BookingKey, code: string, accounts: readonly FikenAccount[]): FikenAccountProblem | null {
  if (!/^\d{4}$/.test(code)) return "account_missing";
  if (!accounts.some((a) => a.code === code)) return "account_missing";
  const [low, high] = RANGE[key];
  const n = Number(code);
  return n >= low && n <= high ? null : "wrong_range";
}

/** The accounts that would take a bucket, for a question's choices. */
export function fikenOptionsFor(key: BookingKey, accounts: readonly FikenAccount[]): FikenAccount[] {
  const [low, high] = RANGE[key];
  return plain(accounts).filter((a) => Number(a.code) >= low && Number(a.code) <= high);
}

export type FikenSetupPick = { key: BookingKey; account: FikenAccount; how: "standard" | "nearest" };
export type FikenSetupQuestion = { key: BookingKey; problem: "no_account"; options: FikenAccount[] };
export type FikenSetupPlan = { bookings: FikenSettings["bookings"]; picks: FikenSetupPick[]; questions: FikenSetupQuestion[] };

/**
 * The setup for the buckets a store needs. For each: the standard account when the company has it; else, in the bucket's range, an account
 * named for it, then the lowest. A bucket with no account in its range becomes a question. Each takes its bucket's standard VAT type.
 */
export function planFikenSetup(accounts: readonly FikenAccount[], keys: readonly BookingKey[]): FikenSetupPlan {
  const picks: FikenSetupPick[] = [];
  const questions: FikenSetupQuestion[] = [];
  const bookings: FikenSettings["bookings"] = {};
  const chart = plain(accounts);
  for (const key of BOOKING_KEYS.filter((k) => keys.includes(k))) {
    const standard = DEFAULT_FIKEN_BOOKING[key];
    const first = chart.find((a) => a.code === standard.account);
    if (first) {
      bookings[key] = { account: first.code, vatType: standard.vatType };
      picks.push({ key, account: first, how: "standard" });
      continue;
    }
    const fits = fikenOptionsFor(key, chart);
    const named = NAMED[key];
    const chosen = (named && fits.find((a) => named.test(a.name))) ?? (key === "gift_card" ? undefined : fits[0]);
    if (chosen) {
      bookings[key] = { account: chosen.code, vatType: standard.vatType };
      picks.push({ key, account: chosen, how: "nearest" });
    } else {
      questions.push({ key, problem: "no_account", options: fits.slice(0, 50) });
    }
  }
  return { bookings, picks, questions };
}

export type FikenSettingsProblem = { key: BookingKey; problem: FikenAccountProblem; account: string | null };

/** Every way kept settings would be refused by this company: the settings page shows them, and the sync waits on them. */
export function checkFikenSettings(settings: Pick<FikenSettings, "bookings">, accounts: readonly FikenAccount[], needed: readonly BookingKey[]): FikenSettingsProblem[] {
  const problems: FikenSettingsProblem[] = [];
  for (const key of BOOKING_KEYS) {
    const booking = settings.bookings[key];
    if (!booking) {
      if (needed.includes(key)) problems.push({ key, problem: "missing", account: null });
      continue;
    }
    const problem = fikenAccountProblem(key, booking.account, accounts);
    if (problem) problems.push({ key, problem, account: booking.account });
  }
  return problems;
}

/** What each problem says to an owner, in plain words. */
export const FIKEN_PROBLEM_WORDS: Record<FikenAccountProblem, string> = {
  missing: "Nothing is chosen for this yet.",
  account_missing: "The account is not in your Fiken chart of accounts.",
  wrong_range: "The account is not one sales can be booked on (3000–3999, or 2000–2999 for gift cards).",
};
