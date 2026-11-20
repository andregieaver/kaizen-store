import type { Metadata } from "next";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";

import { RepliesManager } from "@/components/admin/support/replies-manager";
import { languageName } from "@/lib/support-translate";
import { areaTexts } from "@/lib/admin-area";
import { SUPPORT_WORDS } from "@/lib/admin-words/support";
import { requirePermission } from "@/server/permissions";
import { memberDesk } from "@/server/support-desk";
import { listReplies } from "@/server/support-replies";
import { PageHeader } from "@/components/admin/ui";

import { deleteReplyAction, saveReplyAction } from "./actions";
import { requireExtension } from "@/components/admin/extension-off";

export const metadata: Metadata = { title: "Saved replies" };

/** The store's desk's saved replies (D216, `docs/support.md` 2.4, step 13): read with `support:read`, written with `support:write`. */
export default async function SupportRepliesPage({
  params,
}: PageProps<"/admin/[store]/support/replies">) {
  const { store: slug } = await params;
  const member = await requirePermission(slug, "support:read");
  const notInAccount = requireExtension(member, "support_desk");
  if (notInAccount) return notInAccount;
  const staff = memberDesk(member);
  const lang = adminLangOf(member.account.adminLocale);
  const t = SUPPORT_WORDS[lang];
  const replies = await listReplies(staff);
  const languages = member.store.localization.locales.map((code) => ({
    code,
    name: languageName(code),
  }));
  return (
    <AdminTextScope texts={areaTexts(lang, { support: SUPPORT_WORDS })}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t.pages.storeReplies.title}
          description={<><span className="sm:hidden">{t.replies.phone.lead}</span><span className="max-sm:hidden">{t.pages.storeReplies.description}</span></>}
        />
        <RepliesManager
          replies={replies}
          languages={languages}
          save={staff.canWrite ? saveReplyAction.bind(null, slug) : null}
          remove={staff.canWrite ? deleteReplyAction.bind(null, slug) : null}
        />
      </div>
    </AdminTextScope>
  );
}
