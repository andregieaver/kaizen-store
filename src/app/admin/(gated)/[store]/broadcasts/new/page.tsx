import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { BroadcastEditor } from "@/components/admin/broadcast-editor";
import { Card, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { memberCan, requirePermission } from "@/server/permissions";
import { uploadsEnabled } from "@/server/media";

import { audienceCountAction, saveBroadcastAction, findBroadcastFactsAction, suggestBroadcastAction, uploadBroadcastPictureAction } from "../actions";
import { broadcastChoices } from "../editor-props";

export const metadata: Metadata = { title: "New broadcast" };

/** A new broadcast (D297): written and saved as a draft, then tested and sent from its own page. */
export default async function NewBroadcastPage({ params }: PageProps<"/admin/[store]/broadcasts/new">) {
  const member = await requirePermission((await params).store, "marketing:read");
  const { store } = member;
  const base = `/admin/${store.slug}/broadcasts`;
  const lang = adminLangOf(member.account.adminLocale);
  const wb = adminText(lang, "marketing").broadcasts;
  if (!memberCan(member, "marketing:write")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader back={{ href: base, label: wb.title }} title={wb.newBroadcast} />
        <p className="text-body text-muted">{wb.mayNotWrite}</p>
      </div>
    );
  }
  const choices = await broadcastChoices(store, lang);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: base, label: wb.title }} title={wb.newBroadcast} description={wb.newDescription} />
      <Card compact>
        <AdminTextScope texts={adminTexts(lang, ["marketing"])}>
        <BroadcastEditor
          storeSlug={store.slug}
          broadcastId={null}
          initial={{ title: "", audience: "everyone", segmentId: null, content: {} }}
          {...choices}
          save={saveBroadcastAction}
          count={audienceCountAction}
          suggest={suggestBroadcastAction}
            facts={findBroadcastFactsAction}
          upload={uploadsEnabled() ? uploadBroadcastPictureAction : null}
        />
        </AdminTextScope>
      </Card>
    </div>
  );
}
