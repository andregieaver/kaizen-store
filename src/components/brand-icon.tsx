import type { SocialNetwork } from "@/lib/social-links";

import { BRAND_MARKS as BRANDS } from "./brand-marks-data";

/** Plain marks for what is not a network, drawn with strokes (Lucide's). */
const STROKED: Partial<Record<SocialNetwork, string>> = {
  email: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm18 2-10 7L2 6",
  phone:
    "M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z",
  website: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z",
};

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
