import { describe, expect, it } from "vitest";

import { chooseReviews, googleKeyInput, googleProblem, parsePlaceReviews, parsePlaces, placeLanguage } from "./google-reviews";

/** A place's details as the Places API (New) gives them. */
const details = {
  id: "ChIJN1t_tDeuEmsRUsoyG83frY4",
  displayName: { text: "Kaffebaren", languageCode: "no" },
  rating: 4.6,
  userRatingCount: 132,
  googleMapsUri: "https://maps.google.com/?cid=123",
  reviews: [
    {
      name: "places/x/reviews/1",
      relativePublishTimeDescription: "for en måned siden",
      rating: 5,
      text: { text: "Beste kaffen i byen.", languageCode: "no" },
      originalText: { text: "Best coffee in town.", languageCode: "en" },
      authorAttribution: { displayName: "Kari N.", uri: "https://www.google.com/maps/contrib/1", photoUri: "https://lh3.googleusercontent.com/a" },
    },
    { name: "places/x/reviews/2", rating: 2, text: { text: "Lang kø." }, authorAttribution: { displayName: "Ola" } },
    { name: "places/x/reviews/3", rating: 4, authorAttribution: { displayName: "Uten tekst" } },
    { name: "places/x/reviews/4", rating: 9, text: { text: "Ugyldig" } },
  ],
};

describe("Google reviews", () => {
  it("reads a place's rating and reviews, without reviewers' pictures", () => {
    const place = parsePlaceReviews(details)!;
    expect(place).toMatchObject({ name: "Kaffebaren", rating: 4.6, count: 132, mapsUrl: "https://maps.google.com/?cid=123" });
    expect(place.reviews).toHaveLength(3);
    expect(place.reviews[0]).toEqual({
      key: "places/x/reviews/1",
      author: "Kari N.",
      authorUrl: "https://www.google.com/maps/contrib/1",
      rating: 5,
      text: "Beste kaffen i byen.",
      when: "for en måned siden",
    });
    expect(JSON.stringify(place)).not.toContain("googleusercontent");
    expect(parsePlaceReviews({ error: { message: "x" } })).toBeNull();
  });

  it("shows reviews with words and enough stars, at most as many as asked", () => {
    const { reviews } = parsePlaceReviews(details)!;
    expect(chooseReviews(reviews, {}).map((review) => review.author)).toEqual(["Kari N.", "Ola"]);
    expect(chooseReviews(reviews, { minRating: 4 }).map((review) => review.author)).toEqual(["Kari N."]);
    expect(chooseReviews(reviews, { limit: 1 })).toHaveLength(1);
  });

  it("finds businesses, asks in the page's language, and says what Google said", () => {
    expect(parsePlaces({ places: [{ id: details.id, displayName: { text: "Kaffebaren" }, formattedAddress: "Storgata 1, Oslo" }, { id: "bad id" }] })).toEqual([
      { id: details.id, name: "Kaffebaren", address: "Storgata 1, Oslo" },
    ]);
    expect(parsePlaces({})).toEqual([]);
    expect(placeLanguage("nb-NO")).toBe("no");
    expect(placeLanguage("sv-SE")).toBe("sv");
    expect(googleProblem({ error: { message: "API key not valid." } }, 400)).toBe("Google said: API key not valid.");
    expect(googleKeyInput.safeParse(" AIzaSyA-1234567890abcdefghijklmnopqrstu ").success).toBe(true);
    expect(googleKeyInput.safeParse("secret").success).toBe(false);
  });
});
