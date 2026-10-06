import { describe, expect, it } from "vitest";

import * as limits from "./order-limits";

/**
 * Every number of wave 3's order list, tags, drafts and gifts is pinned here, so a change is a reviewed change (docs/wave-3-orders.md 4.1). The database says
 * the same numbers in its checks and triggers (`orders-ops.test.ts` holds them against the migrations).
 */
describe("the limits of the order list, tags, drafts and gifts", () => {
  it("are the numbers of the spec", () => {
    expect(limits).toMatchObject({
      TAG_MAX_LENGTH: 40,
      TAGS_PER_ORDER: 250,
      ORDERS_PAGE_SIZE: 50,
      ORDERS_COUNT_CAP: 10_000,
      SEARCH_MAX_LENGTH: 100,
      SEARCH_MAX_WORDS: 5,
      SEARCH_MIN_WORD: 2,
      BULK_MAX: 250,
      BULK_PRINT_MAX: 100,
      VIEWS_MAX: 30,
      VIEW_TITLE_MAX: 40,
      GIFT_MESSAGE_MAX: 300,
      GIFT_NAME_MAX: 60,
      GIFT_MESSAGE_LINES: 6,
      DRAFT_LINES_MAX: 100,
      DRAFT_QUANTITY_MAX: 9_999,
      DRAFTS_OPEN_MAX: 500,
      DRAFT_VALID_DAYS_DEFAULT: 7,
      DRAFT_VALID_DAYS_MIN: 1,
      DRAFT_VALID_DAYS_MAX: 30,
      DRAFT_SENDS_PER_DAY: 5,
      DRAFT_SENDS_PER_HOUR_STORE: 60,
      DRAFT_OPEN_RETENTION_DAYS: 90,
      DRAFT_DONE_RETENTION_DAYS: 30,
      AUTO_ARCHIVE_MIN_DAYS: 14,
      AUTO_ARCHIVE_MAX_DAYS: 365,
      AUTO_ARCHIVE_BATCH: 200,
      DISCOUNT_BPS_MIN: 1,
      DISCOUNT_BPS_MAX: 10_000,
      DRAFT_DISCOUNT_LABEL_MAX: 60,
      DRAFT_NOTE_TO_BUYER_MAX: 500,
      DRAFT_INTERNAL_NOTE_MAX: 1_000,
    });
  });

  it("keep a draft's sums inside what a number holds exactly: 100 lines of 9,999 units at the highest price", () => {
    const sum = limits.DRAFT_LINES_MAX * limits.DRAFT_QUANTITY_MAX * limits.DRAFT_PRICE_MAX_MINOR;
    expect(Number.isSafeInteger(sum)).toBe(true);
    // And leave room for a percent discount's intermediate product in plain numbers too (the pricing uses BigInt for it, but a screen may not).
    expect(sum * 2).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it("never start automatic archiving before the 14-day withdrawal period can have run", () => {
    expect(limits.AUTO_ARCHIVE_MIN_DAYS).toBeGreaterThanOrEqual(14);
  });
});
