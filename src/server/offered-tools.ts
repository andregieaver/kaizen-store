import "server-only";

import { PLATFORM_TOOLS } from "@/lib/manager-tools";
import { toolOffered } from "@/lib/owner-tool-features";
import { mayUseTool } from "@/lib/owner-tool-permissions";
import { OWNER_TOOLS, type OwnerTool } from "@/lib/owner-tools";
import type { PermissionHolder } from "@/lib/permissions";

import type { Store } from "./stores";

/**
 * The store's or the platform's tools a person may use here (never the manager's own): their role's (`mayUseTool()`), of the store's
 * features that are on (`toolOffered()`, D178). The AI manager offers exactly these, and a plan's steps may name only these (D309).
 */
export function offeredTools(p: { store: Store | null; holder?: PermissionHolder }): OwnerTool[] {
  if (!p.store) return [...PLATFORM_TOOLS];
  const store = p.store;
  return OWNER_TOOLS.filter((t) => (!p.holder || mayUseTool(p.holder, t.name)) && toolOffered(store, t.name));
}

export const offeredToolsByName = (p: { store: Store | null; holder?: PermissionHolder }): Record<string, OwnerTool> =>
  Object.fromEntries(offeredTools(p).map((t) => [t.name, t]));
