import { describe, expect, it } from "vitest";

import * as limits from "./exchange-limits";
import { DRAFT_PRICE_MAX_MINOR } from "./order-limits";

describe("the numbers of exchanges and return labels (docs/wave-3-exchanges.md 4.1)", () => {
  it("pins every value", () => {
    expect({ ...limits }).toEqual({
      EXCHANGE_LINES_MAX: 20,
      EXCHANGE_QUANTITY_MAX: 99,
      EXCHANGE_PRICE_MAX_MINOR: DRAFT_PRICE_MAX_MINOR,
      EXCHANGE_PROPOSAL_DAYS: 7,
      EXCHANGE_PAY_DAYS: 7,
      EXCHANGE_MIN_HOURS: 24,
      EXCHANGE_SENDS_PER_DAY: 5,
      EXCHANGE_PAY_PRESSES_PER_HOUR: 20,
      EXCHANGE_PAY_PRESSES_PER_HOUR_STORE: 600,
      EXCHANGE_WISH_NOTE_MAX: 500,
      EXCHANGES_PER_RETURN_MAX: 5,
      EXCHANGE_AGREEMENT_NOTE_MAX: 500,
      LABEL_TRIES: 3,
      LABEL_TRY_AFTER_MINUTES: [5, 20, 60],
      LABEL_FETCHES_PER_HOUR: 30,
      LABEL_FETCH_TIMEOUT_MS: 10_000,
      EXCHANGE_TOKEN_KEEP_DAYS: 90,
      EXCHANGE_WISH_KEEP_MONTHS: 24,
      EXCHANGE_SETTLE_HOLD_MINUTES: 30,
    });
  });

  it("has one try time per label try", () => {
    expect(limits.LABEL_TRY_AFTER_MINUTES).toHaveLength(limits.LABEL_TRIES);
  });
});
