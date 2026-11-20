import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { StoreCopyProgress } from "@/components/admin/store-copy-progress";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";
import { areaTexts } from "@/lib/admin-area";
import { PLATFORM_COPY_WORDS } from "@/lib/admin-words/platform-copy";
import { requireAccount } from "@/server/auth";

import { copyProgressAction } from "../../copy-actions";

export const metadata: Metadata = { title: "Copying a store" };

/** How a copy is going (D129), for the owner who started it: the first answer is drawn here, the rest polled. */
export default async function StoreCopyProgressPage({
  params,
}: PageProps<"/admin/stores/copies/[copyId]">) {
  const { copyId } = await params;
  const account = await requireAccount();
  const first = await copyProgressAction(copyId);
  if (!first.ok) notFound();
  return (
    <AdminTextScope
      texts={areaTexts(adminLangOf(account.adminLocale), { platformCopy: PLATFORM_COPY_WORDS })}
    >
      <StoreCopyProgress
        id={copyId}
        progress={first.progress}
        read={copyProgressAction}
      />
    </AdminTextScope>
  );
}
