import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ActivitiesCard } from "@/components/admin/activities/activities-card";
import { activityViews, newActivityValues } from "@/components/admin/activities/activity-view";
import { DealFields } from "@/components/admin/deals/deal-fields";
import { DealStatusControls } from "@/components/admin/deals/deal-status";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { requireFeature } from "@/components/admin/feature-off";
import { StaffFieldsSection } from "@/components/admin/staff-fields-section";
import { Card, Chip, List, ListRow, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { formatPriceInput } from "@/lib/product-input";
import { formatMoney } from "@/lib/money";
import { mainCurrency } from "@/lib/markets";
import { activitiesOf } from "@/server/activities";
import { getDeal, linkCandidates, mayLink, pipelinesOf, type DealLink, type DealMove } from "@/server/deals";
import { memberCan, requirePermission } from "@/server/permissions";
import { listStaff } from "@/server/settings";

import { activityActions } from "../activity-actions-of";
import { deleteDealAction, linkThingAction, placeDealAction, saveDealFieldsAction, searchWhoAction, unlinkThingAction, updateDealAction } from "../actions";

export const metadata: Metadata = { title: "Deal" };

/**
 * One deal (S2, D464): where it stands and what it is worth, its details, what it is linked to (the quote, the order, the Work assignment
 * it leads to, whose value counts instead of the estimate and whose payment or invoice wins it) and each stage it has been in.
 */
export default async function DealPage({ params }: PageProps<"/admin/[store]/deals/[dealId]">) {
  const { store: slug, dealId } = await params;
  const member = await requirePermission(slug, "customers:read");
  const off = requireFeature(member, "sales");
  if (off) return off;
  if (!z.uuid().safeParse(dealId).success) notFound();
  const { store } = member;
  const deal = await getDeal(store, dealId);
  if (!deal) notFound();
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "deals");
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const main = mainCurrency(store);
  const money = (minor: number, currency = main) => formatMoney(minor, currency, locale, { decimals: "hide_whole" });
  const when = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "medium", timeZone: store.timeZone });
  const canChange = memberCan(member, "customers:write");
  const [pipelines, staff, candidates, activities] = await Promise.all([
    pipelinesOf(store.id),
    canChange ? listStaff(store.id) : Promise.resolve([]),
    canChange ? linkCandidates(member, deal) : Promise.resolve([]),
    activitiesOf(store.id, { dealId: deal.id }),
  ]);
  const pipeline = pipelines.find((p) => p.id === deal.pipelineId);
  const stage = pipeline?.stages.find((s) => s.id === deal.stageId);
  const team = staff.filter((s) => !s.disabled && (!s.expiresAt || s.expiresAt > new Date().toISOString())).map((s) => ({ id: s.accountId, name: s.name || s.email }));
  const base = `/admin/${store.slug}`;

  const linkHref = (link: DealLink) =>
    link.kind === "order"
      ? `${base}/orders/${link.thingId}`
      : link.kind === "draft"
        ? `${base}/orders/drafts/${link.thingId}`
        : `/admin/account/work/s/${store.slug}/assignments/${link.thingId}`;
  const moveText = (move: DealMove, index: number) => {
    const stageName = move.stageName ?? "—";
    const what =
      move.status === "won"
        ? w.deal.won
        : move.status === "lost"
          ? w.deal.lostMove
          : index > 0 && deal.moves[index - 1].status !== "open"
            ? fillWords(w.deal.reopened, { stage: stageName })
            : fillWords(w.deal.entered, { stage: stageName });
    const by =
      move.via === "order"
        ? w.deal.byOrder
        : move.via === "work_invoice"
          ? w.deal.byInvoice
          : move.via === "platform"
            ? w.deal.byPlatform
            : move.by
              ? fillWords(w.deal.by, { name: move.by })
              : null;
    return by ? `${what} ${by}` : what;
  };
  const closedLine =
    deal.status === "won"
      ? deal.closedVia === "order"
        ? w.deal.wonByOrder
        : deal.closedVia === "work_invoice"
          ? w.deal.wonByInvoice
          : deal.closedVia === "platform"
            ? w.deal.wonByPlan
            : fillWords(w.deal.wonOn, { date: when(deal.closedAt ?? deal.createdAt) })
      : deal.status === "lost"
        ? fillWords(w.deal.lostOn, { date: when(deal.closedAt ?? deal.createdAt) })
        : null;
  const who = deal.company
    ? { kind: "company" as const, id: deal.company.id, label: deal.company.name, detail: deal.customer ? deal.customer.name || deal.customer.email : null }
    : deal.customer
      ? { kind: "customer" as const, id: deal.customer.id, label: deal.customer.name || deal.customer.email, detail: deal.customer.name ? deal.customer.email : null }
      : null;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        back={{ href: `${base}/deals?pipeline=${deal.pipelineId}`, label: w.deal.back }}
        title={deal.title}
        status={<Chip signal={deal.status === "won" ? "positive" : deal.status === "lost" ? "danger" : "neutral"}>{w.statuses[deal.status]}</Chip>}
        meta={[
          deal.company ? (
            <Link key="company" href={`${base}/companies/${deal.company.id}`} className="underline">
              {deal.company.name}
            </Link>
          ) : null,
          deal.customer ? (
            <Link key="customer" href={`${base}/customers/${deal.customer.id}`} className="underline">
              {deal.customer.name || deal.customer.email}
            </Link>
          ) : null,
          stage ? fillWords(w.deal.stage, { stage: stage.name }) : null,
          deal.owner ? fillWords(w.deal.owner, { name: deal.owner.name }) : w.deal.noOwner,
        ].filter(Boolean)}
      />

      <Card title={w.deal.value} compact>
        <p className="text-display text-ink">{deal.value.minor === null ? "—" : money(deal.value.minor)}</p>
        <p className="text-sm text-muted">
          {deal.value.source === "links" ? w.deal.valueLinks : deal.value.source === "estimate" ? w.deal.valueEstimate : w.deal.valueNone}
          {deal.value.unconverted.length > 0 && ` ${fillWords(w.board.unconverted, { currencies: deal.value.unconverted.join(", ") })}`}
        </p>
        {closedLine && <p className="mt-3 text-sm text-ink">{closedLine}</p>}
        {deal.closeReason && <p className="text-sm text-ink-2">{fillWords(w.deal.reason, { reason: deal.closeReason })}</p>}
        {canChange && (
          <div className="mt-4">
            <DealStatusControls
              dealId={deal.id}
              status={deal.status}
              stageId={deal.stageId}
              stages={pipeline?.stages.map((s) => ({ id: s.id, name: s.name })) ?? []}
              place={placeDealAction.bind(null, store.slug)}
              words={{ board: w.board, lost: w.lost, deal: w.deal }}
            />
          </div>
        )}
      </Card>

      {/* What happens next (S3, D468): the deal's calls, meetings and tasks, about its person and company too. */}
      <ActivitiesCard
        items={activityViews(activities, "deal", { now: new Date(), timeZone: store.timeZone, locale, words: w.activities, base, me: member.account.id })}
        words={w.activities}
        actions={canChange ? activityActions(store.slug) : null}
        team={team}
        me={member.account.id}
        blank={newActivityValues({ dealId: deal.id, customerId: deal.customer?.id, companyId: deal.company?.id }, member.account.id, new Date(), store.timeZone)}
      />

      <Card title={w.deal.links} compact>
        {deal.links.length === 0 ? (
          <p className="text-sm text-muted">{w.deal.linksNone}</p>
        ) : (
          <List label={w.deal.links}>
            {deal.links.map((link) => (
              <ListRow key={link.id}>
                <div className="flex w-full flex-wrap items-center justify-between gap-3 text-sm">
                  <span>
                    <span className="text-muted">{w.deal.kinds[link.kind]} </span>
                    <Link href={linkHref(link)} className="font-medium underline">
                      {link.label}
                    </Link>
                    {link.value && <span className="text-ink-2"> · {money(link.value.minor, link.value.currency)}</span>}
                  </span>
                  {canChange && (
                    <ActionForm action={unlinkThingAction.bind(null, store.slug, deal.id, link.id)}>
                      <SubmitButton variant="secondary">{w.deal.unlink}</SubmitButton>
                    </ActionForm>
                  )}
                </div>
              </ListRow>
            ))}
          </List>
        )}
        {canChange && (mayLink(member, "order") || mayLink(member, "work_assignment")) && (
          <div className="mt-4">
            {candidates.length === 0 ? (
              // With nothing linked, the card's first line already says what a link is for.
              deal.links.length > 0 && <p className="text-sm text-muted">{w.deal.linkNone}</p>
            ) : (
              <ActionForm action={linkThingAction.bind(null, store.slug, deal.id)} className="flex flex-wrap items-end gap-3">
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium">
                  {w.deal.linkWhat}
                  <select name="thing" required defaultValue="" className="min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal">
                    <option value="" disabled>
                      {w.deal.linkChoose}
                    </option>
                    {(["draft", "order", "work_assignment"] as const).map((kind) => {
                      const of = candidates.filter((c) => c.kind === kind);
                      if (of.length === 0) return null;
                      return (
                        <optgroup key={kind} label={w.deal.kinds[kind]}>
                          {of.map((c) => (
                            <option key={c.id} value={`${c.kind}:${c.id}`}>
                              {[c.label, c.minor !== null && c.currency ? money(c.minor, c.currency) : null, when(c.at)].filter(Boolean).join(" · ")}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                </label>
                <SubmitButton>{w.deal.link}</SubmitButton>
              </ActionForm>
            )}
          </div>
        )}
      </Card>

      {canChange && (
        <Card title={w.deal.details} compact>
          <ActionForm action={updateDealAction.bind(null, store.slug, deal.id)} className="flex flex-col gap-5">
            <DealFields
              words={w.form}
              currency={deal.currency}
              who={who}
              search={searchWhoAction.bind(null, store.slug)}
              stages={null}
              stageId={deal.stageId}
              team={team}
              ownerId={deal.owner?.id ?? null}
              values={{ title: deal.title, estimate: deal.estimateMinor === null ? "" : formatPriceInput(deal.estimateMinor, deal.currency), expectedCloseOn: deal.expectedCloseOn ?? "" }}
            />
            <SubmitButton>{w.form.save}</SubmitButton>
          </ActionForm>
        </Card>
      )}

      {/* Custom fields on deals (D118, D464): for staff only, as a customer's and an order's are. */}
      {canChange && <StaffFieldsSection store={store} entity="deal" id={deal.id} save={saveDealFieldsAction.bind(null, store.slug, deal.id)} />}

      <Card title={w.deal.history} compact>
        <ol className="flex flex-col gap-2 text-sm">
          {deal.moves.map((move, index) => (
            <li key={`${move.at}-${index}`} className="flex flex-wrap justify-between gap-2">
              <span className="text-ink">{moveText(move, index)}</span>
              <span className="text-muted">{when(move.at)}</span>
            </li>
          ))}
        </ol>
      </Card>

      {canChange && <DeleteDiscountButton action={deleteDealAction.bind(null, store.slug, deal.id)} code="" question={w.deal.removeConfirm} label={w.deal.remove} />}
    </div>
  );
}
