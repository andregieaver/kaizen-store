import type { ExtensionId } from "./extensions";

/**
 * The AI manager's extension suggestions (D748 E9, D852, `docs/extensions.md` 6), pure: an extension is offered only on a fact read from the
 * store's own records (never a guess), at most once per extension in `OFFER_EVERY_DAYS`, and not again for `QUIET_AFTER_NO_DAYS` after the
 * owner says no. Work is never offered: nothing in a store says how many hours someone logs elsewhere.
 */

export const OFFER_EVERY_DAYS = 30;
export const QUIET_AFTER_NO_DAYS = 90;

/** What the store's records say, each counted by `offerFacts()` over the window it names. */
export type OfferFacts = {
  /** Customer conversations and contact form messages in the last 7 days. */
  customerMessages7d: number;
  /** Subscribers who said yes to marketing email. */
  subscribers: number;
  /** People who asked for something in the last 30 days: quote requests, form messages, chats that left an email. */
  leads30d: number;
  /** Page views in the last 30 days, on a store that sells. */
  pageViews30d: number;
};

/** The least each fact must be before its extension is worth a word. */
export const OFFER_THRESHOLDS = { customerMessages7d: 10, subscribers: 200, leads30d: 10, pageViews30d: 5000 } as const;

/** Which fact stands behind each extension's offer. */
const FACT_OF: Partial<Record<ExtensionId, keyof OfferFacts>> = {
  support_desk: "customerMessages7d",
  email_automation: "subscribers",
  deals: "leads30d",
  ab_testing: "pageViews30d",
};

export type OfferFact = { kind: keyof OfferFacts; count: number };

/** The facts that are large enough, by extension, for the extensions given (those the account could start a trial of). */
export function offerCandidates(facts: OfferFacts, offerable: readonly ExtensionId[]): { extension: ExtensionId; fact: OfferFact }[] {
  return offerable.flatMap((extension) => {
    const kind = FACT_OF[extension];
    if (!kind || facts[kind] < OFFER_THRESHOLDS[kind]) return [];
    return [{ extension, fact: { kind, count: facts[kind] } }];
  });
}

/** An account's last offer of an extension, and the no to it. */
export type OfferMemory = { offeredAt: Date | null; declinedAt: Date | null };

const DAY = 86_400_000;

/** Whether the extension may be offered again at `now`: never offered, or offered over 30 days ago and not declined in the last 90. */
export function offerDue(memory: OfferMemory | undefined, now: Date): boolean {
  if (!memory) return true;
  if (memory.declinedAt && now.getTime() - memory.declinedAt.getTime() < QUIET_AFTER_NO_DAYS * DAY) return false;
  return !memory.offeredAt || now.getTime() - memory.offeredAt.getTime() >= OFFER_EVERY_DAYS * DAY;
}
