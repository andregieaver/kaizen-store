import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminTextScope } from "@/components/admin/admin-text";
import { DreamFeed, DreamMade, DreamProgress, DreamSketch, DreamTimeline } from "@/components/admin/dream/dream-showcase";
import { RefreshWhile } from "@/components/admin/refresh-while";
import { ButtonLink, Chip, KpiTile, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { ownerWaitMs, scoreOf } from "@/lib/dream-factory";
import { marketPath, storeHref } from "@/lib/paths";
import { passMembership, requirePlatformAdmin } from "@/server/auth";
import { testDreamRun } from "@/server/dream-factory";
import { dreamShowcase } from "@/server/dream-showcase";
import { getPageForEdit } from "@/server/pages";
import { DreamFrontPage } from "@/app/admin/(gated)/[store]/dream-factory/front-page";
import { getStore } from "@/server/stores";

export const metadata: Metadata = { title: "Dream Factory run" };

/** As on the store's own page: often enough to watch products land one a turn. */
const REFRESH_SECONDS = 6;

/**
 * A test run of the Dream Factory watched from Platform → AI (D419): the same progress, timeline, sketch, feed and cards the owner sees on
 * `/admin/{store}/dream-factory`, read only. A drill's store belongs to the test address, so its own page is not a platform admin's to open;
 * a real owner's run is not shown here (`testDreamRun()` returns test runs only), and nothing links into the store's admin.
 */
export default async function PlatformDreamRunPage({ params }: { params: Promise<{ runId: string }> }) {
  // The page checks for itself: the layout's check redirects in the browser, after the page's own data would already be sent.
  const account = await requirePlatformAdmin();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "platformTools").ai;
  const words = adminText(lang, "home").dream;
  const run = await testDreamRun((await params).runId);
  if (!run) notFound();
  const store = await getStore(run.storeSlug);
  if (!store) notFound();

  const now = new Date();
  const going = run.status === "running" || run.status === "asking" || (run.status === "ready" && !run.finishedAt);
  const score = scoreOf({ ...run, ownerWaitMs: ownerWaitMs(run.steps, now) });
  // An admin who works in the store (the one who asked for the drill, D420) gets its own page and the members' preview from here.
  const [show, member] = await Promise.all([dreamShowcase(store, run), passMembership(store.slug, account.id)]);
  // The real front page in its live look once the website step has published it (D422), as the owner sees it.
  const frontPage = run.steps.website.status === "done" && store.frontPageId ? await getPageForEdit(store.id, store.frontPageId, "page") : null;
  const market = store.markets[0];
  const storeUrl = storeHref(store.slug, market ? marketPath(store.slug, market.slug) : "/");
  const name = run.brief?.storeName || store.name;

  return (
    <AdminTextScope texts={adminTexts(lang, ["home"])}>
      {going && <RefreshWhile seconds={REFRESH_SECONDS} />}
      <div className="flex max-w-6xl flex-col gap-6">
        <p className="text-sm">
          <Link href="/admin/platform/ai" className="underline">
            {w.dreamBack}
          </Link>
        </p>
        <PageHeader
          title={fillWords(w.dreamWatchTitle, { store: name })}
          description={<>{w.dreamWatchText}</>}
          status={<Chip signal="insight">{w.dreamTest}</Chip>}
        />
        {member && (
          <div className="flex flex-wrap gap-2">
            <ButtonLink kind="main" href={`/api/private/preview?store=${encodeURIComponent(store.slug)}`}>
              {w.dreamPreview}
            </ButtonLink>
            <ButtonLink kind="secondary" href={`/admin/${store.slug}/dream-factory`}>
              {w.dreamOpenStore}
            </ButtonLink>
          </div>
        )}
        {/* Where the run stands in the owner's words; the ways on a ready store offers are the owner's, so none are offered here. */}
        {going ? (
          <DreamProgress steps={run.steps} startedAt={run.createdAt} now={now} storeName={name} words={words} />
        ) : (
          <p className="text-body text-ink-2">{words.run[run.status]}</p>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[auto_1fr]">
          <div className="min-w-0 lg:col-start-2 lg:row-start-1">
            {frontPage ? (
              <DreamFrontPage store={store} page={frontPage} address={hostOf(storeUrl) ?? store.slug} caption={words.look.caption} />
            ) : (
              <DreamSketch show={show} storeName={name} address={hostOf(storeUrl) ?? store.slug} words={words} />
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-span-2 lg:row-start-1">
            <div className="rounded-lg border border-line bg-card p-5">
              <DreamTimeline steps={run.steps} now={now} words={words} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <KpiTile label={words.score.minutes} value={score.minutesToReady === null ? "–" : String(score.minutesToReady)} />
              <KpiTile label={words.score.presses} value={String(score.ownerPresses)} />
              <KpiTile label={words.score.firstTry} value={score.firstTryPercent === null ? "–" : `${score.firstTryPercent} %`} />
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-4 self-start lg:col-start-2 lg:row-start-2">
            <DreamFeed show={show} now={now} words={words} />
            <DreamMade show={show} base={null} words={words} />
          </div>
        </div>
      </div>
    </AdminTextScope>
  );
}

/** The store's address as a visitor's browser shows it, for the sketch. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
