"use server";

import { refresh, updateTag } from "next/cache";

import type { MenuSaveResult } from "@/server/menus";
import { checkPermission, NO_ACCESS } from "@/server/permissions";
import { discardStaging, keepStagedCopy, publishStaging, stageMenu, stagePage, stageTheme, startStaging, type PublishOutcome } from "@/server/site-staging";
import { designTags } from "@/server/design-presets";
import { pagesTag } from "@/server/pages";
import { storeTag } from "@/server/stores";

/** Staging the site changes what visitors will see, so every action asks `website:write` (D358); publishing asks each page's own key too. */
type Done = { ok: true } | { ok: false; problem: string };

export async function startStagingAction(storeSlug: string, name: string): Promise<Done> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problem: NO_ACCESS };
  const done = await startStaging(member, name);
  refresh();
  return done;
}

export async function stagePageAction(storeSlug: string, pageId: string, staged: boolean): Promise<Done> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problem: NO_ACCESS };
  const done = await stagePage(member, pageId, staged);
  refresh();
  return done;
}

/** Keeps the set's copy of a page whose live version changed since it was copied (D385): the person has seen what changed. */
export async function keepStagedCopyAction(storeSlug: string, pageId: string): Promise<Done> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problem: NO_ACCESS };
  const done = await keepStagedCopy(member, pageId);
  refresh();
  return done;
}

export async function stageThemeAction(storeSlug: string, installId: string | null): Promise<Done> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problem: NO_ACCESS };
  const done = await stageTheme(member, installId);
  refresh();
  return done;
}

/** The menu editor's save in staged mode: the change is kept in the set, not saved to the menu. */
export async function stageMenuAction(storeSlug: string, id: string | null, input: unknown): Promise<MenuSaveResult> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  if (!id) return { ok: false, problems: ["menu"] };
  const done = await stageMenu(member, id, input);
  return done.ok ? { ok: true, id } : done;
}

export async function dropStagedMenuAction(storeSlug: string, id: string): Promise<Done> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problem: NO_ACCESS };
  const done = await stageMenu(member, id, null);
  refresh();
  return done.ok ? { ok: true } : { ok: false, problem: done.problems[0] ?? "menu" };
}

export async function discardStagingAction(storeSlug: string): Promise<Done> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problem: NO_ACCESS };
  const done = await discardStaging(member);
  refresh();
  return done;
}

export async function publishStagingAction(
  storeSlug: string,
): Promise<{ ok: true; outcome: PublishOutcome } | { ok: false; problem: string; changed?: { id: string; title: string }[] }> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problem: NO_ACCESS };
  const done = await publishStaging(member);
  if (done.ok) {
    // The pages, the look and the menus: what the builder's Publish, Design settings and the menu saver each refresh.
    updateTag(pagesTag(member.store.id));
    updateTag(storeTag(member.store.slug));
    if (done.outcome.theme?.ok) for (const tag of designTags(member.store)) updateTag(tag);
  }
  refresh();
  return done;
}
