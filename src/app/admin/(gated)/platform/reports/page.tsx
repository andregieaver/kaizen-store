import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PhoneRow } from "@/components/admin/phone-row";
import { Card, Chip, EmptyState, PageHeader } from "@/components/admin/ui";
import { adminDate, PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { adminLangOf, type AdminLang } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import type { PlatformMessages } from "@/lib/admin-messages/platform.en";
import { PLATFORM_WORDS } from "@/lib/admin-words/platform";
import { requirePlatformReader } from "@/server/auth";
import { screeningOn } from "@/server/content-moderation";
import { listContentReports, type ContentReport } from "@/server/content-reports";

import { decideReportAction, saveScreeningAction } from "./actions";
import { UseDraft } from "./use-draft";

export const metadata: Metadata = { title: "Content notices" };

const field = "flex flex-col gap-1 text-sm";
const control = "min-h-10 rounded-md border border-line bg-card px-3";
type Words = PlatformMessages["reports"];

/** Notices of illegal content on stores (DSA art. 16, D411): those waiting first, each decided here with its reason. */
export default async function PlatformReportsPage() {
  await connection();
  const admin = await requirePlatformReader();
  const lang = adminLangOf(admin.adminLocale);
  const w = PLATFORM_WORDS[lang].reports;
  const when = (at: string) => adminDate(PLATFORM_TIME_ZONE, at, "dayTime", lang);
  const [reports, screening] = await Promise.all([listContentReports(), screeningOn()]);
  const waiting = reports.filter((r) => r.status === "received");
  const decided = reports.filter((r) => r.status !== "received");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={
          <>
            <span className="sm:hidden">{w.phone.lead}</span>
            <span className="max-sm:hidden">{w.description}</span>
          </>
        }
        meta={[`${waiting.length} · ${w.waiting.toLowerCase()}`]}
      />
      {/* Round 65 (D832): on a phone each waiting notice is one row (its kind, when it came, the AI's urgency and the store) opening the notice, the reading and the decision. */}
      <Card title={w.waiting} className="max-sm:p-0 max-sm:[&>header]:sr-only">
        {waiting.length === 0 ? (
          <EmptyState compact title={w.none} />
        ) : (
          <ul className="flex flex-col gap-6 max-sm:gap-0 max-sm:px-4">
            {waiting.map((report, index) => (
              <li key={report.id} className="border-b border-line pb-6 last:border-b-0 last:pb-0 max-sm:border-b-0 max-sm:pb-0">
                <PhoneRow
                  inset
                  last={index === waiting.length - 1}
                  title={`${w.categories[report.category]} · ${when(report.createdAt)}`}
                  sub={[report.aiReading ? `${w.phone.ai}: ${w.ai.urgency[report.aiReading.urgency]}` : null, report.store ? report.store.name : w.noStore].filter(Boolean).join(" · ")}
                  change={w.phone.decide}
                  done={w.phone.close}
                >
                <div className="flex flex-col gap-3">
                <Facts report={report} w={w} lang={lang} />
                <Reading report={report} w={w} />
                <ActionForm id={`decide-${report.id}`} action={decideReportAction.bind(null, report.id)} className="flex flex-col gap-3" replaceOnSuccess>
                  <fieldset className="flex flex-wrap gap-4 text-sm">
                    <legend className="mb-1">{w.outcome}</legend>
                    <label className="flex items-center gap-2">
                      <input type="radio" name="outcome" value="no_action" defaultChecked />
                      {w.noAction}
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="radio" name="outcome" value="actioned" />
                      {w.actioned}
                    </label>
                  </fieldset>
                  <label className={field}>
                    {w.actionTaken}
                    <input name="actionTaken" maxLength={1000} className={control} />
                    <span className="text-muted">{w.actionHint}</span>
                  </label>
                  <label className={field}>
                    {w.reason}
                    <textarea name="decision" required minLength={10} maxLength={5000} rows={3} className={`${control} py-2`} />
                    <span className="text-muted">{w.reasonHint}</span>
                  </label>
                  <div>
                    <SubmitButton>{w.decide}</SubmitButton>
                  </div>
                </ActionForm>
                </div>
                </PhoneRow>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={w.screening.title}>
        <ActionForm action={saveScreeningAction} className="flex flex-col gap-3" successMessage={w.screening.saved}>
          <p className="text-sm text-muted">{w.screening.description}</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="on" defaultChecked={screening} />
            {w.screening.label}
          </label>
          <div>
            <SubmitButton>{w.screening.save}</SubmitButton>
          </div>
        </ActionForm>
      </Card>
      <Card title={w.decided}>
        {decided.length === 0 ? (
          <EmptyState compact title={w.noneDecided} />
        ) : (
          <ul className="flex flex-col gap-4">
            {decided.map((report) => (
              <li key={report.id} className="flex flex-col gap-2 border-b border-line pb-4 last:border-b-0 last:pb-0">
                <Facts report={report} w={w} lang={lang} />
                <p className="text-sm">
                  <Chip signal={report.status === "actioned" ? "danger" : "neutral"}>{report.status === "actioned" ? w.actioned : w.noAction}</Chip>{" "}
                  {report.decidedAt && <span className="text-muted">{fillWords(w.decidedAt, { at: when(report.decidedAt) })}</span>}
                </p>
                {report.actionTaken && <p className="text-sm">{report.actionTaken}</p>}
                {report.decision && <p className="text-sm whitespace-pre-line text-muted">{report.decision}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** What a notice says, as the sender wrote it (shown as text, never as HTML). */
function Facts({ report, w, lang }: { report: ContentReport; w: Words; lang: AdminLang }) {
  const sender = report.reporterName || report.reporterEmail
    ? [report.reporterName, report.reporterEmail].filter(Boolean).join(" · ")
    : report.status === "received"
      ? w.anonymous
      : w.forgotten;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <Chip signal="neutral">{w.categories[report.category]}</Chip>
        {report.source === "screening" && <Chip signal="neutral">{w.fromCheck}</Chip>}
        <span className="text-muted">{fillWords(w.received, { at: adminDate(PLATFORM_TIME_ZONE, report.createdAt, "dayTime", lang) })}</span>
      </p>
      <a href={report.url} target="_blank" rel="noopener noreferrer nofollow" className="w-fit break-all underline">
        {report.url}
      </a>
      <p>
        <span className="text-body-strong text-ink">{w.store}:</span> {report.store ? `${report.store.name} (${report.store.slug})` : w.noStore}
      </p>
      <p className="whitespace-pre-line">{report.explanation}</p>
      <p className="text-muted">
        {w.sender}: {sender}
      </p>
    </div>
  );
}

/** The AI's reading of a waiting notice, labelled as the AI's and shown as text; the draft goes into the reason only when asked. */
function Reading({ report, w }: { report: ContentReport; w: Words }) {
  const reading = report.aiReading;
  if (!reading) return <p className="text-sm text-muted">{w.ai.notRead}</p>;
  return (
    <section aria-label={w.ai.heading} className="flex flex-col gap-2 rounded-panel border border-line bg-sunken p-3 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <span className="text-body-strong text-ink">{w.ai.heading}</span>
        <Chip signal={reading.urgency === "high" ? "danger" : "neutral"}>{w.ai.urgency[reading.urgency]}</Chip>
        <Chip signal="neutral">{w.categories[reading.category]}</Chip>
        {reading.manifest && <Chip signal="danger">{w.ai.manifest}</Chip>}
      </p>
      <p className="whitespace-pre-line">{reading.summary}</p>
      <p className="whitespace-pre-line text-muted">{reading.draftReason}</p>
      <p className="text-muted">{w.ai.note}</p>
      <UseDraft formId={`decide-${report.id}`} draft={reading.draftReason} label={w.ai.useDraft} />
    </section>
  );
}
