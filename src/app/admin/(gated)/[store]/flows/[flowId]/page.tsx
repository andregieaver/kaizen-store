import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { requireExtension } from "@/components/admin/extension-off";
import { AdminLink, ButtonLink, Card, Chip, PageHeader } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminDate } from "@/lib/admin-date";
import { wallClock } from "@/lib/page-schedules";
import { flowSuggestion } from "@/lib/flow-report";
import { formatMoney } from "@/lib/money";
import { checkWords, flowChecks } from "@/lib/flow-checks";
import { DATE_TRIGGER_DAYS, isDateTrigger } from "@/lib/flow-triggers";
import { darkPreview } from "@/lib/email-dark";
import { stepReach } from "@/lib/flow-reach";
import { splitFigures, splitsOf, splitWorthTrying } from "@/lib/flow-split";
import { TEST_FLOOR } from "@/lib/broadcast-test-sizes";
import { fillWords } from "@/lib/admin-fill";
import { FLOW_SPLITS_WORDS } from "@/lib/admin-words/flow-splits";
import { languageName } from "@/lib/localization";
import { scheduleOf, storyLead, storyLines, triggerNameOf } from "@/lib/flow-story";
import type { FlowStep } from "@/lib/flows";
import { FLOWS_WORDS } from "@/lib/admin-words/flows";
import { drawFlowEmails, flowReach, flowStepFigures, flowStepPast, flowReport, getFlow } from "@/server/flows";
import { memberCan, requirePermission } from "@/server/permissions";
import { listSegments } from "@/server/segments";

import { FlowCanvasSection } from "./flow-canvas-section";
import { changeFlowEmailAction, changeFlowLapseAction, changeFlowWaitAction, keepFlowWayAction, switchFlowAction, testFlowAction } from "../actions";

const FIELD = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";

export const metadata: Metadata = { title: "Flow" };

/** Every email step of a tree, by id, for its words on the page. */
function emailsOf(steps: readonly FlowStep[], into = new Map<string, Extract<FlowStep, { kind: "email" }>>()) {
  for (const step of steps) {
    if (step.kind === "email") into.set(step.id, step);
    if (step.kind === "if") {
      emailsOf(step.then, into);
      emailsOf(step.else, into);
    }
  }
  return into;
}

/**
 * One flow as the owner reads it (D767 slice 2, email plan M3.3): what starts it, then each email as a sentence (*3 days later, if they have
 * not ordered*) with the email itself drawn as a small picture of its subject and first words. Test it, then switch it on; Homer needs
 * nothing else. Change edits an email where it is; Customise opens the canvas (`flow-board.tsx`), the flow drawn as a chart and dragged and dropped.
 */

/** `datetime-local` text for a time on the store's clock, as the schedule's form sends it back (D786). */
function localText(iso: string, timeZone: string): string {
  const { day, time } = wallClock(iso, timeZone);
  return `${day}T${time}`;
}

export default async function FlowPage({ params, searchParams }: PageProps<"/admin/[store]/flows/[flowId]">) {
  const { store: slug, flowId } = await params;
  const query = await searchParams;
  const see = query.see === "1";
  // The width the drawn emails are seen at (M3.4): a phone's or a desktop's.
  const phone = query.width === "phone";
  // And as a mail app that turns it dark shows it (M3.4).
  const dark = query.scheme === "dark";
  const seeAt = (width: "phone" | null, scheme: "dark" | null) =>
    `/admin/${slug}/flows/${flowId}?see=1${width ? "&width=phone" : ""}${scheme ? "&scheme=dark" : ""}`;
  const member = await requirePermission(slug, "marketing:read");
  const notInAccount = requireExtension(member, "email_automation");
  if (notInAccount) return notInAccount;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = FLOWS_WORDS[lang];
  const flow = await getFlow(store.id, flowId);
  if (!flow) notFound();
  const segmentList = (await listSegments(store.id)).map((s) => ({ id: s.id, name: s.name }));
  const segments = new Map(segmentList.map((s) => [s.id, s.name]));
  const lines = storyLines(flow.steps, w.story, (id) => segments.get(id) ?? "?");
  const emails = emailsOf(flow.steps);
  const mayWrite = memberCan(member, "marketing:write");
  const languages = store.localization.locales.length > 0 ? store.localization.locales : ["en-GB"];
  const checks = flowChecks(flow.steps, languages[0]);
  // A split test's ways side by side (M2.5, D868): read only when the flow splits.
  const splits = splitsOf(flow.steps);
  const [reach, report, past, stepFigures] = await Promise.all([
    mayWrite ? flowReach(store.id, flow.trigger, flow.triggerDays, flow.triggerSegmentId, flow.triggerTag ?? flow.triggerEvent) : Promise.resolve(0),
    flowReport(store.id, flow.id),
    mayWrite ? flowStepPast(store.id, flow.id) : Promise.resolve(null),
    splits.length > 0 ? flowStepFigures(store.id, flow.id) : Promise.resolve(null),
  ]);
  const ws = FLOW_SPLITS_WORDS[lang];
  // Each email's reach (M3.5): from the flow's own past once it has one, else everyone who starts, or at most that inside a branch.
  const reachOf = past ? stepReach(flow.steps, reach, past) : null;
  const numbers = ADMIN_LANG_FACTS[lang].locale;
  const money = Object.entries(report.minor).map(([cur, minor]) => formatMoney(minor, cur, numbers)).join(" + ") || formatMoney(0, store.markets[0]?.currency ?? "EUR", numbers);
  const suggestion = w.report.suggestions[flowSuggestion(report)];
  const topSubject = report.topStep ? emails.get(report.topStep.id) : undefined;
  // The emails drawn for the person tested (M3.5), only when asked for: each is a full email to draw.
  const drawn = mayWrite && see ? await drawFlowEmails(store.id, flow.id) : null;
  const firstLocale = Object.keys([...emails.values()][0]?.content ?? {})[0] ?? store.localization.locales[0] ?? "en-GB";
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `/admin/${store.slug}/flows`, label: w.title }}
        title={flow.name}
        status={
          <Chip signal={flow.enabled ? "positive" : "neutral"} dot>
            {flow.enabled ? w.statuses.on : w.statuses.off}
          </Chip>
        }
      />
      {/* A recipe's words in the store's voice (D897), written after Start answered: said while it writes, and once written. */}
      {query.voice === "1" && (
        <p role="status" className="rounded-panel border border-line bg-card px-4 py-3 text-body text-ink" data-flow-voice>
          {flow.version === 1 ? w.voice.writing : w.voice.written}
        </p>
      )}
      {/* The flow guard (M3.9): why it is off, in numbers counted by code; Switch on below starts it again. */}
      {flow.guard && !flow.enabled && (
        <div role="alert" className="rounded-panel border border-danger-line bg-danger-soft px-4 py-3 text-body text-ink" data-flow-guard>
          {w.guard.paused
            .replace("{left}", flow.guard.left.toLocaleString(numbers))
            .replace("{sent}", flow.guard.sent.toLocaleString(numbers))
            .replace("{date}", adminDate(store, flow.guard.at, "day", lang))}
        </div>
      )}
      <Card compact>
        <div className="flex flex-col gap-4" data-flow-story>
          <p className="text-body-strong text-ink">{storyLead(flow.trigger, flow.goals, w.story, flow.triggerDays, triggerNameOf(flow), scheduleOf(flow, store, lang))}</p>
          {/* A date trigger's days (slice 4), changed where they are said. */}
          {mayWrite && flow.triggerDays !== null && (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">{w.change}</summary>
              <ActionForm action={changeFlowLapseAction.bind(null, store.slug, flow.id)} className="mt-3 flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1">
                  {flow.trigger === "customer.browsed" ? w.browseDays : w.lapseDays}
                  <input
                    name="days"
                    type="number"
                    min={isDateTrigger(flow.trigger) ? DATE_TRIGGER_DAYS[flow.trigger].min : 1}
                    max={isDateTrigger(flow.trigger) ? DATE_TRIGGER_DAYS[flow.trigger].max : 730}
                    required
                    defaultValue={flow.triggerDays}
                    className={`${FIELD} w-28`}
                  />
                </label>
                <SubmitButton variant="secondary">{w.save}</SubmitButton>
              </ActionForm>
            </details>
          )}
          <ol className="flex flex-col gap-3">
            {lines.map((line) => {
              const content = emails.get(line.stepId)?.content;
              const locale = content ? (Object.keys(content)[0] ?? "") : "";
              const first = content ? content[locale] : undefined;
              const words = first?.blocks.find((b) => b.type === "paragraph") as { text?: string } | undefined;
              const missing = languages.filter((l) => !content?.[l]?.subject);
              return (
                <li key={line.stepId} className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4" style={{ marginInlineStart: `${line.depth * 1.25}rem` }}>
                  <p className="text-body text-ink sm:w-64 sm:shrink-0">
                    {line.when.charAt(0).toLocaleUpperCase(lang) + line.when.slice(1)}
                    {line.condition ? `, ${line.condition}` : ""}:
                  </p>
                  <div className="min-w-0 flex-1 rounded-lg border border-line bg-card px-4 py-3 shadow-sm" aria-label={`${w.emailLabel}: ${line.subject}`}>
                    <p className="text-body-strong text-ink">{line.subject}</p>
                    {words?.text && <p className="mt-1 line-clamp-2 text-caption text-muted">{words.text}</p>}
                    {reachOf?.get(line.stepId) && (
                      <p className="mt-1 text-caption text-muted" data-step-reach>
                        {w.stepReach[reachOf.get(line.stepId)?.how ?? "all"].replace("{n}", (reachOf.get(line.stepId)?.n ?? 0).toLocaleString(numbers))}
                      </p>
                    )}
                    {emails.get(line.stepId)?.picks && (
                      <p className="mt-1 text-caption text-muted">{w.picksNote[emails.get(line.stepId)?.picks ?? "cross_sell"]}</p>
                    )}
                    {missing.length > 0 && (
                      <p className="mt-1 text-caption text-muted">
                        {/* languageFor() (D767): a reader without their language gets the store's first language, or nothing without it. */}
                        {(missing.includes(languages[0]) ? w.mainMissing : w.missingIn)
                          .replace("{languages}", missing.map(languageName).join(", "))
                          .replace("{first}", languageName(languages[0]))}
                      </p>
                    )}
                    {/* The words changed where they are (D767 slice 2), every language of the store side by side: one step away, under Change. */}
                    {mayWrite && (
                      <details className="mt-2 text-sm">
                        <summary className="cursor-pointer font-medium">{w.change}</summary>
                        <div className="mt-3 grid gap-4 md:grid-cols-2">
                          {languages.map((lang) => {
                            const own = content?.[lang];
                            const ownWords = own?.blocks.find((b) => b.type === "paragraph") as { text?: string } | undefined;
                            return (
                              <ActionForm key={lang} action={changeFlowEmailAction.bind(null, store.slug, flow.id, line.stepId, lang)} className="flex flex-col gap-3">
                                <fieldset className="flex flex-col gap-3" aria-label={languageName(lang)}>
                                  {languages.length > 1 && <legend className="mb-1 font-medium text-ink">{languageName(lang)}</legend>}
                                  <label className="flex flex-col gap-1">
                                    {w.subject}
                                    <input name="subject" required defaultValue={own?.subject ?? ""} maxLength={200} className={FIELD} />
                                  </label>
                                  <label className="flex flex-col gap-1">
                                    {w.words}
                                    <textarea name="text" required defaultValue={ownWords?.text ?? ""} rows={4} maxLength={5000} className={`${FIELD} py-2`} />
                                  </label>
                                  <div>
                                    <SubmitButton variant="secondary">{w.save}</SubmitButton>
                                  </div>
                                </fieldset>
                              </ActionForm>
                            );
                          })}
                        </div>
                        {line.waitId && (
                          <ActionForm action={changeFlowWaitAction.bind(null, store.slug, flow.id, line.waitId)} className="mt-3 flex flex-wrap items-end gap-2">
                            <label className="flex flex-col gap-1">
                              {w.days}
                              <input name="days" type="number" min={1} max={365} required defaultValue={line.waitDays ?? 1} className={`${FIELD} w-24`} />
                            </label>
                            <SubmitButton variant="secondary">{w.save}</SubmitButton>
                          </ActionForm>
                        )}
                        <p className="mt-2 text-caption text-muted">{w.changeOff}</p>
                      </details>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="text-caption text-muted">{flow.trigger === "subscriber.asleep" ? w.story.endsPaused : w.story.ends}</p>
        </div>
      </Card>
      {/* The canvas (Customise): the flow as a chart, dragged and dropped (flow-board.tsx); one deliberate step from the story. */}
      {mayWrite && (
        <FlowCanvasSection
          customise={w.canvas.customise}
          lead={w.canvas.lead}
          storeSlug={store.slug}
          flowId={flow.id}
          locale={firstLocale}
          steps={flow.steps}
          trigger={flow.trigger}
          triggerDays={flow.triggerDays}
          segmentName={triggerNameOf(flow)}
          schedule={scheduleOf(flow, store, lang)}
          scheduleLocal={flow.scheduleAt ? localText(flow.scheduleAt, store.timeZone) : ""}
          scheduleEvery={flow.scheduleEveryDays}
          segmentId={flow.triggerSegmentId}
          w={w}
          segments={segmentList}
          languages={languages}
        />
      )}
      {/* Lisa's depth on the same screen (M3.10, pass mark 5): how often each person may hear from the store, the one contact policy. */}
      {mayWrite && (
        <AdminLink href={`/admin/${store.slug}/marketing#contact-policy`} className="self-start text-caption text-ink-2 underline underline-offset-2" data-flow-contact-policy>
          {w.contactPolicy}
        </AdminLink>
      )}
      {/* The checks before switching on (M3.6): each a line with what to fix; a blocking one keeps Switch on refused. */}
      {mayWrite && checks.length > 0 && (
        <Card compact>
          <div className="flex flex-col gap-2" data-flow-checks>
            <p className="text-body-strong text-ink">{w.checks.title}</p>
            <ul className="flex flex-col gap-1.5">
              {checks.map((c, i) => (
                <li key={i} className={`text-sm ${c.blocking ? "text-danger-text" : "text-ink-2"}`}>
                  {checkWords(w, c)}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}
      {stepFigures && (
        <Card compact>
          <div className="flex flex-col gap-3" data-flow-splits>
            <p className="text-body-strong text-ink">{ws.title}</p>
            {splits.map((split) => {
              const f = splitFigures(split, stepFigures.people, stepFigures.orders);
              const n = (v: number) => v.toLocaleString(numbers);
              const way = f.better === "then" ? ws.first : ws.second;
              const said =
                f.better !== null
                  ? fillWords(ws.calls.better, { way })
                  : f.call === "few"
                    ? fillWords(ws.calls.few, { floor: n(TEST_FLOOR) })
                    : f.call === "broken"
                      ? ws.calls.broken
                      : ws.calls.even;
              return (
                <div key={split.id} className="flex flex-col gap-1">
                  <p className="text-body text-ink-2">{fillWords(ws.ways, { pa: n(f.first.people), oa: n(f.first.orders), pb: n(f.second.people), ob: n(f.second.orders) })}</p>
                  <p className="text-body text-ink">{said}</p>
                  {mayWrite && f.better && (
                    <ActionForm action={keepFlowWayAction.bind(null, store.slug, flow.id, split.id, f.better)}>
                      <SubmitButton variant="secondary">{fillWords(ws.keep, { way })}</SubmitButton>
                    </ActionForm>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
      {/* The report in words (M3.8): the last 30 days, each order credited to the latest message its buyer got (D761), one suggestion. */}
      {(flow.enabled || report.entered > 0) && (
        <Card compact>
          <div className="flex flex-col gap-1.5" data-flow-report>
            <p className="text-body-strong text-ink">{w.report.title}</p>
            <p className="text-body text-ink-2">
              {report.entered === 0
                ? w.report.nobody
                : w.report.line
                    .replace("{entered}", report.entered.toLocaleString(numbers))
                    .replace("{sent}", report.sent.toLocaleString(numbers))
                    .replace("{orders}", report.orders.toLocaleString(numbers))
                    .replace("{money}", money)}
            </p>
            {topSubject && <p className="text-body text-ink-2">{w.report.top.replace("{subject}", Object.values(topSubject.content)[0]?.subject ?? "")}</p>}
            {report.left > 0 && <p className="text-body text-ink-2">{w.report.left.replace("{left}", report.left.toLocaleString(numbers))}</p>}
            {suggestion && <p className="text-body text-ink">{suggestion}</p>}
            {/* A split test worth trying (M2.5 slice 5), when no stronger suggestion stands. */}
            {!suggestion && splitWorthTrying(flow.steps, report.entered) && (
              <p className="text-body text-ink" data-split-worth-trying>
                {fillWords(ws.worthTrying, { n: report.entered.toLocaleString(numbers) })}
              </p>
            )}
          </div>
        </Card>
      )}
      {drawn && (
        <Card compact>
          <div className="flex flex-col gap-4" data-flow-drawn>
            <p className="text-body-strong text-ink">{drawn.person ? w.seeingEmails.replace("{person}", drawn.person) : w.noPerson}</p>
            {drawn.emails.length > 0 && (
              <div className="flex flex-wrap gap-4">
                <nav aria-label={w.widths.label} className="flex gap-2 text-sm">
                  {(["desktop", "phone"] as const).map((k) => (
                    <ButtonLink
                      key={k}
                      href={seeAt(k === "phone" ? "phone" : null, dark ? "dark" : null)}
                      aria-current={(k === "phone") === phone ? "true" : undefined}
                      kind={(k === "phone") === phone ? "secondary" : "quiet"}
                      size="dense"
                    >
                      {w.widths[k]}
                    </ButtonLink>
                  ))}
                </nav>
                <nav aria-label={w.schemes.label} className="flex gap-2 text-sm">
                  {(["light", "dark"] as const).map((k) => (
                    <ButtonLink
                      key={k}
                      href={seeAt(phone ? "phone" : null, k === "dark" ? "dark" : null)}
                      aria-current={(k === "dark") === dark ? "true" : undefined}
                      kind={(k === "dark") === dark ? "secondary" : "quiet"}
                      size="dense"
                    >
                      {w.schemes[k]}
                    </ButtonLink>
                  ))}
                </nav>
              </div>
            )}
            {dark && drawn.emails.length > 0 && <p className="text-caption text-muted">{w.schemes.note}</p>}
            {drawn.emails.map((e) => (
              <iframe
                key={e.stepId}
                title={w.frame.replace("{subject}", e.subject)}
                srcDoc={dark ? darkPreview(e.html) : e.html}
                sandbox=""
                className={`h-[60vh] rounded-panel border border-line bg-white ${phone ? "w-[375px] max-w-full self-center" : "w-full"}`}
              />
            ))}
          </div>
        </Card>
      )}
      {mayWrite && (
        <div className="flex flex-wrap items-start gap-3">
          {/* The dry run's reach (M3.5): from real data, nothing sent; Test below walks one real person through it. */}
          <p className="w-full text-body text-ink-2" data-flow-reach>
            {reach === 0 ? w.reach.none : reach === 1 ? w.reach.one : w.reach.many.replace("{n}", String(reach))}
          </p>
          {!drawn && (
            <AdminLink href={`/admin/${store.slug}/flows/${flow.id}?see=1`} className="w-full text-sm font-medium text-ink underline underline-offset-2">
              {w.seeEmails.replace("{person}", w.newestPerson)}
            </AdminLink>
          )}
          {!flow.enabled && !flow.tested && <p className="w-full text-body text-ink-2">{w.untested}</p>}
          <ActionForm action={testFlowAction.bind(null, store.slug, flow.id)} className="flex flex-col gap-2">
            <SubmitButton variant={flow.tested ? "secondary" : "primary"}>{w.test}</SubmitButton>
          </ActionForm>
          {flow.enabled ? (
            <ActionForm action={switchFlowAction.bind(null, store.slug, flow.id, false)}>
              <SubmitButton variant="secondary">{w.switchOff}</SubmitButton>
            </ActionForm>
          ) : (
            flow.tested && (
              <ActionForm action={switchFlowAction.bind(null, store.slug, flow.id, true)}>
                <SubmitButton>{w.switchOn}</SubmitButton>
              </ActionForm>
            )
          )}
        </div>
      )}
    </div>
  );
}
