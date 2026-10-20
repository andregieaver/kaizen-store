import type { Metadata } from "next";

import { BroadcastEditor } from "@/components/admin/broadcast-editor";
import { Card, PageHeader } from "@/components/admin/ui";
import { memberCan, requirePermission } from "@/server/permissions";
import { uploadsEnabled } from "@/server/media";

import { audienceCountAction, saveBroadcastAction, suggestBroadcastAction, uploadBroadcastPictureAction } from "../actions";
import { broadcastChoices } from "../editor-props";

export const metadata: Metadata = { title: "New broadcast" };

/** A new broadcast (D297): written and saved as a draft, then tested and sent from its own page. */
export default async function NewBroadcastPage({ params }: PageProps<"/admin/[store]/broadcasts/new">) {
  const member = await requirePermission((await params).store, "marketing:read");
  const { store } = member;
  const base = `/admin/${store.slug}/broadcasts`;
  if (!memberCan(member, "marketing:write")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader back={{ href: base, label: "Broadcasts" }} title="New broadcast" />
        <p className="text-body text-muted">Your role may read broadcasts but not write them.</p>
      </div>
    );
  }
  const choices = await broadcastChoices(store);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: base, label: "Broadcasts" }} title="New broadcast" description="Write it, save it, send a test to yourself, then send it." />
      <Card compact>
        <BroadcastEditor
          storeSlug={store.slug}
          broadcastId={null}
          initial={{ title: "", audience: "everyone", segmentId: null, content: {} }}
          {...choices}
          save={saveBroadcastAction}
          count={audienceCountAction}
          suggest={suggestBroadcastAction}
          upload={uploadsEnabled() ? uploadBroadcastPictureAction : null}
        />
      </Card>
    </div>
  );
}
