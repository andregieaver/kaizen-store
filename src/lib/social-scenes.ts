/**
 * A social post's made scene (D870 S2.1, `docs/social-manager.md` 5): the description the picture model is given, and how often a scene is
 * made. For a product, its own photo is kept exactly and only the background is replaced (the library's `new_background` edit); for a page or
 * a topic, a background is made in the site's look. The post's words, price and logo stay code's, drawn over it. Pure; the server is
 * `src/server/social-scenes.ts`.
 */

import { BRIEF_MAX, type PictureShape } from "./picture-direction";
import { PICTURE_SIZES, type PostChannel } from "./social-posts";

/** A scene is made at most this many times for a post: the first, and two more when the vision check fails it. */
export const SCENE_TRIES_MAX = 3;

const clean = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max);

/**
 * The picture model's brief for a post's scene. `idea` is the calendar's plan for the day where there is one, else the post's topic; a
 * product's brief asks for a setting only (its photo is kept), anything else for a background with calm space for the headline. No words,
 * prices or people in the picture: the post's words are drawn over it by code.
 */
export function sceneBrief(input: { kind: "product" | "page" | "topic"; title: string; idea: string }): string {
  const idea = clean(input.idea, 300);
  const subject = clean(input.title, 120);
  const brief =
    input.kind === "product"
      ? `A setting for the product "${subject}"${idea ? `, suiting this post: ${idea}` : ""}. A calm, natural scene with soft light, the product the clear centre. No text, no prices, no logos, no people.`
      : `A background picture for a social media post${idea ? ` about: ${idea}` : subject ? ` about: ${subject}` : ""}. Calm, uncluttered, with a quiet area where a headline can sit. No text, no prices, no logos, no people.`;
  return brief.slice(0, BRIEF_MAX);
}

/** The made picture's shape for a channel: the nearest of the picture model's three to the channel's picture. */
export function sceneShape(channel: PostChannel): PictureShape {
  const { width, height } = PICTURE_SIZES[channel];
  return width === height ? "square" : height > width ? "portrait" : "landscape";
}

/** Whether a post's scene may be made again after the vision check failed it. */
export const mayRemakeScene = (tries: number): boolean => tries < SCENE_TRIES_MAX;
