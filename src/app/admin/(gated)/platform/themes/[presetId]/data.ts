import "server-only";

import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import type { DesignRow } from "@/lib/design-presets";
import type { LifecycleFacts } from "@/lib/lifecycle";
import { SITE_DESIGN } from "@/lib/theme-admin-paths";
import { requirePlatformAdmin, type Account } from "@/server/auth";
import { designLifecycle, ensureWorkspace, getDesign, type DesignWorkspace } from "@/server/design-presets";
import { platformInstallLook } from "@/server/platform-theme-installs";
import { getStore, type Store } from "@/server/stores";

/**
 * A theme's page (D177): the platform admin (or a 404), the theme (or a 404) and the facts of its state. Read per request. An id of one of
 * Kaizena Flow's own site's installs is the address its page had before D273, sent on to the site's Design.
 */
export async function designPage(presetId: string): Promise<{ admin: Account; design: DesignRow; facts: LifecycleFacts & { used: boolean } }> {
  await connection();
  const admin = await requirePlatformAdmin();
  const design = await getDesign(presetId);
  if (!design) {
    const install = await platformInstallLook(presetId);
    if (install) redirect(install.live ? SITE_DESIGN : `${SITE_DESIGN}/${install.id}`);
    notFound();
  }
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
  if (!store) return { ...page, workspace: null, store: null, problem: "The theme's workspace could not be opened." };
  // A workspace made just now changed the profile's facts (it has one now).
  const design = page.design.workspaceStoreId ? page.design : ((await getDesign(presetId)) ?? page.design);
  return { ...page, design, workspace: ready.workspace, store, problem: null };
}
