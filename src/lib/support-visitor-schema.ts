import { z } from "zod";

import { cleanSignals } from "./recommendations";
import { MESSAGE_MAX } from "./support-rules";

/**
 * The visitor routes' input (D216, `docs/support.md` 5.3), beside `support-visitor.ts` so the widget never loads zod (D211). The
 * site (`store`, `market`) is read by the chat's own site check.
 */

/** A request body's longest length, in characters. */
export const BODY_MAX = 8000;

export const conversationRef = z.object({
  id: z.uuid(),
  token: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/),
});

const after = z.number().int().min(0).max(1_000_000).default(0);

/** A message to the chat, typed (`message`) or spoken (the voice route adds the words it heard). */
export const turnInput = z.object({
  path: z.string().max(300).regex(/^\//).optional(),
  conversation: conversationRef.optional(),
  after,
  message: z.string().trim().min(1).max(MESSAGE_MAX.customer),
  /** What the tab remembers of products looked at and searches made (D139), for recommendations. */
  signals: z.unknown().optional().transform((value) => cleanSignals(value)),
});
export type TurnInput = z.infer<typeof turnInput>;

/** The voice route's request: a turn without its words, which come from the recording. */
export const spokenTurnInput = turnInput.omit({ message: true });

export const feedInput = z.object({ conversation: conversationRef, after });
export type FeedInput = z.infer<typeof feedInput>;

/** Ending takes the same as the feed: the answer is what came after the tab's last message. */
export const endInput = feedInput;
