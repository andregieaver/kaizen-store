/**
 * Product reviews' pure rules (D301, `docs/wave-5-marketing.md` 9): cleaning what a buyer typed, the name shown by default, the cache tag, and the
 * summary the product page and the structured data draw from the published reviews' stars. No zod and no server imports: the account form uses it.
 */

import { REVIEW_BODY_MAX, REVIEW_NAME_MAX, REVIEW_TITLE_MAX } from "./review-status";

/** The tag of a store's published reviews, refreshed whenever one is published, hidden, answered, edited while shown or deleted. */
export const reviewsTag = (storeId: string) => `reviews:${storeId}`;

// Control characters out (a new line stays in the text), and the zero-width ones people paste by accident.
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f​-‍⁠﻿]/g;

/** One line of text, or null when empty; `false` when it is longer than allowed (refused, never cut). */
export function cleanLine(value: string, max: number): string | null | false {
  const text = value.replace(CONTROL, "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return [...text].length > max ? false : text;
}

/** Text of several lines: lines kept, runs of more than one empty line made one, spaces at the ends of lines trimmed. */
export function cleanText(value: string, max: number): string | null | false {
  const text = value
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL, "")
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return null;
  return [...text].length > max ? false : text;
}

export type ReviewInput = { rating: number; title: string | null; body: string | null; name: string };
export type ReviewProblem = "rating" | "title" | "body" | "name";

/** What a buyer sent, cleaned, or what is wrong with it. A review may be stars alone; the name is required. */
export function cleanReview(raw: { rating: unknown; title?: unknown; body?: unknown; name?: unknown }): { ok: true; review: ReviewInput } | { ok: false; problem: ReviewProblem } {
  const rating = Number(raw.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, problem: "rating" };
  const title = cleanLine(String(raw.title ?? ""), REVIEW_TITLE_MAX);
  if (title === false) return { ok: false, problem: "title" };
  const body = cleanText(String(raw.body ?? ""), REVIEW_BODY_MAX);
  if (body === false) return { ok: false, problem: "body" };
  const name = cleanLine(String(raw.name ?? ""), REVIEW_NAME_MAX);
  if (!name) return { ok: false, problem: "name" };
  return { ok: true, review: { rating, title, body, name } };
}

/** The name shown unless the buyer changes it: the first name and the last name's initial (*Kari N.*), never the email address. */
export function defaultReviewName(fullName: string): string {
  const words = fullName.replace(CONTROL, "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const first = [...words[0]].slice(0, REVIEW_NAME_MAX - 3).join("");
  if (words.length === 1) return first;
  const initial = [...words[words.length - 1]][0]?.toLocaleUpperCase() ?? "";
  return initial ? `${first} ${initial}.` : first;
}

export type RatingSummary = {
  count: number;
  /** The mean of the stars to one decimal; null without a review. */
  average: number | null;
  /** How many gave each number of stars, from five down to one. */
  counts: [number, number, number, number, number];
};

/** The summary of a product's published reviews from how many gave each number of stars (counted in SQL). */
export function ratingSummary(byStars: Partial<Record<1 | 2 | 3 | 4 | 5, number>>): RatingSummary {
  const counts: RatingSummary["counts"] = [byStars[5] ?? 0, byStars[4] ?? 0, byStars[3] ?? 0, byStars[2] ?? 0, byStars[1] ?? 0];
  const count = counts.reduce((s, n) => s + n, 0);
  if (count === 0) return { count, average: null, counts };
  const total = counts.reduce((s, n, i) => s + n * (5 - i), 0);
  // Rounded half up to one decimal from whole numbers, so 4.25 is 4.3 everywhere.
  const average = Math.round((total * 10) / count) / 10;
  return { count, average, counts };
}
