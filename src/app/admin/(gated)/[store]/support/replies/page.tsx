import type { Metadata } from "next";

import { RepliesManager } from "@/components/admin/support/replies-manager";
import { languageName } from "@/lib/support-translate";
import { requirePermission } from "@/server/permissions";
import { memberDesk } from "@/server/support-desk";
import { listReplies } from "@/server/support-replies";

import { deleteReplyAction, saveReplyAction } from "./actions";

export const metadata: Metadata = { title: "Saved replies" };

/** The store's desk's saved replies (D216, `docs/support.md` 2.4, step 13): read with `support:read`, written with `support:write`. */
export default async function SupportRepliesPage({ params }: PageProps<"/admin/[store]/support/replies">) {
  const { store: slug } = await params;
  const member = await requirePermission(slug, "support:read");
  const staff = memberDesk(member);
  const replies = await listReplies(staff);
  const languages = member.store.localization.locales.map((code) => ({ code, name: languageName(code) }));
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-display text-ink">Saved replies</h1>
        <p className="text-muted">Answers your team uses often, put in a reply with / in the inbox.</p>
      </div>
      <RepliesManager
        replies={replies}
        languages={languages}
        save={staff.canWrite ? saveReplyAction.bind(null, slug) : null}
        remove={staff.canWrite ? deleteReplyAction.bind(null, slug) : null}
      />
    </div>
  );
}
