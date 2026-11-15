import type { Size } from "./breakpoints";
import type { Border, PartBase, Shadow, Sides, Spacing } from "./page-content";
import type { TypographyGroups } from "./typography";
import { scheduleOf, withSchedule, type Schedule, type Show } from "./visibility";

/**
 * What a settings panel's folds say about their settings while closed (D631): a fold names its current value, so a tab reads top
 * to bottom without opening anything. Here the facts; the panel puts them in words.
 */

/** Four sides at a glance: none, one number for every side, or each its own. */
export type SidesAtGlance = null | number | "mixed";

export function sidesAtGlance(sides: Sides | undefined): SidesAtGlance {
  if (!sides) return null;
  const values = [sides.top, sides.right, sides.bottom, sides.left];
  if (values.every((v) => v === 0)) return null;
  return values.every((v) => v === values[0]) ? values[0] : "mixed";
}

/** A part's spacing: the space outside and inside, each at a glance; both null is the default. */
export const spacingAtGlance = (spacing: Spacing | undefined) => ({ outside: sidesAtGlance(spacing?.margin), inside: sidesAtGlance(spacing?.padding) });

/** A part's frame: its border's line, its corners in pixels, its shadow; each null when it has none. */
export function frameAtGlance(part: { border?: Border | null; radius?: number; shadow?: Shadow | null }): {
  border: Border["style"] | null;
  radius: number | null;
  shadow: Shadow | null;
} {
  return { border: part.border?.style ?? null, radius: part.radius ? part.radius : null, shadow: part.shadow ?? null };
}

/** A part's own text look: none, or the font family and size of its first kind of text that names one, and whether there is more. */
export function typographyAtGlance(groups: TypographyGroups | undefined): null | { family?: string; size?: string } {
  const set = Object.values(groups ?? {}).filter((g) => g && Object.values(g).some((v) => v !== undefined));
  if (set.length === 0) return null;
  const family = set.find((g) => g?.family)?.family;
  const measure = set.find((g) => g?.size)?.size;
  return { ...(family && { family }), ...(measure && { size: `${measure.value}${measure.unit}` }) };
}

/** Who sees a part, its dates aside. */
export type Audience = "everyone" | "nobody" | "signedIn" | "signedOut" | "rules";

/**
 * Where, for whom and when a part shows: the sizes it is hidden at, who sees it (its dates left out, so a schedule alone is still
 * "everyone") and its dates (`own` where its groups of conditions differ in them).
 */
export function visibilityAtGlance(visibility: PartBase["visibility"]): { hiddenAt: Size[]; audience: Audience; schedule: Schedule | "own" | null } {
  const show: Show | undefined = visibility?.show;
  const schedule = scheduleOf(show);
  const rest = schedule === "own" ? show : withSchedule(show, null);
  const audience: Audience =
    rest === undefined || rest === "always" ? "everyone" : rest === "never" ? "nobody" : rest === "signedIn" || rest === "signedOut" ? rest : "rules";
  return { hiddenAt: [...(visibility?.hideAt ?? [])], audience, schedule };
}
