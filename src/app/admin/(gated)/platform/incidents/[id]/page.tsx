import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ButtonLink, Card, Chip, Field, PageHeader } from "@/components/admin/ui";
import { TextArea } from "@/components/admin/ui/field";
import { adminDate, PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import type { PlatformMessages } from "@/lib/admin-messages/platform.en";
import { PLATFORM_WORDS } from "@/lib/admin-words/platform";
import { canMove, workableStatus } from "@/lib/incidents";
import { requirePlatformReader } from "@/server/auth";
import { incidentDetail } from "@/server/incidents";

import { incidentAction } from "../actions";

export const metadata: Metadata = { title: "Incident" };

type W = PlatformMessages["incidents"];

/**
 * One entry of the incident log (D895): what it is, its facts and evidence (ids and counts, drawn as text), its history, and the owner's
 * decisions the log allows from where it stands.
 */
export default async function PlatformIncidentPage({ params }: PageProps<"/admin/platform/incidents/[id]">) {
  await connection();
  const admin = await requirePlatformReader();
  const lang = adminLangOf(admin.adminLocale);
  const w = PLATFORM_WORDS[lang].incidents;
  const { id } = await params;
  const entry = await incidentDetail(id);
  if (!entry) notFound();
  const at = (iso: string) => adminDate(PLATFORM_TIME_ZONE, iso, "dayTime", lang);
  const can = (to: Parameters<typeof canMove>[2]) => canMove(entry.kind, entry.status, to);
  const facts = Object.entries(entry.facts);
  const evidence = Object.entries(entry.evidence);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={entry.title}
        description={[w.kinds[entry.kind], w.sources[entry.source as keyof W["sources"]] ?? entry.source].join(" · ")}
        meta={[
          entry.occurrences > 1 ? fillWords(w.seen, { n: entry.occurrences, at: at(entry.lastSeenAt) }) : fillWords(w.seenOnce, { at: at(entry.lastSeenAt) }),
          ...(entry.storeSlug ? [fillWords(w.store, { store: entry.storeSlug })] : []),
          ...(entry.fixCommit ? [fillWords(w.commit, { commit: entry.fixCommit.slice(0, 7) })] : []),
        ]}
        actions={
          <ButtonLink kind="secondary" href="/admin/platform/incidents">
            {w.back}
          </ButtonLink>
        }
      />
      <Card title={w.statuses[entry.status]} aside={<Chip signal={entry.status === "needs_owner" || entry.status === "proposed" ? "danger" : "neutral"}>{w.kinds[entry.kind]}</Chip>}>
        {entry.fixNote && <p className="mb-4 text-sm text-ink">{entry.fixNote}</p>}
        <ActionForm action={incidentAction} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={entry.id} />
          <Field label={can("wont_fix") ? w.wontFixReason : w.reason}>
            {(control) => <TextArea {...control} name="note" maxLength={2000} rows={2} full />}
          </Field>
          <div className="flex flex-wrap gap-2">
            {can("approved") && entry.status === "proposed" && (
              <SubmitButton name="intent" value="approve">
                {w.approve}
              </SubmitButton>
            )}
            {can("dismissed") && (
              <SubmitButton name="intent" value="dismiss" variant="secondary">
                {w.dismiss}
              </SubmitButton>
            )}
            {entry.status === "needs_owner" && (
              <SubmitButton name="intent" value="send_back" variant="secondary">
                {w.sendBack}
              </SubmitButton>
            )}
            {(entry.status === "done" || entry.status === "wont_fix" || entry.status === "dismissed" || entry.status === "fixed") &&
              can(workableStatus(entry.kind)) && (
                <SubmitButton name="intent" value="reopen" variant="secondary">
                  {w.reopen}
                </SubmitButton>
              )}
            {can("wont_fix") && (
              <SubmitButton name="intent" value="wont_fix" variant="secondary">
                {w.wontFix}
              </SubmitButton>
            )}
          </div>
        </ActionForm>
      </Card>
      {facts.length > 0 && <Facts title={w.facts} rows={facts} />}
      {evidence.length > 0 && <Facts title={w.evidence} rows={evidence} />}
      <Card title={w.history}>
        <ol className="flex flex-col gap-2 text-sm">
          {entry.events.map((event, n) => (
            <li key={n}>
              <span className="text-muted">{at(event.at)}</span>{" "}
              {event.toStatus && <span className="text-body-strong text-ink">{w.statuses[event.toStatus as keyof W["statuses"]] ?? event.toStatus}</span>}{" "}
              <span className="text-muted">
                {event.who ? fillWords(w.historyBy, { who: event.who }) : event.session ? w.historyAutopilot : w.historyPlatform}
              </span>
              {event.note && <span className="block text-ink-2">{event.note}</span>}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

/** Facts or evidence as written: keys and values as text, never HTML (what an AI proposed is drawn as text, as every model's output is). */
function Facts({ title, rows }: { title: string; rows: [string, unknown][] }) {
  return (
    <Card title={title}>
      <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="truncate text-muted">{key}</dt>
            <dd className="min-w-0 break-words text-ink">{typeof value === "string" ? value : JSON.stringify(value)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
