import type { Metadata } from "next";

import { ButtonLink, FocusFrame } from "@/components/admin/ui";
import { adminText } from "@/lib/admin-text";

export const metadata: Metadata = { title: "Offline" };

/**
 * What the admin's service worker shows when a page cannot be fetched (D361): the same for everyone, so it is kept in the browser and never
 * holds an account's data; in English and Norwegian, as no account is known offline.
 */
export default function AdminOfflinePage() {
  const en = adminText("en", "shell").push;
  const nb = adminText("nb", "shell").push;
  return (
    <FocusFrame title={en.offlineTitle} description={en.offlineBody}>
      <div className="flex flex-col gap-4">
        <p lang="nb" className="text-body text-ink-2">
          <span className="text-body-strong text-ink">{nb.offlineTitle}.</span> {nb.offlineBody}
        </p>
        <div>
          <ButtonLink kind="main" href="/admin">
            {en.reload} · <span lang="nb">{nb.reload}</span>
          </ButtonLink>
        </div>
      </div>
    </FocusFrame>
  );
}
