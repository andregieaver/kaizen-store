import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { StoreCopyProgress } from "@/components/admin/store-copy-progress";
import { requireAccount } from "@/server/auth";

import { copyProgressAction } from "../../copy-actions";

export const metadata: Metadata = { title: "Copying a store" };

/** How a copy is going (D129), for the owner who started it: the first answer is drawn here, the rest polled. */
export default async function StoreCopyProgressPage({ params }: PageProps<"/admin/stores/copies/[copyId]">) {
  const { copyId } = await params;
  await requireAccount();
  const first = await copyProgressAction(copyId);
  if (!first.ok) notFound();
  return <StoreCopyProgress id={copyId} progress={first.progress} read={copyProgressAction} />;
}
