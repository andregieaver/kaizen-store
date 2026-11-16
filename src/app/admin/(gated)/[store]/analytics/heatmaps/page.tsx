import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AdminTextScope } from "@/components/admin/admin-text";
import { AnalyticsHeader } from "@/components/admin/analytics/analytics-header";
import { ExportScope } from "@/components/admin/analytics/export-scope";
import { HeatmapsHub, MAP_DAYS, MAP_VIEWS, PageMapView, pageName, recordingsOfPage, type MapDays, type MapShotView, type MapView } from "@/components/admin/analytics/heatmaps-view";
import { RefreshWhile } from "@/components/admin/refresh-while";
import { PageHeader } from "@/components/admin/ui/page-header";
import { fillWords } from "@/lib/admin-fill";
import { adminText, adminTexts } from "@/lib/admin-text";
import { queryText } from "@/lib/analytics-export";
import { formatCount } from "@/lib/analytics-core";
import { addDays, todayIn } from "@/lib/analytics-period";
import { HEAT_DEVICES, MIN_MAP_VIEWS, type HeatDevice } from "@/lib/page-heat";
import { analyticsContext } from "@/server/analytics-context";
import { analyticsCaptions } from "@/server/analytics-say";
import { mapShotPicture, requestMapShot } from "@/server/map-shots";
import { memberCan } from "@/server/permissions";
import { heatPages, pageDevices, pageHeat, taggedTests } from "@/server/page-heat-read";
import { variantNameText } from "@/lib/experiment-words";

import { takeNewPictureAction } from "./actions";

export const metadata: Metadata = { title: "Heatmaps" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Heatmaps (D656, `docs/heatmaps-and-recordings.md` step 7). Without `page`, the hub: where visitors get stuck and the most viewed pages,
 * over the period picked. With `page`, its map on one device over 7, 30, 90 or 365 days: the picture is asked for when it is missing or
 * old (`requestMapShot()`) and the page reads itself again every 20 seconds while it is being taken. Thin on purpose.
 */
export default async function HeatmapsPage({ params, searchParams }: PageProps<"/admin/[store]/analytics/heatmaps">) {
  const query = await searchParams;
  const ctx = await analyticsContext((await params).store, query);
  const { store } = ctx;
  const words = adminText(ctx.lang, "heatmaps");
  const page = one(query.page);
  const scope = (children: React.ReactNode) => (
    <AdminTextScope texts={adminTexts(ctx.lang, ["analytics"])}>
      <ExportScope base={ctx.base} query={queryText(query)} owner={ctx.owner} canExport={ctx.canExport} captions={analyticsCaptions(ctx.lang)}>
        <div className="flex flex-col gap-8">{children}</div>
      </ExportScope>
    </AdminTextScope>
  );

  if (!page || !/^\/[a-z0-9-]{2,40}(\/.*)?$/.test(page) || page.length > 300) {
    const { period } = ctx.params;
    const pages = await heatPages(store.id, period);
    const views = pages.reduce((total, p) => total + p.views, 0);
    return scope(
      <>
        <AnalyticsHeader
          ctx={ctx}
          path="/analytics/heatmaps"
          title={words.hub.title}
          description={words.hub.description}
          lead={pages.length > 0 ? fillWords(words.hub.lead, { pages: formatCount(pages.length), views: formatCount(views) }) : undefined}
          showCompare={false}
        />
        <HeatmapsHub base={ctx.base} on={store.heatmaps} owner={ctx.owner} pages={pages} words={words} />
      </>,
    );
  }

  const view: MapView = (MAP_VIEWS as readonly string[]).includes(one(query.view) ?? "") ? (one(query.view) as MapView) : "click";
  const asked = Number(one(query.days));
  let days: MapDays = (MAP_DAYS as readonly number[]).includes(asked) ? (asked as MapDays) : 30;
  if (view === "click" && days > 90) days = 90;
  const today = todayIn(ctx.now, store.timeZone);
  const period = { from: addDays(today, 1 - days), to: addDays(today, 1) };
  // One A/B version's totals and picture (D656 step 12): the chips offer the tests with totals on this page.
  const tests = await taggedTests(store.id, page);
  const askedTag = one(query.tag) ?? "";
  const tag = tests.some((t) => t.versions.some((v) => `${t.id}:${v.key}` === askedTag)) ? askedTag : "";
  const experimentWords = adminText(ctx.lang, "experiments");
  const versions = tests.flatMap((t) => t.versions.map((v) => ({ tag: `${t.id}:${v.key}`, label: `${t.name}: ${variantNameText(v.name, experimentWords)}` })));
  const devices = await pageDevices(store.id, page, period, tag);
  const askedDevice = one(query.device);
  const device: HeatDevice = (HEAT_DEVICES as readonly string[]).includes(askedDevice ?? "")
    ? (askedDevice as HeatDevice)
    : HEAT_DEVICES.reduce((best, d) => (devices[d] > devices[best] ? d : best), "mobile" as HeatDevice);
  const heat = await pageHeat(store.id, { page, device, tag, from: period.from, to: period.to });

  // The picture is asked for only once the page has enough views to draw.
  let shot: MapShotView = { status: "none", picture: null, width: null, height: null, layout: null, problem: null, shotAt: null };
  if (heat.views >= MIN_MAP_VIEWS) {
    const row = await requestMapShot(store.id, page, device, tag);
    shot = { ...row, picture: await mapShotPicture(store.id, row) };
  }
  const mayAsk = memberCan(ctx, "analytics:write");
  const newPicture = mayAsk ? (
    <ActionForm action={takeNewPictureAction.bind(null, store.slug, page, device, tag)} className="flex flex-col gap-2">
      <div>
        <SubmitButton variant="secondary">{words.map.newPicture}</SubmitButton>
      </div>
    </ActionForm>
  ) : null;

  return scope(
    <>
      <PageHeader back={{ href: `${ctx.base}/analytics/heatmaps`, label: words.map.back }} title={pageName(page, words)} description={words.map.views[view]} />
      <PageMapView
        base={ctx.base}
        page={page}
        view={view}
        device={device}
        days={days}
        devices={devices}
        heat={heat}
        shot={shot}
        period={period}
        newPicture={newPicture}
        refresher={<RefreshWhile seconds={20} />}
        words={words}
        locale={ctx.locale}
        watchHref={ctx.owner ? recordingsOfPage(ctx.base, page) : undefined}
        tag={tag}
        versions={versions}
      />
    </>,
  );
}
