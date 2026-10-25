import type { Metadata } from "next";

import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { LegalPagesPanel } from "@/components/admin/legal-pages-panel";
import { legalOverview } from "@/server/legal-starters";
import { legalWriterAvailability, legalWrites } from "@/server/legal-writer";
import { requireOwnerRole } from "@/server/permissions";
import { PageHeader } from "@/components/admin/ui";

import { createStarterAction, setLegalRoleAction, setTermsModeAction, writeWithAiAction } from "./actions";

export const metadata: Metadata = { title: "Legal pages" };

/** Room for the AI to write a page after the press (D311, unit L2); the five-minute dispatcher takes what is left. */
export const maxDuration = 300;

/**
 * The store's legal pages (wave 1, 1e): starter drafts of the terms, privacy statement, returns and shipping policies, withdrawal information
 * and imprint, the published page chosen for each, the AI's drafts of them (D311), and what checkout says about the terms. Owners only.
 */
export default async function LegalPagesPage({ params }: PageProps<"/admin/[store]/settings/legal">) {
  const member = await requireOwnerRole((await params).store);
  const [overview, available, writes] = await Promise.all([legalOverview(member), legalWriterAvailability(member.store), legalWrites(member.store.id)]);
  const lang = adminLangOf(member.account.adminLocale);
  const words = adminText(lang, "legal");
  const slug = member.store.slug;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={words.pages.title}
        description={words.pages.description}
      />
      <LegalPagesPanel
        overview={overview}
        ai={{ available: available.ok, reason: available.ok ? null : available.reason, writes }}
        storeSlug={slug}
        words={words}
        lang={lang}
        actions={{
          createStarter: createStarterAction.bind(null, slug),
          setRole: setLegalRoleAction.bind(null, slug),
          setTerms: setTermsModeAction.bind(null, slug),
          writeWithAi: writeWithAiAction.bind(null, slug),
        }}
      />
    </div>
  );
}
