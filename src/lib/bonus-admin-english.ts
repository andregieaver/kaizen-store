/**
 * Server code and tests only: an admin client module must not import this (admin-bundle.scan.test.ts).
 * The bonus program's English sentences (D130), as the AI manager's tools read them.
 */
import { loyaltyEn } from "./admin-messages/loyalty.en";

/** What the program is, for the owner who has not turned it on. */
export const BONUS_EXPLANATION = loyaltyEn.bonus.explanation;

/** The note for accountants that goes with the overview. */
export const BONUS_ACCOUNTING_NOTE = loyaltyEn.bonus.accountingNote;
