import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { RecordingPlayer } from "@/components/admin/analytics/recording-player";
import { lengthText } from "@/components/admin/analytics/recordings-view";
import { Card, Chip, EmptyState, List, ListRow, PageHeader, RowLead } from "@/components/admin/ui";
import { adminDate, PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { setAnalyticsLang } from "@/lib/analytics-lang";
import { ADMIN_USE_VIEWER_WORDS } from "@/lib/admin-words/admin-use-viewer";
import { RECORDINGS_WORDS } from "@/lib/admin-words/recordings";
import { adminSignalsState } from "@/server/admin-signals";
import { adminRecordingOf, adminRecordings, adminScreenFigures } from "@/server/admin-use";
import { requirePlatform } from "@/server/auth";

import { screenName } from "./screen-name";

export const metadata: Metadata = { title: "Admin use" };

/**
 * Platform → Admin use (D895 phase 3b): how store owners who said yes use the admin. For Homer, the screens where they struggle most and
 * the recordings, most frustrated first; a recording opens in the stores' player on this page (`?recording=`), whose events route logs the
 * viewing before anything is shown, under the replay's enforced policy (`replayRouteHeaders()`). Kaizena Flow's team only; no owner, store
 * or address is ever on this page, since none is kept.
 */
export default async function AdminUsePage({ searchParams }: PageProps<"/admin/platform/admin-use">) {
  await connection();
  const account = await requirePlatform("settings", "read");
  const lang = adminLangOf(account.adminLocale);
  const watching = (await searchParams).recording;
  if (typeof watching === "string") return <Watch id={watching} lang={lang} />;
  const w = ADMIN_USE_VIEWER_WORDS[lang];
  const rw = RECORDINGS_WORDS[lang];
  const [screens, recordings, state] = await Promise.all([adminScreenFigures(), adminRecordings(), adminSignalsState()]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.description} />
      {!state.open && <p className="text-sm text-muted">{w.notOpen}</p>}
      <Card title={w.screens} description={w.screensSub} count={screens.length}>
        {screens.length === 0 ? (
          <EmptyState compact title={w.screensNone} />
        ) : (
          <List label={w.screens}>
            {screens.map((row) => (
              <ListRow key={row.screen}>
                <RowLead
                  title={screenName(row.screen, w)}
                  sub={[
                    fillWords(w.views, { n: row.views }),
                    row.frustratedPct === null ? w.tooFew : fillWords(w.frustrated, { pct: row.frustratedPct }),
                    row.endPct === null ? null : fillWords(w.end, { pct: row.endPct }),
                    fillWords(w.clicks, { dead: row.deadClicks, rage: row.rageClicks }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
                {row.frustratedPct !== null && <Chip signal={row.frustratedPct >= 20 ? "warning" : "neutral"}>{`${row.frustratedPct} %`}</Chip>}
              </ListRow>
            ))}
          </List>
        )}
      </Card>
      <Card title={w.recordings} description={w.recordingsSub} count={recordings.length}>
        {recordings.length === 0 ? (
          <EmptyState compact title={w.recordingsNone} />
        ) : (
          <List label={w.recordings}>
            {recordings.map((r) => (
              <ListRow key={r.id}>
                <RowLead
                  title={r.screens.map((s) => screenName(s, w)).join(" → ")}
                  href={`/admin/platform/admin-use?recording=${r.id}`}
                  sub={[
                    adminDate(PLATFORM_TIME_ZONE, r.startedAt, "dayTime", lang),
                    rw.devices[r.device],
                    lengthText(r.durationMs, rw),
                    w.ages[r.ageBand],
                    fillWords(w.clicks, { dead: r.deadClicks, rage: r.rageClicks }),
                  ].join(" · ")}
                />
              </ListRow>
            ))}
          </List>
        )}
      </Card>
    </div>
  );
}

/** One recording in the stores' player; its events come from the events route, which writes the viewing to the activity log first. */
async function Watch({ id, lang }: { id: string; lang: ReturnType<typeof adminLangOf> }) {
  setAnalyticsLang(lang);
  const w = ADMIN_USE_VIEWER_WORDS[lang];
  const rw = RECORDINGS_WORDS[lang];
  const row = await adminRecordingOf(id);
  if (!row) notFound();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: "/admin/platform/admin-use", label: w.back }}
        title={fillWords(w.title1, { when: adminDate(PLATFORM_TIME_ZONE, row.startedAt, "dayTime", lang) })}
        description={[rw.devices[row.device], lengthText(row.durationMs, rw), w.ages[row.ageBand]].join(" · ")}
        meta={[row.screens.map((s) => screenName(s, w)).join(" → ")]}
      />
      <RecordingPlayer eventsUrl={`/admin/platform/admin-use/${row.id}/events`} words={rw.player} />
    </div>
  );
}
