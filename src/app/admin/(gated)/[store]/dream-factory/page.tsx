import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AdminTextScope } from "@/components/admin/admin-text";
import { DreamFeed, DreamMade, DreamProgress, DreamReady, DreamSketch, DreamTimeline } from "@/components/admin/dream/dream-showcase";
import { RefreshWhile } from "@/components/admin/refresh-while";
import { ButtonLink, Card, Chip, KpiTile, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { DREAM_STEPS, LOOK_ROUNDS, PROMPT_MAX, PROMPT_MIN, briefQuestions, detailsQuestions, ownerWaitMs, scoreOf } from "@/lib/dream-factory";
import { marketPath, storeHref } from "@/lib/paths";
import { latestDreamRun } from "@/server/dream-factory";
import { dreamShowcase } from "@/server/dream-showcase";
import { getPageForEdit } from "@/server/pages";
import { requirePermission } from "@/server/permissions";

import { answerDreamAction, approveLookAction, askLookAction, confirmDreamAction, discardDreamStoreAction, retryDreamAction, startDreamAction, startDreamOverAction, stopDreamAction } from "./actions";
import { DreamFrontPage } from "./front-page";

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
  // What only the owner can give (D422): stage 1 asks for the countries, stage 2 for the business details.
  const askingBrief = Boolean(brief) && run.steps.brief.status === "asking" && (brief ? briefQuestions(brief).length > 0 : false);
  const askingDetails = Boolean(brief) && run.steps.details.status === "asking" && (brief ? detailsQuestions(brief).length > 0 : false);
  const look = run.steps.approve;
  const lookOpen = look.status === "asking" || look.status === "running";
  // The real front page in its live look, once the website step has published it (D422): it replaces the sketch.
  const frontPage = run.steps.website.status === "done" && store.frontPageId ? await getPageForEdit(store.id, store.frontPageId, "page") : null;
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
        {(askingBrief || askingDetails) && brief && (
          <Card title={w.answers.title}>
            <ActionForm action={answerDreamAction.bind(null, slug, run.id)} className="flex flex-col gap-3">
              {askingDetails && !brief.business.legalName && <Field name="legalName" label={w.answers.legalName} />}
              {askingDetails && !brief.business.organisationNumber && <Field name="organisationNumber" label={w.answers.organisationNumber} />}
              {askingDetails && !brief.business.postalAddress && <Field name="postalAddress" label={w.answers.postalAddress} />}
              {askingDetails && !brief.business.contactEmail && <Field name="contactEmail" label={w.answers.contactEmail} type="email" />}
              {askingDetails && !brief.business.country && <Field name="country" label={w.answers.country} />}
              {askingBrief && brief.countries.length === 0 && <Field name="countries" label={w.answers.countries} />}
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

        {/* Stage 1's end (D422): the owner looks at the real front page and asks for changes until they say This is it. */}
        {lookOpen && (
          <section aria-labelledby="dream-look" className="flex flex-col gap-4 rounded-lg border border-line bg-card p-5">
            <h2 id="dream-look" className="text-title text-ink">
              {w.look.title}
            </h2>
            <p className="text-body text-ink-2">{w.look.text}</p>
            {look.status === "running" ? (
              <p role="status" className="flex items-start gap-3 text-body text-ink">
                <span aria-hidden="true" className="mt-1 size-4 shrink-0 animate-spin rounded-full border-2 border-brand border-r-transparent" />
                <span>
                  <span className="font-medium">{w.look.working}</span> {look.ref}
                </span>
              </p>
            ) : (
              <>
                {look.tries > 0 && look.detail && <p className="text-body text-ink-2">{look.detail}</p>}
                {look.tries >= LOOK_ROUNDS ? (
                  <p className="text-body text-ink">{fillWords(w.look.limit, { max: LOOK_ROUNDS })}</p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {(["colours", "fonts", "layout"] as const).map((kind) => (
                        <ActionForm key={kind} action={askLookAction.bind(null, slug, run.id, kind)}>
                          <SubmitButton variant="secondary">{w.look[kind]}</SubmitButton>
                        </ActionForm>
                      ))}
                    </div>
                    <ActionForm action={askLookAction.bind(null, slug, run.id, "own")} className="flex flex-col gap-2">
                      <label className={field}>
                        {w.look.ownLabel}
                        <input name="ask" required minLength={3} maxLength={500} className={control} />
                      </label>
                      <div>
                        <SubmitButton variant="secondary">{w.look.ask}</SubmitButton>
                      </div>
                    </ActionForm>
                    {look.tries > 0 && <p className="text-sm text-ink-2">{fillWords(w.look.asked, { n: look.tries, max: LOOK_ROUNDS })}</p>}
                  </>
                )}
                <ActionForm action={approveLookAction.bind(null, slug, run.id)}>
                  <SubmitButton>{w.look.yes}</SubmitButton>
                </ActionForm>
              </>
            )}
          </section>
        )}

        {/* The sketch first on a phone, where the timeline would push it out of sight; beside the timeline on a wide screen. */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[auto_1fr]">
          <div className="min-w-0 lg:col-start-2 lg:row-start-1">
            {frontPage ? (
              <DreamFrontPage store={store} page={frontPage} address={address} caption={w.look.caption} />
            ) : (
              <DreamSketch show={show} storeName={brief?.storeName || store.name} address={address} words={w} />
            )}
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
