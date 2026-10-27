import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ButtonLink, Card, Chip, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { designTabHref } from "@/lib/design-presets";
import { THEMES_ADMIN } from "@/lib/theme-admin-paths";
import { SUBMISSION_LIMITS, SUBMISSION_SIGNAL, canMove } from "@/lib/theme-submissions";
import { requirePlatformAdmin } from "@/server/auth";
import { platformSiteWords } from "@/server/platform-site-words";
import { getSubmission } from "@/server/theme-submissions";

import { approveSubmissionAction, rejectSubmissionAction, reviewSubmissionAction } from "../actions";

export const metadata: Metadata = { title: "Submission" };

/**
 * One look shared as a theme (wave 7 unit J, D344): what was sent and by whom; *Review* makes it a draft theme to preview and check on the
 * theme's own pages, *Approve and publish* puts it in the theme store, *Not accepted* says why to its author.
 */
export default async function SubmissionPage({ params }: PageProps<"/admin/platform/themes/submissions/[submissionId]">) {
  await connection();
  const admin = await requirePlatformAdmin();
  const { w } = await platformSiteWords();
  const s = w.submissions;
  const submission = await getSubmission(admin, (await params).submissionId);
  if (!submission) notFound();
  const title = submission.kind === "update" ? fillWords(s.update, { title: submission.presetTitle ?? submission.title }) : submission.title;
  const field = "rounded-md border border-line bg-card px-3 py-2";
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        back={{ href: `${THEMES_ADMIN}/submissions`, label: s.title }}
        title={title}
        status={<Chip signal={SUBMISSION_SIGNAL[submission.status]}>{s.status[submission.status]}</Chip>}
        meta={[fillWords(s.by, { author: submission.authorName }), fillWords(s.from, { store: submission.storeName })]}
      />
      <Card>
        {submission.summary && <p className="text-body-strong text-ink">{submission.summary}</p>}
        {submission.description && <p className="mt-2 whitespace-pre-line text-sm text-ink-2">{submission.description}</p>}
        {submission.notes && (
          <p className="mt-2 whitespace-pre-line text-sm text-ink-2">
            <span className="text-body-strong text-ink">{s.notes}: </span>
            {submission.notes}
          </p>
        )}
        {submission.status === "rejected" && submission.reason && <p className="mt-2 text-sm text-ink-2">{fillWords(s.reasonShown, { reason: submission.reason })}</p>}
        {submission.presetId && (
          <div className="mt-4">
            <ButtonLink href={designTabHref(submission.presetId, "details")}>{s.openTheme}</ButtonLink>
          </div>
        )}
      </Card>
      {canMove(submission.status, "reviewing") && (
        <Card title={s.review} description={s.reviewHint}>
          <ActionForm action={reviewSubmissionAction.bind(null, submission.id)} successMessage={s.reviewed}>
            <SubmitButton>{s.review}</SubmitButton>
          </ActionForm>
        </Card>
      )}
      {canMove(submission.status, "approved") && (
        <Card title={s.approve} description={s.approveHint}>
          <ActionForm action={approveSubmissionAction.bind(null, submission.id)} successMessage={s.approved}>
            <SubmitButton>{s.approve}</SubmitButton>
          </ActionForm>
        </Card>
      )}
      {canMove(submission.status, "rejected") && (
        <Card title={s.reject}>
          <ActionForm action={rejectSubmissionAction.bind(null, submission.id)} className="flex flex-col gap-3" successMessage={s.rejected}>
            <label className="flex flex-col gap-1 text-sm">
              {s.reason}
              <textarea name="reason" required rows={3} maxLength={SUBMISSION_LIMITS.reason} className={field} />
            </label>
            <div>
              <SubmitButton variant="secondary">{s.reject}</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
