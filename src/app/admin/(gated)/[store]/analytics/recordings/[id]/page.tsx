import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { setAnalyticsLang } from "@/lib/analytics-lang";
import { RecordingPlayer } from "@/components/admin/analytics/recording-player";
import { entryName, lengthText } from "@/components/admin/analytics/recordings-view";
import { PageHeader } from "@/components/admin/ui/page-header";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf, ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requirePermission } from "@/server/permissions";
import { recordingOf } from "@/server/recordings-read";

import { deleteRecordingAction } from "../actions";

export const metadata: Metadata = { title: "Recording" };

/**
 * One recording's player (D656, `docs/heatmaps-and-recordings.md` step 11): the owner's alone. The events come from the events route, which
 * writes the viewing to the activity log first; this page sends an enforced policy of its own (`replayRouteHeaders()`). Deleting is a
 * deliberate step with a confirmation.
 */
export default async function RecordingPage({ params }: PageProps<"/admin/[store]/analytics/recordings/[id]">) {
  const { store: slug, id } = await params;
  const member = await requirePermission(slug, "owner");
  const lang = adminLangOf(member.account.adminLocale);
  setAnalyticsLang(lang);
  const words = adminText(lang, "recordings");
  const row = await recordingOf(member.store.id, id);
  if (!row) notFound();
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: member.store.timeZone }).format(new Date(row.startedAt));
  const base = `/admin/${slug}`;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `${base}/analytics/recordings`, label: words.player.back }}
        title={fillWords(words.player.title, { when })}
        description={fillWords(words.player.facts, {
          device: words.devices[row.device],
          length: lengthText(row.durationMs, words),
          pages: row.pages.length === 1 ? words.pages.one : fillWords(words.pages.many, { n: row.pages.length }),
        })}
        meta={[entryName(row.entryPage, words)]}
      />
      <RecordingPlayer eventsUrl={`${base}/analytics/recordings/${row.id}/events`} words={words.player} />
      <details className="w-fit rounded-lg border border-line bg-card p-4 text-sm">
        <summary className="cursor-pointer font-medium">{words.player.delete}</summary>
        <ActionForm action={deleteRecordingAction.bind(null, slug, row.id)} className="mt-3 flex flex-col gap-2">
          <p>{words.player.confirm}</p>
          <div>
            <SubmitButton variant="secondary">{words.player.yes}</SubmitButton>
          </div>
        </ActionForm>
      </details>
    </div>
  );
}
