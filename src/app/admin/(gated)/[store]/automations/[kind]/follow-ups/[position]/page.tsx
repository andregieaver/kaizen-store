import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminTextScope } from "@/components/admin/admin-text";
import { AutomationEditor } from "@/components/admin/automation-editor";
import { DeleteReminderButton } from "@/components/admin/delete-reminder-button";
import { Card, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { FOLLOW_UP_DAYS, FOLLOW_UP_POSITIONS, isLifecycle, isPickKind } from "@/lib/automations";
import { areaTexts } from "@/lib/admin-area";
import { MARKETING_WORDS } from "@/lib/admin-words/marketing";
import { getAutomation } from "@/server/automations";
import { uploadsEnabled } from "@/server/media";
import { memberCan, requirePermission } from "@/server/permissions";

import { findBroadcastFactsAction, suggestBroadcastAction, uploadBroadcastPictureAction } from "../../../../broadcasts/actions";
import { broadcastChoices } from "../../../../broadcasts/editor-props";
import { deleteFollowUpAction, saveFollowUpAction, testFollowUpAction } from "../../../actions";
import { requireExtension } from "@/components/admin/extension-off";

export const metadata: Metadata = { title: "Second or third email" };

/**
 * One follow-up of a lifecycle automation (D653): its days after the email before and its words, a test to yourself and delete. `new` starts
 * from the first email's words; its first save keeps it and moves here under its position.
 */
export default async function FollowUpPage({ params }: PageProps<"/admin/[store]/automations/[kind]/follow-ups/[position]">) {
  const { store: slug, kind, position } = await params;
  const member = await requirePermission(slug, "marketing:read");
  const notInAccount = requireExtension(member, "email_automation");
  if (notInAccount) return notInAccount;
  if (!isLifecycle(kind)) notFound();
  const { store } = member;
  const automation = await getAutomation(store, kind);
  if (!automation.saved) notFound();
  const at = FOLLOW_UP_POSITIONS.find((p) => String(p) === position) ?? null;
  const followUp = at ? automation.followUps.find((f) => f.position === at) : null;
  if (position !== "new" && !followUp) notFound();
  if (position === "new" && automation.followUps.length >= FOLLOW_UP_POSITIONS.length) notFound();
  const lang = adminLangOf(member.account.adminLocale);
  const w = MARKETING_WORDS[lang];
  const wa = w.automations;
  const wf = wa.followUps;
  const base = `/admin/${store.slug}/automations/${kind}`;
  const choices = memberCan(member, "marketing:write") ? await broadcastChoices(store, lang) : null;
  if (!choices) notFound();
  const name = `${kind}:${at ?? "new"}`;
  // A new one is the next: the second while there is none, else the third (ecosystem plan E3.7, D718: never a "follow-up").
  const title = (followUp ? followUp.position : FOLLOW_UP_POSITIONS[automation.followUps.length]) === 2 ? wf.second : wf.third;
  return (
    <AdminTextScope texts={areaTexts(lang, { marketing: MARKETING_WORDS })}>
      <div className="flex flex-col gap-6">
        <PageHeader back={{ href: base, label: wa.kinds[kind].title }} title={title} description={`${wf.stops}${isPickKind(kind) ? ` ${wf.picks}` : ""}`} />
        <Card title={w.common.whatItSays} description={followUp ? undefined : wf.newWords} compact>
          <AutomationEditor
            storeSlug={store.slug}
            kind={name}
            initial={{ delayDays: followUp?.delayDays ?? FOLLOW_UP_DAYS.start, content: followUp?.content ?? automation.content ?? {} }}
            range={FOLLOW_UP_DAYS}
            daysLabel={wf.daysLabel}
            locales={choices.locales}
            aiReady={choices.aiReady}
            save={saveFollowUpAction}
            test={testFollowUpAction}
            suggest={suggestBroadcastAction}
            facts={findBroadcastFactsAction}
            upload={uploadsEnabled() ? uploadBroadcastPictureAction : null}
          />
        </Card>
        {followUp && <DeleteReminderButton action={deleteFollowUpAction.bind(null, store.slug, name)} words={wf.delete} />}
      </div>
    </AdminTextScope>
  );
}
