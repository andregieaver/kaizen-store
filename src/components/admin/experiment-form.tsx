"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { DEVICES, GOAL_WORDS, MAX_RUN_DAYS, MIN_DAYS, type Device, type Goal } from "@/lib/experiments";
import { isTestedPlace, type TargetKind } from "@/lib/ab-site";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { experimentProblems } from "@/lib/experiment-words";
import { CHANGES, eligiblePerDay, findableChange, goalEstimate, isCountedGoal, recommendedGoal, weeksOf, type TrafficFacts } from "@/lib/experiment-traffic";
import type { PartInfo } from "@/lib/experiment-parts";
import { Button, Card, Chip, CARD_CLASS } from "@/components/admin/ui";

import { useAdminLang, useAdminText } from "./admin-text";
import { RuntimeEstimate } from "./runtime-estimate";

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "text-xs font-normal text-muted";

export type TestablePage = { id: string; slug: string; title: string; kind: TargetKind; role?: string | null; partOnly?: boolean; buttons: { id: string; label: string }[]; forms?: { id: string; label: string }[] };
/** The last test that was run on a target, for the chip beside it. */
export type TargetHistory = { status: "running" | "scheduled" | "stopped" | "applied" | "discarded"; winner: string | null };
type Outcome = { ok: true; id: string } | { ok: false; problems: string[] };

const SHARES = [
  { value: 1, key: "all" },
  { value: 0.5, key: "half" },
  { value: 0.25, key: "quarter" },
] as const;

/** The goals shown first, and the ones behind "More goals". */
const FIRST_GOALS: readonly Goal[] = ["orders", "cart", "click"];
const MORE_GOALS: readonly Goal[] = ["revenue", "checkout", "form"];
const DAY = 86_400_000;

const emptyTraffic: TrafficFacts = { counting: false, days: 0, consentShare: null, baselines: { orders: null, cart: null, checkout: null }, targets: {} };

/**
 * Making an A/B test on one screen (D148, redrawn in D656): what the owner wants more of, each goal saying how soon it answers at the shop's
 * own traffic (`experimentTraffic()` counted on the server, worked out here with the results' arithmetic) and one recommended; where, with each
 * page's visitors a day and its last test; and how long, as a bar to a date. The name, the idea, who takes part, the change to look for and the
 * owner's own figures are under Customise, already filled in. The first version is a copy of the page made on saving, to change next.
 */
export function ExperimentForm({
  pages: given,
  markets,
  create,
  base,
  part = null,
  traffic = emptyTraffic,
  history = {},
}: {
  /** A part of the page chosen in the builder (D148): the test is of it, on the one page offered. */
  part?: PartInfo | null;
  pages: TestablePage[];
  markets: { code: string; name: string }[];
  create: (input: unknown) => Promise<Outcome>;
  base: string;
  traffic?: TrafficFacts;
  history?: Record<string, TargetHistory>;
}) {
  const w = useAdminText("experiments");
  const f = w.form;
  const s = w.start;
  const numberLocale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problems, setProblems] = useState<string[]>([]);
  // The busiest page first, chosen for him: it answers soonest (pages with no figure keep their order after those with one).
  const pages = useMemo(
    () => [...given].sort((a, b) => (eligiblePerDay(traffic, b.id) ?? -1) - (eligiblePerDay(traffic, a.id) ?? -1)),
    [given, traffic],
  );
  const [pageId, setPageId] = useState(pages[0]?.id ?? "");
  const [goal, setGoal] = useState<Goal>(() => (pages[0] ? recommendedGoal(traffic, pages[0].id) : "orders"));
  const [goalChosen, setGoalChosen] = useState(false);
  const [moreGoals, setMoreGoals] = useState(false);
  const page = pages.find((p) => p.id === pageId);
  const [button, setButton] = useState("");
  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [share, setShare] = useState(1);
  const [change, setChange] = useState(0.2);
  const [devices, setDevices] = useState<Device[]>([...DEVICES]);
  const [chosenMarkets, setChosenMarkets] = useState<string[]>([]);

  // A part's buttons and forms are the ones inside it; a page's, all of its own.
  const buttons = part ? part.buttons : (page?.buttons ?? []);
  const forms = part ? (part.forms ?? []) : (page?.forms ?? []);
  const recommended = page ? recommendedGoal(traffic, page.id, share) : null;
  const estimateOf = (g: Goal) =>
    page ? goalEstimate({ facts: traffic, targetId: page.id, goal: g, trafficShare: share, versions: 2, relativeChange: change, words: w, numberLocale }) : null;
  const estimate = useMemo(() => estimateOf(goal), [goal, pageId, share, change, traffic]); // eslint-disable-line react-hooks/exhaustive-deps
  const number = (n: number) => n.toLocaleString(numberLocale, { maximumFractionDigits: 0 });
  const date = (days: number) => new Date(Date.now() + days * DAY).toLocaleDateString(numberLocale, { dateStyle: "medium" });

  const toggle = <T extends string>(list: T[], value: T, set: (next: T[]) => void) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const choosePage = (id: string) => {
    setPageId(id);
    setButton("");
    // The recommendation follows the page until the owner picks a goal themselves.
    if (!goalChosen) setGoal(recommendedGoal(traffic, id, share));
  };
  const chooseGoal = (g: Goal) => {
    setGoal(g);
    setGoalChosen(true);
    // A button chosen for one goal is not a form for another.
    setButton("");
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setProblems([]);
    start(async () => {
      const result = await create({
        part: part ? { kind: part.kind, id: part.id } : null,
        name: name.trim() || fillWords(f.testOf, { name: part ? part.label : (page?.title ?? f.aPage) }),
        hypothesis: hypothesis.trim(),
        pageId,
        goal,
        goalBlock: GOAL_WORDS[goal].needsBlock ? button || null : null,
        trafficShare: share,
        audience: {
          ...(devices.length > 0 && devices.length < DEVICES.length && { devices }),
          ...(chosenMarkets.length > 0 && { markets: chosenMarkets }),
        },
      });
      if (result.ok) router.push(`${base}/${result.id}`);
      else setProblems(experimentProblems(result.problems, w));
    });
  };

  if (pages.length === 0) {
    return <p className={`p-5 text-sm text-muted ${CARD_CLASS}`}>{f.noPages}</p>;
  }

  const speedOf = (g: Goal) => {
    if (g === "click") return { text: s.pickButton, tone: "muted" as const };
    if (g === "form") return { text: s.pickForm, tone: "muted" as const };
    if (!isCountedGoal(g) || !traffic.counting) return null;
    const e = estimateOf(g);
    if (!e) return traffic.baselines[g] === null ? { text: s.noRate, tone: "muted" as const } : null;
    const weeks = weeksOf(e);
    if (e.tooLong && page) {
      // Too slow for the change looked for: how soon a bolder one answers, if any does within six weeks.
      const bold = findableChange({ facts: traffic, targetId: page.id, goal: g, trafficShare: share, versions: 2 });
      if (bold && bold.change > change) return { text: fillWords(s.weeksBold, { n: weeksOf(bold.estimate), change: `${Math.round(bold.change * 100)} %` }), tone: "warning" as const };
    }
    if (e.days > MAX_RUN_DAYS) return { text: s.tooSlow, tone: "warning" as const };
    return e.tooLong ? { text: countWords(weeks, s.weeksLong, { n: weeks }), tone: "warning" as const } : { text: countWords(weeks, s.weeks, { n: weeks }), tone: "positive" as const };
  };

  const goalCard = (g: Goal) => {
    const speed = speedOf(g);
    const on = goal === g;
    return (
      <label key={g} className={`flex cursor-pointer flex-col gap-1.5 rounded-card border-2 p-4 text-sm ${on ? "border-brand bg-brand-soft" : "border-edge bg-card"}`} data-goal={g}>
        <input type="radio" name="goal" checked={on} onChange={() => chooseGoal(g)} className="sr-only" />
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-body-strong text-ink">{w.goals[g].label}</span>
          {recommended === g && <Chip signal="positive">{s.recommended}</Chip>}
        </span>
        <span className="text-caption text-ink-2">{fillWords(f.winnerHelps, { asks: w.goals[g].asks })}</span>
        {speed && <span className={`text-caption font-medium ${speed.tone === "positive" ? "text-positive-text" : speed.tone === "warning" ? "text-warning-text" : "text-muted"}`}>{speed.text}</span>}
      </label>
    );
  };

  const historyChip = (id: string) => {
    const h = history[id];
    if (!h) return <Chip signal="neutral">{s.never}</Chip>;
    if (h.status === "applied") return <Chip signal="positive">{fillWords(s.won, { name: h.winner ?? "" })}</Chip>;
    if (h.status === "discarded") return <Chip signal="neutral">{s.kept}</Chip>;
    if (h.status === "stopped") return <Chip signal="warning">{s.undecided}</Chip>;
    return <Chip signal="insight">{s.running}</Chip>;
  };
  const perDayOf = (id: string) => {
    const n = eligiblePerDay(traffic, id);
    if (n === null) return s.notCounted;
    return n < 1 ? s.underOne : fillWords(s.perDay, { n: number(n) });
  };
  const nameOf = (p: TestablePage) =>
    p.kind === "page" ? p.title : `${p.kind === "role" && isTestedPlace(p.role) ? w.roles[p.role] : w.kinds[p.kind].name}: ${p.title}`;

  // Why there is no estimate, when there is none.
  const why = !estimate
    ? goal === "click" || goal === "form" || goal === "revenue"
      ? s.depends
      : !traffic.counting
        ? s.notCounting
        : traffic.consentShare === null
          ? s.noConsent
          : s.noRateYet
    : null;
  const span = estimate ? Math.max(42, estimate.days) : 42;
  // Too subtle a change for this traffic: the smallest one it could find within six weeks, offered in one press.
  const bolder = estimate?.tooLong && page ? findableChange({ facts: traffic, targetId: page.id, goal, trafficShare: share, versions: 2 }) : null;
  const pct = (c: number) => `${Math.round(c * 100)} %`;
  const bolderLine = estimate?.tooLong ? (
    bolder && bolder.change > change ? (
      <p className="flex flex-wrap items-center gap-3 text-sm text-ink" data-bolder={bolder.change}>
        {fillWords(s.bolder, { change: pct(bolder.change), weeks: weeksOf(bolder.estimate) })}
        <Button kind="secondary" size="dense" onClick={() => setChange(bolder.change)}>
          {fillWords(s.bolderButton, { change: pct(bolder.change) })}
        </Button>
      </p>
    ) : (
      <p className="text-sm text-ink-2">{s.noneFits}</p>
    )
  ) : null;
  const at = (days: number) => `${Math.min(100, (days / span) * 100)}%`;

  return (
    <form onSubmit={submit} className="flex max-w-4xl flex-col gap-6" aria-busy={pending}>
      <Card title={s.goalTitle} className="flex flex-col gap-4" compact>
        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">{f.goalLegend}</legend>
          <div className="grid gap-3 md:grid-cols-3">{FIRST_GOALS.map(goalCard)}</div>
          {(moreGoals || MORE_GOALS.includes(goal)) && <div className="grid gap-3 md:grid-cols-3">{MORE_GOALS.map(goalCard)}</div>}
        </fieldset>
        {!MORE_GOALS.includes(goal) && (
          <Button kind="link" className="self-start" onClick={() => setMoreGoals(!moreGoals)}>
            {moreGoals ? s.fewerGoals : `${s.moreGoals}: ${MORE_GOALS.map((g) => w.goals[g].label.toLowerCase()).join(", ")}`}
          </Button>
        )}
        {goal === "form" && (
          <label className={label}>
            {f.whichForm}
            {forms.length === 0 ? (
              <span className={hint}>
                {part ? f.noFormPart : f.noFormPage} {f.addFirst}
              </span>
            ) : (
              <select value={button} onChange={(e) => setButton(e.target.value)} className={input} required>
                <option value="">{f.chooseForm}</option>
                {forms.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            )}
            <span className={hint}>{f.formCounts}</span>
          </label>
        )}
        {goal === "click" && (
          <label className={label}>
            {f.whichButton}
            {buttons.length === 0 ? (
              <span className={hint}>
                {part ? f.noButtonPart : f.noButtonPage} {f.addFirst}
              </span>
            ) : (
              <select value={button} onChange={(e) => setButton(e.target.value)} className={input} required>
                <option value="">{f.chooseButton}</option>
                {buttons.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            )}
          </label>
        )}
      </Card>

      {part ? (
        <Card title={f.step1Part.replace(/^\d+\.\s*/, "")} className="flex flex-col gap-2" compact>
          <p className="text-sm">
            <span className="font-medium">{part.label}</span>{" "}
            {page && page.kind !== "page"
              ? fillWords(f.inThe, { kind: (page.kind === "role" && isTestedPlace(page.role) ? w.roles[page.role] : w.kinds[page.kind].name).toLowerCase() })
              : f.inPage}{" "}
            <span className="font-medium">{page?.title}</span>
            {page?.kind === "page" && ` (/${page.slug})`}.
          </p>
          <p className={hint}>{f.partHint}</p>
        </Card>
      ) : (
        <Card title={s.whereTitle} description={traffic.counting ? s.whereSub : undefined} className="flex flex-col gap-3" compact>
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">{f.whatToTest}</legend>
            {pages.map((p) => (
              <label
                key={p.id}
                className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-md border p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto] ${pageId === p.id ? "border-brand bg-brand-soft" : "border-line bg-card"}`}
                data-target={p.id}
              >
                <input type="radio" name="target" checked={pageId === p.id} onChange={() => choosePage(p.id)} className="sr-only" />
                <span className="min-w-0">
                  <span className="font-medium text-ink">{nameOf(p)}</span>
                  {p.kind === "page" && <span className="text-muted"> /{p.slug}</span>}
                  {p.kind !== "page" && p.kind !== "role" && <span className="block text-caption text-muted">{fillWords(f.seenWhere, { where: w.kinds[p.kind].where })}</span>}
                </span>
                <span className="text-caption tabular-nums text-ink-2">{traffic.counting ? perDayOf(p.id) : ""}</span>
                <span className="col-span-2 sm:col-span-1">{historyChip(p.id)}</span>
              </label>
            ))}
          </fieldset>
          <p className={hint}>
            {f.copyHint} {traffic.counting && s.whereBasis}
          </p>
        </Card>
      )}

      <Card title={s.howLongTitle} className="flex flex-col gap-3" compact>
        {estimate && estimate.days > MAX_RUN_DAYS ? (
          <div className="flex flex-col gap-3" data-estimate-days={estimate.days}>
            <p className="text-sm text-warning-text">{fillWords(s.tooSlowDetail, { change: pct(change), n: number(estimate.perVersion), max: MAX_RUN_DAYS })}</p>
            {bolderLine}
          </div>
        ) : estimate ? (
          <div className="flex flex-col gap-3" data-estimate-days={estimate.days}>
            <div className="relative h-9" aria-hidden>
              <div className="absolute inset-x-0 top-3 h-2.5 rounded-pill bg-sunken" />
              <div className={`absolute left-0 top-3 h-2.5 rounded-pill ${estimate.tooLong ? "bg-warning-solid" : "bg-positive-solid"}`} style={{ width: at(estimate.days) }} />
              <div className="absolute top-0 h-8 w-0.5 bg-ink-2" style={{ left: at(MIN_DAYS) }} />
              <div className="absolute top-0 h-8 w-0.5 bg-ink" style={{ left: at(estimate.days) }} />
            </div>
            <div className="flex flex-wrap justify-between gap-2 text-caption text-muted">
              <span>{s.today}</span>
              <span>{fillWords(s.shortest, { days: MIN_DAYS })}</span>
              <span className="font-medium text-ink">{countWords(weeksOf(estimate), s.answerAt, { n: weeksOf(estimate) })}</span>
              {span === 42 && <span>{s.sixWeeks}</span>}
            </div>
            <p className="text-sm">
              {estimate.sentence}
              {!estimate.tooLong && fillWords(s.around, { date: date(estimate.days) })}
            </p>
            {bolderLine}
          </div>
        ) : (
          <p className="text-sm text-ink-2">{why}</p>
        )}
      </Card>

      <details className={`group ${CARD_CLASS}`} data-customise>
        <summary className="flex cursor-pointer list-none flex-col gap-0.5 p-5 [&::-webkit-details-marker]:hidden">
          <span className="text-body-strong text-ink">{s.customise}</span>
          <span className="text-caption text-muted">{s.customiseHint}</span>
        </summary>
        <div className="flex flex-col gap-4 border-t border-line p-5">
          <label className={label}>
            {f.name}
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={fillWords(f.testOf, { name: part ? part.label : (page?.title ?? f.thePage) })} className={input} />
          </label>
          <label className={label}>
            {f.hypothesis}
            <textarea
              value={hypothesis}
              onChange={(e) => setHypothesis(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder={f.hypothesisPlaceholder}
              className="w-full rounded-md border border-line bg-card px-3 py-2 text-sm font-normal"
            />
            <span className={hint}>{f.hypothesisHint}</span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>
              {f.share}
              <select value={share} onChange={(e) => setShare(Number(e.target.value))} className={input}>
                {SHARES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {w.shares[o.key]}
                  </option>
                ))}
              </select>
              <span className={hint}>{f.shareHint}</span>
            </label>
            <label className={label}>
              {s.change}
              <select value={change} onChange={(e) => setChange(Number(e.target.value))} className={input}>
                {CHANGES.map((c) => (
                  <option key={c} value={c}>
                    {fillWords(w.estimate.more, { n: Math.round(c * 100) })}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="mb-1 font-medium">{f.devices}</legend>
            {DEVICES.map((d) => (
              <label key={d} className="flex items-center gap-2">
                <input type="checkbox" checked={devices.includes(d)} onChange={() => toggle(devices, d, setDevices)} />
                {w.devices[d]}
              </label>
            ))}
          </fieldset>
          {markets.length > 1 && (
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="mb-1 font-medium">{f.countries}</legend>
              {markets.map((m) => (
                <label key={m.code} className="flex items-center gap-2">
                  <input type="checkbox" checked={chosenMarkets.includes(m.code)} onChange={() => toggle(chosenMarkets, m.code, setChosenMarkets)} />
                  {m.name}
                </label>
              ))}
            </fieldset>
          )}
          <div className="flex flex-col gap-2">
            <h3 className="text-body-strong text-ink">{s.ownFigures}</h3>
            <RuntimeEstimate share={share} versions={2} />
          </div>
        </div>
      </details>

      {problems.length > 0 && (
        <ul role="alert" className="list-disc rounded-lg border border-danger-text p-4 pl-8 text-sm text-danger-text">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" kind="main" disabled={pending}>
          {pending ? f.making : s.make}
        </Button>
        <span className="text-xs text-muted">{f.nothingShown}</span>
      </div>
    </form>
  );
}
