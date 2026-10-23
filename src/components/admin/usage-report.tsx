import Link from "next/link";
import type { ReactNode } from "react";

import {
  costWords,
  groupUsage,
  KIND_WORDS,
  SOURCE_WORDS,
  totalOf,
  usedAnything,
  USAGE_PERIODS,
  withFeature,
  withOwner,
  withStore,
  type UsageGroup,
  type UsageRow,
  type UsageSums,
} from "@/lib/ai-usage";
import { formatUsd } from "@/lib/ai-cost";
import { fillWords } from "@/lib/admin-fill";
import { platformToolsEn, type PlatformToolsMessages } from "@/lib/admin-messages/platform-tools.en";
import type { DailyUsage } from "@/server/ai-usage";

/** The report's words with its reader's number format (D312 A11). */
type Words = PlatformToolsMessages["usage"] & { n: (value: number) => string };
type Catalogue = PlatformToolsMessages["usage"];
const EN: Catalogue = platformToolsEn.usage;

/** What a row used besides tokens: characters spoken, audio heard or on a call, pictures made. */
function otherUse(row: Pick<UsageSums, "characters" | "audioSeconds" | "images">, w: Words): string {
  return [
    row.characters > 0 && fillWords(w.charactersSpoken, { count: w.n(row.characters) }),
    row.audioSeconds > 0 && fillWords(w.minutesAudio, { count: w.n(Math.round(row.audioSeconds / 60)) }),
    row.images > 0 && fillWords(row.images === 1 ? w.picture : w.pictures, { count: w.n(row.images) }),
  ]
    .filter(Boolean)
    .join(", ");
}

const th = "px-2 py-2 text-left font-medium text-muted";
const thRight = "px-2 py-2 text-right font-medium text-muted";
const td = "px-2 py-2 align-top";
const tdRight = "px-2 py-2 text-right tabular-nums align-top";

function Head({ first, w }: { first: string; w: Words }) {
  return (
    <thead>
      <tr className="border-b border-line">
        <th scope="col" className={th}>
          {first}
        </th>
        <th scope="col" className={thRight}>
          {w.requests}
        </th>
        <th scope="col" className={thRight}>
          {w.failed}
        </th>
        <th scope="col" className={thRight}>
          {w.inputTokens}
        </th>
        <th scope="col" className={thRight}>
          {w.outputTokens}
        </th>
        <th scope="col" className={thRight}>
          {w.cost}
        </th>
        <th scope="col" className={th}>
          {w.also}
        </th>
      </tr>
    </thead>
  );
}

function Cells({ sums, w }: { sums: UsageSums; w: Words }) {
  return (
    <>
      <td className={tdRight}>{w.n(sums.requests)}</td>
      <td className={tdRight}>{sums.failed > 0 ? w.n(sums.failed) : "–"}</td>
      <td className={tdRight}>{sums.inputTokens > 0 ? w.n(sums.inputTokens) : "–"}</td>
      <td className={tdRight}>{sums.outputTokens > 0 ? w.n(sums.outputTokens) : "–"}</td>
      <td className={tdRight}>{!usedAnything(sums) ? "–" : sums.costMicros === 0 && sums.unpricedRequests > 0 ? <span className="text-muted">{w.noPrice}</span> : costWords(sums)}</td>
      <td className={td}>{otherUse(sums, w) || "–"}</td>
    </>
  );
}

/** One line per provider, model and kind of call, with whose key paid where it differs. */
const modelKey = (w: Words) => (row: UsageRow) => ({
  key: `${row.provider}\u0000${row.model}\u0000${row.kind}\u0000${row.source}`,
  label: row.model,
  sub: `${row.provider} · ${w.kinds[row.kind] ?? KIND_WORDS[row.kind]} · ${w.sources[row.source] ?? SOURCE_WORDS[row.source]}`,
});

/** Provider and model lines of a set of rows. */
function ModelTable({ rows, w, first = w.providerAndModel }: { rows: UsageRow[]; w: Words; first?: string }) {
  const groups = groupUsage(rows, modelKey(w));
  if (groups.length === 0) return <p className="text-sm text-muted">{w.nothing}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] text-sm">
        <Head first={first} w={w} />
        <tbody>
          {groups.map((g) => (
            <tr key={g.key} className="border-b border-line last:border-0">
              <th scope="row" className={`${td} text-left font-normal`}>
                <span className="font-medium">{g.label}</span>
                <span className="block text-xs text-muted">{g.sub}</span>
              </th>
              <Cells sums={g.sums} w={w} />
            </tr>
          ))}
          {groups.length > 1 && (
            <tr className="border-t border-line font-medium">
              <th scope="row" className={`${td} text-left`}>
                {w.all}
              </th>
              <Cells sums={totalOf(rows)} w={w} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Groups (owner accounts, stores) that open to their own provider and model lines. */
function GroupList({ groups, empty, w }: { groups: UsageGroup[]; empty: string; w: Words }) {
  if (groups.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-line rounded-panel border border-line">
      {groups.map((g) => (
        <li key={g.key}>
          <details className="group">
            <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-4 gap-y-1 p-3 text-sm hover:bg-sunken">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{g.label}</span>
                {g.sub && <span className="ml-2 text-muted">{g.sub}</span>}
              </span>
              <span className="tabular-nums">{fillWords(w.requestsCount, { count: w.n(g.sums.requests) })}</span>
              <span className="tabular-nums text-muted">
                {fillWords(w.tokensCount, { count: w.n(g.sums.inputTokens + g.sums.outputTokens) })} · {costWords(g.sums)}
                {g.sums.failed > 0 ? ` · ${fillWords(w.failedCount, { count: w.n(g.sums.failed) })}` : ""}
              </span>
            </summary>
            <div className="border-t border-line p-3">
              <ModelTable rows={g.rows} w={w} />
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-panel border border-line p-4">
      <p className="text-eyebrow text-muted uppercase">{label}</p>
      <p className="mt-1 text-metric text-ink tabular-nums">{value}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}

/** Tokens per day as bars: each with its day and figures for anyone reading it as text. */
function DailyBars({ days, w }: { days: DailyUsage[]; w: Words }) {
  const most = Math.max(1, ...days.map((d) => d.tokens));
  return (
    <figure className="flex flex-col gap-2">
      <div className="flex h-24 items-end gap-px" role="img" aria-label={fillWords(w.perDayLabel, { days: days.length, most: w.n(most) })}>
        {days.map((d) => (
          <div
            key={d.day}
            title={fillWords(w.dayTitle, { day: d.day, tokens: w.n(d.tokens), cost: formatUsd(d.costMicros), requests: w.n(d.requests) })}
            className="min-w-px flex-1 rounded-t-sm bg-inverse/70"
            style={{ height: `${Math.max(d.tokens > 0 ? 3 : 0, Math.round((d.tokens / most) * 100))}%` }}
          />
        ))}
      </div>
      <figcaption className="flex justify-between text-xs text-muted">
        <span>{days[0]?.day}</span>
        <span>{fillWords(w.perDayCaption, { cost: formatUsd(days.reduce((sum, d) => sum + d.costMicros, 0)) })}</span>
        <span>{days.at(-1)?.day}</span>
      </figcaption>
    </figure>
  );
}

export function PeriodLinks({ base, period, extra = "", words = EN }: { base: string; period: string; extra?: string; words?: Catalogue }) {
  return (
    <nav aria-label={words.period} className="flex flex-wrap gap-1">
      {USAGE_PERIODS.map((p) => (
        <Link
          key={p.id}
          href={`${base}?period=${p.id}${extra}`}
          aria-current={p.id === period ? "page" : undefined}
          className={`rounded-pill px-3 py-1.5 text-sm ${p.id === period ? "bg-sunken font-medium" : "text-muted hover:bg-sunken"}`}
        >
          {words.periods[p.id] ?? p.label}
        </Link>
      ))}
    </nav>
  );
}

const card = "rounded-lg border border-line bg-card p-5";

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={card}>
      <h2 id={id} className="text-title text-ink">
        {title}
      </h2>
      {note && <p className="mb-3 mt-1 text-sm text-muted">{note}</p>}
      <div className={note ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

/**
 * A report of AI usage (D106): the platform's (every store, owner account
 * and Kaizen's own) or one owner's (the stores they own): totals, tokens per
 * day, per provider and model, per feature, and per owner account and store,
 * each opening to its own providers and models. Sums are worked out from the
 * recorded calls in `src/lib/ai-usage.ts`, never by the browser.
 */
export function UsageReport({ rows, days, scope, words = EN, locale = "en-GB" }: { rows: UsageRow[]; days: DailyUsage[]; scope: "platform" | "owner"; words?: Catalogue; locale?: string }) {
  const number = new Intl.NumberFormat(locale);
  const w: Words = { ...words, n: (value) => number.format(value) };
  const total = totalOf(rows);
  const onKaizen = totalOf(rows.filter((r) => r.source === "platform"));
  const onOwn = totalOf(rows.filter((r) => r.source === "store"));
  const perOwner = groupUsage(rows, withOwner);
  const perStore = groupUsage(rows, withStore);
  const anyEstimated = total.estimatedRequests > 0;
  return (
    <div className="flex flex-col gap-6">
      <section aria-label={w.totals} className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label={w.requests} value={w.n(total.requests)} note={total.failed > 0 ? fillWords(w.failedCount, { count: w.n(total.failed) }) : undefined} />
        <Tile label={w.inputTokens} value={w.n(total.inputTokens)} />
        <Tile label={w.outputTokens} value={w.n(total.outputTokens)} />
        <Tile
          label={w.estimatedCost}
          value={costWords(total)}
          note={
            total.unpricedRequests > 0
              ? fillWords(w.noPriceYet, { count: w.n(total.unpricedRequests) })
              : onOwn.costMicros > 0
                ? fillWords(w.keysSplit, { kaizen: formatUsd(onKaizen.costMicros), own: formatUsd(onOwn.costMicros) })
                : undefined
          }
        />
        <Tile
          label={scope === "platform" ? w.onKaizenKey : w.onKaizenAi}
          value={w.n(onKaizen.inputTokens + onKaizen.outputTokens)}
          note={onOwn.requests > 0 ? fillWords(w.tokensOnOwn, { count: w.n(onOwn.inputTokens + onOwn.outputTokens) }) : w.tokens}
        />
      </section>
      {otherUse(total, w) && <p className="text-sm text-muted">{fillWords(w.alsoLine, { what: otherUse(total, w) })}</p>}

      <Section id="daily" title={w.perDay}>
        <DailyBars days={days} w={w} />
      </Section>

      <Section
        id="models"
        title={w.byModel}
        note={scope === "platform" ? w.byModelPlatform : w.byModelOwner}
      >
        <ModelTable rows={rows} w={w} />
      </Section>

      {scope === "platform" && (
        <Section id="owners" title={w.byOwner} note={w.byOwnerNote}>
          <GroupList groups={perOwner} empty={w.nothing} w={w} />
        </Section>
      )}

      <Section
        id="stores"
        title={w.byStore}
        note={scope === "platform" ? w.byStorePlatform : w.byStoreOwner}
      >
        <GroupList groups={perStore} empty={w.nothing} w={w} />
      </Section>

      <Section id="features" title={w.byFeature}>
        <GroupList groups={groupUsage(rows, withFeature)} empty={w.nothing} w={w} />
      </Section>

      <p className="text-sm text-muted">
        {w.countedFrom} {anyEstimated && `${fillWords(w.estimatedNote, { count: w.n(total.estimatedRequests) })} `}
        {w.liveCalls} {w.costNote}
        {scope === "platform" ? (
          <>
            {" "}(<Link href="/admin/platform/ai/prices" className="underline">{w.aiPrices}</Link>)
          </>
        ) : null}
        {w.plusNote} {w.kept}
      </p>
    </div>
  );
}
