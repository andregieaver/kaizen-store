import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { requireExtension } from "@/components/admin/extension-off";
import { Card, Chip, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { storyLead, storyLines } from "@/lib/flow-story";
import type { FlowStep } from "@/lib/flows";
import { getFlow } from "@/server/flows";
import { memberCan, requirePermission } from "@/server/permissions";
import { listSegments } from "@/server/segments";

import { switchFlowAction, testFlowAction } from "../actions";

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
 * nothing else. Editing the words and the canvas (Customise) come next in slice 2.
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
  const segments = new Map((await listSegments(store.id)).map((s) => [s.id, s.name]));
  const lines = storyLines(flow.steps, w.story, (id) => segments.get(id) ?? "?");
  const emails = emailsOf(flow.steps);
  const mayWrite = memberCan(member, "marketing:write");
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
          <p className="text-body-strong text-ink">{storyLead(flow.trigger, flow.goals, w.story)}</p>
          <ol className="flex flex-col gap-3">
            {lines.map((line) => {
              const content = emails.get(line.stepId)?.content;
              const first = content ? Object.values(content)[0] : undefined;
              const words = first?.blocks.find((b) => "text" in b && typeof b.text === "string") as { text?: string } | undefined;
              return (
                <li key={line.stepId} className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4" style={{ marginInlineStart: `${line.depth * 1.25}rem` }}>
                  <p className="text-body text-ink sm:w-64 sm:shrink-0">
                    {line.when.charAt(0).toLocaleUpperCase(lang) + line.when.slice(1)}
                    {line.condition ? `, ${line.condition}` : ""}:
                  </p>
                  <div className="min-w-0 flex-1 rounded-lg border border-line bg-card px-4 py-3 shadow-sm" aria-label={`${w.emailLabel}: ${line.subject}`}>
                    <p className="text-body-strong text-ink">{line.subject}</p>
                    {words?.text && <p className="mt-1 line-clamp-2 text-caption text-muted">{words.text}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="text-caption text-muted">{w.story.ends}</p>
        </div>
      </Card>
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
