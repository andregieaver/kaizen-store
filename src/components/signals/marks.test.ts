import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Heatmaps' marks in storefront components (D656, `docs/heatmaps-and-recordings.md` 7.7): the click watch ignores clicks inside
 * `data-kz-private`, the recorder masks text inside `data-kz-mask`, a change inside `data-kz-ambient` does not make a click alive, and quick
 * presses inside `data-kz-no-rage` are no rage. A component that loses its mark would send what it must not, so each is checked here.
 */

const MARKS: Record<string, string[]> = {
  "data-kz-private": [
    "chat-widget",
    "cart-drawer",
    "site-form",
    "back-in-stock",
    "quote-request",
    "gift-card-buy",
    "appointment-picker",
    "blog-comment-form",
    "discount-code-form",
    "gift-card-form",
    "vat-number-field",
    "affiliate-field",
    "delivery-choice",
    "search-box",
    "search-section",
    "domain-search-box",
    "review-item",
    "express-area",
    "klarna-message",
    "consent/consent-manager",
  ],
  "data-kz-mask": ["product-reviews", "blog-comments", "google-reviews-section"],
  "data-kz-ambient": ["countdown-view", "stats-view", "brands-carousel", "carousel", "video-view", "animation-view"],
  "data-kz-no-rage": ["quantity-stepper", "carousel-arrows", "product-gallery", "dropdown"],
};

const source = (file: string) => readFileSync(path.join(__dirname, "..", `${file}.tsx`), "utf8");

describe("heatmaps' marks (D656)", () => {
  for (const [mark, files] of Object.entries(MARKS))
    it(`${mark} stays on its components`, () => {
      expect(files.filter((file) => !source(file).includes(`${mark}=`))).toEqual([]);
    });

  it("marks the review pictures and the chat's panel and launcher themselves", () => {
    expect(source("review-item")).toMatch(/data-review-pictures[^>]*data-kz-private|data-kz-private[^>]*data-review-pictures/);
    expect(source("chat-widget")).toMatch(/data-chat-panel[^>]*data-kz-private|data-kz-private[^>]*data-chat-panel/);
    expect(source("chat-widget")).toMatch(/data-chat-launcher[^>]*data-kz-private|data-kz-private[^>]*data-chat-launcher/);
  });
});
