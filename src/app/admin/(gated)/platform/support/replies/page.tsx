import type { Metadata } from "next";

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
  const replies = await listReplies(staff);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Saved replies" description={<>Answers Kaizen&apos;s people use often, put in a reply with / in the inbox.</>} />
      <RepliesManager replies={replies} languages={KAIZEN_LANGUAGES.map((code) => ({ code, name: languageName(code) }))} save={saveKaizenReplyAction} remove={deleteKaizenReplyAction} />
    </div>
  );
}
