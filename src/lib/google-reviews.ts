import { z } from "zod";

/**
 * Google reviews in testimonials (D91). Pure: the owner's key as typed,
 * Google's answers read into what the site shows, and which reviews show.
 * Reviews come from Google's Places API when a page is shown and are never
 * kept, as Google's terms ask; reviewers' pictures are not shown, as
 * loading them would tell Google about every visitor.
 */

export const GOOGLE_REVIEWS_MAX = 5;

export type GoogleReview = {
  key: string;
  author: string;
  /** The reviewer's profile on Google. */
  authorUrl: string | null;
  rating: number;
  text: string;
  /** When, as Google says it in the page's language ("a month ago"). */
  when: string;
};

export type GooglePlaceReviews = {
  name: string;
  rating: number | null;
  count: number;
  /** The business on Google Maps, where all its reviews are. */
  mapsUrl: string | null;
  reviews: GoogleReview[];
};

export type GooglePlace = { id: string; name: string; address: string };

/** A Google Maps Platform API key as pasted. */
export const googleKeyInput = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{30,100}$/, "That does not look like a Google API key. Copy it from Google Cloud's Credentials page.");

/** A Place ID, as Google gives it. */
export const placeIdInput = z.string().trim().regex(/^[A-Za-z0-9_-]{10,300}$/, "Choose the business again.");

/** The language to ask Google in for a locale: Norwegian Bokmål is Google's `no`. */
export function placeLanguage(locale: string): string {
  const base = locale.split("-")[0].toLowerCase();
  return base === "nb" || base === "nn" ? "no" : base;
}

const text = (value: unknown) => (value && typeof value === "object" && typeof (value as { text?: unknown }).text === "string" ? (value as { text: string }).text : "");
const url = (value: unknown) => (typeof value === "string" && /^https:\/\//.test(value) ? value : null);

/** A place's details from the Places API (New) read as reviews; null when it is not an answer about a place. */
export function parsePlaceReviews(json: unknown): GooglePlaceReviews | null {
  if (!json || typeof json !== "object") return null;
  const place = json as Record<string, unknown>;
  if (typeof place.id !== "string") return null;
  const reviews = Array.isArray(place.reviews) ? place.reviews : [];
  return {
    name: text(place.displayName),
    rating: typeof place.rating === "number" ? place.rating : null,
    count: typeof place.userRatingCount === "number" ? place.userRatingCount : 0,
    mapsUrl: url(place.googleMapsUri),
    reviews: reviews.flatMap((value, index): GoogleReview[] => {
      if (!value || typeof value !== "object") return [];
      const review = value as Record<string, unknown>;
      const author = (review.authorAttribution ?? {}) as Record<string, unknown>;
      const rating = typeof review.rating === "number" ? Math.round(review.rating) : 0;
      if (rating < 1 || rating > 5) return [];
      return [
        {
          key: typeof review.name === "string" ? review.name : String(index),
          author: typeof author.displayName === "string" ? author.displayName : "",
          authorUrl: url(author.uri),
          rating,
          text: text(review.text) || text(review.originalText),
          when: typeof review.relativePublishTimeDescription === "string" ? review.relativePublishTimeDescription : "",
        },
      ];
    }),
  };
}

/** Places found by a search, from the Places API (New). */
export function parsePlaces(json: unknown): GooglePlace[] {
  const places = json && typeof json === "object" && Array.isArray((json as { places?: unknown }).places) ? (json as { places: unknown[] }).places : [];
  return places.flatMap((value) => {
    const place = (value ?? {}) as Record<string, unknown>;
    const id = placeIdInput.safeParse(place.id);
    return id.success ? [{ id: id.data, name: text(place.displayName), address: typeof place.formattedAddress === "string" ? place.formattedAddress : "" }] : [];
  });
}

/** Google's reason in an error answer, for people. */
export function googleProblem(json: unknown, status: number): string {
  const error = json && typeof json === "object" ? (json as { error?: { message?: unknown; status?: unknown } }).error : undefined;
  const reason = typeof error?.message === "string" ? error.message : `status ${status}`;
  return `Google said: ${reason}`;
}

/** The reviews to show: those with words and at least `minRating` stars, at most `limit`, as Google ordered them. */
export function chooseReviews(reviews: GoogleReview[], { minRating = 1, limit = GOOGLE_REVIEWS_MAX }: { minRating?: number; limit?: number }): GoogleReview[] {
  return reviews.filter((review) => review.text.trim() !== "" && review.rating >= minRating).slice(0, limit);
}
