/**
 * Support (D216, `docs/support.md` 4.1): every number the support system lives by, in one place, pinned by
 * `support-rules.test.ts`. Pure: imported by the server, the admin and the widget alike.
 */

/** Who answers a desk's customers (S5): the chat agent alone, the AI first and then people, or people only. */
export const SUPPORT_MODES = ["off", "ai_first", "people"] as const;
export type SupportMode = (typeof SUPPORT_MODES)[number];

/** Who answers a conversation now. */
export const HANDLERS = ["ai", "queue", "human"] as const;
export type Handler = (typeof HANDLERS)[number];

export const STATUSES = ["open", "ended"] as const;
export type ConversationStatus = (typeof STATUSES)[number];

/** Who wrote a message. `note` and `partner` are staff only and never reach the customer. */
export const AUTHORS = ["customer", "ai", "agent", "system", "note", "partner"] as const;
export type MessageAuthor = (typeof AUTHORS)[number];

/** The authors a customer may see (their feed, emails and export). */
export const CUSTOMER_VISIBLE: readonly MessageAuthor[] = ["customer", "ai", "agent", "system"];

export const SOURCES = ["site", "admin"] as const;
export type ConversationSource = (typeof SOURCES)[number];

export const HANDOFF_REASONS = ["customer", "ai", "tone", "no_ai", "limit"] as const;
export type HandoffReason = (typeof HANDOFF_REASONS)[number];

export const ENDED_BY = ["customer", "agent", "timeout", "system"] as const;
export type EndedBy = (typeof ENDED_BY)[number];

export const SUMMARY_STATUSES = ["none", "pending", "done", "failed", "skipped"] as const;
export type SummaryStatus = (typeof SUMMARY_STATUSES)[number];

/** The longest each author's message may be. A system line has no words of its own (its `kind` is drawn by each side). */
export const MESSAGE_MAX: Record<MessageAuthor, number> = {
  customer: 1000,
  ai: 2000,
  agent: 4000,
  note: 2000,
  partner: 3000,
  system: 0,
};

export const PARTNER_FACTS_MAX = 8;
export const PARTNER_DRAFT_MAX = 1000;
export const PARTNER_RECOMMENDATION_MAX = 400;
export const PARTNER_ANSWER_MAX = 800;
export const PARTNER_QUESTION_MAX = 500;
/** The customer has stopped writing for this long before the partner looks. */
export const PARTNER_PAUSE_SECONDS = 4;
/** Tool rounds of one partner turn, as the chat's `ROUNDS`. */
export const PARTNER_ROUNDS = 4;

/** The AI's history, as the chat's `HISTORY_MAX`. */
export const AI_HISTORY = 20;
/** Then the customer is asked to start a new conversation. */
export const CONVERSATION_MESSAGES_MAX = 300;
export const REOPEN_HOURS = 24;
export const QUEUE_GIVE_UP_DAYS = 14;
/** A conversation with a person ends after this long without anyone writing. */
export const HUMAN_IDLE_END_HOURS = 24;
/** A customer action the AI proposed expires. */
export const ACTION_MINUTES = 30;
export const HEARTBEAT_SECONDS = 20;
/** An agent counts as online when switched on and seen this recently. */
export const ONLINE_SECONDS = 60;

export const POLL_VISITOR_MS = { waiting: 3000, ai: 10_000, hidden: 15_000 } as const;
export const POLL_STAFF_MS = { list: 3000, conversation: 2000, realtime: 15_000 } as const;

export const EMAIL_EVERY_MINUTES = 10;
export const EMAILS_MAX = 20;
export const CONTACT_CHANGES_MAX = 3;
export const RATING_COMMENT_MAX = 500;
export const CONTACT_NAME_MAX = 120;
export const CONTACT_EMAIL_MAX = 254;
export const PAGE_PATH_MAX = 300;
export const AI_REASON_MAX = 200;

/** Desk settings' bounds and defaults (3.1). */
export const END_AFTER_MINUTES = { min: 10, max: 240, default: 30 } as const;
export const NOTIFY_AFTER_MINUTES = { min: 1, max: 60, default: 5 } as const;
export const TONE_ALERT_DEFAULT = -40;
export const TONE_HANDOFF_DEFAULT = -60;
export const TRANSCRIPT_DAYS = [30, 60, 90] as const;
export const TRANSCRIPT_DAYS_DEFAULT = 90;
/** A desk whose support is off keeps a transcript this long after the conversation ends (S2). */
export const TRANSCRIPT_DAYS_OFF = 1;
/** Anonymised conversations (counts and closed fields only) are deleted after this long. */
export const RECORD_MONTHS = 24;
export const MAX_CHATS = { min: 1, max: 20, default: 5 } as const;
export const DISPLAY_NAME_MAX = 40;

export const SUMMARY_TRIES = 3;
/** A report's rate or median is shown only from this many cases. */
export const MIN_SUPPORT_SAMPLE = 10;
