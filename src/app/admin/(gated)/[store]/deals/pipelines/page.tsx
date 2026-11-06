import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { StagesEditor } from "@/components/admin/deals/stages-editor";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { requireFeature } from "@/components/admin/feature-off";
import { Card, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { ensurePipeline } from "@/server/deals";
import { memberCan, requirePermission } from "@/server/permissions";

import { createPipelineAction, deletePipelineAction, renamePipelineAction, saveStagesAction } from "../actions";

export const metadata: Metadata = { title: "Pipelines" };

const control = "min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal";

/**
 * The store's pipelines (S2, D464), Lisa's page: each pipeline's name and its stages in order, with the chance a deal in each is won and
 * the stage sent quotes belong in; a pipeline added, or deleted once no deal is in it. Homer never needs it: his first pipeline is made for
 * him on the board.
 */
export default async function PipelinesPage({ params }: PageProps<"/admin/[store]/deals/pipelines">) {
  const member = await requirePermission((await params).store, "customers:read");
  const off = requireFeature(member, "sales");
  if (off) return off;
  const { store } = member;
  const w = adminText(adminLangOf(member.account.adminLocale), "deals");
  const p = w.pipelinesPage;
  const pipelines = await ensurePipeline(store.id, {
    name: w.firstPipeline,
    stages: [{ name: w.stageNames.new }, { name: w.stageNames.talking }, { name: w.stageNames.quote_sent, quoteStage: true }],
  });
  const canChange = memberCan(member, "customers:write");

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader back={{ href: `/admin/${store.slug}/deals`, label: w.deal.back }} title={p.title} description={p.description} />
      {pipelines.map((pipeline) => (
        <Card key={pipeline.id} title={pipeline.name} compact>
          {canChange ? (
            <div className="flex flex-col gap-6">
              <ActionForm action={renamePipelineAction.bind(null, store.slug, pipeline.id)} className="flex flex-wrap items-end gap-3" successMessage={p.saved}>
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium">
                  {p.name}
                  <input name="name" required maxLength={80} defaultValue={pipeline.name} className={control} />
                </label>
                <SubmitButton variant="secondary">{p.rename}</SubmitButton>
              </ActionForm>
              <ActionForm action={saveStagesAction.bind(null, store.slug, pipeline.id)} className="flex flex-col gap-4" successMessage={p.saved}>
                <StagesEditor initial={pipeline.stages.map((s) => ({ id: s.id, name: s.name, probability: s.probability, quoteStage: s.quoteStage }))} words={p} />
                <SubmitButton>{p.save}</SubmitButton>
              </ActionForm>
              {pipelines.length > 1 && (
                <DeleteDiscountButton action={deletePipelineAction.bind(null, store.slug, pipeline.id)} code="" question={p.removeConfirm} label={p.remove} />
              )}
            </div>
          ) : (
            <ol className="flex flex-col gap-1 text-sm">
              {pipeline.stages.map((s) => (
                <li key={s.id}>
                  {s.name}
                  {s.probability !== null && <span className="text-muted"> · {s.probability} %</span>}
                </li>
              ))}
            </ol>
          )}
        </Card>
      ))}
      {canChange && pipelines.length < 20 && (
        <Card title={p.add} compact>
          <ActionForm action={createPipelineAction.bind(null, store.slug)} className="flex flex-col gap-4" successMessage={p.saved}>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {p.name}
              <input name="name" required maxLength={80} className={control} />
            </label>
            <StagesEditor initial={[w.stageNames.new, w.stageNames.talking, w.stageNames.quote_sent].map((name, i) => ({ id: null, name, probability: null, quoteStage: i === 2 }))} words={p} />
            <SubmitButton>{p.add}</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
