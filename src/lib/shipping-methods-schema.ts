import { z } from "zod";

import { patternListProblem } from "./postal-patterns";
import {
  ESTIMATE_DAYS_MAX,
  INFO_MAX,
  INSTRUCTIONS_MAX,
  NAME_MAX,
  PATTERNS_MAX,
  RADIUS_KM_MAX,
  RADIUS_KM_MIN,
  READY_HOURS_MAX,
  TIERS_MAX,
  WEIGHT_GRAMS_MAX,
} from "./shipping-limits";
import { tierProblems, type TierProblem } from "./shipping-methods";

/**
 * What the shipping settings' editors send (D237, `docs/wave-3-shipping-methods.md` 2.1 to 2.3), checked the same in the browser and on the server
 * (the database checks again). Amounts are integer minor units of the market's own currency, weights grams; the editors turn what was typed into them.
 * Kept apart from `src/lib/shipping-methods.ts` so the checkout (a pay route) never loads zod (D211). Messages are the admin's (English).
 */

const name = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label}: enter a name.`)
    .max(NAME_MAX, `${label}: at most ${NAME_MAX} characters.`);

const minor = (label: string) => z.number().int(`${label}: a whole amount.`).min(0, `${label}: not below zero.`).max(100_000_000, `${label}: that is too much.`);
const positiveMinor = (label: string) => minor(label).min(1, `${label}: above zero, or leave it empty.`);
const uuid = z.uuid();
/** Texts by locale (`nb-NO`, `en`): a method's or an area's name, instructions, information. */
const texts = (max: number) => z.record(z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/), z.string().trim().max(max)).default({});

const TIER_WORDS: Record<TierProblem, string> = {
  too_many: `at most ${TIERS_MAX} tiers`,
  mixed_basis: "every tier by the same measure",
  two_flat: "one flat price",
  flat_range: "a flat price has no from or up to",
  negative: "no amount or bound below zero",
  empty_range: "each tier's up to above its from",
  gap: "no gap between tiers: each starts where the one before ends, the first at 0",
  overlap: "no overlap between tiers, and only the last without an up to",
};

export const tierInput = z.object({
  basis: z.enum(["flat", "weight", "value"]),
  minValue: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  maxValue: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable(),
  amountMinor: minor("Price"),
});

/** The rates of one zone and profile: none (*Not offered*), one flat price or tiers that meet. */
export const rateGroupInput = z
  .object({ zoneId: uuid.nullable(), profileId: uuid.nullable(), tiers: z.array(tierInput).max(TIERS_MAX, `At most ${TIERS_MAX} tiers.`) })
  .superRefine((group, ctx) => {
    for (const problem of tierProblems(group.tiers)) ctx.addIssue({ code: "custom", message: `Rates: ${TIER_WORDS[problem]}.`, path: ["tiers"] });
  });

export const methodInput = z
  .object({
    id: uuid.nullable(),
    marketCode: z.string().regex(/^[A-Z]{2}$/),
    name: name("Name"),
    names: texts(NAME_MAX),
    estimate: z.object({ min: z.number().int().min(0).max(ESTIMATE_DAYS_MAX), max: z.number().int().min(0).max(ESTIMATE_DAYS_MAX) }).nullable(),
    freeOverMinor: positiveMinor("Free above").nullable(),
    active: z.boolean(),
    groups: z.array(rateGroupInput).max(21 * 21, "Too many rate blocks."),
  })
  .superRefine((m, ctx) => {
    if (m.estimate && m.estimate.min > m.estimate.max) ctx.addIssue({ code: "custom", message: "Transit time: the first number is at most the second.", path: ["estimate"] });
    const keys = m.groups.map((g) => `${g.zoneId ?? "-"}|${g.profileId ?? "-"}`);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "Rates: one block per zone and profile.", path: ["groups"] });
  });
export type MethodInput = z.infer<typeof methodInput>;

const patternsInput = z
  .array(z.string())
  .min(1, "Enter at least one postal code or prefix.")
  .max(PATTERNS_MAX, `At most ${PATTERNS_MAX} postal codes and prefixes.`)
  .superRefine((patterns, ctx) => {
    const problem = patternListProblem(patterns);
    if (problem === "malformed") ctx.addIssue({ code: "custom", message: "Postal codes: codes like 0150, or prefixes like 01*." });
    if (problem === "duplicate") ctx.addIssue({ code: "custom", message: "Postal codes: each only once." });
    if (problem === "too_long") ctx.addIssue({ code: "custom", message: "Postal codes: at most 3,000 characters in all." });
  });

export const zoneInput = z.object({
  id: uuid.nullable(),
  marketCode: z.string().regex(/^[A-Z]{2}$/),
  name: name("Name"),
  patterns: patternsInput,
});
export type ZoneInput = z.infer<typeof zoneInput>;

export const profileInput = z.object({
  id: uuid.nullable(),
  name: name("Name"),
  productIds: z.array(uuid).max(10_000),
});
export type ProfileInput = z.infer<typeof profileInput>;

export const defaultWeightInput = z.object({
  grams: z.number().int("Default weight: whole grams.").min(1, "Default weight: at least 1 g.").max(WEIGHT_GRAMS_MAX, `Default weight: at most ${WEIGHT_GRAMS_MAX} g.`),
});

export const pickupOptionInput = z.object({
  locationId: uuid,
  active: z.boolean(),
  amountMinor: minor("Price"),
  readyInHours: z.number().int().min(0).max(READY_HOURS_MAX, `Usually ready in: at most ${READY_HOURS_MAX} hours.`),
  instructions: z.string().trim().max(INSTRUCTIONS_MAX, `Pickup instructions: at most ${INSTRUCTIONS_MAX} characters.`),
  instructionsT: texts(INSTRUCTIONS_MAX),
});
export type PickupOptionInput = z.infer<typeof pickupOptionInput>;

export const localAreaInput = z
  .object({
    id: uuid.nullable(),
    marketCode: z.string().regex(/^[A-Z]{2}$/),
    locationId: uuid.nullable(),
    name: name("Name"),
    names: texts(NAME_MAX),
    kind: z.enum(["postal", "radius"]),
    patterns: z.array(z.string()).max(PATTERNS_MAX),
    radiusKm: z.number().min(RADIUS_KM_MIN, `Radius: at least ${RADIUS_KM_MIN} km.`).max(RADIUS_KM_MAX, `Radius: at most ${RADIUS_KM_MAX} km.`).nullable(),
    amountMinor: minor("Price"),
    minBasketMinor: positiveMinor("Minimum basket").nullable(),
    freeOverMinor: positiveMinor("Free above").nullable(),
    info: z.string().trim().max(INFO_MAX, `Delivery information: at most ${INFO_MAX} characters.`),
    infoT: texts(INFO_MAX),
    active: z.boolean(),
  })
  .superRefine((a, ctx) => {
    if (a.kind === "postal") {
      const problem = a.patterns.length === 0 ? "empty" : patternListProblem(a.patterns);
      if (problem) ctx.addIssue({ code: "custom", message: "Postal codes: enter codes like 0150 or prefixes like 01*, each once.", path: ["patterns"] });
      if (a.radiusKm !== null) ctx.addIssue({ code: "custom", message: "An area by postal codes has no radius.", path: ["radiusKm"] });
    } else {
      if (a.locationId === null) ctx.addIssue({ code: "custom", message: "Choose the place the radius is measured from.", path: ["locationId"] });
      if (a.radiusKm === null) ctx.addIssue({ code: "custom", message: "Enter the radius in kilometres.", path: ["radiusKm"] });
      else if (Math.round(a.radiusKm * 10) !== a.radiusKm * 10) ctx.addIssue({ code: "custom", message: "Radius: at most one decimal.", path: ["radiusKm"] });
      if (a.patterns.length > 0) ctx.addIssue({ code: "custom", message: "An area by radius has no postal codes.", path: ["patterns"] });
    }
  });
export type LocalAreaInput = z.infer<typeof localAreaInput>;
