import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AdminTextScope } from "@/components/admin/admin-text";
import { RefreshWhile } from "@/components/admin/refresh-while";
import { ButtonLink, Card, Chip, KpiTile, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import type { Signal } from "@/lib/admin-schemes";
import { adminText, adminTexts } from "@/lib/admin-text";
import { DREAM_STEPS, PROMPT_MAX, PROMPT_MIN, briefQuestions, ownerWaitMs, scoreOf, type StepStatus } from "@/lib/dream-factory";
import { latestDreamRun } from "@/server/dream-factory";
import { requirePermission } from "@/server/permissions";

import { answerDreamAction, confirmDreamAction, retryDreamAction, startDreamAction, stopDreamAction } from "./actions";

export const metadata: Metadata = { title: "Dream Factory" };

const SIGNAL: Record<StepStatus, Signal> = { waiting: "neutral", running: "insight", asking: "warning", done: "positive", skipped: "neutral", failed: "danger" };
const field = "flex flex-col gap-1 text-body font-medium";
const control = "min-h-11 rounded-md border border-line bg-card px-3 font-normal";

/**
 * The Dream Factory (D409, `docs/dream-factory.md`): the owner describes the store, the AI builds it, and this page shows each step and asks
 * only for what the owner alone can give: the business's details, a yes to the brief, payments, a plan and the moment to open.
 */
export default async function DreamFactoryPage({ params }: { params: Promise<{ store: string }> }) {
  const member = await requirePermission((await params).store, "owner");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "home").dream;
  const run = await latestDreamRun(store.id);
  const slug = store.slug;
  const base = `/admin/${slug}`;
  const going = run && (run.status === "running" || run.status === "asking" || (run.status === "ready" && !run.finishedAt));

  if (!run || run.status === "stopped") {
    return (
      <AdminTextScope texts={adminTexts(lang, ["home"])}>
        <div className="flex max-w-2xl flex-col gap-6">
          <PageHeader title={w.title} description={<>{w.description}</>} />
          {run && <p className="text-body text-ink-2">{w.run.stopped}</p>}
          <ActionForm action={startDreamAction.bind(null, slug)} className="flex flex-col gap-4">
            <label className={field}>
              {w.startLabel}
              <textarea name="prompt" required minLength={PROMPT_MIN} maxLength={PROMPT_MAX} rows={6} className={`${control} py-2`} />
              <span className="font-normal text-ink-2">{w.startHint}</span>
            </label>
            <div>
              <SubmitButton>{w.start}</SubmitButton>
            </div>
          </ActionForm>
        </div>
      </AdminTextScope>
    );
  }

  const score = scoreOf({ ...run, ownerWaitMs: ownerWaitMs(run.steps, new Date()) });
  const brief = run.brief;
  const questions = brief && run.steps.brief.status === "asking" ? briefQuestions(brief) : [];
  const runWords = w.run[run.status];
  return (
    <AdminTextScope texts={adminTexts(lang, ["home"])}>
      {going && <RefreshWhile seconds={15} />}
      <div className="flex max-w-3xl flex-col gap-6">
        <PageHeader title={w.title} description={<>{runWords}</>} status={run.test ? <Chip signal="insight">{w.test}</Chip> : undefined} />

        {/* What only the owner can give, first: the one thing in their way. */}
        {questions.length > 0 && brief && (
          <Card title={w.answers.title}>
            <ActionForm action={answerDreamAction.bind(null, slug, run.id)} className="flex flex-col gap-3">
              {!brief.business.legalName && <Field name="legalName" label={w.answers.legalName} />}
              {!brief.business.organisationNumber && <Field name="organisationNumber" label={w.answers.organisationNumber} />}
              {!brief.business.postalAddress && <Field name="postalAddress" label={w.answers.postalAddress} />}
              {!brief.business.contactEmail && <Field name="contactEmail" label={w.answers.contactEmail} type="email" />}
              {!brief.business.country && <Field name="country" label={w.answers.country} />}
              {brief.countries.length === 0 && <Field name="countries" label={w.answers.countries} />}
              <div>
                <SubmitButton>{w.answers.save}</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        )}
        {brief && run.steps.confirm.status === "asking" && (
          <Card title={w.brief.title}>
            <dl className="grid gap-x-6 gap-y-2 text-body sm:grid-cols-[max-content_1fr]">
              <dt className="text-ink-2">{w.brief.sells}</dt>
              <dd>{brief.storeName}: {brief.sells}</dd>
              {brief.audience && (
                <>
                  <dt className="text-ink-2">{w.brief.audience}</dt>
                  <dd>{brief.audience}</dd>
                </>
              )}
              <dt className="text-ink-2">{w.brief.countries}</dt>
              <dd>{brief.countries.join(", ")}</dd>
              <dt className="text-ink-2">{w.brief.products}</dt>
              <dd>{brief.products}</dd>
              <dt className="text-ink-2">{w.brief.business}</dt>
              <dd>{[brief.business.legalName, brief.business.organisationNumber, brief.business.postalAddress, brief.business.contactEmail].filter(Boolean).join(", ")}</dd>
            </dl>
            <ActionForm action={confirmDreamAction.bind(null, slug, run.id)} className="mt-4 flex flex-col gap-2">
              <p className="text-body text-ink-2">{w.brief.yesHint}</p>
              <div>
                <SubmitButton>{w.brief.yes}</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        )}
        {run.steps.payments.status === "asking" && <ButtonLink href={`${base}/settings/payments`}>{w.payments}</ButtonLink>}
        {run.steps.plan.status === "asking" && <ButtonLink href={`${base}/billing`}>{w.plan}</ButtonLink>}
        {run.steps.open.status === "asking" && (
          <ButtonLink kind="main" href={`${base}/setup/launch`}>
            {w.open}
          </ButtonLink>
        )}

        <ol className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {DREAM_STEPS.map((step) => {
            const state = run.steps[step.id];
            const canRetry = step.who !== "owner" && state.status === "asking" && step.id !== "brief";
            return (
              <li key={step.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="font-medium">{w.steps[step.id]}</span>
                  {state.detail && <span className="text-body text-ink-2">{state.detail}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {canRetry && (
                    <ActionForm action={retryDreamAction.bind(null, slug, run.id, step.id)}>
                      <SubmitButton variant="secondary">{w.retry}</SubmitButton>
                    </ActionForm>
                  )}
                  <Chip signal={SIGNAL[state.status]} dot>
                    {w.status[state.status]}
                  </Chip>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="grid gap-3 sm:grid-cols-3">
          <KpiTile label={w.score.minutes} value={score.minutesToReady === null ? "–" : String(score.minutesToReady)} />
          <KpiTile label={w.score.presses} value={String(score.ownerPresses)} />
          <KpiTile label={w.score.firstTry} value={score.firstTryPercent === null ? "–" : `${score.firstTryPercent} %`} />
        </div>

        {going && (
          <ActionForm action={stopDreamAction.bind(null, slug, run.id)}>
            <SubmitButton variant="secondary">{w.stop}</SubmitButton>
          </ActionForm>
        )}
      </div>
    </AdminTextScope>
  );
}

function Field({ name, label, type = "text" }: { name: string; label: string; type?: string }) {
  return (
    <label className={field}>
      {label}
      <input name={name} type={type} className={control} />
    </label>
  );
}
