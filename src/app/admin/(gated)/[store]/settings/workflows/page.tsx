import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { AdminLink, Card, PageHeader } from "@/components/admin/ui";
import { NewWorkflow, WorkflowCard, type WorkflowActions, type WorkflowView } from "@/components/admin/workflows";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { EVENTS } from "@/lib/integrations";
import { listValues } from "@/lib/workflows";
import { listProductChoices } from "@/server/discounts";
import { memberCan, requirePermission } from "@/server/permissions";
import { listEndpoints } from "@/server/webhook-endpoints";
import { listWorkflows, workflowRuns } from "@/server/workflows";

import { deleteWorkflowAction, saveWorkflowAction, switchWorkflowAction, testWorkflowAction } from "./actions";

export const metadata: Metadata = { title: "Workflows" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Settings → Workflows (D356): when something happens or at a set time, check and act; saved off, tested, then switched on. After the order
 * rules were moved here (ecosystem plan E3.3, D718) the address names them (`moved`, their ids) and the page says which they are, in words.
 */
export default async function WorkflowsPage({ params, searchParams }: PageProps<"/admin/[store]/settings/workflows">) {
  const member = await requirePermission((await params).store, "settings:read");
  const movedParam = (await searchParams).moved;
  const movedIds = new Set((typeof movedParam === "string" ? movedParam.split(",") : []).filter((id) => UUID.test(id)).map((id) => id.toLowerCase()));
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
  const moved = flows.filter((f) => movedIds.has(f.id));
  const movedWords = adminText(lang, "automatic").moved;
  // A paid order's product conditions (E3.3) by the products' names.
  const productIds = new Set(flows.flatMap((f) => f.conditions.filter((c) => c.field === "order.products").flatMap((c) => listValues(c.value))));
  const valueLabels =
    productIds.size === 0
      ? {}
      : Object.fromEntries((await listProductChoices(store.id, store.markets[0]?.ownLocale ?? "en-GB")).filter((p) => productIds.has(p.id)).map((p) => [p.id, p.title]));

  return (
    <AdminTextScope texts={adminTexts(lang, ["notifications"])}>
      <div className="flex flex-col gap-6">
        <PageHeader title={w.title} description={<>{w.description}</>} />
        {moved.length > 0 && (
          <Card title={movedWords.title}>
            <p role="status" className="text-body text-ink">
              {fillWords(movedWords.text, { names: moved.map((f) => f.name).join(", ") })}
            </p>
            <p className="mt-2 text-body text-muted">
              <AdminLink href={`/admin/${store.slug}/settings/automation/log`} className="underline underline-offset-2">
                {movedWords.log}
              </AdminLink>
            </p>
          </Card>
        )}
        {canWrite && (
          <Card title={w.make}>
            <NewWorkflow endpoints={endpointChoices} triggerLabels={triggerLabels} save={actions.save} />
          </Card>
        )}
        {views.length === 0 ? (
          <p className="text-sm text-muted">{w.none}</p>
        ) : (
          views.map((flow) => <WorkflowCard key={flow.id} flow={flow} endpoints={endpointChoices} triggerLabels={triggerLabels} canWrite={canWrite} actions={actions} valueLabels={valueLabels} />)
        )}
        <p className="text-sm text-muted">{w.limits}</p>
      </div>
    </AdminTextScope>
  );
}
