import { z } from "zod";

import { cleanSignals } from "./recommendations";
import { AGENT_NAME_MAX, GREETING_MAX, HISTORY_MAX, INSTRUCTIONS_MAX, MESSAGE_MAX, OCCUPATION_MAX } from "./chat";

/**
 * The schemas of `chat.ts`, apart from it so the browser's parts that use its plain helpers do not load zod (D211,
 * `storefront-bundle.scan.test.ts`). The server and the admin import what checks input from here.
 */

/** A visitor's request: the conversation so far (kept in their browser), their country, and the page they are on. */
export const chatRequest = z.object({
  market: z.string().regex(/^[a-z]{2}(?:-[a-z]{2})?(?:-[a-z]{3})?$/).optional(),
  path: z.string().max(300).regex(/^\//).optional(),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(MESSAGE_MAX) }))
    .min(1)
    .max(HISTORY_MAX)
    .refine((messages) => messages.at(-1)?.role === "user", "The last message is the visitor's."),
  /** What the visitor's tab remembers of the products they looked at and what they searched for (D139), for recommendations. */
  signals: z.unknown().optional().transform((value) => cleanSignals(value)),
});

export type ChatRequest = z.infer<typeof chatRequest>;

/** An agent's settings as the admin saves them. */
export const chatAgentInput = z.object({
  enabled: z.boolean(),
  name: z.string().trim().max(AGENT_NAME_MAX, `Keep the name under ${AGENT_NAME_MAX} characters.`),
  occupation: z.string().trim().max(OCCUPATION_MAX, `Keep the occupation under ${OCCUPATION_MAX} characters.`),
  avatar: z
    .object({
      url: z.url({ protocol: /^https?$/, error: "The picture has an invalid address." }).max(1000),
      width: z.number().int().min(1).max(10_000),
      height: z.number().int().min(1).max(10_000),
    })
    .nullable(),
  greeting: z.record(
    z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/),
    z.string().trim().max(GREETING_MAX, `Keep the greeting under ${GREETING_MAX} characters.`),
  ),
  instructions: z.string().trim().max(INSTRUCTIONS_MAX, `Keep the guidance under ${INSTRUCTIONS_MAX} characters.`),
  voice: z.boolean(),
  dailyLimit: z.coerce.number().int().min(1, "Allow at least one message a day.").max(100_000, "Allow at most 100,000 messages a day."),
}).refine((agent) => !agent.enabled || agent.name.length > 0, { message: "Give the agent a name before switching it on.", path: ["name"] });

export type ChatAgentInput = z.infer<typeof chatAgentInput>;

export const navigateArgs = z.object({
  to: z.string(),
  handle: z.string().max(200).optional(),
  slug: z.string().max(200).optional(),
  query: z.string().max(200).optional(),
});
