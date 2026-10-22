"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { DEVICES, GOALS, GOAL_WORDS, type Device, type Goal } from "@/lib/experiments";
import { isTestedPlace, type TargetKind } from "@/lib/ab-site";
import { fillWords } from "@/lib/admin-fill";
import { experimentProblems } from "@/lib/experiment-words";
import type { PartInfo } from "@/lib/experiment-parts";

import { useAdminText } from "./admin-text";
import { RuntimeEstimate } from "./runtime-estimate";
import { CARD_CLASS } from "@/components/admin/ui";

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const card = "flex flex-col gap-4 rounded-lg border border-line bg-card p-5";
const hint = "text-xs font-normal text-muted";

export type TestablePage = { id: string; slug: string; title: string; kind: TargetKind; role?: string | null; partOnly?: boolean; buttons: { id: string; label: string }[]; forms?: { id: string; label: string }[] };
type Outcome = { ok: true; id: string } | { ok: false; problems: string[] };

const SHARES = [
  { value: 1, key: "all" },
  { value: 0.5, key: "half" },
  { value: 0.25, key: "quarter" },
] as const;

/**
 * Making an A/B test (D148): which page, what it should improve, and who takes part. The first version is a copy of the
 * page made on saving, to change next. The estimate of how long it takes is the owner's own guess worked out here, with the
 * same function the results use.
 */
export function ExperimentForm({
  pages,
  markets,
  create,
  base,
  part = null,
}: {
  /** A part of the page chosen in the builder (D148): the test is of it, on the one page offered. */
  part?: PartInfo | null;
  pages: TestablePage[];
  markets: { code: string; name: string }[];
  create: (input: unknown) => Promise<Outcome>;
  base: string;
}) {
  const w = useAdminText("experiments");
  const f = w.form;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problems, setProblems] = useState<string[]>([]);
  const [pageId, setPageId] = useState(pages[0]?.id ?? "");
  const [goal, setGoal] = useState<Goal>("orders");
  const page = pages.find((p) => p.id === pageId);
  const [button, setButton] = useState("");
  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [share, setShare] = useState(1);
  const [devices, setDevices] = useState<Device[]>([...DEVICES]);
  const [chosenMarkets, setChosenMarkets] = useState<string[]>([]);

  // A part's buttons and forms are the ones inside it; a page's, all of its own.
  const buttons = part ? part.buttons : (page?.buttons ?? []);
  const forms = part ? (part.forms ?? []) : (page?.forms ?? []);

  const toggle = <T extends string>(list: T[], value: T, set: (next: T[]) => void) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

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
    return (
      <p className={`p-5 text-sm text-muted ${CARD_CLASS}`}>
        {f.noPages}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex max-w-3xl flex-col gap-6" aria-busy={pending}>
      <section className={card} aria-labelledby="ab-page">
        <h2 id="ab-page" className="text-title text-ink">{part ? f.step1Part : f.step1}</h2>
        {part ? (
          <p className="text-sm">
            <span className="font-medium">{part.label}</span>{" "}
            {page && page.kind !== "page"
              ? fillWords(f.inThe, { kind: (page.kind === "role" && isTestedPlace(page.role) ? w.roles[page.role] : w.kinds[page.kind].name).toLowerCase() })
              : f.inPage}{" "}
            <span className="font-medium">{page?.title}</span>
            {page?.kind === "page" && ` (/${page.slug})`}.
            <span className={`${hint} block`}>
              {f.partHint}
            </span>
          </p>
        ) : (
        <label className={label}>
          {f.whatToTest}
          <select value={pageId} onChange={(e) => setPageId(e.target.value)} className={input}>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.kind === "page" ? `${p.title} (/${p.slug})` : `${p.kind === "role" && isTestedPlace(p.role) ? w.roles[p.role] : w.kinds[p.kind].name}: ${p.title}`}
              </option>
            ))}
          </select>
          <span className={hint}>
            {f.copyHint}
            {page && page.kind !== "page" && ` ${fillWords(f.seenWhere, { where: w.kinds[page.kind].where })}`}
          </span>
        </label>
        )}
      </section>

      <section className={card} aria-labelledby="ab-goal">
        <h2 id="ab-goal" className="text-title text-ink">{f.step2}</h2>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{f.goalLegend}</legend>
          {GOALS.map((g) => (
            <label key={g} className="flex items-start gap-3 rounded-md border border-line p-3 text-sm has-[:checked]:border-brand">
              <input type="radio" name="goal" checked={goal === g} onChange={() => {
                  setGoal(g);
                  // A button chosen for one goal is not a form for another.
                  setButton("");
                }} className="mt-1" />
              <span>
                <span className="font-medium">{w.goals[g].label}</span>
                <span className="block text-xs text-muted">{fillWords(f.winnerHelps, { asks: w.goals[g].asks })}</span>
              </span>
            </label>
          ))}
        </fieldset>
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
      </section>

      <section className={card} aria-labelledby="ab-name">
        <h2 id="ab-name" className="text-title text-ink">{f.step3}</h2>
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
      </section>

      <section className={card} aria-labelledby="ab-who">
        <h2 id="ab-who" className="text-title text-ink">{f.step4}</h2>
        <label className={label}>
          {f.share}
          <select value={share} onChange={(e) => setShare(Number(e.target.value))} className={input}>
            {SHARES.map((s) => (
              <option key={s.value} value={s.value}>
                {w.shares[s.key]}
              </option>
            ))}
          </select>
          <span className={hint}>{f.shareHint}</span>
        </label>
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
      </section>

      <section className={card} aria-labelledby="ab-time">
        <h2 id="ab-time" className="text-title text-ink">{f.howLong}</h2>
        <RuntimeEstimate share={share} versions={2} />
      </section>

      {problems.length > 0 && (
        <ul role="alert" className="list-disc rounded-lg border border-danger-text p-4 pl-8 text-sm text-danger-text">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className="min-h-11 rounded-pill bg-brand px-5 text-sm font-medium text-brand-ink disabled:opacity-50">
          {pending ? f.making : f.make}
        </button>
        <span className="self-center text-xs text-muted">{f.nothingShown}</span>
      </div>
    </form>
  );
}
