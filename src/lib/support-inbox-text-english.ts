/**
 * The inbox's English words (D216) that code with no language reads too (bloat review step 2.50): the AI manager's support tools read them
 * here, and the `support` catalogue (`admin-messages/support.en.ts`) takes its `lib.handoff` and `lib.outcomes` from here, so neither brings
 * both languages of the catalogue. Imports nothing.
 */

export const HANDOFF_EN = {
  customer: "The customer asked for a person",
  ai: "The assistant asked for a person",
  tone: "The customer's tone fell",
  no_ai: "The assistant could not answer",
  limit: "The assistant reached its daily limit",
};

export const OUTCOME_EN = {
  resolved: "Resolved",
  unresolved: "Not resolved",
  follow_up: "Needs a follow-up",
  no_reply: "No reply",
  spam: "Spam",
};

/** A topic's own words in English: none, so a topic is its id in words (`topicWords()`). */
export const TOPIC_EN: Record<string, string> = {};

/** Why a conversation went to a person, for the header. */
export const HANDOFF_WORDS: Record<string, string> = HANDOFF_EN;

/** An outcome of a summary, in words (2.7). */
export const OUTCOME_WORDS: Record<string, string> = OUTCOME_EN;
