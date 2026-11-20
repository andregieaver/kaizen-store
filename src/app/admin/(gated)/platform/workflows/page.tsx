import type { Metadata } from "next";
import { connection } from "next/server";

import { AdminTextScope } from "@/components/admin/admin-text";
import { PhoneRow } from "@/components/admin/phone-row";
import { Card, PageHeader } from "@/components/admin/ui";
import { NewWorkflow, WorkflowCard, type WorkflowActions, type WorkflowView } from "@/components/admin/workflows";
import { adminDate, PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { adminLangOf } from "@/lib/admin-lang";
import { PLATFORM_EVENTS } from "@/lib/platform-integrations";
import { areaTexts } from "@/lib/admin-area";
import { NOTIFICATIONS_WORDS } from "@/lib/admin-words/notifications";
import { NOTIFICATIONS_WORKFLOWS_WORDS } from "@/lib/admin-words/notifications-workflows";
import { PLATFORM_WORDS } from "@/lib/admin-words/platform";
import { platformCan, requirePlatformReader } from "@/server/auth";
import { listPlatformEndpoints } from "@/server/platform-endpoints";
import { listPlatformWorkflows, platformWorkflowRuns } from "@/server/platform-workflows";

import { deletePlatformWorkflowAction, savePlatformWorkflowAction, switchPlatformWorkflowAction, testPlatformWorkflowAction } from "./actions";

export const metadata: Metadata = { title: "Workflows" };

/**
 * Kaizena Flow's workflows (C4 step 3, D516): a store's Settings → Workflows (D356) for the platform's events. When something happens on
 * the platform or at a set time (Oslo's), check and act; saved off, tested on the latest event of its kind, then switched on. A platform
 * owner makes them; every role on the team reads them.
 */
export default async function PlatformWorkflowsPage() {
  await connection();
  const admin = await requirePlatformReader();
  const lang = adminLangOf(admin.adminLocale);
  const all = NOTIFICATIONS_WORDS[lang];
  const w = all.workflows;
  const own = PLATFORM_WORDS[lang];
  const canWrite = platformCan(admin, "settings");
  const triggerLabels = Object.fromEntries(PLATFORM_EVENTS.map((event) => [event, own.integrations.events[event]?.label ?? event]));
  const when = (iso: string) => adminDate(PLATFORM_TIME_ZONE, iso, "dayTime", lang);
  const [flows, endpoints] = await Promise.all([listPlatformWorkflows(), listPlatformEndpoints()]);
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
      runs: (await platformWorkflowRuns(flow.id, 10)).map((r) => ({ id: r.id, when: when(r.at), status: r.status, matched: r.matched })),
    })),
  );
  const actions: WorkflowActions = {
    save: savePlatformWorkflowAction,
    test: testPlatformWorkflowAction,
    switchOn: switchPlatformWorkflowAction,
    remove: deletePlatformWorkflowAction,
  };
  const endpointChoices = endpoints.map((e) => ({ id: e.id, name: e.name }));

  return (
    <AdminTextScope texts={areaTexts(lang, { notificationsWorkflows: NOTIFICATIONS_WORKFLOWS_WORDS })}>
      <div className="flex flex-col gap-6">
        <PageHeader title={w.title} description={<><span className="sm:hidden">{w.phone.lead}</span><span className="max-sm:hidden">{own.workflows.description}</span></>} />
        {/* Round 49 (D762), as the store's page: on a phone the workflows come first and a new one is a row under them. */}
        {canWrite && (
          <div className="max-sm:order-1 max-sm:overflow-hidden max-sm:rounded-card">
            <PhoneRow flat last title={w.make} sub={w.phone.makeSub} change={w.phone.open} done={w.phone.close}>
              <Card title={w.make}>
                <NewWorkflow endpoints={endpointChoices} triggerLabels={triggerLabels} save={actions.save} scope="platform" namePlaceholder={own.workflows.namePlaceholder} />
              </Card>
            </PhoneRow>
          </div>
        )}
        {views.length === 0 ? (
          <p className="text-sm text-muted">{w.none}</p>
        ) : (
          views.map((flow) => <WorkflowCard key={flow.id} flow={flow} endpoints={endpointChoices} triggerLabels={triggerLabels} canWrite={canWrite} actions={actions} scope="platform" />)
        )}
        <p className="text-sm text-muted max-sm:order-2">{own.workflows.limits}</p>
      </div>
    </AdminTextScope>
  );
}
