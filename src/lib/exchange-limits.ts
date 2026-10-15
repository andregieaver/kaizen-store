/**
 * The numbers of exchanges and return labels (wave 3, D239, `docs/wave-3-exchanges.md` 4.1). One module so a limit is one reviewed change:
 * `exchange-limits.test.ts` pins every value, the database rules of `exchanges_rules` use the same numbers (`src/db/exchanges.test.ts` holds the two
 * together), and the screens say them out loud. Pure: no server import, no zod (the exchange page, a no-extras path, reaches these).
 */
import { DRAFT_PRICE_MAX_MINOR } from "./order-limits";

/** Replacement lines on one exchange. */
export const EXCHANGE_LINES_MAX = 20;
/** Units of one replacement line. */
export const EXCHANGE_QUANTITY_MAX = 99;
/** The most one replacement unit, or a shipping price staff set, can cost (a draft's limit: keeps every sum exact in a JavaScript number). */
export const EXCHANGE_PRICE_MAX_MINOR = DRAFT_PRICE_MAX_MINOR;
/** How long a proposal waits for the customer's confirmation, in days (D174's `EDIT_PAY_DAYS`); capped by a withdrawal's refund deadline (4.5). */
export const EXCHANGE_PROPOSAL_DAYS = 7;
/** How long the pay step of an exchange with a difference to pay is open, in days; capped likewise. */
export const EXCHANGE_PAY_DAYS = 7;
/** Less time than this to a withdrawal's legal refund deadline, and the exchange is refused: refund instead. */
export const EXCHANGE_MIN_HOURS = 24;
/** How many times one exchange can be emailed in a day (`chat_usage` bucket `exchange:send:{id}`, D173's draft limit). */
export const EXCHANGE_SENDS_PER_DAY = 5;
/** Presses of an exchange's pay button an hour: per exchange and per store (`exchange:pay:{id}`, `exchange:pay`). */
export const EXCHANGE_PAY_PRESSES_PER_HOUR = 20;
export const EXCHANGE_PAY_PRESSES_PER_HOUR_STORE = 600;
/** The customer's exchange wish, in characters (D153's note limit). */
export const EXCHANGE_WISH_NOTE_MAX = 500;
/** Proposals (`return_exchanges.seq`) of one return, whatever became of them: an abuse brake the database holds. */
export const EXCHANGES_PER_RETURN_MAX = 5;
/** Staff's note on a recorded agreement, in characters (kept only in the history event's `data.note`). */
export const EXCHANGE_AGREEMENT_NOTE_MAX = 500;
/** How many times the five-minute job tries to book a withdrawal return's label, and when (minutes after the return was made). */
export const LABEL_TRIES = 3;
export const LABEL_TRY_AFTER_MINUTES: readonly number[] = [5, 20, 60];
/** Fetches of one return's label an hour (`chat_usage` bucket `label:{returnId}`). */
export const LABEL_FETCHES_PER_HOUR = 30;
/** How long a booked label's fetch from the carrier may take. */
export const LABEL_FETCH_TIMEOUT_MS = 10_000;
/** An ended exchange's token hash is cleared this many days after it ended (`pruneExchangeTokens()`, application code). */
export const EXCHANGE_TOKEN_KEEP_DAYS = 90;
/** The customer's exchange wish note is blanked this many months after the return ended (`runRetention()`). */
export const EXCHANGE_WISH_KEEP_MONTHS = 24;
/** A step (a) hold of an exchange that settles at once (Δ ≤ 0), in minutes: long enough for the refund, short enough to free stock if it fails. */
export const EXCHANGE_SETTLE_HOLD_MINUTES = 30;
