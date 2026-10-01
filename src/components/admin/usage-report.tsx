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
import type { DailyUsage } from "@/server/ai-usage";

const number = new Intl.NumberFormat("en-GB");
const n = (value: number) => number.format(value);

/** What a row used besides tokens: characters spoken, audio heard or on a call, pictures made. */
function otherUse(row: Pick<UsageSums, "characters" | "audioSeconds" | "images">): string {
  return [
    row.characters > 0 && `${n(row.characters)} characters spoken`,
    row.audioSeconds > 0 && `${n(Math.round(row.audioSeconds / 60))} min of audio`,
    row.images > 0 && `${n(row.images)} ${row.images === 1 ? "picture" : "pictures"}`,
  ]
    .filter(Boolean)
    .join(", ");
}

const th = "px-2 py-2 text-left font-medium text-muted";
const thRight = "px-2 py-2 text-right font-medium text-muted";
const td = "px-2 py-2 align-top";
const tdRight = "px-2 py-2 text-right tabular-nums align-top";

function Head({ first }: { first: string }) {
  return (
    <thead>
      <tr className="border-b border-border">
        <th scope="col" className={th}>
          {first}
        </th>
        <th scope="col" className={thRight}>
          Requests
        </th>
        <th scope="col" className={thRight}>
          Failed
        </th>
        <th scope="col" className={thRight}>
          Input tokens
        </th>
        <th scope="col" className={thRight}>
          Output tokens
        </th>
        <th scope="col" className={thRight}>
          Cost
        </th>
        <th scope="col" className={th}>
          Also
        </th>
      </tr>
    </thead>
  );
}

function Cells({ sums }: { sums: UsageSums }) {
  return (
    <>
      <td className={tdRight}>{n(sums.requests)}</td>
      <td className={tdRight}>{sums.failed > 0 ? n(sums.failed) : "–"}</td>
      <td className={tdRight}>{sums.inputTokens > 0 ? n(sums.inputTokens) : "–"}</td>
      <td className={tdRight}>{sums.outputTokens > 0 ? n(sums.outputTokens) : "–"}</td>
      <td className={tdRight}>{!usedAnything(sums) ? "–" : sums.costMicros === 0 && sums.unpricedRequests > 0 ? <span className="text-muted">No price</span> : costWords(sums)}</td>
      <td className={td}>{otherUse(sums) || "–"}</td>
    </>
  );
}

/** One line per provider, model and kind of call, with whose key paid where it differs. */
const modelKey = (row: UsageRow) => ({
  key: `${row.provider}\u0000${row.model}\u0000${row.kind}\u0000${row.source}`,
  label: row.model,
  sub: `${row.provider} · ${KIND_WORDS[row.kind]} · ${SOURCE_WORDS[row.source]}`,
});

/** Provider and model lines of a set of rows. */
function ModelTable({ rows, first = "Provider and model" }: { rows: UsageRow[]; first?: string }) {
  const groups = groupUsage(rows, modelKey);
  if (groups.length === 0) return <p className="text-sm text-muted">Nothing used in this period.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] text-sm">
        <Head first={first} />
        <tbody>
          {groups.map((g) => (
            <tr key={g.key} className="border-b border-border last:border-0">
              <th scope="row" className={`${td} text-left font-normal`}>
                <span className="font-medium">{g.label}</span>
                <span className="block text-xs text-muted">{g.sub}</span>
              </th>
              <Cells sums={g.sums} />
            </tr>
          ))}
          {groups.length > 1 && (
            <tr className="border-t border-border font-medium">
              <th scope="row" className={`${td} text-left`}>
                All
              </th>
              <Cells sums={totalOf(rows)} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Groups (owner accounts, stores) that open to their own provider and model lines. */
function GroupList({ groups, empty }: { groups: UsageGroup[]; empty: string }) {
  if (groups.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {groups.map((g) => (
        <li key={g.key}>
          <details className="group">
            <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-4 gap-y-1 p-3 text-sm hover:bg-surface">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{g.label}</span>
                {g.sub && <span className="ml-2 text-muted">{g.sub}</span>}
              </span>
              <span className="tabular-nums">{n(g.sums.requests)} requests</span>
              <span className="tabular-nums text-muted">
                {n(g.sums.inputTokens + g.sums.outputTokens)} tokens · {costWords(g.sums)}
                {g.sums.failed > 0 ? ` · ${n(g.sums.failed)} failed` : ""}
              </span>
            </summary>
            <div className="border-t border-border p-3">
              <ModelTable rows={g.rows} />
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}

/** Tokens per day as bars: each with its day and figures for anyone reading it as text. */
function DailyBars({ days }: { days: DailyUsage[] }) {
  const most = Math.max(1, ...days.map((d) => d.tokens));
  return (
    <figure className="flex flex-col gap-2">
      <div className="flex h-24 items-end gap-px" role="img" aria-label={`Tokens used per day, ${days.length} days, the most ${n(most)}`}>
        {days.map((d) => (
          <div
            key={d.day}
            title={`${d.day}: ${n(d.tokens)} tokens, ${formatUsd(d.costMicros)}, ${n(d.requests)} requests`}
            className="min-w-px flex-1 rounded-t-sm bg-foreground/70"
            style={{ height: `${Math.max(d.tokens > 0 ? 3 : 0, Math.round((d.tokens / most) * 100))}%` }}
          />
        ))}
      </div>
      <figcaption className="flex justify-between text-xs text-muted">
        <span>{days[0]?.day}</span>
        <span>Tokens per day · {formatUsd(days.reduce((sum, d) => sum + d.costMicros, 0))} in all</span>
        <span>{days.at(-1)?.day}</span>
      </figcaption>
    </figure>
  );
}

export function PeriodLinks({ base, period, extra = "" }: { base: string; period: string; extra?: string }) {
  return (
    <nav aria-label="Period" className="flex flex-wrap gap-1">
      {USAGE_PERIODS.map((p) => (
        <Link
          key={p.id}
          href={`${base}?period=${p.id}${extra}`}
          aria-current={p.id === period ? "page" : undefined}
          className={`rounded-md px-3 py-1.5 text-sm ${p.id === period ? "bg-surface font-medium" : "text-muted hover:bg-surface"}`}
        >
          {p.label}
        </Link>
      ))}
    </nav>
  );
}

const card = "rounded-lg border border-border bg-background p-5";

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={card}>
      <h2 id={id} className="font-medium">
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
export function UsageReport({ rows, days, scope }: { rows: UsageRow[]; days: DailyUsage[]; scope: "platform" | "owner" }) {
  const total = totalOf(rows);
  const onKaizen = totalOf(rows.filter((r) => r.source === "platform"));
  const onOwn = totalOf(rows.filter((r) => r.source === "store"));
  const perOwner = groupUsage(rows, withOwner);
  const perStore = groupUsage(rows, withStore);
  const anyEstimated = total.estimatedRequests > 0;
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label="Requests" value={n(total.requests)} note={total.failed > 0 ? `${n(total.failed)} failed` : undefined} />
        <Tile label="Input tokens" value={n(total.inputTokens)} />
        <Tile label="Output tokens" value={n(total.outputTokens)} />
        <Tile
          label="Estimated cost"
          value={costWords(total)}
          note={
            total.unpricedRequests > 0
              ? `${n(total.unpricedRequests)} requests have no price yet`
              : onOwn.costMicros > 0
                ? `${formatUsd(onKaizen.costMicros)} on Kaizen's key, ${formatUsd(onOwn.costMicros)} on stores' own`
                : undefined
          }
        />
        <Tile
          label={scope === "platform" ? "On Kaizen's key" : "On Kaizen's AI"}
          value={n(onKaizen.inputTokens + onKaizen.outputTokens)}
          note={onOwn.requests > 0 ? `${n(onOwn.inputTokens + onOwn.outputTokens)} tokens on stores' own keys` : "tokens"}
        />
      </section>
      {otherUse(total) && <p className="text-sm text-muted">Also: {otherUse(total)}.</p>}

      <Section id="daily" title="Per day">
        <DailyBars days={days} />
      </Section>

      <Section
        id="models"
        title="By provider and model"
        note={scope === "platform" ? "Everything used in the period, whoever's key paid." : "Everything used by the stores you own, whoever's key paid."}
      >
        <ModelTable rows={rows} />
      </Section>

      {scope === "platform" && (
        <Section id="owners" title="By store owner account" note="Each owner account's stores together, with the providers and models they used. Kaizen's own use (its AI manager and chat agent) is listed apart.">
          <GroupList groups={perOwner} empty="Nothing used in this period." />
        </Section>
      )}

      <Section
        id="stores"
        title="By store"
        note={scope === "platform" ? "Each store, with the providers and models used for it." : "Each of your stores, with the providers and models used for it."}
      >
        <GroupList groups={perStore} empty="Nothing used in this period." />
      </Section>

      <Section id="features" title="By what asked">
        <GroupList groups={groupUsage(rows, withFeature)} empty="Nothing used in this period." />
      </Section>

      <p className="text-sm text-muted">
        Counted from each call to a model as it is made. {anyEstimated && `${n(total.estimatedRequests)} requests are counted by Kaizen (about four characters a token) because the provider did not report tokens. `}
        Live voice calls are counted as one request with their length.
        Cost is an estimate in US dollars: each call&apos;s tokens, pictures, minutes of audio and spoken characters at the prices set for its model on the day it was made
        {scope === "platform" ? (
          <>
            {" "}(<Link href="/admin/platform/ai/prices" className="underline">AI prices</Link>)
          </>
        ) : null}
        ; a &quot;+&quot; means some usage has no price, so the real cost is higher.
        Usage is kept for 400 days.
      </p>
    </div>
  );
}
