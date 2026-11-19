/**
 * Server code and tests only: an admin client module must not import this (admin-bundle.scan.test.ts).
 * The inbox's English words (D216), as the AI manager's support tools read them.
 */
import { supportEn } from "./admin-messages/support.en";

/** Why a conversation went to a person, for the header. */
export const HANDOFF_WORDS: Record<string, string> = supportEn.lib.handoff;

/** An outcome of a summary, in words (2.7). */
export const OUTCOME_WORDS: Record<string, string> = supportEn.lib.outcomes;
