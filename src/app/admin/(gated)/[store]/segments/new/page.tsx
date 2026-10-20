import type { Metadata } from "next";

import { SegmentEditor } from "@/components/admin/segment-editor";
import { PageHeader } from "@/components/admin/ui";
import { SEGMENT_STARTERS } from "@/lib/segments";
import { memberCan, requirePermission } from "@/server/permissions";

import { previewSegmentAction, saveSegmentAction } from "../actions";
import { editorChoices } from "../editor-props";

export const metadata: Metadata = { title: "New segment" };

/** A new segment (D296): start from a ready one or from everyone, and see the count as the rules change. */
export default async function NewSegmentPage({ params }: PageProps<"/admin/[store]/segments/new">) {
  const member = await requirePermission((await params).store, "marketing:read");
  const { store } = member;
  const back = { href: `/admin/${store.slug}/segments`, label: "Segments" };
  if (!memberCan(member, "marketing:write")) {
    return <PageHeader back={back} title="New segment" description="Your role can see segments but not make them." />;
  }
  const choices = await editorChoices(store);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={back} title="New segment" />
      <SegmentEditor
        storeSlug={store.slug}
        segmentId={null}
        initial={{ name: "", rules: { match: "all", conditions: [] } }}
        starters={SEGMENT_STARTERS.filter((s) => choices.rfmReady || !s.rules.conditions.some((c) => c.kind === "rfm")).map((s) => ({ ...s }))}
        preview={previewSegmentAction}
        save={saveSegmentAction}
        {...choices}
      />
    </div>
  );
}
