import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { VARIATIONS_MAX, type DesignVariation } from "@/lib/design-presets";
import { variationKey, variationName, type DraftVariation } from "@/lib/design-variations";
import { parseStoreTheme, storeThemeInput, type StoreTheme } from "@/lib/theme";
import { themeFontFamilies } from "@/lib/theme-elements";

import { audit, type Account } from "./auth";
import { designProblem, draftVariations, ensureWorkspace, getDesign, type ApplyDeps, type DesignResult } from "./design-presets";
import { installFonts } from "./fonts";
import { checkStoreTheme } from "./themes";

/**
 * A theme's presets as the platform's admins draft them (`docs/theme-showcase-phase-1.md` step 1; variations in code): added as a copy of
 * the theme's drafted settings, renamed, ordered, removed, and their looks edited in the theme editor. Every function is a platform admin's
 * and works on the theme's own rows only; Publish copies them into the version (`publishDesign()`). Audited `platform.design_variation_*`.
 */

type Row = Record<string, unknown>;
const NOT_YOURS = "Only Kaizena Flow's admins edit themes.";
const refuse = (message: string): { ok: false; problems: string[] } => ({ ok: false, problems: [message] });

/** The theme's drafted presets for its *Presets* tab, the theme's own look first (as the editor shows it). */
export async function listVariations(admin: Account, presetId: string): Promise<DraftVariation[]> {
  if (!admin.platformAdmin) return [];
  return draftVariations(presetId);
}

/** One drafted preset as the theme editor edits it, or null. */
export async function variationForEdit(admin: Account, presetId: string, key: string): Promise<(DraftVariation & { storeTheme: StoreTheme }) | null> {
  if (!admin.platformAdmin) return null;
  const found = (await draftVariations(presetId)).find((v) => v.key === key);
  return found ? { ...found, storeTheme: { base: found.theme.base, savedId: null, settings: found.theme.settings } } : null;
}

/**
 * Adds a preset: named, with a key from its name, starting as a copy of the theme's drafted look (its workspace's theme), or as `look` when
 * given (a demo store's theme settings, D277: *Publish this look… → As a preset*), checked as a store's theme is against the workspace.
 */
export async function addVariation(admin: Account, presetId: string, nameInput: unknown, look?: StoreTheme): Promise<DesignResult<{ key: string }>> {
  if (!admin.platformAdmin) return refuse(NOT_YOURS);
  const name = variationName(nameInput);
  if (!name) return refuse("Give the preset a name.");
  const design = await getDesign(presetId);
  if (!design) return refuse("Unknown theme.");
  if (design.archivedAt) return refuse("This theme is archived. Restore it before changing its presets.");
  const workspace = await ensureWorkspace(admin, presetId);
  if (!workspace.ok) return workspace;
  const existing = await draftVariations(presetId);
  if (existing.length >= VARIATIONS_MAX) return refuse(`A theme has at most ${VARIATIONS_MAX + 1} presets: its own look and ${VARIATIONS_MAX} more.`);
  if (existing.some((v) => v.name.toLowerCase() === name.toLowerCase())) return refuse("Another preset of this theme has that name.");
  let theme: StoreTheme;
  if (look) {
    const checked = await checkStoreTheme(workspace.workspace.store.id, { ...look, savedId: null });
    if (!checked.ok) return checked;
    theme = checked.theme;
  } else {
    const [store] = await db().execute<Row>(sql`select theme from commerce.stores where id = ${workspace.workspace.store.id}::uuid`);
    theme = parseStoreTheme(store?.theme);
  }
  const key = variationKey(name, existing.map((v) => v.key));
  try {
    await db().execute(sql`
      insert into commerce.design_variations (preset_id, key, name, position, theme, created_by, updated_by)
      values (${presetId}::uuid, ${key}, ${name}, ${Math.max(0, ...existing.map((v) => v.position)) + 1},
        ${JSON.stringify({ base: theme.base, settings: theme.settings })}::jsonb, ${admin.id}::uuid, ${admin.id}::uuid)
    `);
  } catch (error) {
    return refuse(variationProblem(error));
  }
  await audit(admin.id, design.workspaceStoreId, "platform.design_variation_added", { preset: presetId, variation: key, from: look ? "store" : "theme" }, {
    target: { type: "design_preset", id: presetId },
  });
  return { ok: true, key };
}

/** Renames a preset; its key (in installs and addresses) stays. */
export async function renameVariation(admin: Account, presetId: string, key: string, nameInput: unknown): Promise<DesignResult> {
  if (!admin.platformAdmin) return refuse(NOT_YOURS);
  const name = variationName(nameInput);
  if (!name) return refuse("Give the preset a name.");
  const existing = await draftVariations(presetId);
  if (!existing.some((v) => v.key === key)) return refuse("That preset is not this theme's.");
  if (existing.some((v) => v.key !== key && v.name.toLowerCase() === name.toLowerCase())) return refuse("Another preset of this theme has that name.");
  await db().execute(sql`
    update commerce.design_variations set name = ${name}, updated_by = ${admin.id}::uuid where preset_id = ${presetId}::uuid and key = ${key}
  `);
  await audit(admin.id, null, "platform.design_variation_renamed", { preset: presetId, variation: key }, { target: { type: "design_preset", id: presetId } });
  return { ok: true };
}

/** Moves a preset one place up or down among the theme's (the theme's own look stays first). */
export async function moveVariation(admin: Account, presetId: string, key: string, direction: "up" | "down"): Promise<DesignResult> {
  if (!admin.platformAdmin) return refuse(NOT_YOURS);
  const list = await draftVariations(presetId);
  const at = list.findIndex((v) => v.key === key);
  if (at < 0) return refuse("That preset is not this theme's.");
  const to = direction === "up" ? at - 1 : at + 1;
  if (to < 0 || to >= list.length) return { ok: true };
  const order = [...list];
  [order[at], order[to]] = [order[to], order[at]];
  await db().transaction(async (tx) => {
    for (const [position, v] of order.entries()) {
      await tx.execute(sql`update commerce.design_variations set position = ${position + 1} where id = ${v.id}::uuid and preset_id = ${presetId}::uuid`);
    }
  });
  await audit(admin.id, null, "platform.design_variation_moved", { preset: presetId, variation: key, direction }, { target: { type: "design_preset", id: presetId } });
  return { ok: true };
}

/**
 * Takes a preset out of the draft. Stores that installed it keep what they have; at the next version they get the theme's own look, told so
 * in *What's new*, and a version that brings a preset of the same key back brings them back to it.
 */
export async function removeVariation(admin: Account, presetId: string, key: string): Promise<DesignResult> {
  if (!admin.platformAdmin) return refuse(NOT_YOURS);
  const [row] = await db().execute<Row>(sql`
    delete from commerce.design_variations where preset_id = ${presetId}::uuid and key = ${key} returning id
  `);
  if (!row) return refuse("That preset is not this theme's.");
  await audit(admin.id, null, "platform.design_variation_removed", { preset: presetId, variation: key }, { target: { type: "design_preset", id: presetId } });
  return { ok: true };
}

/**
 * Saves a preset's look from the theme editor: checked as a store's theme is (`checkStoreTheme()` against the theme's workspace, so its fonts
 * are installed and no saved theme of another store is named), kept in the draft.
 */
export async function saveVariationTheme(
  admin: Account,
  presetId: string,
  key: string,
  input: unknown,
): Promise<{ ok: true; theme: StoreTheme } | { ok: false; problems: string[] }> {
  if (!admin.platformAdmin) return refuse(NOT_YOURS);
  const workspace = await ensureWorkspace(admin, presetId);
  if (!workspace.ok) return workspace;
  const checked = await checkStoreTheme(workspace.workspace.store.id, input);
  if (!checked.ok) return checked;
  const theme = { ...checked.theme, savedId: null };
  const [row] = await db().execute<Row>(sql`
    update commerce.design_variations set theme = ${JSON.stringify({ base: theme.base, settings: theme.settings })}::jsonb, updated_by = ${admin.id}::uuid
    where preset_id = ${presetId}::uuid and key = ${key} returning id
  `);
  if (!row) return refuse("That preset is not this theme's.");
  await audit(admin.id, workspace.workspace.store.id, "platform.design_variation_saved", { preset: presetId, variation: key, base: theme.base }, {
    target: { type: "design_preset", id: presetId },
  });
  return { ok: true, theme };
}

/** The plain words for a refusal of the presets' database rules. */
function variationProblem(error: unknown): string {
  const text = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : String(error);
  if (text.includes("design_variations.limit")) return `A theme has at most ${VARIATIONS_MAX + 1} presets: its own look and ${VARIATIONS_MAX} more.`;
  if (text.includes("design_variations_key_idx")) return "Another preset of this theme has that name. Try another.";
  if (text.includes("design_variations_name")) return "A preset's name is 1 to 40 characters.";
  if (text.includes("design_variations_theme")) return "That preset's look is too large to keep.";
  return designProblem(error);
}

/**
 * A launch theme's presets written into its draft from code (D246, `docs/theme-showcase-phase-1.md` step 3, `LAUNCH_THEMES`): each by its
 * fixed key, named and ordered as the code says, its look checked as a store's theme is and its fonts installed (`deps.installFonts` in
 * tests); a drafted preset the code no longer has is taken out (installs of it keep the theme's own look, said in *What's new*). Publish
 * copies them into the version as any theme's.
 */
export async function writeLaunchVariations(
  admin: Account,
  presetId: string,
  variations: DesignVariation[],
  deps: Pick<ApplyDeps, "installFonts"> = {},
): Promise<DesignResult> {
  if (!admin.platformAdmin) return refuse(NOT_YOURS);
  if (variations.length > VARIATIONS_MAX) return refuse(`A theme has at most ${VARIATIONS_MAX + 1} presets: its own look and ${VARIATIONS_MAX} more.`);
  const looks: { key: string; name: string; theme: string }[] = [];
  for (const variation of variations) {
    const parsed = storeThemeInput.safeParse({ base: variation.theme.base, savedId: null, settings: variation.theme.settings });
    if (!parsed.success) return refuse(`${variation.name}: ${parsed.error.issues[0]?.message ?? "its look cannot be read."}`);
    const fonts = await (deps.installFonts ?? installFonts)(themeFontFamilies(parsed.data.settings));
    if (!fonts.ok) return refuse(`${variation.name}: ${fonts.problem}`);
    looks.push({ key: variation.key, name: variation.name, theme: JSON.stringify({ base: parsed.data.base, settings: parsed.data.settings }) });
  }
  try {
    await db().transaction(async (tx) => {
      await tx.execute(sql`
        delete from commerce.design_variations where preset_id = ${presetId}::uuid and not (key = any(${`{${looks.map((l) => l.key).join(",")}}`}::text[]))
      `);
      for (const [index, look] of looks.entries()) {
        await tx.execute(sql`
          insert into commerce.design_variations (preset_id, key, name, position, theme, created_by, updated_by)
          values (${presetId}::uuid, ${look.key}, ${look.name}, ${index + 1}, ${look.theme}::jsonb, ${admin.id}::uuid, ${admin.id}::uuid)
          on conflict (preset_id, key) do update set name = excluded.name, position = excluded.position, theme = excluded.theme, updated_by = excluded.updated_by
        `);
      }
    });
  } catch (error) {
    return refuse(variationProblem(error));
  }
  return { ok: true };
}
