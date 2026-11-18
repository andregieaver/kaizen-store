import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { requireExtension } from "@/components/admin/extension-off";
import { AdminLink, Card, Chip, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { storyLead } from "@/lib/flow-story";
import { listFlows } from "@/server/flows";
import { memberCan, requirePermission } from "@/server/permissions";

import { startWelcomeFlowAction } from "./actions";

export const metadata: Metadata = { title: "Flows" };

/**
 * A store's flows (D767 slice 2, email plan M3.3): each with what starts it and whether it is on, and one button that starts the welcome
 * series while there are none. `marketing:read` sees it; `marketing:write` starts one. Part of the email automation extension (D748).
 */
export default async function FlowsPage({ params }: PageProps<"/admin/[store]/flows">) {
  const member = await requirePermission((await params).store, "marketing:read");
  const notInAccount = requireExtension(member, "email_automation");
  if (notInAccount) return notInAccount;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "flows");
  const flows = await listFlows(store.id);
  const mayWrite = memberCan(member, "marketing:write");
  const start = mayWrite ? (
    <ActionForm action={startWelcomeFlowAction.bind(null, store.slug)}>
      <SubmitButton>{w.startWelcome}</SubmitButton>
    </ActionForm>
  ) : undefined;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.lead} actions={flows.length > 0 ? start : undefined} />
      {flows.length === 0 ? (
        <Card compact>
          <div className="flex flex-col items-start gap-3">
            <p className="text-body text-ink-2">{w.empty}</p>
            {start}
          </div>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3" aria-label={w.title}>
          {flows.map((flow) => (
            <li key={flow.id}>
              <Card compact>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex min-w-0 flex-col gap-1">
                    <AdminLink href={`/admin/${store.slug}/flows/${flow.id}`} className="text-body-strong text-ink underline-offset-2 hover:underline">
                      {flow.name}
                    </AdminLink>
                    <span className="text-caption text-muted">{storyLead(flow.trigger, flow.goals, w.story)}</span>
                  </span>
                  <Chip signal={flow.enabled ? "positive" : "neutral"} dot>
                    {flow.enabled ? w.statuses.on : w.statuses.off}
                  </Chip>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
