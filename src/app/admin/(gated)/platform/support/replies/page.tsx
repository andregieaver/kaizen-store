import type { Metadata } from "next";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";

import { RepliesManager } from "@/components/admin/support/replies-manager";
import { languageName } from "@/lib/support-translate";
import { kaizenDesk } from "@/server/support-desk";
import { listReplies } from "@/server/support-replies";
import { PageHeader } from "@/components/admin/ui";

import { deleteKaizenReplyAction, saveKaizenReplyAction } from "./actions";

export const metadata: Metadata = { title: "Saved replies" };

/** The languages Kaizen's own site speaks in its chat. */
const KAIZEN_LANGUAGES = ["en", "nb", "sv", "da"];

/** Kaizen's desk's saved replies (D216, step 13): platform admins. */
export default async function KaizenSupportRepliesPage() {
  const staff = await kaizenDesk();
  const lang = adminLangOf(staff.account.adminLocale);
  const t = adminText(lang, "support");
  const replies = await listReplies(staff);
  return (
    <AdminTextScope texts={adminTexts(lang, ["support"])}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t.pages.platformReplies.title}
          description={t.pages.platformReplies.description}
        />
        <RepliesManager
          replies={replies}
          languages={KAIZEN_LANGUAGES.map((code) => ({
            code,
            name: languageName(code),
          }))}
          save={saveKaizenReplyAction}
          remove={deleteKaizenReplyAction}
        />
      </div>
    </AdminTextScope>
  );
}
