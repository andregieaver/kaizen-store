/**
 * Server code and tests only: an admin client module must not import this (admin-bundle.scan.test.ts).
 * The affiliate program's English sentences (D131), as the AI manager's tools read them.
 */
import { loyaltyEn } from "./admin-messages/loyalty.en";

/** What the program is, for the owner who has not turned it on. */
export const AFFILIATE_EXPLANATION = loyaltyEn.affiliate.explanation;

/** Why the program needs the bonus program. */
export const AFFILIATE_NEEDS_BONUS = loyaltyEn.affiliate.needsBonus;
