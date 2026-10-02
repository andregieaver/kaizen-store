import { z } from "zod";

import type { PartInfo } from "./replicate-build";
import { cleanDecl, ruleOf, type StyleModel } from "./replicate-styles";

/**
 * What the AI may change in a copy after it has looked at it (D150): the declarations of parts that exist, in the places
 * the converter makes, as a short list it must justify. The model never writes CSS or structure: it names a part
 * (an id from the list it was given), a place in it, and properties with values; each property must be one a copy may
 * set and each value `cleanDecl()`'s, with numbers in a sensible range. Anything else is refused and said so.
 */

/** Where in a part a change goes, by name; the selector after the part's id. */
export const WHERE = {
  self: "",
  image: " img",
  link: " a",
  grid: " > :last-child > :first-child",
  inside: " > :last-child",
} as const;
export type Where = keyof typeof WHERE;

export const PATCHES_MAX = 40;

const changeSchema = z.object({
  part: z.string().regex(/^rp\d{1,5}$/),
  where: z.enum(["self", "image", "link", "grid", "inside"]).default("self"),
  viewport: z.enum(["desktop", "phone", "both"]).default("both"),
  set: z.record(z.string().max(40), z.union([z.string().max(300), z.number()])).refine((set) => Object.keys(set).length <= 12, "at most twelve properties"),
  why: z.string().max(200).default(""),
});
export type PatchChange = z.infer<typeof changeSchema>;

const planSchema = z.object({
  summary: z.string().max(600).default(""),
  changes: z.array(changeSchema).max(PATCHES_MAX * 2),
  notes: z.array(z.string().max(300)).max(10).default([]),
});
export type PatchPlan = z.infer<typeof planSchema>;

/** The JSON object in a model's answer: the first `{` to its closing `}`, whatever fence or words surround it. */
export function jsonOf(text: string): unknown | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function parsePatchPlan(text: string): { ok: true; plan: PatchPlan } | { ok: false; problem: string } {
  const json = jsonOf(text);
  if (json === null) return { ok: false, problem: "The answer was not JSON." };
  const parsed = planSchema.safeParse(json);
  if (!parsed.success) return { ok: false, problem: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 3).join("; ") };
  return { ok: true, plan: parsed.data };
}

/** Numbers a property may take, in pixels (or plain, for weights and opacity). */
const BOUNDS: Record<string, [number, number]> = {
  "font-size": [6, 300],
  "line-height": [6, 500],
  "font-weight": [100, 900],
  "letter-spacing": [-10, 40],
  opacity: [0, 1],
  width: [0, 4000],
  "max-width": [0, 4000],
  height: [0, 6000],
  "min-height": [0, 6000],
  "margin-top": [-400, 1500],
  "margin-bottom": [-400, 1500],
  "margin-left": [-400, 1500],
  "margin-right": [-400, 1500],
  "padding-top": [0, 1000],
  "padding-bottom": [0, 1000],
  "padding-left": [0, 1000],
  "padding-right": [0, 1000],
  "column-gap": [0, 400],
  "row-gap": [0, 400],
};

function inBounds(property: string, value: string): boolean {
  const bounds = BOUNDS[property];
  if (!bounds) return true;
  const match = /^(-?\d+(?:\.\d+)?)(px)?$/.exec(value);
  if (!match) return true; // auto, %, em and keywords are not bounded by pixels
  const n = Number(match[1]);
  return n >= bounds[0] && n <= bounds[1];
}

export type Applied = { applied: string[]; refused: string[]; count: number };

/** Applies a plan to the model: only to parts that exist, only clean declarations in range, and at most `PATCHES_MAX`. */
export function applyPatchPlan(model: StyleModel, parts: PartInfo[], plan: PatchPlan): Applied {
  const known = new Set(parts.map((p) => p.id));
  const labels = new Map(parts.map((p) => [p.id, p.label ?? p.kind]));
  const out: Applied = { applied: [], refused: [], count: 0 };
  for (const change of plan.changes) {
    if (out.count >= PATCHES_MAX) {
      out.refused.push("More changes than a pass takes; the rest are left for the next.");
      break;
    }
    if (!known.has(change.part)) {
      out.refused.push(`${change.part} is not a part of the page.`);
      continue;
    }
    const clean: Record<string, string> = {};
    const names: string[] = [];
    for (const [property, raw] of Object.entries(change.set)) {
      const value = typeof raw === "number" ? (property === "font-weight" || property === "opacity" || property === "z-index" ? String(raw) : `${raw}px`) : raw;
      const cleaned = cleanDecl(property, value);
      if (cleaned === null || !inBounds(property, cleaned)) {
        out.refused.push(`${change.part}: ${property} ${String(raw).slice(0, 40)} is not allowed.`);
        continue;
      }
      clean[property] = cleaned;
      names.push(`${property} ${cleaned}`);
    }
    if (names.length === 0) continue;
    const rule = ruleOf(model, change.part, WHERE[change.where]);
    if (change.viewport !== "phone") Object.assign(rule.desktop, clean);
    if (change.viewport !== "desktop") Object.assign(rule.mobile, clean);
    out.count += 1;
    out.applied.push(`${labels.get(change.part)}${change.where === "self" ? "" : ` (${change.where})`}: ${names.slice(0, 4).join(", ")}${change.viewport === "both" ? "" : ` on ${change.viewport === "phone" ? "phones" : "computers"}`}${change.why ? ` — ${change.why}` : ""}`);
  }
  return out;
}
