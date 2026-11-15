import { SMALLER_SIZES, type SmallerSize } from "./breakpoints";
import type { PartBase } from "./page-content";

/**
 * Copy style and Paste style (D631): what a part's Design tab holds, taken from one part and laid on another of the same kind
 * (a button's on a button, a row's on a row). What it says (text, pictures, items, links), how it moves (Motion), who sees it
 * (Visibility) and its anchor stay the part's own. A smaller screen size's design settings (`at`) go with it; its layout settings
 * there (a column's share, a row's stacking) stay.
 */

/** What a style was copied from: a row, a column, or a kind of component. Paste takes it only onto the same kind. */
export type StyleKind = "row" | "column" | `block:${string}`;

/** A copied style: the values of its kind's design settings (absent ones are left out) and theirs at the smaller sizes. */
export type CopiedStyle = {
  kind: StyleKind;
  values: Record<string, unknown>;
  at?: Partial<Record<SmallerSize, Record<string, unknown>>>;
};

/** Every part's design: spacing, frame, typography and its classes. */
const PART_KEYS = ["style", "border", "radius", "shadow", "shadowOpacity", "typography", "className"] as const;

/** A background's settings, a row's and a column's (a row's alone can be fixed and placed). */
const BACKGROUND_KEYS = ["background", "backgroundMotion", "backgroundLayers", "backgroundHue", "backdropBlur"] as const;

/** Each kind's own design settings, beside every part's. A component not named here has every part's only. */
const KIND_KEYS: Record<string, readonly string[]> = {
  row: ["sectionStyle", ...BACKGROUND_KEYS, "backgroundFixed", "backgroundAlign"],
  column: [...BACKGROUND_KEYS],
  "block:button": ["variant", "size", "shape", "fullWidth", "align", "fill", "hover"],
  "block:dualButton": ["size", "shape", "gap", "align", "hover"],
  "block:image": ["shape", "maxWidth", "align"],
  "block:separator": ["line", "thickness", "color", "width", "position"],
};

/** The settings a smaller screen size can hold that are design, not layout (`PartSizeSettings`). */
const SIZE_DESIGN_KEYS = new Set(["style", "border", "radius", "shadow", "shadowOpacity", "typography", "background", "backdropBlur", "align", "maxWidth"]);

/** The kind of a part, as its settings name it. */
export const styleKindOf = (target: { kind: "row" | "column" | "block" }, part: { type?: string }): StyleKind =>
  target.kind === "block" ? `block:${part.type ?? "unknown"}` : target.kind;

/** The design settings a kind of part has. */
export const styleKeys = (kind: StyleKind): readonly string[] => [...PART_KEYS, ...(KIND_KEYS[kind] ?? [])];

/** The design settings a kind of part has at a smaller size. */
const sizeKeys = (kind: StyleKind): string[] => styleKeys(kind).filter((key) => SIZE_DESIGN_KEYS.has(key));

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Copies the design of a part of this kind. */
export function copyStyle(kind: StyleKind, part: PartBase): CopiedStyle {
  const own = part as Record<string, unknown>;
  const values: Record<string, unknown> = {};
  for (const key of styleKeys(kind)) if (own[key] !== undefined) values[key] = clone(own[key]);
  const at: NonNullable<CopiedStyle["at"]> = {};
  for (const size of SMALLER_SIZES) {
    const settings = part.at?.[size] as Record<string, unknown> | undefined;
    if (!settings) continue;
    const kept: Record<string, unknown> = {};
    for (const key of sizeKeys(kind)) if (settings[key] !== undefined) kept[key] = clone(settings[key]);
    if (Object.keys(kept).length > 0) at[size] = kept;
  }
  return { kind, values, ...(Object.keys(at).length > 0 && { at }) };
}

/** Whether a copied style can be laid on a part of this kind. */
export const canPaste = (copied: CopiedStyle | null, kind: StyleKind): copied is CopiedStyle => copied !== null && copied.kind === kind;

/**
 * The change that lays a copied style on a part: each of its kind's design settings becomes the copied one, or none where the
 * copy has none (`undefined`, so a patch takes it away), and at each smaller size the design settings are the copy's while the
 * size's other settings stay.
 */
export function pasteStylePatch(part: PartBase, copied: CopiedStyle): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of styleKeys(copied.kind)) patch[key] = copied.values[key] === undefined ? undefined : clone(copied.values[key]);
  const at: Record<string, Record<string, unknown>> = {};
  for (const size of SMALLER_SIZES) {
    const settings: Record<string, unknown> = { ...(part.at?.[size] as Record<string, unknown> | undefined) };
    for (const key of sizeKeys(copied.kind)) delete settings[key];
    Object.assign(settings, clone(copied.at?.[size] ?? {}));
    if (Object.keys(settings).length > 0) at[size] = settings;
  }
  patch.at = Object.keys(at).length > 0 ? at : undefined;
  return patch;
}

/** Whether a part has any design of its own: the Design tab's dot. */
export function hasOwnStyle(kind: StyleKind, part: PartBase): boolean {
  const copied = copyStyle(kind, part);
  return Object.keys(copied.values).length > 0 || copied.at !== undefined;
}

/** A copied style read back (from the browser's storage): its shape checked, else null. */
export function readCopiedStyle(value: unknown): CopiedStyle | null {
  if (!value || typeof value !== "object") return null;
  const { kind, values, at } = value as Record<string, unknown>;
  if (typeof kind !== "string" || !(kind === "row" || kind === "column" || kind.startsWith("block:"))) return null;
  if (!values || typeof values !== "object" || Array.isArray(values)) return null;
  if (at !== undefined && (!at || typeof at !== "object" || Array.isArray(at))) return null;
  const keys = new Set(styleKeys(kind as StyleKind));
  const sized = new Set(sizeKeys(kind as StyleKind));
  // Only the kind's own design settings are taken, whatever else was stored.
  const kept = Object.fromEntries(Object.entries(values).filter(([key]) => keys.has(key)));
  const keptAt: NonNullable<CopiedStyle["at"]> = {};
  for (const size of SMALLER_SIZES) {
    const settings = (at as Record<string, unknown> | undefined)?.[size];
    if (!settings || typeof settings !== "object") continue;
    const entries = Object.entries(settings).filter(([key]) => sized.has(key));
    if (entries.length > 0) keptAt[size] = Object.fromEntries(entries);
  }
  return { kind: kind as StyleKind, values: kept, ...(Object.keys(keptAt).length > 0 && { at: keptAt }) };
}
