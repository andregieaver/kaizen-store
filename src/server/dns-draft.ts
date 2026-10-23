import "server-only";

import type { DnsChange } from "@/lib/dns-plan";
import { parseRecordLines, recipeChanges, RECIPE_IDS, type RecipeId } from "@/lib/dns-recipes";

import type { HolderRef } from "./domain-holder";
import { zoneRecords } from "./domain-dns";

/** What a DNS editor sends (D315 phase 3): records typed and records ticked to go, or a set-up with its values. */
export type DnsDraft =
  | { kind: "records"; add: string; remove: string[] }
  | { kind: "recipe"; recipe: RecipeId; values: Record<string, string> };

/** The changes a draft stands for, on the zone's live records, for any holder (a store's page or *Your domains*, D317). */
export async function draftChanges(holder: HolderRef, apex: string, draft: DnsDraft): Promise<{ ok: true; changes: DnsChange[] } | { ok: false; problems: string[] }> {
  const read = await zoneRecords(holder, apex);
  if (!read.ok) return read;
  if (draft.kind === "recipe") {
    if (!(RECIPE_IDS as string[]).includes(draft.recipe)) return { ok: false, problems: ["Choose what to set up."] };
    return recipeChanges(draft.recipe, draft.values ?? {}, read.records);
  }
  const parsed = parseRecordLines(String(draft.add ?? "").slice(0, 8000));
  if (parsed.problems.length > 0) return { ok: false, problems: parsed.problems };
  const removes = read.records.filter((r) => (draft.remove ?? []).includes(r.id));
  return { ok: true, changes: [...removes.map((r): DnsChange => ({ op: "remove", record: r })), ...parsed.records.map((r): DnsChange => ({ op: "add", record: r }))] };
}
