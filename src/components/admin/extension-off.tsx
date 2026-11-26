import type { ReactElement } from "react";

import { startTrialAction } from "@/app/admin/(gated)/[store]/extension-actions";
import { adminLangOf } from "@/lib/admin-lang";
import { EXTENSION_PITCH_WORDS } from "@/lib/admin-words/extension-pitch";
import { readExtensionFacts, standingOf, type ExtensionId } from "@/lib/extensions";
import { can, type PermissionHolder } from "@/lib/permissions";

import { ExtensionOffPanel } from "./extension-off-text";

/**
 * The gate of an admin page that is part of a paid extension (D748 E3, E5): null while the account has it, in its grace period or
 * read-only (the page opens to be read and exported; its actions refuse, and the store frame's banner says so), else the extension's
 * marker (`ExtensionOffPanel`) that the page returns in place of itself, handed its line in the member's language (a server area, so the
 * lines are not in every screen's words). Called after the page's permission check, with its membership:
 * `const off = requireExtension(member, "deals"); if (off) return off;`
 */
export function requireExtension(
  member: { store: { slug: string; extensionFacts: unknown }; account: { adminLocale?: string | null } } & PermissionHolder,
  extension: ExtensionId,
): ReactElement | null {
  if (standingOf(readExtensionFacts(member.store.extensionFacts), extension, new Date()).state !== "absent") return null;
  return (
    <ExtensionOffPanel
      extension={extension}
      pitch={EXTENSION_PITCH_WORDS[adminLangOf(member.account.adminLocale)][extension]}
      owner={can(member, "owner")}
      tryAction={startTrialAction.bind(null, member.store.slug, extension)}
    />
  );
}
