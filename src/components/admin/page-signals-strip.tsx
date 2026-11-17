import Link from "next/link";
import type { ReactNode } from "react";

// Never `heatmaps-view.tsx` for its addresses: a route loads every client component its modules import (PSI PERF-01), and the editor's must
// not carry the heatmap's.
import { AskAboutAlert } from "@/components/admin/analytics/ask-about-alert";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { NO_FIGURE } from "@/lib/analytics-core";
import { setAnalyticsLang } from "@/lib/analytics-lang";
import { MIN_MAP_VIEWS } from "@/lib/page-heat";
import { askText, deviceRows, speedVerdict, stripText, type SignalFacts } from "@/lib/page-signals";
import { speedValueText } from "@/lib/speed";
import { log } from "@/server/log";
import { pageSignals, type SignalTarget } from "@/server/page-signals";
import type { Store } from "@/server/stores";

/**
 * *How it performs* in the page and product editors (ecosystem plan E2.3, D713): what the store already measures of this page or product
 * over the last 30 days, where it is edited, instead of five analytics screens and the A/B tests. Homer reads one quiet line of plain words
 * and the links to each screen with more (its heatmap, its recordings, speed, the product's analytics, the running test, the AI manager);
 * Lisa opens the figures per device and per screen. When nothing is measured, the line says what to switch on, and the owner gets the link.
 *
 * Drawn on the server inside the editor's own Suspense boundary, so the editor paints first and never waits for it; nothing is cached. A
 * failed read draws nothing: the editor matters more. The caller shows it only to members with `analytics:read`.
 */
export async function PageSignalsStrip({
  store,
  target,
  what,
  name,
  lang,
  owner,
  tests,
  className = "",
}: {
  store: Store;
  target: SignalTarget;
  what: "page" | "product";
  /** The page's title or the product's name, for the AI manager's question. */
  name: string;
  lang: AdminLang;
  /** The store's owner: the recordings and the settings that switch measuring on are theirs alone. */
  owner: boolean;
  /** The member may open the A/B tests (`marketing:read`). */
  tests: boolean;
  className?: string;
}) {
  let facts: SignalFacts;
  try {
    facts = await pageSignals(store, target, { owner });
  } catch (error) {
    log("warn", "page_signals.read_failed", { storeId: store.id, what }, error);
    return null;
  }
  // The figures' own convention (a decimal comma in Norwegian), as the analytics pages write them.
  setAnalyticsLang(lang);
  const w = adminText(lang, "heatmaps");
  const words = w.strip;
  const speedWords = adminText(lang, "analytics").speed;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const base = `/admin/${store.slug}`;
  const text = stripText(facts, words);
  const link = "underline underline-offset-2";

  const links: ReactNode[] = [];
  if (facts.heat?.topKey) {
    links.push(
      <Link key="map" prefetch={false} href={`${base}/analytics/heatmaps?${new URLSearchParams({ page: facts.heat.topKey }).toString()}`} className={link}>
        {words.heatmap}
      </Link>,
    );
  }
  if (facts.recordings && facts.recordings.count > 0) {
    links.push(
      <Link key="recordings" prefetch={false} href={`${base}/analytics/recordings?${new URLSearchParams({ page: facts.recordings.page }).toString()}`} className={link}>
        {fillWords(facts.recordings.count === 1 ? words.recordings.one : words.recordings.many, { n: facts.recordings.count })}
      </Link>,
    );
  }
  if (facts.speed) {
    links.push(
      <Link key="speed" prefetch={false} href={`${base}/analytics/speed`} className={link}>
        {words.speedLink}
      </Link>,
    );
  }
  if (what === "product") {
    links.push(
      <Link key="products" prefetch={false} href={`${base}/analytics/products`} className={link}>
        {words.productLink}
      </Link>,
    );
  }
  if (facts.test && tests) {
    links.push(
      <Link key="test" prefetch={false} href={`${base}/experiments/${facts.test.id}`} className={link}>
        {words.testLink}
      </Link>,
    );
  }
  if (owner && text.switchOn) {
    links.push(
      <Link key="on" prefetch={false} href={`${base}/analytics/settings#${text.switchOn === "heatmaps" ? "signals" : "visits"}`} className={link}>
        {words.turnOn[text.switchOn]}
      </Link>,
    );
  }
  links.push(<AskAboutAlert key="ask" message={askText(what, name, facts, words)} label={words.ask} srLabel={fillWords(words.askAbout, { name })} />);

  const devices = deviceRows(facts);
  const fewViews = facts.heat !== null && facts.heat.total.views > 0 && facts.heat.total.views < MIN_MAP_VIEWS;
  const lisa = devices.length > 0 || facts.speed !== null;

  return (
    <section aria-label={words.label} data-page-signals className={`flex flex-col gap-2 rounded-panel border border-line bg-card p-4 text-sm ${className}`}>
      <h2 className="text-xs text-muted">{words.label}</h2>
      <p>
        {text.line ?? words.nothing}
        {!text.line && !owner ? <span className="text-muted"> {words.askOwner}</span> : null}
      </p>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1">{links}</p>
      {lisa ? (
        <details>
          <summary className="cursor-pointer text-muted">{words.more}</summary>
          <div className="mt-3 flex flex-col gap-3">
            {devices.length > 0 ? (
              <table className="w-full text-xs tabular-nums">
                <caption className="sr-only">{words.devicesTitle}</caption>
                <thead>
                  <tr className="text-muted">
                    <th scope="col" className="py-1 pr-2 text-left font-normal">
                      {words.colDevice}
                    </th>
                    <th scope="col" className="py-1 pr-2 text-right font-normal">
                      {words.colViews}
                    </th>
                    <th scope="col" className="py-1 pr-2 text-right font-normal">
                      {words.colStuck}
                    </th>
                    <th scope="col" className="py-1 text-right font-normal">
                      {words.colHalf}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((row) => (
                    <tr key={row.device} className="border-t border-line">
                      <th scope="row" className="py-1 pr-2 text-left font-normal">
                        {w.map.devices[row.device]}
                      </th>
                      <td className="py-1 pr-2 text-right">{row.views}</td>
                      <td className="py-1 pr-2 text-right">{row.stuck ?? NO_FIGURE}</td>
                      <td className="py-1 text-right">{row.half ?? NO_FIGURE}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {fewViews ? <p className="text-xs text-muted">{fillWords(words.fewViews, { n: MIN_MAP_VIEWS })}</p> : null}
            {facts.speed ? (
              <div className="flex flex-col gap-1 text-xs">
                <p className="text-muted">{fillWords(words.speedTitle, { kind: speedWords.kinds[facts.speed.kind] })}</p>
                <ul className="flex flex-col gap-1">
                  {facts.speed.rows.map((row) => {
                    const verdict = speedVerdict([row]);
                    const screen = speedWords.screens[row.screen];
                    if (!verdict) return <li key={row.screen}>{fillWords(words.tooFewLoads, { screen })}</li>;
                    const figures = row.cells.flatMap((cell) => (cell.value === null ? [] : [`${speedWords.metrics[cell.metric].short} ${speedValueText(cell.metric, cell.value, locale)}`]));
                    return (
                      <li key={row.screen}>
                        {fillWords(words.screen, { screen, rating: speedWords.ratings[verdict] })}
                        <span className="text-muted"> · {figures.join(" · ")}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </section>
  );
}
