import type { Metadata } from "next";

import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { LegalPagesPanel } from "@/components/admin/legal-pages-panel";
import { legalOverview } from "@/server/legal-starters";
import { requireOwnerRole } from "@/server/permissions";
import { PageHeader } from "@/components/admin/ui";

import { createStarterAction, setLegalRoleAction, setTermsModeAction } from "./actions";

export const metadata: Metadata = { title: "Legal pages" };

/**
 * The store's legal pages (wave 1, 1e): starter drafts of the terms, privacy statement, returns and shipping policies, withdrawal information
 * and imprint, the published page chosen for each, and what checkout says about the terms. Owners only.
 */
export default async function LegalPagesPage({ params }: PageProps<"/admin/[store]/settings/legal">) {
  const member = await requireOwnerRole((await params).store);
  const overview = await legalOverview(member);
  const words = adminText(adminLangOf(member.account.adminLocale), "legal");
  const slug = member.store.slug;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={words.pages.title}
        description={words.pages.description}
      />
      <LegalPagesPanel
        overview={overview}
        storeSlug={slug}
        words={words}
        actions={{
          createStarter: createStarterAction.bind(null, slug),
          setRole: setLegalRoleAction.bind(null, slug),
          setTerms: setTermsModeAction.bind(null, slug),
        }}
      />
    </div>
  );
}
