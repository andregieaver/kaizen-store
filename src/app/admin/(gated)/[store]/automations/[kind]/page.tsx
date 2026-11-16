import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminTextScope } from "@/components/admin/admin-text";
import { AutomationEditor, AutomationSwitch } from "@/components/admin/automation-editor";
import { ButtonLink, Card, Chip, PageHeader } from "@/components/admin/ui";
import { countWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { DELAY_RANGES, FOLLOW_UP_POSITIONS, isLifecycle, isPickKind } from "@/lib/automations";
import { automationDays } from "@/lib/marketing-words";
import { getAutomation } from "@/server/automations";
import { uploadsEnabled } from "@/server/media";
import { memberCan, requirePermission } from "@/server/permissions";

import { findBroadcastFactsAction, suggestBroadcastAction, uploadBroadcastPictureAction } from "../../broadcasts/actions";
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
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "marketing");
  const wa = w.automations;
  const words = wa.kinds[kind];
  const wf = wa.followUps;
  const base = `/admin/${store.slug}/automations`;
  const mayWrite = memberCan(member, "marketing:write");
  const choices = mayWrite ? await broadcastChoices(store, lang) : null;
  return (
    <AdminTextScope texts={adminTexts(lang, ["marketing"])}>
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: base, label: wa.title }}
        title={words.title}
        status={
          <Chip signal={automation.enabled ? "positive" : "neutral"} dot>
            {automation.enabled ? w.common.on : w.common.off}
          </Chip>
        }
        description={`${words.does} ${automationDays(kind, automation.delayDays ?? 0, wa)}${isPickKind(kind) ? ` ${wf.picks}` : ""}`}
        actions={
          mayWrite && automation.saved ? <AutomationSwitch storeSlug={store.slug} kind={kind} on={automation.enabled} toggle={switchAutomationAction} /> : undefined
        }
      />
      {choices ? (
        <Card title={w.common.whatItSays} description={automation.saved ? undefined : wa.starterWords} compact>
          <AutomationEditor
            storeSlug={store.slug}
            kind={kind}
            initial={{ delayDays: automation.delayDays ?? DELAY_RANGES[kind].start, content: automation.content ?? {} }}
            range={DELAY_RANGES[kind]}
            daysLabel={words.daysLabel}
            locales={choices.locales}
            aiReady={choices.aiReady}
            save={saveAutomationAction}
            test={testAutomationAction}
            suggest={suggestBroadcastAction}
            facts={findBroadcastFactsAction}
            upload={uploadsEnabled() ? uploadBroadcastPictureAction : null}
          />
        </Card>
      ) : (
        <p className="text-body text-muted">{wa.mayNotChange}</p>
      )}
      {/* D657: the flow's further emails, one step away from the first; each its days after the one before. */}
      {automation.saved && (
        <Card title={wf.title} description={automation.followUps.length === 0 ? wf.none : wf.stops} compact>
          <div className="flex flex-col gap-3">
            {automation.followUps.length > 0 && (
              <ul className="flex flex-col divide-y divide-line">
                {automation.followUps.map((f) => (
                  <li key={f.position} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <span className="flex flex-col">
                      <span className="text-body text-ink">
                        {f.position === 2 ? wf.second : wf.third}: {f.content[store.localization.locales[0]]?.subject || "…"}
                      </span>
                      <span className="text-body text-ink-2">{countWords(f.delayDays, wf.after, { n: String(f.delayDays) })}</span>
                    </span>
                    <ButtonLink href={`${base}/${kind}/follow-ups/${f.position}`} kind="quiet">
                      {wf.edit}
                    </ButtonLink>
                  </li>
                ))}
              </ul>
            )}
            {mayWrite && automation.followUps.length < FOLLOW_UP_POSITIONS.length && (
              <div>
                <ButtonLink href={`${base}/${kind}/follow-ups/new`} kind="secondary">
                  {wf.add}
                </ButtonLink>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
    </AdminTextScope>
  );
}
