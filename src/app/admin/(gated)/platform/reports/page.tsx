import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card, Chip, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import type { PlatformMessages } from "@/lib/admin-messages/platform.en";
import { requirePlatformAdmin } from "@/server/auth";
import { listContentReports, type ContentReport } from "@/server/content-reports";

import { decideReportAction } from "./actions";

export const metadata: Metadata = { title: "Illegal content notices" };

const field = "flex flex-col gap-1 text-sm";
const control = "min-h-10 rounded-md border border-line bg-card px-3";
type Words = PlatformMessages["reports"];
const when = (at: string) => at.slice(0, 16).replace("T", " ");

/** Notices of illegal content on stores (DSA art. 16, D411): those waiting first, each decided here with its reason. */
export default async function PlatformReportsPage() {
  await connection();
  const admin = await requirePlatformAdmin();
  const w = adminText(adminLangOf(admin.adminLocale), "platform").reports;
  const reports = await listContentReports();
  const waiting = reports.filter((r) => r.status === "received");
  const decided = reports.filter((r) => r.status !== "received");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.description} meta={[`${waiting.length} · ${w.waiting.toLowerCase()}`]} />
      <Card title={w.waiting}>
        {waiting.length === 0 ? (
          <p className="text-sm text-muted">{w.none}</p>
        ) : (
          <ul className="flex flex-col gap-6">
            {waiting.map((report) => (
              <li key={report.id} className="flex flex-col gap-3 border-b border-line pb-6 last:border-b-0 last:pb-0">
                <Facts report={report} w={w} />
                <ActionForm action={decideReportAction.bind(null, report.id)} className="flex flex-col gap-3" replaceOnSuccess>
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
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={w.decided}>
        {decided.length === 0 ? (
          <p className="text-sm text-muted">{w.noneDecided}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {decided.map((report) => (
              <li key={report.id} className="flex flex-col gap-2 border-b border-line pb-4 last:border-b-0 last:pb-0">
                <Facts report={report} w={w} />
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
function Facts({ report, w }: { report: ContentReport; w: Words }) {
  const sender = report.reporterName || report.reporterEmail
    ? [report.reporterName, report.reporterEmail].filter(Boolean).join(" · ")
    : report.status === "received"
      ? w.anonymous
      : w.forgotten;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <Chip signal="neutral">{w.categories[report.category]}</Chip>
        <span className="text-muted">{fillWords(w.received, { at: when(report.createdAt) })}</span>
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
