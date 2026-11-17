import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "New automation rule" };

/**
 * A new automation rule (wave 3, D238, 2.5 point 2) is made as a workflow since the rules were folded into workflows (ecosystem plan E3.3, D718):
 * a workflow on *Order paid* tests what a rule tested and tags, emails staff, holds or asks the AI manager as a rule did. This address leads there.
 */
export default async function NewRulePage({ params }: PageProps<"/admin/[store]/settings/automation/new">) {
  const member = await requirePermission((await params).store, "settings:read");
  redirect(`/admin/${member.store.slug}/settings/workflows`);
}
