/**
 * The threshold watch (D514, section 4.4 of `docs/own-books-and-sales.md`): a store's turnover over the last twelve months, from its own
 * books, against the thresholds that change its duties: the country pack's legal ones and the owner's own (Human Web's NOK 5 million: take
 * an accountant). Said before it happens: near (85 %) a threshold, and once it is passed (a legal one for a month after, an owner's until
 * they take it away). Pure.
 */

/** Near: from 85 % of a threshold. */
export const NEAR_SHARE = 0.85;

/** A legal threshold the country pack brings: Norway's, in kroner (øre). `as` only for a limited company (an AS). */
export type LegalThreshold = { key: "vat_registration" | "audit_as"; amountMinor: number; currency: string; onlyAs?: boolean };

export const NO_THRESHOLDS: readonly LegalThreshold[] = [
  // NOK 50 000 over twelve months: VAT registration, and the end of the small business exemptions (section 4.1).
  { key: "vat_registration", amountMinor: 5_000_000, currency: "NOK" },
  // An AS may opt out of audit only under NOK 7 million in operating revenue (with a balance and staff under their limits).
  { key: "audit_as", amountMinor: 700_000_000, currency: "NOK", onlyAs: true },
];

export type OwnThreshold = { id: string; amountMinor: number; currency: string; note: string };

export type Watch =
  | { kind: "legal"; key: LegalThreshold["key"]; state: "near" | "passed"; amountMinor: number; currency: string; turnoverMinor: number }
  | { kind: "own"; id: string; note: string; state: "near" | "passed"; amountMinor: number; currency: string; turnoverMinor: number };

/** Whether the books' legal name is a limited company's (it ends in AS or ASA): the store's legal form is not kept otherwise. */
export const isLimitedCompany = (legalName: string): boolean => /\s(AS|ASA)$/i.test(legalName.trim());

/**
 * What the watch says for a store: each threshold the turnover is near, and each it has passed (a legal one only when it was below a month
 * ago, so a business long past VAT registration is not told so; an owner's own until they take it away). Only thresholds in the books'
 * currency; nothing for a store without books in a country with a pack.
 */
export function watchThresholds(input: {
  turnoverMinor: number;
  turnoverMonthAgoMinor: number;
  currency: string;
  legalName: string;
  legal: readonly LegalThreshold[];
  own: readonly OwnThreshold[];
}): Watch[] {
  const watches: Watch[] = [];
  const t = input.turnoverMinor;
  const stateOf = (amount: number, passedSticks: boolean): "near" | "passed" | null => {
    if (t >= amount) return passedSticks || input.turnoverMonthAgoMinor < amount ? "passed" : null;
    return t >= amount * NEAR_SHARE ? "near" : null;
  };
  for (const own of input.own) {
    if (own.currency !== input.currency) continue;
    const state = stateOf(own.amountMinor, true);
    if (state) watches.push({ kind: "own", id: own.id, note: own.note, state, amountMinor: own.amountMinor, currency: own.currency, turnoverMinor: t });
  }
  for (const legal of input.legal) {
    if (legal.currency !== input.currency || (legal.onlyAs && !isLimitedCompany(input.legalName))) continue;
    const state = stateOf(legal.amountMinor, false);
    if (state) watches.push({ kind: "legal", key: legal.key, state, amountMinor: legal.amountMinor, currency: legal.currency, turnoverMinor: t });
  }
  return watches;
}

/** An amount said shortly: NOK 4.3 million, NOK 850 000. */
export function shortAmount(minor: number, currency: string, locale: string, words: { million: string }): string {
  const units = minor / 100;
  if (Math.abs(units) >= 1_000_000) {
    return `${currency} ${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(units / 1_000_000)} ${words.million}`;
  }
  return `${currency} ${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(units))}`;
}

export type WatchWords = {
  million: string;
  ownNear: string;
  ownPassed: string;
  legal: Record<LegalThreshold["key"], { near: string; passed: string }>;
};

/** A watch in a person's words: the turnover, the threshold and what it means (the owner's own note, or the law's). */
export function watchText(watch: Watch, words: WatchWords, locale: string): string {
  const values = { turnover: shortAmount(watch.turnoverMinor, watch.currency, locale, words), limit: shortAmount(watch.amountMinor, watch.currency, locale, words) };
  const fill = (template: string, extra: Record<string, string> = {}) =>
    template.replace(/\{(\w+)\}/g, (whole, name: string) => ({ ...values, ...extra } as Record<string, string>)[name] ?? whole);
  if (watch.kind === "own") return fill(watch.state === "near" ? words.ownNear : words.ownPassed, { note: watch.note });
  return fill(words.legal[watch.key][watch.state]);
}
