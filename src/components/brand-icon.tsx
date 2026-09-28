import {
  siBehance,
  siBluesky,
  siDiscord,
  siDribbble,
  siFacebook,
  siGithub,
  siInstagram,
  siMastodon,
  siMedium,
  siMessenger,
  siPinterest,
  siReddit,
  siSnapchat,
  siSoundcloud,
  siSpotify,
  siSubstack,
  siTelegram,
  siThreads,
  siTiktok,
  siTripadvisor,
  siTumblr,
  siTwitch,
  siVimeo,
  siWhatsapp,
  siX,
  siYoutube,
} from "simple-icons";

import type { SocialNetwork } from "@/lib/social-links";

type Mark = { path: string; hex: string | null };

/** LinkedIn's mark, which Simple Icons no longer carries. */
const LINKEDIN =
  "M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z";

/** Plain marks for what is not a network, drawn with strokes (Lucide's). */
const STROKED: Partial<Record<SocialNetwork, string>> = {
  email: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm18 2-10 7L2 6",
  phone:
    "M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z",
  website: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z",
};

const BRANDS: Partial<Record<SocialNetwork, Mark>> = Object.fromEntries(
  (
    [
      ["facebook", siFacebook],
      ["instagram", siInstagram],
      ["x", siX],
      ["tiktok", siTiktok],
      ["youtube", siYoutube],
      ["pinterest", siPinterest],
      ["threads", siThreads],
      ["bluesky", siBluesky],
      ["mastodon", siMastodon],
      ["snapchat", siSnapchat],
      ["whatsapp", siWhatsapp],
      ["telegram", siTelegram],
      ["messenger", siMessenger],
      ["discord", siDiscord],
      ["spotify", siSpotify],
      ["soundcloud", siSoundcloud],
      ["vimeo", siVimeo],
      ["twitch", siTwitch],
      ["reddit", siReddit],
      ["tumblr", siTumblr],
      ["medium", siMedium],
      ["substack", siSubstack],
      ["github", siGithub],
      ["behance", siBehance],
      ["dribbble", siDribbble],
      ["tripadvisor", siTripadvisor],
    ] as const
  ).map(([network, icon]) => [network, { path: icon.path, hex: `#${icon.hex}` }]),
);
BRANDS.linkedin = { path: LINKEDIN, hex: "#0A66C2" };

/**
 * A network's own colour; null for black and near-black marks (X, Threads,
 * TikTok, GitHub…) and plain marks, which take the text's colour so they
 * show on dark themes too.
 */
export function brandColor(network: SocialNetwork): string | null {
  const hex = BRANDS[network]?.hex;
  if (!hex) return null;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return r + g + b < 120 ? null : hex;
}

/** A network's logo (or a plain mark), in the current colour. */
export function BrandIcon({ network, className }: { network: SocialNetwork; className?: string }) {
  const stroked = STROKED[network];
  if (stroked) {
    return (
      <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={stroked} />
      </svg>
    );
  }
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d={BRANDS[network]?.path ?? ""} />
    </svg>
  );
}
