import { z } from "zod";

import { AGENT_NAME_MAX, GREETING_MAX, INSTRUCTIONS_MAX, OCCUPATION_MAX } from "./chat";
import { cleanAvatarStyle } from "./chat-avatar";
import { GUIDE_LANGS, GUIDE_MESSAGE_MAX } from "./docs-guide-shape";

/**
 * What the docs guide (D444) takes in, checked: its settings as the platform's admins save them (the platform chat's, D81, without voice:
 * the docs' panel is typed), and a reader's message. Apart from `docs-guide-shape.ts` so the docs' panel loads no zod.
 */

/** The guide's settings: on or off, who it is, its greeting per docs language, the platform's guidance and the daily limit. */
export const guideSettingsInput = z
  .object({
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
    /** How the picture is framed (D233); anything out of range falls back, nothing is the standard look. */
    avatarStyle: z.unknown().optional().transform((value) => cleanAvatarStyle(value)),
    greeting: z.partialRecord(z.enum(GUIDE_LANGS), z.string().trim().max(GREETING_MAX, `Keep the greeting under ${GREETING_MAX} characters.`)),
    instructions: z.string().trim().max(INSTRUCTIONS_MAX, `Keep the guidance under ${INSTRUCTIONS_MAX} characters.`),
    dailyLimit: z.coerce.number().int().min(1, "Allow at least one message a day.").max(100_000, "Allow at most 100,000 messages a day."),
  })
  .refine((guide) => !guide.enabled || guide.name.length > 0, { message: "Give the guide a name before switching it on.", path: ["name"] });

export type GuideSettingsInput = z.infer<typeof guideSettingsInput>;

/** A docs page's path as the guide's panel sends it (`owners/getting-started/create-your-store`), or the front page (empty). */
const pagePath = z.string().max(300).regex(/^(?:[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*){0,4})?$/);

/** A reader's message: its words, the docs' language and page they write from, and their conversation's reference once there is one. */
export const guideTurnInput = z.object({
  message: z.string().trim().min(1).max(GUIDE_MESSAGE_MAX),
  lang: z.enum(GUIDE_LANGS),
  page: pagePath.optional(),
  conversation: z.object({ id: z.uuid(), token: z.string().regex(/^[A-Za-z0-9_-]{32,64}$/) }).optional(),
  /** The last message the tab has seen. */
  after: z.number().int().min(0).max(100_000).default(0),
});

export type GuideTurnInput = z.infer<typeof guideTurnInput>;
