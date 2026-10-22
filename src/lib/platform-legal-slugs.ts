/** Kaizena Flow's own legal pages (D312 P5) and their addresses, apart from their texts (`platform-legal.ts`), so the footer loads no words. */
export const PLATFORM_LEGAL_KINDS = ["terms", "privacy", "dpa"] as const;
export type PlatformLegalKind = (typeof PLATFORM_LEGAL_KINDS)[number];

/** Each page's address on Kaizena Flow's site (the same in every language; Norwegian under `/no`). */
export const PLATFORM_LEGAL_SLUGS: Record<PlatformLegalKind, string> = {
  terms: "terms",
  privacy: "privacy",
  dpa: "data-processing-agreement",
};
