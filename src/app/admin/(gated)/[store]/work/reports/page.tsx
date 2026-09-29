import type { Metadata } from "next";

import { WorkComingSoon } from "@/components/admin/work/coming-soon";
import { WorkOff } from "@/components/admin/work/work-off";
import { requireMember } from "@/server/auth";

export const metadata: Metadata = { title: "Reports" };

/** A stand-in until this page is built: overwrite this file with the real page. */
export default async function WorkReportsPage({ params }: PageProps<"/admin/[store]/work/reports">) {
  const { store } = await requireMember((await params).store);
  if (!store.workOn) return <WorkOff storeSlug={store.slug} title="Reports" />;
  return <WorkComingSoon storeSlug={store.slug} title="Reports" />;
}
