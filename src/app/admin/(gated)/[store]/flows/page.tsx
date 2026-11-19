import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { requireExtension } from "@/components/admin/extension-off";
import { AdminLink, Card, Chip, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { RECIPES, type RecipeKey } from "@/lib/flow-recipes";
import { storyLead } from "@/lib/flow-story";
import { getAutomations } from "@/server/automations";
import { listFlows } from "@/server/flows";
import { memberCan, requirePermission } from "@/server/permissions";

import { startRecipeFlowAction } from "./actions";

export const metadata: Metadata = { title: "Flows" };

/**
 * A store's flows (D767, email plan M3.1 and M3.3): each with what starts it and whether it is on, and below them the goals a flow starts
 * from (`RECIPES`), one Start each, for the goals the store has no flow for yet. `marketing:read` sees it; `marketing:write` starts one.
 * Part of the email automation extension (D748).
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
  const made = new Set(flows.map((f) => f.replaces));
  const goals = (Object.keys(RECIPES) as RecipeKey[]).filter((key) => !made.has(key));
  // A goal whose automation the owner already wrote starts from their words (slice 3, M2.2), and says so.
  const automations = mayWrite && goals.length > 0 ? await getAutomations(store) : null;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.lead} />
      {flows.length > 0 && (
        <ul className="flex flex-col gap-3" aria-label={w.title}>
          {flows.map((flow) => (
            <li key={flow.id}>
              <Card compact>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex min-w-0 flex-col gap-1">
                    <AdminLink href={`/admin/${store.slug}/flows/${flow.id}`} className="text-body-strong text-ink underline-offset-2 hover:underline">
                      {flow.name}
                    </AdminLink>
                    <span className="text-caption text-muted">{storyLead(flow.trigger, flow.goals, w.story, flow.triggerDays)}</span>
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
      {mayWrite && goals.length > 0 && (
        <section className="flex flex-col gap-3" aria-label={w.goals.title}>
          <h2 className="text-body-strong text-ink">{w.goals.title}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {goals.map((key) => (
              <Card compact key={key}>
                <div role="group" aria-label={w.goals[key].title} className="flex h-full flex-col items-start gap-2">
                  <p className="text-body-strong text-ink">{w.goals[key].title}</p>
                  <p className="flex-1 text-caption text-muted">{automations?.[key].saved ? w.goals.fromOwn : w.goals[key].text}</p>
                  <ActionForm action={startRecipeFlowAction.bind(null, store.slug, key)}>
                    <SubmitButton variant={flows.length === 0 ? "primary" : "secondary"}>{w.goals.start}</SubmitButton>
                  </ActionForm>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
