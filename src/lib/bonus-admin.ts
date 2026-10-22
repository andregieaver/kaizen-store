import { BONUS_KIND_LABELS, isGrantKind, earnAmount, restoreShare, type BonusEntry, type BonusOverview, type BonusSettings } from "./bonus";
import { countWords, fillWords } from "./admin-fill";
import { loyaltyEn, type LoyaltyMessages } from "./admin-messages/loyalty.en";
import { bonusSettingsInput } from "./bonus-schema";
import { formatMoney, minorUnitDigits } from "./money";
import { formatPriceInput, parsePrice } from "./product-input";

/**
 * What the owner's screens for the bonus program (D130) need besides the contract in `bonus.ts`: the settings form's
 * text in and out (percent, days, an amount), the sentences that explain the rules, a signed adjustment, and how an
 * order's credits are described. Pure, so the browser and the tests use it as the server does.
 */

// ---------------------------------------------------------------------------
// Percent <-> basis points
// ---------------------------------------------------------------------------

/** Basis points as the percentage typed in the form: 500 is "5", 250 is "2.5", 275 is "2.75". */
export function bpsToPercentText(bps: number): string {
  return String(Math.round(bps) / 100);
}

/**
 * A typed percentage as basis points: "5", "2,5", "2.75" and "5 %" work (at most two decimals); null when it is not one.
 * Whole arithmetic, so 4.35% is exactly 435.
 */
export function percentTextToBps(text: string): number | null {
  const compact = text.replace(/[\s ]/g, "").replace(/%$/, "");
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(compact);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
}

/** "5%" or "2.5%": a percentage as shoppers read it. */
export function percentLabel(bps: number): string {
  return `${bpsToPercentText(bps)}%`;
}

// ---------------------------------------------------------------------------
// The settings form
// ---------------------------------------------------------------------------

/** The form as typed: every number is text until it has been read. */
export type BonusFormValues = {
  enabled: boolean;
  /** Credits back, in percent. */
  earnPercent: string;
  /** The return period, in days. */
  pendingDays: string;
  /** The most of an order's goods credits may pay, in percent. */
  maxRedeemPercent: string;
  /** The least to use at once, as an amount in the credits' currency; empty for none. */
  minRedeem: string;
  /** Whether credits expire at all. */
  expires: boolean;
  expiresMonths: string;
};

export type BonusField = Exclude<keyof BonusFormValues, "enabled" | "expires">;

/** The order the fields are in, so the first problem gets the focus. */
export const BONUS_FIELD_ORDER: readonly BonusField[] = [
  "earnPercent",
  "pendingDays",
  "maxRedeemPercent",
  "minRedeem",
  "expiresMonths",
];

export function formFromSettings(settings: BonusSettings, currency: string): BonusFormValues {
  return {
    enabled: settings.enabled,
    earnPercent: bpsToPercentText(settings.earnBps),
    pendingDays: String(settings.pendingDays),
    maxRedeemPercent: String(settings.maxRedeemPercent),
    minRedeem: settings.minRedeemMinor > 0 ? formatPriceInput(settings.minRedeemMinor, currency) : "",
    expires: settings.expiresMonths !== null,
    expiresMonths: String(settings.expiresMonths ?? 12),
  };
}

export type BonusFormRead =
  | { ok: true; settings: BonusSettings }
  | { ok: false; errors: Partial<Record<BonusField, string>> };

const wholeNumber = (text: string): number | null => (/^\d{1,9}$/.test(text.trim()) ? Number(text.trim()) : null);

/**
 * The form read into settings, checked with `bonusSettingsInput` (the server's own check). Every field that is wrong
 * gets its own message, in the words of the contract where it has them.
 */
export function readBonusForm(
  values: BonusFormValues,
  currency: string,
  w: LoyaltyMessages["bonus"]["errors"] = loyaltyEn.bonus.errors,
): BonusFormRead {
  const errors: Partial<Record<BonusField, string>> = {};

  const earnBps = percentTextToBps(values.earnPercent);
  if (earnBps === null) errors.earnPercent = w.earnPercent;

  const pendingDays = wholeNumber(values.pendingDays);
  if (pendingDays === null) errors.pendingDays = w.pendingDays;

  const maxRedeemPercent = wholeNumber(values.maxRedeemPercent);
  if (maxRedeemPercent === null) errors.maxRedeemPercent = w.maxRedeemPercent;

  let minRedeemMinor: number | null = 0;
  if (values.minRedeem.trim() !== "") {
    minRedeemMinor = parsePrice(values.minRedeem, currency);
    if (minRedeemMinor === null)
      errors.minRedeem = fillWords(w.minRedeem, { currency });
  }

  let expiresMonths: number | null = null;
  if (values.expires) {
    expiresMonths = wholeNumber(values.expiresMonths);
    if (expiresMonths === null) errors.expiresMonths = w.expiresMonths;
  }

  // What could be read is checked against the contract, so its limits are said in its own words.
  const parsed = bonusSettingsInput.safeParse({
    enabled: values.enabled,
    earnBps: earnBps ?? 0,
    pendingDays: pendingDays ?? 0,
    maxRedeemPercent: maxRedeemPercent ?? 1,
    minRedeemMinor: minRedeemMinor ?? 0,
    expiresMonths: values.expires ? (expiresMonths ?? 1) : null,
  });
  if (!parsed.success) {
    const fieldOf: Record<string, BonusField> = {
      earnBps: "earnPercent",
      pendingDays: "pendingDays",
      maxRedeemPercent: "maxRedeemPercent",
      minRedeemMinor: "minRedeem",
      expiresMonths: "expiresMonths",
    };
    for (const issue of parsed.error.issues) {
      const field = fieldOf[String(issue.path[0])];
      if (field && !errors[field]) errors[field] = friendly(field, issue.message, w);
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, settings: parsed.data as BonusSettings };
}

/** The contract's own messages are kept; the ones zod writes itself (a number out of range) are put in words. */
function friendly(field: BonusField, message: string, w: LoyaltyMessages["bonus"]["errors"]): string {
  if (/^(Too small|Too big|Invalid|Number must|Expected)/i.test(message) || message === "Invalid input") {
    switch (field) {
      case "pendingDays":
        return w.pendingRange;
      case "minRedeem":
        return w.minRange;
      case "expiresMonths":
        return w.monthsRange;
      default:
        return w.checkNumber;
    }
  }
  return message;
}

/** The problems in the order of the form, for the summary at its end and for the first field to focus. */
export function orderedProblems(errors: Partial<Record<BonusField, string>>): { field: BonusField; message: string }[] {
  return BONUS_FIELD_ORDER.flatMap((field) => (errors[field] ? [{ field, message: errors[field] as string }] : []));
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

export type MoneyFormat = (minor: number) => string;

/** A money formatter for one currency and locale, as the pages and tools use it. */
export const moneyIn =
  (currency: string, locale: string): MoneyFormat =>
  (minor) =>
    formatMoney(minor, currency, locale);

/** What an order of 1,000 (in the credits' currency) earns: "A 1,000 NOK order earns 50 NOK in credits." */
export function earnExample(
  earnBps: number,
  currency: string,
  locale: string,
  orderMajor = 1000,
  template = loyaltyEn.bonus.example,
): { orderLabel: string; earnLabel: string; sentence: string } {
  const orderMinor = orderMajor * 10 ** minorUnitDigits(currency);
  const orderLabel = formatMoney(orderMinor, currency, locale);
  const earnLabel = formatMoney(earnAmount(orderMinor, earnBps), currency, locale);
  return { orderLabel, earnLabel, sentence: fillWords(template, { order: orderLabel, earn: earnLabel }) };
}

type RuleWords = LoyaltyMessages["bonusRules"];

/** The wait before credits can be used, as the shopper's texts say it ("right after you pay", "14 days after you pay"). */
export function waitWords(pendingDays: number, w: RuleWords = loyaltyEn.bonusRules): string {
  return pendingDays <= 0 ? w.rightAfter : fillWords(w.after, { days: countWords(pendingDays, w.days) });
}

/**
 * The rules in sentences, the way a shopper reads them: the first ones are the storefront's own English texts
 * (`bonus.howEarn`, `bonus.howUse`, `bonus.howUseExpires` in `i18n.ts`, which a test holds this to), then what only the
 * owner sets: the limit on an order and the least to use. The admin's summary, the confirmation of a change and what
 * the AI manager says all come from here, so they never disagree.
 */
export function rulesSummary(settings: BonusSettings, money: MoneyFormat, currency: string, w: RuleWords = loyaltyEn.bonusRules): string[] {
  const lines: string[] = [];
  lines.push(
    settings.earnBps > 0
      ? fillWords(w.earn, { percent: percentNumber(settings.earnBps, w), wait: waitWords(settings.pendingDays, w) })
      : w.none,
  );
  lines.push(
    settings.expiresMonths === null ? w.use : fillWords(w.useExpires, { months: countWords(settings.expiresMonths, w.months) }),
  );
  const least = settings.minRedeemMinor > 0 ? fillWords(w.least, { amount: money(settings.minRedeemMinor) }) : "";
  lines.push(fillWords(w.limit, { percent: settings.maxRedeemPercent, least, currency }));
  if (settings.expiresMonths !== null) lines.push(w.reminder);
  return lines;
}

/** A percentage's number with the words' own decimal mark: "2.5" in English, "2,5" in Norwegian. */
export function percentNumber(bps: number, w: { decimal: string } = loyaltyEn.bonusRules): string {
  return bpsToPercentText(bps).replace(".", w.decimal);
}

/** What the program is, for the owner who has not turned it on. */
export const BONUS_EXPLANATION = loyaltyEn.bonus.explanation;

/** What turning it on or off does, in the order the owner needs to know it. */
export const BONUS_ON_NOTES = loyaltyEn.bonus.onNotes;
export const BONUS_OFF_NOTE = loyaltyEn.bonus.offNote;

/** The note for accountants that goes with the overview. */
export const BONUS_ACCOUNTING_NOTE = loyaltyEn.bonus.accountingNote;

/** The overview as rows of a list: label and amount. */
export function overviewRows(
  overview: BonusOverview,
  money: MoneyFormat,
  w: LoyaltyMessages["bonusOverview"] = loyaltyEn.bonusOverview,
): { label: string; value: string; hint?: string }[] {
  return [
    { label: w.outstanding, value: money(overview.outstandingMinor), hint: w.outstandingHint },
    { label: w.pending, value: money(overview.pendingMinor), hint: w.pendingHint },
    { label: w.earned, value: money(overview.earned30dMinor) },
    { label: w.used, value: money(overview.redeemed30dMinor) },
    { label: w.expired, value: money(overview.expired30dMinor) },
    { label: w.customers, value: String(overview.customersWithCredits) },
  ];
}

// ---------------------------------------------------------------------------
// A customer's credits
// ---------------------------------------------------------------------------

const MINUS = "−";

/** A ledger amount with its sign: "+50,00 kr" or "−20,00 kr". */
export function signedMoney(minor: number, currency: string, locale: string): string {
  if (minor === 0) return formatMoney(0, currency, locale);
  return `${minor > 0 ? "+" : MINUS}${formatMoney(Math.abs(minor), currency, locale)}`;
}

/** The kind of a ledger line as staff read it. */
export const entryLabel = (entry: Pick<BonusEntry, "kind">, w: Record<BonusEntry["kind"], string> = BONUS_KIND_LABELS): string => w[entry.kind];

/** Whether a grant can be used yet (its date has passed), or null for lines that are not grants. */
export function isUsableNow(entry: Pick<BonusEntry, "kind" | "availableAt">, now: Date): boolean | null {
  if (!isGrantKind(entry.kind) || !entry.availableAt) return null;
  return new Date(entry.availableAt).getTime() <= now.getTime();
}

/** The most text a reason for an adjustment takes, and the least. */
export const ADJUST_NOTE_MIN = 3;
export const ADJUST_NOTE_MAX = 200;

export type Adjustment =
  | { ok: true; amountMinor: number; note: string }
  | { ok: false; field: "amount" | "note"; problem: string };

/**
 * An adjustment as typed: an amount that adds (50, +50) or removes (-20, −20) credits in the credits' currency, and a
 * reason of 3 to 200 characters. Zero is refused.
 */
export function readAdjustment(
  amountText: string,
  noteText: string,
  currency: string,
  w: LoyaltyMessages["adjust"] = loyaltyEn.adjust,
): Adjustment {
  const text = amountText.replace(/[\s ]/g, "");
  const negative = /^[-−–]/.test(text);
  const digits = text.replace(/^[-+−–]/, "");
  const amount = digits === "" ? null : parsePrice(digits, currency);
  if (amount === null)
    return { ok: false, field: "amount", problem: w.amountProblem };
  if (amount === 0) return { ok: false, field: "amount", problem: w.zero };
  const note = noteText.trim();
  if (note.length < ADJUST_NOTE_MIN)
    return { ok: false, field: "note", problem: fillWords(w.noteShort, { min: ADJUST_NOTE_MIN }) };
  if (note.length > ADJUST_NOTE_MAX) return { ok: false, field: "note", problem: fillWords(w.noteLong, { max: ADJUST_NOTE_MAX }) };
  return { ok: true, amountMinor: negative ? -amount : amount, note };
}

/** The question before an adjustment is made. */
export function adjustmentQuestion(amountMinor: number, who: string, money: MoneyFormat, w: LoyaltyMessages["adjust"] = loyaltyEn.adjust): string {
  return amountMinor > 0
    ? fillWords(w.addQuestion, { amount: money(amountMinor), who })
    : fillWords(w.takeQuestion, { amount: money(-amountMinor), who });
}

/** An adjustment as typed, in words for an approval: "Add 50 in bonus credits to ann@example.com". */
export function adjustmentPhrase(amountText: string, who: string): string {
  const text = amountText.trim();
  const negative = /^[-\u2212\u2013]/.test(text);
  const amount = text.replace(/^[-+\u2212\u2013]\s*/, "");
  return negative ? `Take ${amount} in bonus credits from ${who}` : `Add ${amount} in bonus credits to ${who}`;
}

// ---------------------------------------------------------------------------
// An order's credits
// ---------------------------------------------------------------------------

/** What an order's view carries about credits (D130): null for an order with none, and for a copied one. */
export type OrderBonus = { usedMinor: number; earnedMinor: number; availableAt: string | null };

/**
 * What happens to an order's credits if it is refunded, from its own figures: used credits come back by the refunded
 * share, earned credits are taken back (never below zero: what was already used stays used).
 */
export function refundNotes(
  bonus: OrderBonus | null,
  money: MoneyFormat,
  refund?: { refundedMinor: number; totalMinor: number },
): string[] {
  if (!bonus) return [];
  const notes: string[] = [];
  if (bonus.usedMinor > 0) {
    const share = refund ? restoreShare(bonus.usedMinor, refund.refundedMinor, refund.totalMinor) : 0;
    notes.push(
      `${money(bonus.usedMinor)} in credits was used on this order. A refund returns the refunded share of it to the customer's credits${
        share > 0 ? ` (${money(share)} so far)` : ""
      }.`,
    );
  }
  if (bonus.earnedMinor > 0) {
    notes.push(
      `The order earned ${money(bonus.earnedMinor)} in credits. A refund takes back the credits the refunded part earned, never below zero: credits the customer has already used stay used.`,
    );
  }
  return notes;
}
