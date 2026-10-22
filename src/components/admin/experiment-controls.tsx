"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  addVariantAction,
  applyVariantAction,
  deleteDraftAction,
  discardExperimentAction,
  removeVariantAction,
  renameExperimentAction,
  scheduleExperimentAction,
  startExperimentAction,
  stopExperimentAction,
  unscheduleExperimentAction,
  updateDraftAction,
} from "@/app/admin/(gated)/[store]/experiments/actions";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { experimentProblems } from "@/lib/experiment-words";
import { DEVICES, MAX_VARIANTS, type Device } from "@/lib/experiments";
import type { ExperimentInfo } from "@/server/experiment-admin";
import { Button, Card, CARD_CLASS } from "@/components/admin/ui";

import { PAGE_TYPE_COPY } from "./page-type-copy";
import { useAdminLang, useAdminText } from "./admin-text";
import { RuntimeEstimate } from "./runtime-estimate";

type Outcome = { ok: true } | { ok: false; problems: string[] };

const button = "min-h-10 rounded-pill border border-edge px-4 text-sm font-medium disabled:opacity-50";
const primary = "min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink disabled:opacity-50";
const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";

/** Runs a server action from a click: shows what it says is wrong, refreshes the page on success. */
function useRun() {
  const words = useAdminText("experiments");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problems, setProblems] = useState<string[]>([]);
  const run = (action: () => Promise<Outcome>, then?: () => void) => {
    setProblems([]);
    start(async () => {
      const result = await action();
      if (result.ok) {
        then?.();
        router.refresh();
      } else setProblems(experimentProblems(result.problems, words));
    });
  };
  return { pending, problems, run, router, setProblems };
}

function Problems({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return (
    <ul role="alert" className="list-disc rounded-lg border border-danger-text p-4 pl-8 text-sm text-danger-text">
      {problems.map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  );
}

/** A draft: its versions to change, its settings, and the start button, which says in words what is still missing. */
export function DraftPanel({ store, test, markets }: { store: string; test: ExperimentInfo; markets: { code: string; name: string }[] }) {
  const { pending, problems, run, router } = useRun();
  const w = useAdminText("experiments");
  const d = w.draft;
  const base = `/admin/${store}/experiments`;
  const [name, setName] = useState(test.name);
  const [hypothesis, setHypothesis] = useState(test.hypothesis);
  const [share, setShare] = useState(test.trafficShare);
  const [minDays, setMinDays] = useState(test.minDays);
  const [devices, setDevices] = useState<Device[]>(test.audience.devices ?? [...DEVICES]);
  const [chosen, setChosen] = useState<string[]>(test.audience.markets ?? []);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [at, setAt] = useState("");
  const toggle = <T extends string>(list: T[], value: T, set: (next: T[]) => void) => set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const save = () =>
    run(
      () =>
        updateDraftAction(store, test.id, {
          name,
          hypothesis,
          trafficShare: share,
          minDays,
          audience: {
            ...(devices.length > 0 && devices.length < DEVICES.length && { devices }),
            ...(chosen.length > 0 && { markets: chosen }),
          },
        }),
      () => setSaved(true),
    );

  return (
    <div className="flex flex-col gap-6">
      <Card
        title={d.step1}
        aside={
          test.variants.length < MAX_VARIANTS && (
            <Button type="button" disabled={pending} onClick={() => run(() => addVariantAction(store, test.id))}>
              {d.addVersion}
            </Button>
          )
        }
        className="flex flex-col gap-3"
        compact
      >
        <p className="text-sm text-muted">
          {test.part
            ? `${fillWords(d.partIntro, { part: test.part.label })}${test.part.modal ? (test.part.modal.byItself ? d.partByItself : d.partLinked) : ""}`
            : d.pageIntro}
        </p>
        <ul className="flex flex-col gap-2">
          {test.variants.map((v) => (
            <li key={v.key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line p-3 text-sm">
              <span>
                <span className="font-medium">{v.name}</span>
                <span className="block text-xs text-muted">
                  {fillWords(d.shareOf, { n: Math.round(v.share * 100) })}
                  {v.key !== "a" && (v.changed ? d.changed : d.notChanged)}
                </span>
                {v.scope === "outside" && (
                  <span role="alert" className="block text-xs text-danger-text">
                    {fillWords(d.outside, { part: test.part?.label ?? "" })}
                  </span>
                )}
                {v.scope === "missing" && (
                  <span role="alert" className="block text-xs text-danger-text">
                    {fillWords(d.missing, { part: test.part?.label ?? "" })}
                  </span>
                )}
                {v.scope === "modal" && (
                  <span role="alert" className="block text-xs text-danger-text">
                    {fillWords(d.modal, { part: test.part?.label ?? "" })}
                  </span>
                )}
              </span>
              <span className="flex flex-wrap gap-3">
                {v.pageId && (
                  <>
                    <Link href={`${base}/variants/${v.pageId}`} className="underline">
                      {d.changeIt}
                    </Link>
                    <Link href={`${base}/variants/${v.pageId}/preview`} className="underline">
                      {d.preview}
                    </Link>
                  </>
                )}
                {v.key === "a" && (
                  <Link href={`/admin/${store}/${PAGE_TYPE_COPY[test.page.type].segment}/${test.page.id}/preview`} className="underline">
                    {d.preview}
                  </Link>
                )}
                {v.key !== "a" && test.variants.length > 2 && (
                  <button type="button" disabled={pending} onClick={() => run(() => removeVariantAction(store, test.id, v.key))} className="text-danger-text underline">
                    {d.remove}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={d.step2} className="flex flex-col gap-4" compact>
        <label className={label}>
          {d.name}
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={input} />
        </label>
        <label className={label}>
          {d.hypothesis}
          <textarea value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} maxLength={500} rows={2} className="w-full rounded-md border border-line bg-card px-3 py-2 text-sm font-normal" />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>
            {d.share}
            <select value={share} onChange={(e) => setShare(Number(e.target.value))} className={input}>
              <option value={1}>{w.shares.all}</option>
              <option value={0.5}>{w.shares.half}</option>
              <option value={0.25}>{w.shares.quarter}</option>
            </select>
          </label>
          <label className={label}>
            {d.minDays}
            <input type="number" min={1} max={90} value={minDays} onChange={(e) => setMinDays(Number(e.target.value))} className={input} />
            <span className="text-xs font-normal text-muted">{d.minDaysHint}</span>
          </label>
        </div>
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="mb-1 font-medium">{d.devices}</legend>
          {DEVICES.map((device) => (
            <label key={device} className="flex items-center gap-2">
              <input type="checkbox" checked={devices.includes(device)} onChange={() => toggle(devices, device, setDevices)} />
              {w.devices[device]}
            </label>
          ))}
        </fieldset>
        {markets.length > 1 && (
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="mb-1 font-medium">{d.countries}</legend>
            {markets.map((m) => (
              <label key={m.code} className="flex items-center gap-2">
                <input type="checkbox" checked={chosen.includes(m.code)} onChange={() => toggle(chosen, m.code, setChosen)} />
                {m.name}
              </label>
            ))}
          </fieldset>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">{d.howLong}</summary>
          <div className="mt-3">
            <RuntimeEstimate share={share} versions={test.variants.length} minDays={minDays} />
          </div>
        </details>
        <div className="flex items-center gap-3">
          <button type="button" disabled={pending} onClick={save} className={button}>
            {d.save}
          </button>
          {saved && <span role="status" className="text-sm text-muted">{d.saved}</span>}
        </div>
      </Card>

      <Problems problems={problems} />
      <Card title={d.step3} className="flex flex-col gap-3" compact>
        <p className="text-sm text-muted">
          {fillWords(d.startIntro, { days: test.minDays })}
        </p>
        {test.scheduleProblem && (
          <p role="alert" className="rounded-md border border-warning-text p-3 text-sm">
            {test.scheduleProblem}
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <button type="button" disabled={pending} onClick={() => run(() => startExperimentAction(store, test.id))} className={primary}>
            {d.startNow}
          </button>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {d.orAt}
            <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal" />
          </label>
          <button
            type="button"
            disabled={pending || at === ""}
            onClick={() => run(() => scheduleExperimentAction(store, test.id, new Date(at).toISOString()))}
            className={button}
          >
            {d.schedule}
          </button>
        </div>
        <div className="flex flex-wrap gap-3">
          {confirmDelete ? (
            <span className="flex items-center gap-2 text-sm">
              {d.deleteAsk}
              <button type="button" disabled={pending} onClick={() => run(() => deleteDraftAction(store, test.id), () => router.push(base))} className="min-h-10 rounded-pill bg-danger-soft px-4 text-danger-text disabled:opacity-50">
                {d.delete}
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="underline">
                {d.keepIt}
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="text-sm text-danger-text underline">
              {d.deleteDraft}
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}

/** What can be done to a test that has started: stop it, choose a winner or keep the original, and rename it. */
export function RunPanel({ store, test }: { store: string; test: ExperimentInfo }) {
  const { pending, problems, run } = useRun();
  const w = useAdminText("experiments");
  const r = w.run;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const [confirm, setConfirm] = useState<string | null>(null);
  const [name, setName] = useState(test.name);
  const [renaming, setRenaming] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <Problems problems={problems} />
      {test.status === "scheduled" && test.scheduledStart && (
        <Card
          title={<>{fillWords(r.starts, { date: new Date(test.scheduledStart).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) })}</>}
          description={r.scheduledText}
          className="flex flex-col gap-3"
          compact
        >
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={pending} onClick={() => run(() => startExperimentAction(store, test.id))} className={primary}>
              {r.startNow}
            </button>
            <button type="button" disabled={pending} onClick={() => run(() => unscheduleExperimentAction(store, test.id))} className={button}>
              {r.backToDraft}
            </button>
          </div>
        </Card>
      )}
      {test.status === "running" && (
        <Card
          title={r.running}
          description={
            <>
              {r.runningText}
              {test.plannedEnd && fillWords(r.plannedEnd, { date: new Date(test.plannedEnd).toLocaleDateString(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" }) })}
            </>
          }
          className="flex flex-col gap-3"
          compact
        >
          {confirm === "stop" ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {r.stopAsk}
              <button type="button" disabled={pending} onClick={() => run(() => stopExperimentAction(store, test.id), () => setConfirm(null))} className="min-h-10 rounded-pill bg-danger-soft px-4 text-danger-text disabled:opacity-50">
                {r.stop}
              </button>
              <button type="button" onClick={() => setConfirm(null)} className="underline">
                {r.keepRunning}
              </button>
            </div>
          ) : (
            <div>
              <button type="button" onClick={() => setConfirm("stop")} className={button}>
                {r.stop}
              </button>
            </div>
          )}
        </Card>
      )}
      {test.status === "stopped" && (
        <Card
          title={r.decide}
          description={
            <>
              {r.decideText} {test.part ? fillWords(r.decidePart, { part: test.part.label }) : r.decidePage}
              {test.stopReason === "guardrail" && r.guardrail}
              {test.stopReason === "planned_end" && r.plannedStop}
            </>
          }
          className="flex flex-col gap-3"
          compact
        >
          <div className="flex flex-wrap gap-3">
            {test.variants
              .filter((v) => v.key !== "a")
              .map((v) =>
                confirm === `apply-${v.key}` ? (
                  <span key={v.key} className="flex flex-wrap items-center gap-2 text-sm">
                    {test.part ? fillWords(r.replacePart, { part: test.part.label, name: v.name }) : fillWords(r.replacePage, { name: v.name })}
                    <button type="button" disabled={pending} onClick={() => run(() => applyVariantAction(store, test.id, v.key), () => setConfirm(null))} className="min-h-10 rounded-pill bg-brand px-4 text-brand-ink disabled:opacity-50">
                      {fillWords(r.yesUse, { name: v.name })}
                    </button>
                    <button type="button" onClick={() => setConfirm(null)} className="underline">
                      {r.cancel}
                    </button>
                  </span>
                ) : (
                  <button key={v.key} type="button" onClick={() => setConfirm(`apply-${v.key}`)} className={primary}>
                    {fillWords(r.use, { name: v.name })}
                  </button>
                ),
              )}
            <button type="button" disabled={pending} onClick={() => run(() => discardExperimentAction(store, test.id))} className={button}>
              {r.keepOriginal}
            </button>
          </div>
        </Card>
      )}
      {(test.status === "applied" || test.status === "discarded") && (
        <p className={`p-4 text-sm ${CARD_CLASS}`}>
          {test.status === "applied"
            ? fillWords(r.applied, { name: test.variants.find((v) => v.key === test.appliedVariant)?.name ?? r.aVersion })
            : r.discarded}{" "}
          {r.finished}
        </p>
      )}
      {test.status !== "applied" && test.status !== "discarded" && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {renaming ? (
            <>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-label={r.name} className={`${input} max-w-xs`} />
              <button type="button" disabled={pending} onClick={() => run(() => renameExperimentAction(store, test.id, { name }), () => setRenaming(false))} className={button}>
                {r.saveName}
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setRenaming(true)} className="underline">
              {r.rename}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
