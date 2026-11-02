import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AdminTextScope } from "@/components/admin/admin-text";
import { DreamFeed, DreamMade, DreamProgress, DreamReady, DreamSketch, DreamTimeline } from "@/components/admin/dream/dream-showcase";
import { RefreshWhile } from "@/components/admin/refresh-while";
import { ButtonLink, Card, Chip, KpiTile, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { DREAM_STEPS, PROMPT_MAX, PROMPT_MIN, briefQuestions, ownerWaitMs, scoreOf } from "@/lib/dream-factory";
import { marketPath, storeHref } from "@/lib/paths";
import { latestDreamRun } from "@/server/dream-factory";
import { dreamShowcase } from "@/server/dream-showcase";
import { requirePermission } from "@/server/permissions";

import { answerDreamAction, confirmDreamAction, discardDreamStoreAction, retryDreamAction, startDreamAction, startDreamOverAction, stopDreamAction } from "./actions";

export const metadata: Metadata = { title: "Dream Factory" };

/** How often the page reads the run again while it goes: often enough to watch the store appear. */
const REFRESH_SECONDS = 6;
const field = "flex flex-col gap-1 text-body font-medium";
const control = "min-h-11 rounded-md border border-line bg-card px-3 font-normal";

/**
 * The Dream Factory (D409, `docs/dream-factory.md`): the owner describes the store, the AI builds it, and this page shows each step and asks
 * only for what the owner alone can give: the business's details, a yes to the brief, payments, a plan and the moment to open. While it
 * builds the owner watches it (D419): the progress and what is happening now, the timeline, a sketch of the front page filling in, what
 * has been made and the feed of what was just made; when it is ready, the ways on.
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

  const now = new Date();
  const score = scoreOf({ ...run, ownerWaitMs: ownerWaitMs(run.steps, now) });
  const brief = run.brief;
  const questions = brief && run.steps.brief.status === "asking" ? briefQuestions(brief) : [];
  const runWords = w.run[run.status];
  const show = await dreamShowcase(store, run);
  const market = store.markets[0];
  const storeUrl = storeHref(slug, market ? marketPath(slug, market.slug) : "/");
  const address = hostOf(storeUrl) ?? slug;
  // The store's front page once the website step has set it; before that the first page made, which the step makes the front page.
  const front = store.frontPageId ?? show.pages.find((page) => page.pageId)?.pageId ?? null;
  const ready = run.status === "ready" || run.status === "open";
  return (
    <AdminTextScope texts={adminTexts(lang, ["home"])}>
      {going && <RefreshWhile seconds={REFRESH_SECONDS} />}
      <div className="flex max-w-6xl flex-col gap-6">
        <PageHeader title={w.title} description={<>{runWords}</>} status={run.test ? <Chip signal="insight">{w.test}</Chip> : undefined} />

        {/* The store is seen through the members' preview (D339): a store not yet open is private, and a link to it would show its lock page. */}
        {ready && <DreamReady show={show} links={{ store: previewHref(slug), front: front ? `${base}/pages/${front}` : null, products: `${base}/products` }} words={w} />}

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
        {(run.steps.payments.status === "asking" || run.steps.plan.status === "asking" || run.steps.open.status === "asking") && (
          <div className="flex flex-wrap gap-2">
            {run.steps.payments.status === "asking" && <ButtonLink href={`${base}/settings/payments`}>{w.payments}</ButtonLink>}
            {run.steps.plan.status === "asking" && <ButtonLink href={`${base}/billing`}>{w.plan}</ButtonLink>}
            {run.steps.open.status === "asking" && (
              <ButtonLink kind="main" href={`${base}/setup/launch`}>
                {w.open}
              </ButtonLink>
            )}
          </div>
        )}

        {going && <DreamProgress steps={run.steps} startedAt={run.createdAt} now={now} storeName={brief?.storeName || store.name} words={w} />}

        {/* The sketch first on a phone, where the timeline would push it out of sight; beside the timeline on a wide screen. */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[auto_1fr]">
          <div className="min-w-0 lg:col-start-2 lg:row-start-1">
            <DreamSketch show={show} storeName={brief?.storeName || store.name} address={address} words={w} />
          </div>
          <div className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-span-2 lg:row-start-1">
            <div className="rounded-lg border border-line bg-card p-5">
              <DreamTimeline
                steps={run.steps}
                now={now}
                words={w}
                action={(id) =>
                  run.steps[id].status === "asking" && id !== "brief" && !OWNER_STEPS.has(id) ? (
                    <ActionForm action={retryDreamAction.bind(null, slug, run.id, id)}>
                      <SubmitButton variant="secondary">{w.retry}</SubmitButton>
                    </ActionForm>
                  ) : null
                }
              />
            </div>
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
          <div className="flex min-w-0 flex-col gap-4 self-start lg:col-start-2 lg:row-start-2">
            <DreamFeed show={show} now={now} words={w} />
            <DreamMade show={show} base={base} words={w} />
          </div>
        </div>

        {/* Start over or discard (D421), one deliberate step away and only before the store opens. */}
        {!store.setupCompletedAt && (
          <details className="rounded-lg border border-line bg-card p-5">
            <summary className="cursor-pointer text-title text-ink">{w.again.title}</summary>
            <div className="mt-3 flex flex-col gap-6">
              <p className="text-body text-ink-2">{w.again.text}</p>
              <ActionForm action={startDreamOverAction.bind(null, slug)} className="flex flex-col gap-3">
                <label className={field}>
                  {w.again.label}
                  <textarea name="prompt" required minLength={PROMPT_MIN} maxLength={PROMPT_MAX} rows={5} defaultValue={run.prompt} className={`${control} py-2`} />
                  <span className="font-normal text-ink-2">{w.again.startOverHint}</span>
                </label>
                <div>
                  <SubmitButton>{w.again.startOver}</SubmitButton>
                </div>
              </ActionForm>
              <ActionForm action={discardDreamStoreAction.bind(null, slug)} className="flex flex-col gap-3 border-t border-line pt-5">
                <label className={field}>
                  {w.again.discardLabel}
                  <input name="typed" required autoComplete="off" className={control} />
                  <span className="font-normal text-ink-2">{fillWords(w.again.discardHint, { address: slug })}</span>
                </label>
                <div>
                  <SubmitButton variant="secondary">{w.again.discard}</SubmitButton>
                </div>
              </ActionForm>
            </div>
          </details>
        )}
      </div>
    </AdminTextScope>
  );
}

/** The steps that are the owner's own (their yes, payments, a plan, opening): nothing to try again. */
const OWNER_STEPS = new Set<string>(DREAM_STEPS.filter((step) => step.who === "owner").map((step) => step.id));

/** The members' preview of the store (D339): lets them in while it is private, then shows its front page. */
const previewHref = (slug: string) => `/api/private/preview?store=${encodeURIComponent(slug)}`;

/** The store's address as a visitor's browser shows it, for the sketch. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function Field({ name, label, type = "text" }: { name: string; label: string; type?: string }) {
  return (
    <label className={field}>
      {label}
      <input name={name} type={type} className={control} />
    </label>
  );
}
