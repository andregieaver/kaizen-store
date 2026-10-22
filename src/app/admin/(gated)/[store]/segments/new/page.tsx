import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { SegmentEditor } from "@/components/admin/segment-editor";
import { PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { SEGMENT_STARTERS } from "@/lib/segments";
import { memberCan, requirePermission } from "@/server/permissions";

import { previewSegmentAction, saveSegmentAction } from "../actions";
import { editorChoices } from "../editor-props";

export const metadata: Metadata = { title: "New segment" };

/** A new segment (D296): start from a ready one or from everyone, and see the count as the rules change. */
export default async function NewSegmentPage({ params }: PageProps<"/admin/[store]/segments/new">) {
  const member = await requirePermission((await params).store, "marketing:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "marketing");
  const back = { href: `/admin/${store.slug}/segments`, label: w.segments.title };
  if (!memberCan(member, "marketing:write")) {
    return <PageHeader back={back} title={w.segments.newSegment} description={w.segments.mayNotMake} />;
  }
  const choices = await editorChoices(store, lang);
  const starters = SEGMENT_STARTERS.filter((s) => choices.rfmReady || !s.rules.conditions.some((c) => c.kind === "rfm")).map((s) => ({
    ...s,
    ...(w.segments.starters[s.key] ?? {}),
  }));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={back} title={w.segments.newSegment} />
      <AdminTextScope texts={adminTexts(lang, ["marketing"])}>
        <SegmentEditor
          storeSlug={store.slug}
          segmentId={null}
          initial={{ name: "", rules: { match: "all", conditions: [] } }}
          starters={starters}
          preview={previewSegmentAction}
          save={saveSegmentAction}
          {...choices}
        />
      </AdminTextScope>
    </div>
  );
}
