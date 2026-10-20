import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AutomationEditor, AutomationSwitch } from "@/components/admin/automation-editor";
import { Card, Chip, PageHeader } from "@/components/admin/ui";
import { AUTOMATION_WORDS, DELAY_RANGES, isLifecycle } from "@/lib/automations";
import { getAutomation } from "@/server/automations";
import { uploadsEnabled } from "@/server/media";
import { memberCan, requirePermission } from "@/server/permissions";

import { suggestBroadcastAction, uploadBroadcastPictureAction } from "../../broadcasts/actions";
import { broadcastChoices } from "../../broadcasts/editor-props";
import { saveAutomationAction, switchAutomationAction, testAutomationAction } from "../actions";

export const metadata: Metadata = { title: "Email automation" };

/** One lifecycle automation (D298, 6.6): its days, its words per language, a test to yourself and the switch. */
export default async function AutomationPage({ params }: PageProps<"/admin/[store]/automations/[kind]">) {
  const { store: slug, kind } = await params;
  const member = await requirePermission(slug, "marketing:read");
  if (!isLifecycle(kind)) notFound();
  const { store } = member;
  const automation = await getAutomation(store, kind);
  const words = AUTOMATION_WORDS[kind];
  const base = `/admin/${store.slug}/automations`;
  const mayWrite = memberCan(member, "marketing:write");
  const choices = mayWrite ? await broadcastChoices(store) : null;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: base, label: "Email automations" }}
        title={words.title}
        status={
          <Chip signal={automation.enabled ? "positive" : "neutral"} dot>
            {automation.enabled ? "On" : "Off"}
          </Chip>
        }
        description={`${words.does} ${words.days?.(automation.delayDays ?? 0) ?? ""}`}
        actions={
          mayWrite && automation.saved ? <AutomationSwitch storeSlug={store.slug} kind={kind} on={automation.enabled} toggle={switchAutomationAction} /> : undefined
        }
      />
      {choices ? (
        <Card title="What it says" description={automation.saved ? undefined : "These are words to start from. Change them as you like and save; then switch it on."} compact>
          <AutomationEditor
            storeSlug={store.slug}
            kind={kind}
            initial={{ delayDays: automation.delayDays ?? DELAY_RANGES[kind].start, content: automation.content ?? {} }}
            range={DELAY_RANGES[kind]}
            daysLabel={words.daysLabel ?? "Days"}
            locales={choices.locales}
            aiReady={choices.aiReady}
            save={saveAutomationAction}
            test={testAutomationAction}
            suggest={suggestBroadcastAction}
            upload={uploadsEnabled() ? uploadBroadcastPictureAction : null}
          />
        </Card>
      ) : (
        <p className="text-body text-muted">Your role may read automations but not change them.</p>
      )}
    </div>
  );
}
