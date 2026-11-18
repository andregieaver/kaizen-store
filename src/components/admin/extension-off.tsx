import type { ReactElement } from "react";

import { storeExtensionOn, type ExtensionId } from "@/lib/extensions";
import { can, type PermissionHolder } from "@/lib/permissions";

import { ExtensionOffPanel } from "./extension-off-text";

/**
 * The gate of an admin page that is part of a paid extension (D748 E3): null while the account has it, else the `ExtensionOffPanel` the page
 * returns in place of itself. Called after the page's permission check (and any `requireFeature()`), with its membership:
 * `const off = requireExtension(member, "deals"); if (off) return off;`
 */
export function requireExtension(member: { store: { extensionFacts: unknown } } & PermissionHolder, extension: ExtensionId): ReactElement | null {
  if (storeExtensionOn(member.store, extension)) return null;
  return <ExtensionOffPanel extension={extension} owner={can(member, "owner")} />;
}
