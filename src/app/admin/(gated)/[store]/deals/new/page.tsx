import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { DealFields } from "@/components/admin/deals/deal-fields";
import { requireFeature } from "@/components/admin/feature-off";
import { PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { mainCurrency } from "@/lib/markets";
import { ensurePipeline, whoOf } from "@/server/deals";
import { memberCan, requirePermission } from "@/server/permissions";
import { listStaff } from "@/server/settings";

import { createDealAction, searchWhoAction } from "../actions";

export const metadata: Metadata = { title: "New deal" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/**
 * A new deal (S2, D464): Homer says what they might buy and who with (already chosen when he came from the person's or the company's
 * page), and an estimate if he has one; the stage, the owner and when it may close wait under More choices.
 */
export default async function NewDealPage({ params, searchParams }: PageProps<"/admin/[store]/deals/new">) {
  const member = await requirePermission((await params).store, "customers:read");
  const off = requireFeature(member, "sales");
  if (off) return off;
  if (!memberCan(member, "customers:write")) notFound();
  const { store } = member;
  const query = await searchParams;
  const w = adminText(adminLangOf(member.account.adminLocale), "deals");
  const pipelines = await ensurePipeline(store.id, {
    name: w.firstPipeline,
    stages: [{ name: w.stageNames.new }, { name: w.stageNames.talking }, { name: w.stageNames.quote_sent, quoteStage: true }],
  });
  const pipeline = pipelines.find((p) => p.id === one(query.pipeline)) ?? pipelines[0];
  const customer = one(query.customer);
  const company = one(query.company);
  const [who, staff] = await Promise.all([
    customer ? whoOf(store.id, "customer", customer) : company ? whoOf(store.id, "company", company) : Promise.resolve(null),
    listStaff(store.id),
  ]);
  const team = staff.filter((s) => !s.disabled && (!s.expiresAt || s.expiresAt > new Date().toISOString())).map((s) => ({ id: s.accountId, name: s.name || s.email }));

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader back={{ href: `/admin/${store.slug}/deals`, label: w.deal.back }} title={w.form.newTitle} description={w.form.newDescription} />
      <ActionForm action={createDealAction.bind(null, store.slug)} className="flex flex-col gap-5">
        <DealFields
          words={w.form}
          currency={mainCurrency(store)}
          who={who}
          search={searchWhoAction.bind(null, store.slug)}
          stages={pipelines.map((p) => ({ pipeline: p.name, stages: p.stages.map((s) => ({ id: s.id, name: s.name })) }))}
          stageId={pipeline.stages[0]?.id ?? ""}
          team={team}
          ownerId={member.account.id}
          values={{ title: "", estimate: "", expectedCloseOn: "" }}
        />
        <SubmitButton>{w.form.create}</SubmitButton>
      </ActionForm>
    </div>
  );
}
