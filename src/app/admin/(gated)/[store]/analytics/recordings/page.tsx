import type { Metadata } from "next";

import { AnalyticsHeader } from "@/components/admin/analytics/analytics-header";
import { RecordingsList } from "@/components/admin/analytics/recordings-view";
import { fillWords } from "@/lib/admin-fill";
import { formatCount } from "@/lib/analytics-core";
import { HEAT_DEVICES, type HeatDevice } from "@/lib/page-heat";
import { analyticsContext } from "@/server/analytics-context";
import { listRecordings, recordingCounts, recordingTests, type RecordingFilters } from "@/server/recordings-read";
import { variantNameText } from "@/lib/experiment-words";
import { EXPERIMENTS_WORDS } from "@/lib/admin-words/experiments";
import { RECORDINGS_WORDS } from "@/lib/admin-words/recordings";
import { recordingsOpenNow } from "@/server/recordings-admin";

export const metadata: Metadata = { title: "Recordings" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Recordings of visits (D656, `docs/heatmaps-and-recordings.md` step 11): the owner's alone. Those kept are listed whatever the switch
 * says; the switch only stops new ones. Most frustrated first, or newest; chips and filters in the address. Thin on purpose.
 */
export default async function RecordingsPage({ params, searchParams }: PageProps<"/admin/[store]/analytics/recordings">) {
  const query = await searchParams;
  const ctx = await analyticsContext((await params).store, query, "owner");
  const { store } = ctx;
  const words = RECORDINGS_WORDS[ctx.lang];
  const device = one(query.device);
  const has = one(query.has);
  const page = one(query.page);
  const tag = one(query.tag);
  const from = one(query.from);
  const to = one(query.to);
  const filters: RecordingFilters = {
    device: (HEAT_DEVICES as readonly string[]).includes(device ?? "") ? (device as HeatDevice) : undefined,
    has: has === "rage" || has === "dead" ? has : undefined,
    page: page && /^\/[a-z0-9-]{2,40}(\/.*)?$/.test(page) && page.length <= 300 ? page : undefined,
    tag: tag && /^[0-9a-f-]{36}:[a-d]$/.test(tag) ? tag : undefined,
    from: from && DAY.test(from) ? from : undefined,
    to: to && DAY.test(to) ? to : undefined,
    sort: one(query.sort) === "newest" ? "newest" : "frustrated",
  };
  const p = Math.max(0, Math.min(100, Number(one(query.p)) || 0));
  const [{ rows, more }, counts, open, tests] = await Promise.all([
    listRecordings(store.id, filters, p),
    recordingCounts(store.id, filters),
    recordingsOpenNow(),
    recordingTests(store.id),
  ]);
  const experimentWords = EXPERIMENTS_WORDS[ctx.lang];
  const versions = tests.flatMap((t) => t.versions.map((v) => ({ tag: `${t.id}:${v.key}`, label: `${t.name}: ${variantNameText(v.name, experimentWords)}` })));
  return (
    <>
      <div className="flex flex-col gap-8">
        <AnalyticsHeader
          ctx={ctx}
          path="/analytics/recordings"
          title={words.title}
          description={
            <>
              <span className="sm:hidden">{words.phoneLead}</span>
              <span className="max-sm:hidden">{words.description}</span>
            </>
          }
          picker={false}
          showCompare={false}
          lead={counts.all > 0 ? fillWords(filters.sort === "newest" ? words.leadNewest : words.lead, { n: formatCount(counts.all) }) : undefined}
        />
        <RecordingsList
          base={ctx.base}
          rows={rows}
          counts={counts}
          filters={filters}
          on={store.recordings}
          available={open || store.house}
          more={more}
          page={p}
          timeZone={store.timeZone}
          locale={ctx.locale}
          now={ctx.now}
          words={words}
          versions={versions}
        />
      </div>
    </>
  );
}
