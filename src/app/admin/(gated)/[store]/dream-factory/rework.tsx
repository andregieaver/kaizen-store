import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { DreamProgress, DreamTimeline } from "@/components/admin/dream/dream-showcase";
import { RefreshWhile } from "@/components/admin/refresh-while";
import { ButtonLink, Card, Chip, PageHeader } from "@/components/admin/ui";
import { VersionDifferences } from "@/components/admin/version-differences";
import { fillWords } from "@/lib/admin-fill";
import type { HomeMessages } from "@/lib/admin-messages/home.en";
import { PROMPT_MAX, PROMPT_MIN, REVIEW_ROUNDS, REWORK_STEPS, passed } from "@/lib/dream-factory";
import { marketPath, storeHref } from "@/lib/paths";
import type { DreamRun } from "@/server/dream-factory";
import { reworkPrepared, type ReworkPrepared } from "@/server/dream-showcase";
import type { Store } from "@/server/stores";

import { agreeReworkAction, applyReworkAction, askReworkAction, retryDreamAction, startReworkAction, stopDreamAction } from "./actions";

type Words = HomeMessages["dream"];

const field = "flex flex-col gap-1 text-body font-medium";
const control = "min-h-11 rounded-md border border-line bg-card px-3 font-normal";
const REFRESH_SECONDS = 6;
const OWNER_STEPS = new Set<string>(REWORK_STEPS.filter((step) => step.who === "owner").map((step) => step.id));

/** The form a rework starts from (D527): what the owner wants changed, in their own words. */
export function ReworkStart({ slug, words: w, title }: { slug: string; words: Words; title?: string }) {
  const r = w.rework;
  return (
    <ActionForm action={startReworkAction.bind(null, slug)} className="flex flex-col gap-4">
      <label className={field}>
        {title ?? r.startLabel}
        <textarea name="prompt" required minLength={PROMPT_MIN} maxLength={PROMPT_MAX} rows={5} className={`${control} py-2`} />
        <span className="font-normal text-ink-2">{r.startHint}</span>
      </label>
      <div>
        <SubmitButton>{r.start}</SubmitButton>
      </div>
    </ActionForm>
  );
}

/**
 * A rework's page (D527): the plan and the owner's yes, the changes being prepared, then the review: what would change, in the code's own
 * words from the store's rows (`reworkPrepared()`), with *Make it live*, one more change in the owner's words, or setting it aside.
 * Nothing shown here is on the site until the owner's press.
 */
export async function ReworkRun({ store, run, words: w }: { store: Store; run: DreamRun; words: Words }) {
  const r = w.rework;
  const slug = store.slug;
  const base = `/admin/${slug}`;
  const now = new Date();
  const going = run.status === "running" || run.status === "asking";
  const plan = run.plan;
  const review = run.steps.review;
  const reviewing = review.status === "asking" || review.status === "running";
  const prepared = passed(run.steps.agree) ? await reworkPrepared(store, run) : null;
  const market = store.markets[0];
  // A store not yet open is private: its members see it through their preview (D339).
  const storeUrl = store.setupCompletedAt ? storeHref(slug, market ? marketPath(slug, market.slug) : "/") : `/api/private/preview?store=${encodeURIComponent(slug)}`;
  const words = run.status === "ready" || run.status === "open" ? r.run.running : r.run[run.status];
  return (
    <>
      {going && <RefreshWhile seconds={REFRESH_SECONDS} />}
      <div className="flex max-w-4xl flex-col gap-6">
        <PageHeader title={r.title} description={<>{words}</>} />

        {run.status === "applied" && (
          <Card title={r.done.title}>
            <p className="text-body text-ink-2">{run.steps.apply.detail}</p>
            <div className="mt-4">
              <ButtonLink kind="main" href={storeUrl}>
                {r.done.visit}
              </ButtonLink>
            </div>
          </Card>
        )}

        {plan && run.steps.agree.status === "asking" && (
          <Card title={r.plan.title}>
            <PlanList plan={plan} words={w} />
            <ActionForm action={agreeReworkAction.bind(null, slug, run.id)} className="mt-4 flex flex-col gap-2">
              <p className="text-body text-ink-2">{r.plan.yesHint}</p>
              <div>
                <SubmitButton>{r.plan.yes}</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        )}

        {going && !reviewing && <DreamProgress steps={run.steps} startedAt={run.createdAt} now={now} storeName={store.name} words={w} list={REWORK_STEPS} heading={r.building} />}

        {prepared && (reviewing || !passed(run.steps.review)) && (
          <section aria-labelledby="rework-review" className="flex flex-col gap-5 rounded-lg border border-line bg-card p-5">
            <div className="flex flex-col gap-1">
              <h2 id="rework-review" className="text-title text-ink">
                {reviewing ? r.review.title : r.review.soFar}
              </h2>
              <p className="text-body text-ink-2">{r.review.text}</p>
            </div>
            <Prepared prepared={prepared} base={base} words={w} />
            {review.status === "running" && (
              <p role="status" className="flex items-start gap-3 text-body text-ink">
                <span aria-hidden="true" className="mt-1 size-4 shrink-0 animate-spin rounded-full border-2 border-brand border-r-transparent" />
                <span>
                  <span className="font-medium">{r.review.working}</span> {review.ref}
                </span>
              </p>
            )}
            {review.status === "asking" && (
              <>
                {review.tries > 0 && review.detail && <p className="text-body text-ink-2">{review.detail}</p>}
                <ActionForm action={applyReworkAction.bind(null, slug, run.id)}>
                  <SubmitButton>{r.review.yes}</SubmitButton>
                </ActionForm>
                {review.tries >= REVIEW_ROUNDS ? (
                  <p className="text-body text-ink">{fillWords(r.review.limit, { max: REVIEW_ROUNDS })}</p>
                ) : (
                  <ActionForm action={askReworkAction.bind(null, slug, run.id)} className="flex flex-col gap-2">
                    <label className={field}>
                      {r.review.ownLabel}
                      <input name="ask" required minLength={3} maxLength={500} className={control} />
                    </label>
                    <div className="flex flex-wrap items-center gap-3">
                      <SubmitButton variant="secondary">{r.review.ask}</SubmitButton>
                      {review.tries > 0 && <span className="text-sm text-ink-2">{fillWords(r.review.asked, { n: review.tries, max: REVIEW_ROUNDS })}</span>}
                    </div>
                  </ActionForm>
                )}
                <ActionForm action={stopDreamAction.bind(null, slug, run.id)} className="flex flex-col gap-2 border-t border-line pt-4">
                  <p className="text-sm text-ink-2">{r.review.discardHint}</p>
                  <div>
                    <SubmitButton variant="secondary">{r.review.discard}</SubmitButton>
                  </div>
                </ActionForm>
              </>
            )}
          </section>
        )}

        <div className="rounded-lg border border-line bg-card p-5">
          <DreamTimeline
            steps={run.steps}
            now={now}
            words={w}
            list={REWORK_STEPS}
            stages={false}
            action={(id) =>
              run.steps[id].status === "asking" && !OWNER_STEPS.has(id) ? (
                <ActionForm action={retryDreamAction.bind(null, slug, run.id, id)}>
                  <SubmitButton variant="secondary">{w.retry}</SubmitButton>
                </ActionForm>
              ) : null
            }
          />
        </div>
        {going && !reviewing && (
          <ActionForm action={stopDreamAction.bind(null, slug, run.id)}>
            <SubmitButton variant="secondary">{w.stop}</SubmitButton>
          </ActionForm>
        )}

        {!going && (
          <Card title={r.another}>
            <ReworkStart slug={slug} words={w} />
          </Card>
        )}
      </div>
    </>
  );
}

/** The plan as the owner agrees to it: each change in the plan's words, and what was asked for that a rework does not do. */
function PlanList({ plan, words: w }: { plan: NonNullable<DreamRun["plan"]>; words: Words }) {
  const p = w.rework.plan;
  return (
    <div className="flex flex-col gap-4 text-body">
      {plan.summary && <p className="text-ink">{plan.summary}</p>}
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
        {plan.look && (
          <>
            <dt className="text-ink-2">{p.look}</dt>
            <dd>{plan.look}</dd>
          </>
        )}
        {plan.header && (
          <>
            <dt className="text-ink-2">{p.header}</dt>
            <dd>{plan.header}</dd>
          </>
        )}
        {plan.footer && (
          <>
            <dt className="text-ink-2">{p.footer}</dt>
            <dd>{plan.footer}</dd>
          </>
        )}
        {plan.pages.length > 0 && (
          <>
            <dt className="text-ink-2">{p.pages}</dt>
            <dd>
              <ul className="flex flex-col gap-1">
                {plan.pages.map((page) => (
                  <li key={page.page || page.title}>
                    <span className="font-medium">{page.title}</span>
                    {!page.page && <span className="text-ink-2"> ({p.newPage})</span>}: {page.change}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {plan.newProducts.length > 0 && (
          <>
            <dt className="text-ink-2">{p.newProducts}</dt>
            <dd>
              <ul className="flex flex-col gap-1">
                {plan.newProducts.map((product) => (
                  <li key={product.title}>
                    <span className="font-medium">{product.title}</span>
                    {product.about && `: ${product.about}`}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {plan.productChanges.length > 0 && (
          <>
            <dt className="text-ink-2">{p.productChanges}</dt>
            <dd>
              <ul className="flex flex-col gap-1">
                {plan.productChanges.map((change) => (
                  <li key={change.product}>
                    <span className="font-medium">{change.product}</span>: {change.change}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {plan.outside.length > 0 && (
          <>
            <dt className="text-ink-2">{p.outside}</dt>
            <dd>
              {plan.outside.join(", ")}
              <span className="block text-ink-2">{p.outsideHint}</span>
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

/** What is prepared, each kind once it has something: the look, the pages with what changes, the new products, the kept changes. */
function Prepared({ prepared, base, words: w }: { prepared: ReworkPrepared; base: string; words: Words }) {
  const r = w.rework.review;
  const { look, pages, products, changes } = prepared;
  if (!look && pages.length === 0 && products.length === 0 && changes.length === 0) return <p className="text-body text-ink-2">{r.nothing}</p>;
  const heading = "text-sm font-medium text-ink-2";
  return (
    <div className="flex flex-col gap-5">
      {look && (
        <div className="flex flex-col gap-1">
          <h3 className={heading}>{r.look}</h3>
          <p className="flex flex-wrap items-center gap-3 text-body">
            <span className="font-medium text-ink">{look.title}</span>
            {!look.live && (
              <Link href={`${base}/settings/design/themes/${look.id}/preview`} className="underline">
                {r.lookTry}
              </Link>
            )}
          </p>
        </div>
      )}
      {pages.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className={heading}>{r.pages}</h3>
          <ul className="flex flex-col gap-3">
            {pages.map((page) => (
              <li key={page.id} className="flex flex-col gap-1 text-body">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{page.title}</span>
                  {page.isNew && <Chip signal="insight">{r.newPage}</Chip>}
                  {!page.changed && <Chip signal="neutral">{r.notChanged}</Chip>}
                  <Link href={`${base}/pages/${page.id}`} className="text-sm underline">
                    {r.open}
                  </Link>
                </span>
                {page.changed && !page.isNew && <VersionDifferences differences={page.differences} />}
              </li>
            ))}
          </ul>
        </div>
      )}
      {products.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className={heading}>{r.products}</h3>
          <ul className="flex flex-col gap-1 text-body">
            {products.map((product) => (
              <li key={product.id} className="flex flex-wrap items-center gap-2">
                <Link href={`${base}/products/${product.id}`} className="font-medium underline">
                  {product.title}
                </Link>
                {product.status === "draft" && <Chip signal="neutral">{product.complete ? r.draft : r.incomplete}</Chip>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {changes.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className={heading}>{r.changes}</h3>
          <ul className="flex flex-col gap-1 text-body">
            {changes.map((change) => (
              <li key={change.id} className="flex flex-wrap items-baseline gap-2">
                <span>{change.summary}</span>
                <span className="text-sm text-ink-2">{(r.changeStatus as Record<string, string>)[change.status] ?? change.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
