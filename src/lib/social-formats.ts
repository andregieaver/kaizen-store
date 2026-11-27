/**
 * A social post's formats beyond its one picture (D870 S2.1b, `docs/social-manager.md` 5): a carousel and a Story frame, drawn from the same
 * template as the picture (`socialPicture()`). A carousel is the drawn picture, then up to `CAROUSEL_PHOTOS_MAX` more of the product's own
 * photos, then a closing slide with its title and price (five at most, Pinterest's limit). A Story is the same picture in 9:16 for Instagram
 * and Facebook. Pure; the drawing is `src/server/social-pictures.tsx`, the publishing `src/server/social-publish.ts`.
 */

import type { PostChannel } from "./social-posts";

/** The channels that publish a carousel: Instagram, a Facebook Page's photos, a Pinterest carousel Pin, LinkedIn's multi-image post. */
export const CAROUSEL_CHANNELS: readonly PostChannel[] = ["instagram", "facebook", "pinterest", "linkedin"];
/** The channels that publish a Story. */
export const STORY_CHANNELS: readonly PostChannel[] = ["instagram", "facebook"];
/** The product's photos after its first that a carousel shows. */
export const CAROUSEL_PHOTOS_MAX = 3;
/** A Story frame's size. */
export const STORY_SIZE = { width: 1080, height: 1920, shape: "9:16" } as const;

/** A carousel's slide: the drawn picture, one of the product's other photos (`photo` counts from its second), or the closing slide. */
export type Slide = { kind: "cover" } | { kind: "photo"; photo: number } | { kind: "offer" };

/** A carousel's slides, for a product with this many photos in all. */
export function carouselSlides(photos: number): Slide[] {
  const extra = Math.max(0, Math.min(CAROUSEL_PHOTOS_MAX, photos - 1));
  return [{ kind: "cover" }, ...Array.from({ length: extra }, (_, i) => ({ kind: "photo" as const, photo: i + 1 })), { kind: "offer" }];
}

/** Whether a post may be a carousel: one about a product, on a channel that publishes them. */
export const mayCarousel = (channel: PostChannel, hasProduct: boolean): boolean => hasProduct && CAROUSEL_CHANNELS.includes(channel);

/** Whether a post may also go out as a Story. */
export const mayStory = (channel: PostChannel): boolean => STORY_CHANNELS.includes(channel);

/** The slide asked for by its number (0, the drawn picture), or null past the last. */
export const slideAt = (slides: readonly Slide[], n: number): Slide | null => (Number.isInteger(n) && n >= 0 && n < slides.length ? slides[n] : null);
