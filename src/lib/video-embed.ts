/**
 * Videos from YouTube and Vimeo (D91): the video an address points to, and
 * the player address that plays it. The player loads only when the visitor
 * presses play, from YouTube's privacy-enhanced host and with Vimeo's
 * do-not-track, so nothing is fetched from either before then.
 */

export type EmbedSource = "youtube" | "vimeo";

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** A YouTube video's id from any of its addresses (watch, youtu.be, shorts, embed, live), else null. */
export function youtubeId(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.)/, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "music.youtube.com") {
    const [first, second] = url.pathname.split("/").filter(Boolean);
    id = first === "watch" ? url.searchParams.get("v") : ["shorts", "embed", "live", "v"].includes(first ?? "") ? (second ?? null) : null;
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

/** A Vimeo video's id (and its privacy hash for unlisted videos) from its address, else null. */
export function vimeoId(link: string): { id: string; hash: string | null } | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  if (host !== "vimeo.com" && host !== "player.vimeo.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const index = parts.findIndex((part) => /^\d{6,12}$/.test(part));
  if (index < 0) return null;
  const next = parts[index + 1];
  const hash = url.searchParams.get("h") ?? (next && /^[0-9a-f]{6,20}$/.test(next) ? next : null);
  return { id: parts[index], hash };
}

/** The player address for a video on YouTube or Vimeo, starting at once, or null if the address is not a video there. */
export function embedUrl(source: EmbedSource, link: string): string | null {
  if (source === "youtube") {
    const id = youtubeId(link);
    return id ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0` : null;
  }
  const video = vimeoId(link);
  if (!video) return null;
  const hash = video.hash ? `&h=${video.hash}` : "";
  return `https://player.vimeo.com/video/${video.id}?autoplay=1&dnt=1${hash}`;
}

export const EMBED_NAMES: Record<EmbedSource, string> = { youtube: "YouTube", vimeo: "Vimeo" };
