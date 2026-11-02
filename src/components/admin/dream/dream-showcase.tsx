import Link from "next/link";
import type { ReactNode } from "react";

import { ButtonLink, Card, Chip } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { HomeMessages } from "@/lib/admin-messages/home.en";
import type { Signal } from "@/lib/admin-schemes";
import { DREAM_STEPS, type DreamStepId, type DreamSteps, type StepStatus } from "@/lib/dream-factory";
import { agoMinutes, mockColours, safeFont, showcaseProgress, stepMinutes, type ShowcaseProgress } from "@/lib/dream-showcase";
import type { DreamShowcase } from "@/server/dream-showcase";

type Words = HomeMessages["dream"];

const SIGNAL: Record<StepStatus, Signal> = { waiting: "neutral", running: "insight", asking: "warning", done: "positive", skipped: "neutral", failed: "danger" };

/**
 * Watching the Dream Factory build (D419): the progress and what the AI is doing now, every step on a timeline with its minutes, a sketch of
 * the store's front page that fills in as the brand, logo, pages and products are made, the things made so far, and the feed of what was
 * just made; when the store is ready, what was made and where to go next. Everything shown is the store's own records and the code's words
 * (`src/server/dream-showcase.ts`); the page refreshes itself while the run goes.
 */
export function DreamProgress({ steps, startedAt, now, storeName, words: w }: { steps: DreamSteps; startedAt: Date; now: Date; storeName: string; words: Words }) {
  const s = w.show;
  const p = showcaseProgress(steps, startedAt, now);
  return (
    <section aria-labelledby="dream-building" className="flex flex-col gap-4 rounded-lg border border-line bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="dream-building" className="text-title text-ink">
          {fillWords(s.building, { store: storeName })}
        </h2>
        <span className="text-body text-ink-2">{p.minutes === 0 ? s.startedNow : fillWords(s.started, { minutes: p.minutes })}</span>
      </div>
      <ProgressBar progress={p} label={fillWords(s.progress, { done: p.done, total: p.total })} />
      <div aria-live="polite" className="flex flex-col gap-2">
        {p.now.map((id) => (
          <p key={id} className="dream-new flex items-start gap-3 text-body">
            <span className="relative mt-1.5 flex size-2.5 shrink-0" aria-hidden="true">
              <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 ${steps[id].status === "asking" ? "bg-warning-text" : "bg-brand"}`} />
              <span className={`relative inline-flex size-2.5 rounded-full ${steps[id].status === "asking" ? "bg-warning-text" : "bg-brand"}`} />
            </span>
            <span>
              <span className="font-medium text-ink">{s.now}: </span>
              {s.doing[id]}
              {steps[id].detail && <span className="block text-ink-2">{steps[id].detail}</span>}
            </span>
          </p>
        ))}
        {p.next && (
          <p className="text-body text-ink-2">
            <span className="font-medium">{s.next}: </span>
            {s.doing[p.next]}
          </p>
        )}
      </div>
    </section>
  );
}

function ProgressBar({ progress, label }: { progress: ShowcaseProgress; label: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} aria-label={label} className="h-2.5 overflow-hidden rounded-full bg-sunken">
        <div className="dream-bar h-full w-full rounded-full bg-brand" style={{ transform: `scaleX(${Math.max(progress.percent, 3) / 100})` }} />
      </div>
      <span className="text-sm text-ink-2">{label}</span>
    </div>
  );
}

/** Every step on a line: done ones ticked with their minutes, the working one turning, the rest waiting. */
export function DreamTimeline({
  steps,
  now,
  words: w,
  action,
}: {
  steps: DreamSteps;
  now: Date;
  words: Words;
  /** What a step offers beside its status (Try again), when it does. */
  action?: (id: DreamStepId) => ReactNode;
}) {
  return (
    <ol className="flex flex-col [&>li:last-child]:pb-0">
      {DREAM_STEPS.map((step, index) => {
        const state = steps[step.id];
        const minutes = stepMinutes(state, now);
        const last = index === DREAM_STEPS.length - 1;
        const working = state.status === "running" || state.status === "asking";
        return (
          <li key={step.id} className="relative flex gap-3 pb-4">
            {!last && <span aria-hidden="true" className={`absolute left-3.5 top-8 bottom-0 w-px ${state.status === "done" || state.status === "skipped" ? "bg-positive-text/40" : "bg-line"}`} />}
            <StepMark status={state.status} index={index + 1} />
            <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`font-medium ${state.status === "waiting" ? "text-ink-2" : "text-ink"}`}>{w.steps[step.id]}</span>
                <Chip signal={SIGNAL[state.status]} dot>
                  {w.status[state.status]}
                </Chip>
                {minutes !== null && <span className="text-sm text-ink-2">{fillWords(w.show.minutes, { minutes })}</span>}
                {action?.(step.id)}
              </div>
              {working && <span className="text-body text-ink">{w.show.doing[step.id]}</span>}
              {state.detail && <span className="text-body text-ink-2">{state.detail}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StepMark({ status, index }: { status: StepStatus; index: number }) {
  const base = "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-medium";
  if (status === "done") {
    return (
      <span className={`${base} bg-positive-soft text-positive-text`} aria-hidden="true">
        <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className={`${base} bg-insight-soft`} aria-hidden="true">
        <span className="size-4 animate-spin rounded-full border-2 border-brand border-r-transparent" />
      </span>
    );
  }
  if (status === "asking") return <span className={`${base} bg-warning-soft text-warning-text`} aria-hidden="true">!</span>;
  if (status === "failed") return <span className={`${base} bg-danger-soft text-danger-text`} aria-hidden="true">×</span>;
  return (
    <span className={`${base} border border-line bg-card text-ink-2`} aria-hidden="true">
      {status === "skipped" ? "–" : index}
    </span>
  );
}

/**
 * A sketch of the store's front page from what has been made: the logo or name in the look's heading font, the pages as its menu, the tagline
 * and a button in the look's colours, and the products with their pictures and prices. A part not made yet shimmers.
 */
export function DreamSketch({ show, storeName, address, words: w }: { show: DreamShowcase; storeName: string; address: string; words: Words }) {
  const s = w.show;
  const c = mockColours(show.look?.light ?? null);
  const heading = safeFont(show.look?.fonts.heading, "serif");
  const body = safeFont(show.look?.fonts.body);
  const placeholder = (className: string) => <span aria-hidden="true" className={`dream-shimmer block rounded ${className}`} style={{ backgroundColor: c.border }} />;
  const menu = show.pages.filter((p) => p.title).slice(0, 4);
  const shown = show.products.slice(0, 4);
  return (
    <figure className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-lg border border-line shadow-sm">
        <div className="flex items-center gap-1.5 border-b border-line bg-sunken px-3 py-2" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-danger-text/50" />
          <span className="size-2.5 rounded-full bg-warning-text/50" />
          <span className="size-2.5 rounded-full bg-positive-text/50" />
          <span className="ml-2 truncate rounded bg-card px-2 py-0.5 text-xs text-ink-2">{address}</span>
        </div>
        <div style={{ backgroundColor: c.background, color: c.text, fontFamily: body }} className="text-sm">
          <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${c.border}` }}>
            {show.marks.logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- the store's own logo from its media library, small
              <img src={show.marks.logo} alt={storeName} className="dream-new h-6 w-auto max-w-[45%] object-contain" />
            ) : (
              <span className="truncate text-base font-medium" style={{ fontFamily: heading }}>
                {storeName}
              </span>
            )}
            <span className="flex min-w-0 gap-3 overflow-hidden text-xs" style={{ color: c.muted }}>
              {menu.length > 0 ? menu.map((p) => <span key={p.title} className="dream-new truncate">{p.title}</span>) : [0, 1, 2].map((i) => <span key={i}>{placeholder("h-2 w-10")}</span>)}
            </span>
          </div>
          <div className="flex flex-col items-start gap-3 px-4 py-6" style={{ backgroundColor: c.surface }}>
            {show.brand?.tagline ? (
              <p className="dream-new text-lg font-medium leading-snug" style={{ fontFamily: heading }}>
                {show.brand.tagline}
              </p>
            ) : (
              <span className="flex w-full flex-col gap-2">
                {placeholder("h-4 w-3/4")}
                {placeholder("h-4 w-1/2")}
              </span>
            )}
            <span className="rounded-full px-3 py-1 text-xs font-medium" style={{ backgroundColor: c.accent, color: c.accentText }}>
              {s.shopNow}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2 px-4 py-4 sm:gap-3">
            {[0, 1, 2, 3].map((i) => {
              const product = shown[i];
              return product ? (
                <div key={product.id} className="dream-new flex min-w-0 flex-col gap-1">
                  {product.picture ? (
                    // eslint-disable-next-line @next/next/no-img-element -- the product's own picture, small
                    <img src={product.picture} alt="" className="aspect-square w-full rounded object-cover" />
                  ) : (
                    placeholder("aspect-square w-full")
                  )}
                  <span className="truncate text-xs">{product.title}</span>
                  {product.price && (
                    <span className="text-xs" style={{ color: c.muted }}>
                      {product.price}
                    </span>
                  )}
                </div>
              ) : (
                <div key={`empty-${i}`} className="flex flex-col gap-1">
                  {placeholder("aspect-square w-full")}
                  {placeholder("h-2 w-3/4")}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <figcaption className="text-sm text-ink-2">
        <span className="font-medium text-ink">{s.preview}.</span> {s.previewHint}
      </figcaption>
    </figure>
  );
}

/** The newest things made, as a feed: what, and how long ago. */
export function DreamFeed({ show, now, words: w }: { show: DreamShowcase; now: Date; words: Words }) {
  const s = w.show;
  return (
    <Card title={s.latest}>
      {show.feed.length === 0 ? (
        <p className="text-body text-ink-2">{s.nothingYet}</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-live="polite">
          {show.feed.map((item) => {
            const minutes = agoMinutes(item.at, now);
            return (
              <li key={`${item.kind}-${item.at}-${item.label}`} className="dream-new flex items-baseline justify-between gap-3 text-body">
                <span className="min-w-0">{fillWords(s.made[item.kind], { label: item.label })}</span>
                <span className="shrink-0 text-sm text-ink-2">{minutes === 0 ? s.ago.now : fillWords(s.ago.minutes, { n: minutes })}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** What has been made so far, a card for each kind once it has something. */
export function DreamMade({ show, base, words: w }: { show: DreamShowcase; base: string; words: Words }) {
  const s = w.show;
  const colours = show.look ? (["background", "surface", "text", "accent", "accentText"] as const).map((key) => mockColours(show.look?.light ?? null)[key]) : [];
  return (
    <div className="flex flex-col gap-4">
      {(show.brand || show.look) && (
        <Card title={s.brand}>
          <div className="dream-new flex flex-col gap-3 text-body">
            {show.brand?.voice && <p className="text-ink-2">{show.brand.voice}</p>}
            {show.brand && show.brand.values.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {show.brand.values.map((v) => (
                  <Chip key={v}>{v}</Chip>
                ))}
              </div>
            )}
            {show.look && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-ink-2">{s.colours}</span>
                  <span className="flex overflow-hidden rounded-md border border-line">
                    {colours.map((colour, i) => (
                      <span key={`${colour}-${i}`} className="size-7" style={{ backgroundColor: colour }} title={colour} />
                    ))}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-ink-2">
                  {show.look.fonts.heading && <span style={{ fontFamily: safeFont(show.look.fonts.heading, "serif") }}>{fillWords(s.headingFont, { font: show.look.fonts.heading })}</span>}
                  {show.look.fonts.body && <span style={{ fontFamily: safeFont(show.look.fonts.body) }}>{fillWords(s.bodyFont, { font: show.look.fonts.body })}</span>}
                </div>
              </>
            )}
          </div>
        </Card>
      )}
      {show.notes.length > 0 && (
        <Card title={s.research}>
          <ul className="flex flex-col gap-3">
            {show.notes.map((n) => (
              <li key={`${n.topic}-${n.at}`} className="dream-new flex flex-col gap-0.5 text-body">
                <span className="font-medium text-ink">{n.topic}</span>
                <span className="line-clamp-3 text-ink-2">{n.finding}</span>
                {n.sites.length > 0 && <span className="text-sm text-ink-2">{fillWords(s.sources, { sites: n.sites.join(", ") })}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {show.products.length > 0 && (
        <Card title={`${s.products} (${show.productCount})`}>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {show.products.map((p) => (
              <li key={p.id} className="dream-new flex min-w-0 flex-col gap-1 text-sm">
                {p.picture ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the product's own picture, small
                  <img src={p.picture} alt="" className="aspect-square w-full rounded-md border border-line object-cover" />
                ) : (
                  <span className="flex aspect-square w-full items-center justify-center rounded-md border border-dashed border-line px-2 text-center text-xs text-ink-2">{s.noPicture}</span>
                )}
                <Link href={`${base}/products/${p.id}`} className="truncate underline">
                  {p.title}
                </Link>
                {p.price && <span className="text-ink-2">{p.price}</span>}
              </li>
            ))}
          </ul>
          {show.productCount > show.products.length && <p className="mt-2 text-sm text-ink-2">{fillWords(s.productsMore, { n: show.productCount - show.products.length })}</p>}
        </Card>
      )}
      {show.pages.length > 0 && (
        <Card title={s.pages}>
          <ul className="flex flex-col gap-2">
            {show.pages.map((page, i) => (
              <li key={`${page.title}-${i}`} className="dream-new flex flex-wrap items-center justify-between gap-2 text-body">
                <span className="flex items-center gap-2">
                  {page.status === "building" && <span aria-hidden="true" className="size-3.5 animate-spin rounded-full border-2 border-brand border-r-transparent" />}
                  {page.title || "…"}
                </span>
                <span className="flex items-center gap-2">
                  <Chip signal={page.status === "live" || page.status === "built" ? "positive" : page.status === "failed" ? "danger" : "insight"} dot>
                    {s.pageStatus[page.status]}
                  </Chip>
                  {page.pageId && (
                    <Link href={`${base}/pages/${page.pageId}`} className="text-sm underline">
                      {s.openPage}
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {(show.legal.length > 0 || show.goals.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {show.legal.length > 0 && (
            <Card title={s.legal}>
              <ul className="flex flex-col gap-1 text-body">
                {show.legal.map((l) => (
                  <li key={l.name} className="dream-new">
                    {l.name}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {show.goals.length > 0 && (
            <Card title={s.goals}>
              <ul className="flex flex-col gap-1 text-body">
                {show.goals.map((g) => (
                  <li key={g} className="dream-new">
                    {g}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

/** When the store is ready: what was made, and the ways on. */
export function DreamReady({ show, links, words: w }: { show: DreamShowcase; links: { store: string; front: string | null; products: string }; words: Words }) {
  const s = w.show;
  return (
    <section aria-labelledby="dream-ready" className="dream-new flex flex-col gap-3 rounded-lg border border-positive-text/30 bg-positive-soft p-5">
      <h2 id="dream-ready" className="text-title text-ink">
        {s.readyTitle}
      </h2>
      <p className="text-body text-ink">{s.readyText}</p>
      <div className="flex flex-wrap gap-2">
        <ButtonLink kind="main" href={links.store}>
          {s.visit}
        </ButtonLink>
        {links.front && (
          <ButtonLink kind="secondary" href={links.front}>
            {s.editFront}
          </ButtonLink>
        )}
        {show.productCount > 0 && (
          <ButtonLink kind="secondary" href={links.products}>
            {s.seeProducts}
          </ButtonLink>
        )}
      </div>
    </section>
  );
}
