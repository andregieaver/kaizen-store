import type { Metadata } from "next";

import { LegalPagesPanel } from "@/components/admin/legal-pages-panel";
import { legalOverview } from "@/server/legal-starters";
import { requireOwnerRole } from "@/server/permissions";

import { createStarterAction, setLegalRoleAction, setTermsModeAction } from "./actions";

export const metadata: Metadata = { title: "Legal pages" };

/**
 * The store's legal pages (wave 1, 1e): starter drafts of the terms, privacy statement, returns and shipping policies, withdrawal information
 * and imprint, the published page chosen for each, and what checkout says about the terms. Owners only.
 */
export default async function LegalPagesPage({ params }: PageProps<"/admin/[store]/settings/legal">) {
  const member = await requireOwnerRole((await params).store);
  const overview = await legalOverview(member);
  const slug = member.store.slug;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Legal pages</h1>
        <p className="max-w-2xl text-sm text-muted">
          The texts a shop is expected to show: its terms, how it handles personal data, how returns and delivery work, the right to withdraw and who the
          business is. Start from a draft, make it yours, publish it, and choose it here.
        </p>
      </div>
      <LegalPagesPanel
        overview={overview}
        storeSlug={slug}
        actions={{
          createStarter: createStarterAction.bind(null, slug),
          setRole: setLegalRoleAction.bind(null, slug),
          setTerms: setTermsModeAction.bind(null, slug),
        }}
      />
    </div>
  );
}
