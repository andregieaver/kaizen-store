/**
 * What staff read when a tag is refused (bloat review step 2.50): the English beside `order-tags.ts`, so the Orders catalogue
 * (`admin-messages/orders.en.ts`) and the admin API read one text and the catalogue imports no code. Imports nothing but types and the limit it
 * says out loud (`order-limits.ts`, which imports nothing).
 */
import { TAG_MAX_LENGTH } from "./order-limits";
import type { TagProblem } from "./order-tags";

/** What staff read when a tag is refused. */
export const TAG_PROBLEM_TEXT: Record<TagProblem, string> = {
  empty: "A tag cannot be empty.",
  too_long: `A tag is at most ${TAG_MAX_LENGTH} characters.`,
  invalid_chars: "A tag cannot hold a comma or a control character.",
};
