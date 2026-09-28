/**
 * Social media buttons (D91): the networks a page can link to, each with
 * its name and the addresses it takes. Pure, shared by the schema, the
 * editor and the site. Logos come from Simple Icons (CC0), drawn by
 * `BrandIcon`; email, phone and website are plain marks.
 */

export const SOCIAL_NETWORKS = {
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
  threads: "Threads",
  bluesky: "Bluesky",
  mastodon: "Mastodon",
  snapchat: "Snapchat",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  messenger: "Messenger",
  discord: "Discord",
  spotify: "Spotify",
  soundcloud: "SoundCloud",
  vimeo: "Vimeo",
  twitch: "Twitch",
  reddit: "Reddit",
  tumblr: "Tumblr",
  medium: "Medium",
  substack: "Substack",
  github: "GitHub",
  behance: "Behance",
  dribbble: "Dribbble",
  tripadvisor: "Tripadvisor",
  email: "Email",
  phone: "Phone",
  website: "Website",
} as const;
export type SocialNetwork = keyof typeof SOCIAL_NETWORKS;

/** What an address for the network looks like, for the editor's hint. */
export function socialPlaceholder(network: SocialNetwork): string {
  if (network === "email") return "post@example.com";
  if (network === "phone") return "+47 22 12 34 56";
  if (network === "website") return "https://example.com";
  if (network === "x") return "https://x.com/…";
  return `https://www.${network === "whatsapp" ? "wa.me" : network === "messenger" ? "m.me" : `${network}.com`}/…`;
}

/**
 * The address a link goes to, from what the owner typed: an email address
 * as `mailto:`, a phone number as `tel:`, else a web address (https added
 * where it was left out). Null when it is not one.
 */
export function socialHref(network: SocialNetwork, typed: string): string | null {
  const value = typed.trim();
  if (!value) return null;
  if (network === "email") {
    const address = value.replace(/^mailto:/i, "");
    return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(address) ? `mailto:${address}` : null;
  }
  if (network === "phone") {
    const number = value.replace(/^tel:/i, "").replace(/[\s().-]/g, "");
    return /^\+?[0-9]{4,20}$/.test(number) ? `tel:${number}` : null;
  }
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Black or white, whichever reads better on a colour (`#rrggbb`). */
export function textOn(hex: string): "#000000" | "#ffffff" {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#000000" : "#ffffff";
}
