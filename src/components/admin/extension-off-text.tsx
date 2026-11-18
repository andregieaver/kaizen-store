"use client";

import { fillWords } from "@/lib/admin-fill";
import type { ExtensionId } from "@/lib/extensions";

import { useAdminText } from "./admin-text";

/**
 * What a page of a paid extension the account does not have shows in its place (D748 E3), in the account's language from `common.extensions`.
 * Step E5 makes it the extension's marker, with its trial one press away.
 */
export function ExtensionOffPanel({ extension, owner }: { extension: ExtensionId; owner: boolean }) {
  const w = useAdminText("common").extensions;
  return (
    <section aria-labelledby="extension-off-heading" className="flex flex-col gap-3 rounded-panel bg-sunken p-5">
      <h1 id="extension-off-heading" className="text-xl font-medium">
        {fillWords(w.off, { name: w.names[extension] })}
      </h1>
      <p className="text-sm text-muted">{w.hidden}</p>
      {!owner && <p className="text-sm">{w.onlyOwner}</p>}
    </section>
  );
}
