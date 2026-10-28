import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { Card, PageHeader } from "@/components/admin/ui";
import { NewWorkflow, WorkflowCard, type WorkflowActions, type WorkflowView } from "@/components/admin/workflows";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { EVENTS } from "@/lib/integrations";
import { memberCan, requirePermission } from "@/server/permissions";
import { listEndpoints } from "@/server/webhook-endpoints";
import { listWorkflows, workflowRuns } from "@/server/workflows";

import { deleteWorkflowAction, saveWorkflowAction, switchWorkflowAction, testWorkflowAction } from "./actions";

export const metadata: Metadata = { title: "Workflows" };

/** Settings → Workflows (D356): when something happens or at a set time, check and act; saved off, tested, then switched on. */
export default async function WorkflowsPage({ params }: PageProps<"/admin/[store]/settings/workflows">) {
  const member = await requirePermission((await params).store, "settings:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const all = adminText(lang, "notifications");
  const w = all.workflows;
  const canWrite = memberCan(member, "settings:write");
  const triggerLabels = Object.fromEntries(EVENTS.map((e) => [e.id, all.integrations.events[e.id]?.label ?? e.label]));
  const when = (iso: string) => new Date(iso).toLocaleString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone || "Europe/Oslo" });
  const [flows, endpoints] = await Promise.all([listWorkflows(store.id), listEndpoints(store.id)]);
  const views: WorkflowView[] = await Promise.all(
    flows.map(async (flow) => ({
      id: flow.id,
      name: flow.name,
      trigger: flow.trigger,
      schedule: flow.schedule,
      conditions: flow.conditions,
      actions: flow.actions,
      enabled: flow.enabled,
      tested: flow.testedVersion === flow.version,
      runs: (await workflowRuns(store.id, flow.id, 10)).map((r) => ({ id: r.id, when: when(r.at), status: r.status, matched: r.matched })),
    })),
  );
  const slug = store.slug;
  const actions: WorkflowActions = {
    save: saveWorkflowAction.bind(null, slug),
    test: testWorkflowAction.bind(null, slug),
    switchOn: switchWorkflowAction.bind(null, slug),
    remove: deleteWorkflowAction.bind(null, slug),
  };
  const endpointChoices = endpoints.map((e) => ({ id: e.id, name: e.name }));

  return (
    <AdminTextScope texts={adminTexts(lang, ["notifications"])}>
      <div className="flex flex-col gap-6">
        <PageHeader title={w.title} description={<>{w.description}</>} />
        {canWrite && (
          <Card title={w.make}>
            <NewWorkflow endpoints={endpointChoices} triggerLabels={triggerLabels} save={actions.save} />
          </Card>
        )}
        {views.length === 0 ? (
          <p className="text-sm text-muted">{w.none}</p>
        ) : (
          views.map((flow) => <WorkflowCard key={flow.id} flow={flow} endpoints={endpointChoices} triggerLabels={triggerLabels} canWrite={canWrite} actions={actions} />)
        )}
        <p className="text-sm text-muted">{w.limits}</p>
      </div>
    </AdminTextScope>
  );
}
