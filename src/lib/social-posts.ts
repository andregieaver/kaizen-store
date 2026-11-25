/**
 * The social post creator (D870 C1, `docs/social-manager.md` 3): for each channel a caption, hashtags and the post's tagged link, written by
 * the store's writer from a product's facts or the owner's topic, for the owner to copy into the channel by hand. What each channel takes,
 * what the writer must answer, how an answer is read, and the text the owner copies. Pure, shared by the server and its tests.
 *
 * The model never writes a price, a stock level or a link: the price line and the link are code's (`copyText()`), and every caption and
 * hashtag is checked for the claims AI may not make before it is kept (`postClaims()`).
 */

import { findAvoided, type AvoidedFinding } from "./brand";
import { findClaims, type ClaimFinding } from "./claims";
import { POST_CHANNELS, type PostChannel } from "./post-links";

export { POST_CHANNELS, type PostChannel };

export type ChannelSpec = {
  label: string;
  /** The longest caption the channel takes; the writer is asked for well under it (`aimChars`). */
  maxChars: number;
  aimChars: number;
  /** How many hashtags suit the channel. */
  hashtags: { min: number; max: number };
  /** The channel shows a title of its own (a Pin's). */
  title: boolean;
  /** A link in the caption opens; elsewhere it belongs in the profile, a Story or the Pin's own link. */
  linkInCaption: boolean;
  /** How the channel reads, for the writer. */
  style: string;
};

export const CHANNEL_SPECS: Record<PostChannel, ChannelSpec> = {
  instagram: {
    label: "Instagram",
    maxChars: 2200,
    aimChars: 400,
    hashtags: { min: 3, max: 8 },
    title: false,
    linkInCaption: false,
    style: "A first line that makes people stop scrolling, then two or three short lines; a few emoji at most; links do not open in captions.",
  },
  facebook: {
    label: "Facebook",
    maxChars: 2000,
    aimChars: 300,
    hashtags: { min: 0, max: 2 },
    title: false,
    linkInCaption: true,
    style: "Friendly and conversational, two to four short sentences, ending with what to do next.",
  },
  pinterest: {
    label: "Pinterest",
    maxChars: 500,
    aimChars: 300,
    hashtags: { min: 0, max: 3 },
    title: true,
    linkInCaption: false,
    style: "A title of a few searchable words, and a description that says what it is and who it is for in words people search for.",
  },
  tiktok: {
    label: "TikTok",
    maxChars: 2200,
    aimChars: 150,
    hashtags: { min: 3, max: 5 },
    title: false,
    linkInCaption: false,
    style: "Very short and casual, a hook in the first words; links do not open in captions.",
  },
  linkedin: {
    label: "LinkedIn",
    maxChars: 3000,
    aimChars: 500,
    hashtags: { min: 1, max: 3 },
    title: false,
    linkInCaption: true,
    style: "Professional and plain: what it is, why it matters, in short paragraphs.",
  },
};

export const TITLE_MAX = 100;
export const HASHTAG_MAX_CHARS = 30;
export const TOPIC_MAX = 500;
export const THEME_MAX = 80;

/** A post's reference for its tagged link (`postContent()`): 12 lower-case letters and digits, random. */
export function newPostRef(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(random(12), (b) => alphabet[b % alphabet.length]).join("");
}

export type WrittenPost = { channel: PostChannel; title: string; caption: string; hashtags: string[] };

/** A hashtag as kept: without `#`, letters, digits and underscores only, at most `HASHTAG_MAX_CHARS`; empty when nothing is left. */
export function cleanHashtag(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFKC")
    .replace(/^#+/, "")
    .replace(/[^\p{L}\p{N}_]/gu, "")
    .slice(0, HASHTAG_MAX_CHARS);
}

const text = (raw: unknown, max: number) =>
  typeof raw === "string"
    ? raw
        .replace(/\r\n?/g, "\n")
        .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, max)
        .trim()
    : "";

/**
 * The writer's answer as posts, one per channel asked for and in that order, or null when it is no JSON or leaves a channel without a
 * caption. Captions are cut to the channel's limit, hashtags tidied, deduplicated and cut to the channel's most; a channel not asked for is
 * dropped.
 */
export function parseSocialPosts(answer: string, channels: readonly PostChannel[]): WrittenPost[] | null {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data: unknown;
  try {
    data = JSON.parse(answer.slice(start, end + 1));
  } catch {
    return null;
  }
  const list = (data as { posts?: unknown })?.posts;
  if (!Array.isArray(list)) return null;
  const out: WrittenPost[] = [];
  for (const channel of channels) {
    const raw = list.find((p) => (p as { channel?: unknown })?.channel === channel) as Record<string, unknown> | undefined;
    if (!raw) return null;
    const spec = CHANNEL_SPECS[channel];
    const caption = text(raw.caption, spec.maxChars);
    if (!caption) return null;
    const tags = Array.isArray(raw.hashtags) ? raw.hashtags.map(cleanHashtag).filter(Boolean) : [];
    const hashtags = [...new Map(tags.map((t) => [t.toLowerCase(), t])).values()].slice(0, spec.hashtags.max);
    out.push({ channel, title: spec.title ? text(raw.title, TITLE_MAX) : "", caption, hashtags });
  }
  return out;
}

/** The claims a post makes (D76's filter) and the brand's words to avoid, over its title, caption and hashtags. */
export function postClaims(post: Pick<WrittenPost, "title" | "caption" | "hashtags">, avoid: readonly string[] = []): (ClaimFinding | AvoidedFinding)[] {
  return [post.title, post.caption, ...post.hashtags].flatMap((t) => [...findClaims(t), ...findAvoided(t, avoid)]);
}

/** What the writer is told about each channel asked for. */
export function channelBrief(channels: readonly PostChannel[]): string {
  return channels
    .map((c) => {
      const s = CHANNEL_SPECS[c];
      const tags = s.hashtags.max === 0 ? "no hashtags" : `${s.hashtags.min} to ${s.hashtags.max} hashtags`;
      return `${c}: about ${s.aimChars} characters, ${tags}${s.title ? `, a title under ${TITLE_MAX} characters` : ""}. ${s.style}`;
    })
    .join("\n");
}

/** The answer's shape, for the writer. */
export const ANSWER_SHAPE = `Answer only with JSON: {"posts": [{"channel": string, "title": string (only where a title is asked for, else empty), "caption": string, "hashtags": string[] (without #)}]}, one post per channel asked for.`;

export type CopyInput = { channel: PostChannel; title: string; caption: string; hashtags: readonly string[]; link: string; priceLine: string | null };

/**
 * The text the owner copies into the channel: the title (a Pin's) and the caption, the price line (code's, from the shop's price) when
 * kept, the link where the channel opens links in a caption, and the hashtags. Where the channel does not open links, the link is copied
 * on its own (for the profile, a Story or the Pin) and left out here.
 */
export function copyText(post: CopyInput): string {
  const spec = CHANNEL_SPECS[post.channel];
  const parts = [spec.title && post.title ? post.title : "", post.caption, post.priceLine ?? "", spec.linkInCaption ? post.link : ""].filter(Boolean);
  const tags = post.hashtags.map((t) => `#${t}`).join(" ");
  return [parts.join("\n\n"), tags].filter(Boolean).join("\n\n");
}
