import type { Metadata } from "next";
import { Suspense } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { confirmStatusAction, subscribeStatusAction, unsubscribeStatusAction } from "@/app/(platform)/status/actions";
import { PLATFORM_LANG_FACTS, platformPath, type PlatformLang } from "@/lib/platform-lang";
import { platformText } from "@/lib/platform-text";
import { incidentWords, updateWords, uptimeText, type DayBar } from "@/lib/status";
import { languageMeta } from "@/server/platform-lang-meta";
import { confirmationWorks, statusOverview, unsubscribeWorks, type IncidentView } from "@/server/status";

/** The status page's head in `lang` (D360), with its feed. */
export async function statusMetadata(lang: PlatformLang): Promise<Metadata> {
  const w = platformText(lang).status;
  return {
    title: w.title,
    description: w.description,
    alternates: { ...(await languageMeta(lang, "/status")), types: { "application/atom+xml": platformPath(lang, "/status/feed.atom") } },
  };
}

const BAR: Record<DayBar["state"], string> = {
  ok: "bg-emerald-500",
  partial: "bg-amber-400",
  down: "bg-red-600",
  none: "bg-border",
};
const DOT = { ok: "bg-emerald-500", degraded: "bg-red-600", unknown: "bg-border" } as const;
const control = "min-h-11 rounded-md border border-border bg-background px-3 font-normal";
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ""));

/** Kaizena Flow's status page (D360): each component's state and 90 days, incidents, and how to hear about them. */
export function StatusRoute({ lang }: { lang: PlatformLang }) {
  const w = platformText(lang).status;
  return (
    <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 py-16">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{w.title}</h1>
        <p className="mt-2 text-muted">{w.description}</p>
      </div>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-surface" />}>
        <StatusBody lang={lang} />
      </Suspense>
      <section aria-labelledby="status-subscribe" className="flex flex-col gap-3">
        <h2 id="status-subscribe" className="text-xl font-semibold">
          {w.subscribeTitle}
        </h2>
        <p className="text-muted">{w.subscribeIntro}</p>
        <ActionForm action={subscribeStatusAction} className="flex flex-wrap items-end gap-3" replaceOnSuccess>
          <input type="hidden" name="locale" value={PLATFORM_LANG_FACTS[lang].locale} />
          <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm font-medium">
            {w.email}
            <input type="email" name="email" required autoComplete="email" className={control} />
          </label>
          <div aria-hidden="true" className="hidden">
            <input name="website" tabIndex={-1} autoComplete="off" />
          </div>
          <SubmitButton>{w.subscribe}</SubmitButton>
        </ActionForm>
        <a href={platformPath(lang, "/status/feed.atom")} className="self-start text-sm underline">
          {w.feed}
        </a>
      </section>
    </main>
  );
}

async function StatusBody({ lang }: { lang: PlatformLang }) {
  const w = platformText(lang).status;
  const locale = PLATFORM_LANG_FACTS[lang].tag;
  const view = await statusOverview();
  const tone = view.overall === "ok" ? "border-emerald-500" : view.overall === "maintenance" ? "border-border" : "border-red-600";
  return (
    <>
      <p role="status" className={`rounded-lg border-l-4 bg-surface px-4 py-3 text-lg font-medium ${tone}`}>
        {w.overall[view.overall]}
      </p>
      {view.open.length > 0 && (
        <section aria-labelledby="status-open" className="flex flex-col gap-4">
          <h2 id="status-open" className="text-xl font-semibold">
            {w.ongoing}
          </h2>
          {view.open.map((incident) => (
            <Incident key={incident.id} incident={incident} lang={lang} />
          ))}
        </section>
      )}
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {view.components.map((component) => (
          <li key={component.id} className="flex flex-col gap-2 px-4 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="flex items-center gap-2 font-medium">
                <span aria-hidden className={`inline-block size-2.5 rounded-full ${DOT[component.state]}`} />
                {w.components[component.id]}
              </span>
              <span className="text-sm text-muted">{w.states[component.state]}</span>
            </div>
            <p className="text-sm text-muted">{w.hints[component.id]}</p>
            <div
              role="img"
              aria-label={component.uptime === null ? w.noUptime : fill(w.uptime, { uptime: uptimeText(component.uptime, locale) ?? "" })}
              className="flex h-8 gap-px"
            >
              {component.bars.map((bar) => (
                <span
                  key={bar.day}
                  title={
                    bar.state === "none"
                      ? fill(w.dayNone, { day: bar.day })
                      : bar.state === "ok"
                        ? fill(w.dayOk, { day: bar.day, total: bar.total })
                        : fill(w.dayFailed, { day: bar.day, failed: bar.total - bar.ok, total: bar.total })
                  }
                  className={`flex-1 rounded-sm ${BAR[bar.state]}`}
                />
              ))}
            </div>
            <div className="flex justify-between text-xs text-muted">
              <span>{w.ninetyAgo}</span>
              <span>{component.uptime === null ? w.noUptime : fill(w.uptime, { uptime: uptimeText(component.uptime, locale) ?? "" })}</span>
              <span>{w.today}</span>
            </div>
            {/* The part's objective over 30 days (REL-09), worked out from the same checks. */}
            <p className="text-xs text-muted">
              {fill(component.slo.met === null ? w.sloNone : component.slo.met ? w.sloMet : w.sloMissed, {
                target: uptimeText(component.slo.targetBps, locale) ?? "",
                actual: uptimeText(component.slo.actualBps, locale) ?? "",
                minutes: new Intl.NumberFormat(locale).format(Math.max(0, component.slo.minutesLeft ?? 0)),
              })}
            </p>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">{w.note}</p>
      <section aria-labelledby="status-incidents" className="flex flex-col gap-4">
        <h2 id="status-incidents" className="text-xl font-semibold">
          {w.incidentsTitle}
        </h2>
        {view.recent.length === 0 ? <p className="text-muted">{w.noIncidents}</p> : view.recent.map((i) => <Incident key={i.id} incident={i} lang={lang} />)}
      </section>
    </>
  );
}

function Incident({ incident, lang }: { incident: IncidentView; lang: PlatformLang }) {
  const w = platformText(lang).status;
  return (
    <article id={`incident-${incident.id}`} className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <h3 className="font-semibold">
        {incidentWords(incident, lang)} <span className="text-sm font-normal text-muted">· {w.impacts[incident.impact]}</span>
      </h3>
      {incident.components.length > 0 && (
        <p className="text-sm text-muted">{fill(w.affects, { components: incident.components.map((c) => w.components[c]).join(", ") })}</p>
      )}
      <ol className="flex flex-col gap-2">
        {incident.updates.map((u, i) => (
          <li key={i} className="text-sm">
            <span className="font-medium">{w.statuses[u.status]}</span> <time dateTime={u.at} className="text-muted">{u.at.slice(0, 16).replace("T", " ")} UTC</time>
            <p className="whitespace-pre-line">{updateWords(u, lang)}</p>
          </li>
        ))}
      </ol>
    </article>
  );
}

/** A subscriber's link page (confirm or leave): a button, so opening the link does nothing. */
export function StatusLinkRoute({ lang, kind, params }: { lang: PlatformLang; kind: "confirm" | "unsubscribe"; params: Promise<{ token: string }> }) {
  const w = platformText(lang).status;
  return (
    <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">{kind === "confirm" ? w.confirmTitle : w.unsubscribeTitle}</h1>
      <Suspense fallback={<div className="h-24 animate-pulse rounded-lg bg-surface" />}>
        <StatusLink lang={lang} kind={kind} params={params} />
      </Suspense>
    </main>
  );
}

async function StatusLink({ lang, kind, params }: { lang: PlatformLang; kind: "confirm" | "unsubscribe"; params: Promise<{ token: string }> }) {
  const { token } = await params;
  const w = platformText(lang).status;
  const works = kind === "confirm" ? await confirmationWorks(token) : await unsubscribeWorks(token);
  if (!works) return <p role="alert">{w.unknownLink}</p>;
  return (
    <ActionForm action={kind === "confirm" ? confirmStatusAction : unsubscribeStatusAction} className="flex flex-col gap-4" replaceOnSuccess>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="locale" value={PLATFORM_LANG_FACTS[lang].locale} />
      <p>{kind === "confirm" ? w.confirmAsk : w.unsubscribeAsk}</p>
      <div>
        <SubmitButton>{kind === "confirm" ? w.confirmButton : w.unsubscribeButton}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export const statusLinkMetadata = (lang: PlatformLang, kind: "confirm" | "unsubscribe"): Metadata => ({
  title: kind === "confirm" ? platformText(lang).status.confirmTitle : platformText(lang).status.unsubscribeTitle,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
});
