import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { requireExtension } from "@/components/admin/extension-off";
import { Card, Chip, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { languageName } from "@/lib/localization";
import { storyLead, storyLines } from "@/lib/flow-story";
import type { FlowStep } from "@/lib/flows";
import { getFlow } from "@/server/flows";
import { memberCan, requirePermission } from "@/server/permissions";
import { listSegments } from "@/server/segments";

import { FlowCanvas } from "./canvas";
import { changeFlowEmailAction, changeFlowLapseAction, changeFlowWaitAction, switchFlowAction, testFlowAction } from "../actions";

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
 * nothing else. Change edits an email where it is; Customise opens the canvas (`canvas.tsx`), every step as a tree.
 */
export default async function FlowPage({ params }: PageProps<"/admin/[store]/flows/[flowId]">) {
  const { store: slug, flowId } = await params;
  const member = await requirePermission(slug, "marketing:read");
  const notInAccount = requireExtension(member, "email_automation");
  if (notInAccount) return notInAccount;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "flows");
  const flow = await getFlow(store.id, flowId);
  if (!flow) notFound();
  const segmentList = (await listSegments(store.id)).map((s) => ({ id: s.id, name: s.name }));
  const segments = new Map(segmentList.map((s) => [s.id, s.name]));
  const lines = storyLines(flow.steps, w.story, (id) => segments.get(id) ?? "?");
  const emails = emailsOf(flow.steps);
  const mayWrite = memberCan(member, "marketing:write");
  const languages = store.localization.locales.length > 0 ? store.localization.locales : ["en-GB"];
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
      <Card compact>
        <div className="flex flex-col gap-4" data-flow-story>
          <p className="text-body-strong text-ink">{storyLead(flow.trigger, flow.goals, w.story, flow.triggerDays)}</p>
          {/* A lapse flow's days without an order (slice 4), changed where they are said. */}
          {mayWrite && flow.triggerDays !== null && (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">{w.change}</summary>
              <ActionForm action={changeFlowLapseAction.bind(null, store.slug, flow.id)} className="mt-3 flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1">
                  {w.lapseDays}
                  <input name="days" type="number" min={30} max={730} required defaultValue={flow.triggerDays} className={`${FIELD} w-28`} />
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
          <p className="text-caption text-muted">{w.story.ends}</p>
        </div>
      </Card>
      {mayWrite && <FlowCanvas steps={flow.steps} storeSlug={store.slug} flowId={flow.id} locale={firstLocale} w={w} segments={segmentList} />}
      {mayWrite && (
        <div className="flex flex-wrap items-start gap-3">
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
