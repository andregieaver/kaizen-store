import { z } from "zod";

import { PLACEMENTS, type RecommendSettings, SESSION_ID, TOKEN_CAP_MAX, UUID, cleanSignals } from "./recommendations";

/**
 * The schemas of `recommendations.ts`, apart from it so the browser's parts that use its plain helpers do not load zod (D211,
 * `storefront-bundle.scan.test.ts`). The server and the admin import what checks input from here.
 */

const whole = (message: string, min: number, max: number) =>
  z.coerce.number({ error: message }).int(message).min(min, message).max(max, message);

/** The owner's form: the cap is entered in thousands of tokens, blank for none. */
export const recommendSettingsInput = z.object({
  enabled: z.boolean(),
  ai: z.boolean(),
  holdoutPercent: whole("The share of visitors who get the plain ranking is a whole number from 0 to 50.", 0, 50),
  upsellCeilingPercent: whole("The ceiling for an upsell is a whole number of percent from 0 to 500.", 0, 500),
  monthlyTokenCap: z
    .union([z.literal("").transform(() => null), whole("The monthly cap is a whole number of thousands of tokens, or empty for none.", 0, TOKEN_CAP_MAX / 1000).transform((k) => k * 1000)])
    .nullable(),
});

export function parseRecommendSettings(form: FormData): { ok: true; settings: RecommendSettings } | { ok: false; problems: string[] } {
  const cap = String(form.get("monthlyTokenCap") ?? "").trim();
  const parsed = recommendSettingsInput.safeParse({
    enabled: form.get("enabled") === "on",
    ai: form.get("ai") === "on",
    holdoutPercent: String(form.get("holdoutPercent") ?? "").trim() || "0",
    upsellCeilingPercent: String(form.get("upsellCeilingPercent") ?? "").trim() || "0",
    monthlyTokenCap: cap,
  });
  return parsed.success ? { ok: true, settings: parsed.data } : { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
}

const ids = z.array(z.string().regex(UUID)).max(20);

/** Where the grid is, as the page knows it; trusted only for what to recommend, never for anything private. */
export const recommendPlace = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("product"), productId: z.string().regex(UUID) }),
  z.object({ kind: z.literal("listing"), query: z.string().max(600).default(""), /** On a category or tag page: its id. */ termId: z.string().regex(UUID).optional() }),
  z.object({ kind: z.literal("article"), pageId: z.string().regex(UUID) }),
  z.object({ kind: z.literal("page"), pageId: z.string().regex(UUID) }),
  z.object({ kind: z.literal("other") }),
]);

export type RecommendPlace = z.infer<typeof recommendPlace>;

/** What the grid asks for: how many, which kinds, whether to say why, and the categories and tags it keeps to. */
export const recommendBlock = z.object({
  limit: z.number().int().min(1).max(12),
  mix: z.object({ upsell: z.boolean(), crossSell: z.boolean(), complement: z.boolean() }),
  explain: z.boolean(),
  categories: ids.default([]),
  tags: ids.default([]),
  /** The custom fields (by id) the grid's tiles show under the title (D120). */
  tileFields: z.array(z.string().regex(/^[0-9a-zA-Z_-]{1,64}$/)).max(3).default([]),
});

export type RecommendBlock = z.infer<typeof recommendBlock>;

export const recommendRequest = z.object({
  store: z.string().regex(/^[a-z0-9-]{1,60}$/),
  market: z.string().regex(/^[a-z]{2}(?:-[a-z]{2})?(?:-[a-z]{3})?(?:-[a-z]{3})?$/),
  session: z.string().regex(SESSION_ID),
  place: recommendPlace,
  block: recommendBlock,
  signals: z.unknown().optional().transform((value) => cleanSignals(value)),
});

export type RecommendRequest = z.infer<typeof recommendRequest>;

/** A tab's report of what it showed and what was clicked, and a cart's of a recommended product put in it. */
export const recommendEvents = z.object({
  store: z.string().regex(/^[a-z0-9-]{1,60}$/),
  session: z.string().regex(SESSION_ID),
  arm: z.enum(["ai", "baseline"]),
  placement: z.enum(PLACEMENTS),
  events: z
    .array(z.object({ productId: z.string().regex(UUID), event: z.enum(["impression", "click"]) }))
    .min(1)
    .max(24),
});

export type RecommendEvents = z.infer<typeof recommendEvents>;

/** One product the tab opened from a recommendation, and how it was shown. */
export const recommendClick = z.object({
  p: z.string().regex(UUID),
  arm: z.enum(["ai", "baseline"]),
  placement: z.enum(PLACEMENTS),
});

/** What the buy form carries: the tab's id and the products it opened from recommendations in the last half hour. */
export const recommendAttribution = z.object({
  session: z.string().regex(SESSION_ID),
  clicks: z.array(recommendClick).max(12),
});

export type RecommendAttribution = z.infer<typeof recommendAttribution>;

export function parseAttribution(value: unknown): RecommendAttribution | null {
  if (typeof value !== "string" || value.length > 1200) return null;
  try {
    const parsed = recommendAttribution.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
