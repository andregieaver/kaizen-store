import "server-only";

import { notFound } from "next/navigation";
import { connection } from "next/server";

import type { DesignRow } from "@/lib/design-presets";
import type { LifecycleFacts } from "@/lib/lifecycle";
import { requirePlatformAdmin, type Account } from "@/server/auth";
import { designLifecycle, ensureWorkspace, getDesign, type DesignWorkspace } from "@/server/design-presets";
import { getStore, type Store } from "@/server/stores";

/** A design profile's page (D177): the platform admin (or a 404), the profile (or a 404) and the facts of its state. Read per request. */
export async function designPage(presetId: string): Promise<{ admin: Account; design: DesignRow; facts: LifecycleFacts & { used: boolean } }> {
  await connection();
  const admin = await requirePlatformAdmin();
  const design = await getDesign(presetId);
  if (!design) notFound();
  return { admin, design, facts: await designLifecycle(design) };
}

/**
 * The same, with the profile's workspace store to edit (made the first time a profile from before D177 is edited, `ensureWorkspace()`), or
 * why it could not be made.
 */
export async function designWorkspacePage(presetId: string): Promise<
  Awaited<ReturnType<typeof designPage>> & ({ workspace: DesignWorkspace; store: Store; problem: null } | { workspace: null; store: null; problem: string })
> {
  const page = await designPage(presetId);
  const ready = await ensureWorkspace(page.admin, presetId);
  if (!ready.ok) return { ...page, workspace: null, store: null, problem: ready.problems.join(" ") };
  const store = await getStore(ready.workspace.store.slug);
  if (!store) return { ...page, workspace: null, store: null, problem: "The design profile's workspace could not be opened." };
  // A workspace made just now changed the profile's facts (it has one now).
  const design = page.design.workspaceStoreId ? page.design : ((await getDesign(presetId)) ?? page.design);
  return { ...page, design, workspace: ready.workspace, store, problem: null };
}
