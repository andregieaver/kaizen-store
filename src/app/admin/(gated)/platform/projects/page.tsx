import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { EmptyState, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { PLATFORM_WORDS } from "@/lib/admin-words/platform";
import { HOUSE_SLUG } from "@/lib/house-routing";
import { passMembership, requirePlatformReader } from "@/server/auth";
import { memberCan } from "@/server/permissions";

export const metadata: Metadata = { title: "Projects" };

/**
 * Kaizena Flow's own projects and checklists (D904, `docs/projects.md` P7.1). They live in its store, as its customers and deals do
 * (D466, D467): this entry opens that store's Projects for someone on its team, and says how to be added for anyone else. The store's
 * page switches the feature on if it is off.
 */
export default async function PlatformProjectsPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const account = await requirePlatformReader();
  const member = await passMembership(HOUSE_SLUG, account.id);
  if (member && memberCan(member, "projects:read")) redirect(`/admin/${HOUSE_SLUG}/projects`);
  const w = PLATFORM_WORDS[adminLangOf(account.adminLocale)].projects;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} />
      <EmptyState title={w.elsewhere}>{w.notMember}</EmptyState>
    </div>
  );
}
