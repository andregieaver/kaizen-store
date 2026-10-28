import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { NoticeList } from "@/components/admin/ai-notices";
import { Card, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { requireAccount } from "@/server/auth";

export const metadata: Metadata = { title: "AI manager notices" };

/**
 * The AI manager's notices in every place the person works (D350): what it finished or waits on while they were away, each opening its
 * conversation or page. The list is the panel's, for every store and Kaizena Flow's own site at once.
 */
export default async function NoticesPage() {
  const account = await requireAccount();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "assistant").notices;
  return (
    <AdminTextScope texts={adminTexts(lang, ["assistant"])}>
      <div className="flex flex-col gap-6">
        <PageHeader title={w.pageTitle} description={w.pageDescription} />
        <Card>
          <NoticeList place="all" showPlace />
        </Card>
      </div>
    </AdminTextScope>
  );
}
