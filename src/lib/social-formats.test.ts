import { describe, expect, it } from "vitest";

import { carouselSlides, mayCarousel, mayStory, slideAt } from "./social-formats";
import { postBody } from "./linkedin";
import { pinBody } from "./pinterest";

/** A post's carousel and Story (D870 S2.1b): which posts may have them, the slides, and how Pinterest and LinkedIn take several pictures. */

describe("a post's formats", () => {
  it("makes a carousel of the drawn picture, up to three more photos and the closing slide", () => {
    expect(carouselSlides(1)).toEqual([{ kind: "cover" }, { kind: "offer" }]);
    expect(carouselSlides(3)).toEqual([{ kind: "cover" }, { kind: "photo", photo: 1 }, { kind: "photo", photo: 2 }, { kind: "offer" }]);
    expect(carouselSlides(9)).toHaveLength(5);
    expect(slideAt(carouselSlides(2), 1)).toEqual({ kind: "photo", photo: 1 });
    expect(slideAt(carouselSlides(2), 3)).toBeNull();
    expect(slideAt(carouselSlides(2), -1)).toBeNull();
  });

  it("offers a carousel for a product's post on the channels that publish one, and a Story on Instagram and Facebook", () => {
    expect(mayCarousel("instagram", true)).toBe(true);
    expect(mayCarousel("instagram", false)).toBe(false);
    expect(mayCarousel("tiktok", true)).toBe(false);
    expect(mayStory("facebook")).toBe(true);
    expect(mayStory("pinterest")).toBe(false);
  });

  it("pins several pictures as a carousel Pin and posts them on LinkedIn as a multi-image post", () => {
    const post = { channel: "pinterest" as const, title: "Bowls", caption: "Glazed.", hashtags: [], link: "https://shop.example/p", priceLine: null };
    expect(pinBody("1", post, ["https://a/1.jpg", "https://a/2.jpg"]).media_source).toEqual({
      source_type: "multiple_image_urls",
      items: [
        { url: "https://a/1.jpg", title: "Bowls", link: "https://shop.example/p" },
        { url: "https://a/2.jpg", title: "Bowls", link: "https://shop.example/p" },
      ],
    });
    expect(pinBody("1", post, "https://a/1.jpg").media_source).toEqual({ source_type: "image_url", url: "https://a/1.jpg" });
    expect(postBody("urn:li:person:a", "Words", ["urn:li:image:A", "urn:li:image:B"], "Bowls").content).toEqual({
      multiImage: { images: [{ id: "urn:li:image:A", altText: "Bowls" }, { id: "urn:li:image:B", altText: "Bowls" }] },
    });
  });
});
