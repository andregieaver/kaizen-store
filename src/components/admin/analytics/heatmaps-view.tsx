import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { adminDate, adminDay } from "@/lib/admin-date";
import { fillWords } from "@/lib/admin-fill";
import type { HeatmapsMessages } from "@/lib/admin-messages/heatmaps.en";
import { formatCount, formatNumber, formatPercent } from "@/lib/analytics-core";
import { addDays } from "@/lib/analytics-period";
import { foldPercent, frustrationRank, projectCells, reachedShares, reachLines, attentionSeconds, type MapLayout } from "@/lib/heat-read";
import { partLabel, partTotals } from "@/lib/heat-tools";
import { BANDS, MIN_MAP_VIEWS, type HeatDevice } from "@/lib/page-heat";
import type { HeatPageRow, PageHeat } from "@/server/page-heat-read";

import { DataTable, type Column } from "./data-table";
import { PageMap, type MapPoint } from "./page-map";
import { AnalyticsSection, Note } from "./section";

/**
 * Heatmaps' screens (D656, `docs/heatmaps-and-recordings.md` step 7), drawn on the server from plain props: the hub (where visitors get
 * stuck, the most viewed pages) and a page's map (the picture with clicks, scroll depth or attention over it, and the tables of the same
 * figures). Homer sees one list and one green button; Lisa's fold holds a new picture, what is not on it and the dates.
 */

export const MAP_VIEWS = ["click", "scroll", "look"] as const;
export type MapView = (typeof MAP_VIEWS)[number];
export const MAP_DAYS = [7, 30, 90, 365] as const;
export type MapDays = (typeof MAP_DAYS)[number];
const card = "flex flex-col gap-4 rounded-lg border border-line bg-card p-5";
const primary = "inline-flex min-h-10 items-center rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink";
const chip = (active: boolean) => `inline-flex h-9 items-center rounded-panel border px-3 text-sm ${active ? "border-brand bg-sunken font-medium" : "border-line"}`;

/** A page key as the owner reads it: the path under the market, or the front page. */
export function pageName(page: string, words: HeatmapsMessages): string {
  const rest = page.replace(/^\/[a-z0-9-]+/, "");
  return rest === "" ? words.hub.frontPage : rest;
}

/** Recordings of a page with rage clicks, for the owner (D656 step 11). */
export const recordingsOfPage = (base: string, page: string) => `${base}/analytics/recordings?${new URLSearchParams({ page, has: "rage" }).toString()}`;

export const mapHref = (base: string, page: string, params: Record<string, string> = {}) =>
  `${base}/analytics/heatmaps?${new URLSearchParams({ page, ...params }).toString()}`;

// ---------------------------------------------------------------------------
// The hub
// ---------------------------------------------------------------------------

export type HeatmapsHubProps = {
  base: string;
  on: boolean;
  owner: boolean;
  pages: HeatPageRow[];
  words: HeatmapsMessages;
};

export function HeatmapsHub({ base, on, owner, pages, words }: HeatmapsHubProps) {
  const w = words.hub;
  if (!on && pages.length === 0) {
    return (
      <div className={card}>
        <p className="text-sm">{w.off}</p>
        {owner ? (
          <p>
            <Link href={`${base}/analytics/settings#signals`} className={primary}>
              {w.turnOn}
            </Link>
          </p>
        ) : null}
      </div>
    );
  }
  const stuck = frustrationRank(pages, MIN_MAP_VIEWS).filter((p) => p.frustratedViews > 0).slice(0, 5);
  const measured = pages.filter((p) => p.views >= MIN_MAP_VIEWS);
  const name = (page: string) => pageName(page, words);
  const columns: Column<HeatPageRow & { frustration?: number }>[] = [
    { key: "page", label: w.colPage, cell: (r) => <span className="break-all">{name(r.page)}</span> },
    { key: "views", label: w.colViews, align: "right", cell: (r) => formatCount(r.views) },
    { key: "stuck", label: w.colStuck, align: "right", cell: (r) => formatPercent(r.views > 0 ? r.frustratedViews / r.views : 0) },
    { key: "reach", label: w.colReach, align: "right", cell: (r) => formatPercent(r.reachedHalf) },
  ];
  return (
    <div className="flex flex-col gap-8">
      {!on ? <Note title={w.off}>{owner ? <Link href={`${base}/analytics/settings#signals`} className="underline">{w.turnOn}</Link> : null}</Note> : null}
      {measured.length === 0 ? <p className="text-sm text-muted">{fillWords(w.collecting, { n: MIN_MAP_VIEWS })}</p> : null}

      <AnalyticsSection id="stuck" title={w.stuckTitle} description={<span className="max-sm:hidden">{w.stuckDescription}</span>}>
        <div className={card}>
          {stuck.length === 0 ? (
            <p className="text-sm text-muted">{w.noneStuck}</p>
          ) : (
            <ol className="flex flex-col divide-y divide-line">
              {stuck.map((p, i) => (
                <li key={p.page} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 max-sm:flex-nowrap max-sm:gap-2">
                  <div className="min-w-0">
                    <p className="break-all font-medium">{name(p.page)}</p>
                    <p className="text-sm text-muted">
                      {formatCount(p.views)} <span className="max-sm:hidden">{w.colViews.toLowerCase()}</span>
                      <span className="sm:hidden">{w.phone.views}</span> · {formatPercent(p.frustration)} {w.colStuck.toLowerCase()}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 max-sm:shrink-0 max-sm:flex-nowrap max-sm:gap-2">
                    {owner ? (
                      <Link href={recordingsOfPage(base, p.page)} className="text-sm underline">
                        <span className="sm:hidden">{w.phone.recordings}</span>
                        <span className="max-sm:hidden">{w.watch}</span>
                      </Link>
                    ) : null}
                    <Link href={mapHref(base, p.page)} className={`${i === 0 ? primary : "inline-flex min-h-10 items-center rounded-pill border border-edge bg-card px-4 text-sm"} max-sm:px-3`}>
                      <span className="sm:hidden">{w.map}</span>
                      <span className="max-sm:hidden">{i === 0 ? w.seeMap : w.map}</span>
                    </Link>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </AnalyticsSection>

      <AnalyticsSection id="pages" title={w.mostTitle} description={<span className="max-sm:hidden">{w.mostDescription}</span>}>
        {/* Round 54 (D802): on a phone each page is a line with its figures and Map, in place of the table. */}
        <ul className="flex flex-col overflow-hidden rounded-panel bg-card sm:hidden" aria-label={w.mostTitle}>
          {pages.map((r) => (
            <li key={r.page} className="flex min-h-14 items-center gap-3 border-b border-line px-4 py-2 last:border-0">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body break-all text-ink">{name(r.page)}</span>
                <span className="text-caption text-ink-2">
                  {formatCount(r.views)} {w.phone.views} · {formatPercent(r.views > 0 ? r.frustratedViews / r.views : 0)} {w.phone.stuck} · {formatPercent(r.reachedHalf)} {w.phone.reached}
                </span>
              </span>
              {r.views >= MIN_MAP_VIEWS ? (
                <Link href={mapHref(base, r.page)} className="shrink-0 text-sm underline">
                  {w.map}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="max-sm:hidden">
        <DataTable
          caption={w.mostTitle}
          columns={[...columns, { key: "map", label: w.map, cell: (r) => (r.views >= MIN_MAP_VIEWS ? <Link href={mapHref(base, r.page)} className="underline">{w.map}</Link> : "—") }]}
          rows={pages}
          rowKey={(r) => r.page}
          exportable={false}
          exportReason="heatmaps.pages"
        />
        </div>
      </AnalyticsSection>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A page's map
// ---------------------------------------------------------------------------

export type MapShotView = { status: "waiting" | "taking" | "done" | "failed" | "none"; picture: string | null; width: number | null; height: number | null; layout: MapLayout | null; problem: string | null; shotAt: string | null };

export type PageMapViewProps = {
  base: string;
  page: string;
  view: MapView;
  device: HeatDevice;
  days: MapDays;
  devices: Record<HeatDevice, number>;
  heat: PageHeat;
  shot: MapShotView;
  period: { from: string; to: string };
  /** The bound action for a new picture, for a member who may ask for one. */
  newPicture: ReactNode;
  /** Shown while a picture is being taken (`RefreshWhile`). */
  refresher: ReactNode;
  words: HeatmapsMessages;
  locale: string;
  /** The store's time zone: when the picture was taken, on the store's clock (D812). */
  timeZone: string;
  /** The owner's link to this page's recordings with rage clicks (D656 step 11); left out for anyone else. */
  watchHref?: string;
  /** The A/B version shown (`{experiment}:{version}`), `""` for every visitor (D656 step 12). */
  tag?: string;
  /** The versions with totals for this page, as chips beside "Every visitor"; none without a test. */
  versions?: { tag: string; label: string }[];
  /**
   * Per part of the table, by anchor (ecosystem plan E2.3, D713): the builder opened on it, and "A/B test this" for it (`partLinks()`);
   * a part the page's builder does not have (a landmark, the header's) has none.
   */
  partActions?: Record<string, { edit?: string; test?: string }>;
};

export function PageMapView(props: PageMapViewProps) {
  const { base, page, view, device, days, devices, heat, shot, period, words, locale, timeZone } = props;
  const w = words.map;
  const tag = props.tag ?? "";
  const here = (params: Partial<{ view: string; device: string; days: string; tag: string }>) => {
    const next: Record<string, string> = { view, device, days: String(days), tag, ...params };
    if (!next.tag) delete next.tag;
    return mapHref(base, page, next);
  };
  const dayChoices = view === "click" ? MAP_DAYS.filter((d) => d <= 90) : MAP_DAYS;
  const shares = reachedShares(heat.reach);
  const lines = reachLines(shares);
  const fold = foldPercent(heat.foldSum, heat.views);
  const seconds = attentionSeconds(heat.attention, heat.views) ?? new Array<number>(BANDS).fill(0);
  const enough = heat.views >= MIN_MAP_VIEWS;
  const layout = shot.layout;
  const pictureHeight = shot.height ?? 0;
  const attHeight = heat.views > 0 ? Math.min(heat.attHeightSum / heat.views, pictureHeight || Infinity) : 0;

  const points = (pick: (c: PageHeat["cells"][number]) => number): MapPoint[] =>
    layout ? projectCells(heat.cells.map((c) => ({ ...c, clicks: pick(c) })).filter((c) => c.clicks > 0), layout).points : [];
  const missing = layout ? projectCells(heat.cells, layout).missing : 0;

  // The tables behind the map.
  const parts = partTotals(heat.cells, 15);
  const depthRows = [25, 50, 75, 100].map((p) => ({ p, share: shares[p / 5] ?? 0 }));
  const lookRows = seconds
    .map((s, i) => ({ i, s }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 5);

  const chips = (
    <div className="flex flex-col gap-3">
      <nav aria-label={w.viewLabel} className="flex flex-wrap gap-2">
        {MAP_VIEWS.map((v) => (
          <Link key={v} href={here({ view: v, days: v === "click" && days > 90 ? "90" : String(days) })} aria-current={v === view ? "true" : undefined} className={chip(v === view)}>
            {w.views[v]}
          </Link>
        ))}
      </nav>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <nav aria-label={w.deviceLabel} className="flex flex-wrap gap-2">
          {(["mobile", "tablet", "desktop"] as const).map((d) => (
            <Link key={d} href={here({ device: d })} aria-current={d === device ? "true" : undefined} className={chip(d === device)}>
              {w.devices[d]} <span className="ml-1.5 tabular-nums text-muted">{formatCount(devices[d])}</span>
            </Link>
          ))}
        </nav>
        <nav aria-label={w.periodLabel} className="flex flex-wrap gap-2">
          {dayChoices.map((d) => (
            <Link key={d} href={here({ days: String(d) })} aria-current={d === days ? "true" : undefined} className={chip(d === days)}>
              {fillWords(w.days, { n: d })}
            </Link>
          ))}
        </nav>
      </div>
      {props.versions && props.versions.length > 0 ? (
        <nav aria-label={w.versionLabel} className="flex flex-wrap gap-2">
          {[{ tag: "", label: w.everyone }, ...props.versions].map((v) => (
            <Link key={v.tag || "all"} href={here({ tag: v.tag })} aria-current={v.tag === tag ? "true" : undefined} className={chip(v.tag === tag)}>
              {v.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );

  let picture: ReactNode;
  if (!enough) picture = <p className="text-sm text-muted">{fillWords(w.tooFew, { views: formatCount(heat.views), n: MIN_MAP_VIEWS })}</p>;
  else if (shot.status === "waiting" || shot.status === "taking") picture = <p className="text-sm">{w.taking}{props.refresher}</p>;
  else if (shot.status === "failed") picture = <p className="text-sm">{fillWords(w.failed, { problem: shot.problem ?? "" })}</p>;
  else if (shot.status === "done" && shot.picture && shot.width && shot.height && layout)
    picture = (
      <PageMap
        picture={shot.picture}
        alt={w.pictureAlt}
        width={shot.width}
        height={shot.height}
        pageHeight={layout.h}
        view={view}
        clicks={view === "click" ? { all: points((c) => c.clicks), dead: points((c) => c.dead), rage: points((c) => c.rage) } : undefined}
        clickLabels={w.clickKinds}
        reach={view === "scroll" ? { shares: shares.slice(0, 20), lines, foldPercent: fold, lineLabel: w.lineLabel, foldLabel: w.fold } : undefined}
        look={view === "look" ? { seconds, labels: seconds.map((s) => fillWords(w.seconds, { s: formatNumber(s, 1) })), height: attHeight } : undefined}
      />
    );
  else picture = <p className="text-sm text-muted">{w.noPicture}</p>;


  return (
    <div className="flex flex-col gap-6">
      {chips}
      {props.watchHref ? (
        <Link href={props.watchHref} className="w-fit text-sm underline">
          {words.hub.watch}
        </Link>
      ) : null}
      {enough ? (
        <p className="text-sm">
          {fillWords(w.summary, {
            views: formatCount(heat.views),
            stuck: formatPercent(heat.views > 0 ? heat.frustratedViews / heat.views : 0),
            p50: lines.p50 * 5,
          })}
        </p>
      ) : null}
      {/* A phone's or tablet's picture sits beside its tables; a computer's is too wide for that, so its tables follow it. */}
      <div
        className={`grid items-start gap-6 ${shot.width && shot.width <= 900 ? "lg:grid-cols-[minmax(0,var(--map-w))_minmax(0,1fr)]" : ""}`}
        style={{ "--map-w": `${shot.width ?? 390}px` } as CSSProperties}
      >
        <div>{picture}</div>
        <div className="flex flex-col gap-6">
          {view === "click" ? (
            <DataTable
              caption={w.partsTitle}
              showCaption
              columns={[
                { key: "part", label: w.colPart, cell: (r) => partLabel(r.anchor, layout, words) },
                { key: "clicks", label: w.colClicks, align: "right", cell: (r) => formatCount(r.clicks) },
                { key: "dead", label: w.colDead, align: "right", cell: (r) => formatCount(r.dead) },
                { key: "rage", label: w.colRage, align: "right", cell: (r) => formatCount(r.rage) },
                ...(props.partActions && Object.keys(props.partActions).length > 0
                  ? [
                      {
                        key: "change",
                        label: w.colChange,
                        cell: (r: (typeof parts)[number]) => {
                          const links = props.partActions?.[r.anchor];
                          if (!links) return null;
                          return (
                            <span className="flex flex-wrap gap-x-3 gap-y-1">
                              {links.edit ? (
                                <Link href={links.edit} className="underline underline-offset-2">
                                  {w.editPart}
                                </Link>
                              ) : null}
                              {links.test ? (
                                <Link href={links.test} className="underline underline-offset-2">
                                  {w.testPart}
                                </Link>
                              ) : null}
                            </span>
                          );
                        },
                      },
                    ]
                  : []),
              ]}
              rows={parts}
              rowKey={(r) => r.anchor}
              exportable={false}
              exportReason="heatmaps.parts"
            />
          ) : null}
          {view === "scroll" ? (
            <DataTable
              caption={w.reachTitle}
              showCaption
              columns={[
                { key: "depth", label: w.colDepth, cell: (r) => fillWords(w.reachedRow, { p: r.p }) },
                { key: "reached", label: w.colReached, align: "right", cell: (r) => formatPercent(r.share) },
              ]}
              rows={depthRows}
              rowKey={(r) => String(r.p)}
              exportable={false}
              exportReason="heatmaps.scroll"
              footer={fold !== null ? <tr><td className="px-3 py-2 text-sm">{w.fold}</td><td className="px-3 py-2 text-right text-sm tabular-nums">{formatPercent(fold / 100)}</td></tr> : undefined}
            />
          ) : null}
          {view === "look" ? (
            <DataTable
              caption={w.lookTitle}
              showCaption
              columns={[
                { key: "band", label: w.colBand, cell: (r) => fillWords(w.band, { from: r.i * 5, to: r.i * 5 + 5 }) },
                { key: "time", label: w.colTime, align: "right", cell: (r) => fillWords(w.seconds, { s: formatNumber(r.s, 1) }) },
              ]}
              rows={lookRows}
              rowKey={(r) => String(r.i)}
              exportable={false}
              exportReason="heatmaps.look"
            />
          ) : null}
          <details className="rounded-lg border border-line bg-card p-4 text-sm">
            <summary className="cursor-pointer font-medium">{w.more}</summary>
            <div className="mt-3 flex flex-col gap-2 text-muted">
              {props.newPicture}
              {missing > 0 ? <p>{fillWords(w.notOnPicture, { n: formatCount(missing) })}</p> : null}
              {shot.shotAt ? <p>{fillWords(w.pictureFrom, { date: adminDate(timeZone, shot.shotAt, "day", locale) })}</p> : null}
              <p>{fillWords(w.figuresFrom, { from: adminDay(period.from, "day", locale), to: adminDay(addDays(period.to, -1), "day", locale) })}</p>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

export { partLabel };
