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
import { DEVICES, MAX_VARIANTS, type Device } from "@/lib/experiments";
import type { ExperimentInfo } from "@/server/experiment-admin";

import { RuntimeEstimate } from "./runtime-estimate";

type Outcome = { ok: true } | { ok: false; problems: string[] };

const button = "min-h-10 rounded-md border border-border px-4 text-sm font-medium disabled:opacity-50";
const primary = "min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50";
const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";

const DEVICE_WORDS: Record<Device, string> = { mobile: "Phones", tablet: "Tablets", desktop: "Computers" };

/** Runs a server action from a click: shows what it says is wrong, refreshes the page on success. */
function useRun() {
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
      } else setProblems(result.problems);
    });
  };
  return { pending, problems, run, router, setProblems };
}

function Problems({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return (
    <ul role="alert" className="list-disc rounded-lg border border-red-700 p-4 pl-8 text-sm text-red-800 dark:text-red-300">
      {problems.map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  );
}

/** A draft: its versions to change, its settings, and the start button, which says in words what is still missing. */
export function DraftPanel({ store, test, markets }: { store: string; test: ExperimentInfo; markets: { code: string; name: string }[] }) {
  const { pending, problems, run, router } = useRun();
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
      <section aria-labelledby="ab-versions" className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="ab-versions" className="text-lg font-semibold">1. Change a version</h2>
          {test.variants.length < MAX_VARIANTS && (
            <button type="button" disabled={pending} onClick={() => run(() => addVariantAction(store, test.id))} className={button}>
              Add another version
            </button>
          )}
        </div>
        <p className="text-sm text-muted">
          {test.part
            ? `The original is your page as it is. Each other version starts as a copy of it: open it in the page builder and change ${test.part.label}, then publish it there. Everything else on the page has to stay as it is, so the test is about that part only.`
            : "The original is your page as it is. Each other version starts as a copy of it: open it in the page builder, change the thing you want to try (a heading, a picture, a button), and publish it there. Change one thing at a time, so you know what made the difference."}
        </p>
        <ul className="flex flex-col gap-2">
          {test.variants.map((v) => (
            <li key={v.key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm">
              <span>
                <span className="font-medium">{v.name}</span>
                <span className="block text-xs text-muted">
                  {Math.round(v.share * 100)} % of the visitors in the test
                  {v.key !== "a" && (v.changed ? " · changed" : " · not changed yet")}
                </span>
                {v.scope === "outside" && (
                  <span role="alert" className="block text-xs text-red-800 dark:text-red-300">
                    Changes more than {test.part?.label}: put everything else back as it was.
                  </span>
                )}
                {v.scope === "missing" && (
                  <span role="alert" className="block text-xs text-red-800 dark:text-red-300">
                    No longer has {test.part?.label}.
                  </span>
                )}
              </span>
              <span className="flex flex-wrap gap-3">
                {v.pageId && (
                  <>
                    <Link href={`${base}/variants/${v.pageId}`} className="underline">
                      Change it
                    </Link>
                    <Link href={`${base}/variants/${v.pageId}/preview`} className="underline">
                      Preview
                    </Link>
                  </>
                )}
                {v.key === "a" && (
                  <Link href={`/admin/${store}/pages/${test.page.id}/preview`} className="underline">
                    Preview
                  </Link>
                )}
                {v.key !== "a" && test.variants.length > 2 && (
                  <button type="button" disabled={pending} onClick={() => run(() => removeVariantAction(store, test.id, v.key))} className="text-red-700 underline dark:text-red-400">
                    Remove
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="ab-settings" className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5">
        <h2 id="ab-settings" className="text-lg font-semibold">2. Check the settings</h2>
        <label className={label}>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={input} />
        </label>
        <label className={label}>
          What do you think will happen?
          <textarea value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} maxLength={500} rows={2} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal" />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>
            Share of visitors in the test
            <select value={share} onChange={(e) => setShare(Number(e.target.value))} className={input}>
              <option value={1}>All visitors</option>
              <option value={0.5}>Half of the visitors</option>
              <option value={0.25}>A quarter of the visitors</option>
            </select>
          </label>
          <label className={label}>
            Shortest run, in days
            <input type="number" min={1} max={90} value={minDays} onChange={(e) => setMinDays(Number(e.target.value))} className={input} />
            <span className="text-xs font-normal text-muted">No winner is announced before this, so a lucky first days do not decide it. Whole weeks work best.</span>
          </label>
        </div>
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="mb-1 font-medium">Devices</legend>
          {DEVICES.map((d) => (
            <label key={d} className="flex items-center gap-2">
              <input type="checkbox" checked={devices.includes(d)} onChange={() => toggle(devices, d, setDevices)} />
              {DEVICE_WORDS[d]}
            </label>
          ))}
        </fieldset>
        {markets.length > 1 && (
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="mb-1 font-medium">Countries (none ticked: all)</legend>
            {markets.map((m) => (
              <label key={m.code} className="flex items-center gap-2">
                <input type="checkbox" checked={chosen.includes(m.code)} onChange={() => toggle(chosen, m.code, setChosen)} />
                {m.name}
              </label>
            ))}
          </fieldset>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">How long will it take?</summary>
          <div className="mt-3">
            <RuntimeEstimate share={share} versions={test.variants.length} minDays={minDays} />
          </div>
        </details>
        <div className="flex items-center gap-3">
          <button type="button" disabled={pending} onClick={save} className={button}>
            Save settings
          </button>
          {saved && <span role="status" className="text-sm text-muted">Saved.</span>}
        </div>
      </section>

      <Problems problems={problems} />
      <section aria-labelledby="ab-start" className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5">
        <h2 id="ab-start" className="text-lg font-semibold">3. Start the test</h2>
        <p className="text-sm text-muted">
          Visitors who have accepted statistics cookies will be shown the versions from the next page view. The test runs for at least {test.minDays} days and
          you can stop it at any time. The page itself does not change until you choose a winner.
        </p>
        {test.scheduleProblem && (
          <p role="alert" className="rounded-md border border-amber-500 p-3 text-sm">
            {test.scheduleProblem}
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <button type="button" disabled={pending} onClick={() => run(() => startExperimentAction(store, test.id))} className={primary}>
            Start the test now
          </button>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Or start it at
            <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="min-h-10 rounded-md border border-border bg-background px-3 text-sm font-normal" />
          </label>
          <button
            type="button"
            disabled={pending || at === ""}
            onClick={() => run(() => scheduleExperimentAction(store, test.id, new Date(at).toISOString()))}
            className={button}
          >
            Schedule the start
          </button>
        </div>
        <div className="flex flex-wrap gap-3">
          {confirmDelete ? (
            <span className="flex items-center gap-2 text-sm">
              Delete this draft and its versions?
              <button type="button" disabled={pending} onClick={() => run(() => deleteDraftAction(store, test.id), () => router.push(base))} className="min-h-10 rounded-md bg-red-700 px-4 text-white disabled:opacity-50">
                Delete
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="underline">
                Keep it
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="text-sm text-red-700 underline dark:text-red-400">
              Delete the draft
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

/** What can be done to a test that has started: stop it, choose a winner or keep the original, and rename it. */
export function RunPanel({ store, test }: { store: string; test: ExperimentInfo }) {
  const { pending, problems, run } = useRun();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [name, setName] = useState(test.name);
  const [renaming, setRenaming] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <Problems problems={problems} />
      {test.status === "scheduled" && test.scheduledStart && (
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5" aria-labelledby="ab-scheduled">
          <h2 id="ab-scheduled" className="text-lg font-semibold">
            Starts {new Date(test.scheduledStart).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
          </h2>
          <p className="text-sm text-muted">
            The test starts by itself then, if everything is still in order; if not, it goes back to a draft and says why. Until then visitors see your page as it
            is, and the versions are locked. To change anything, take it back to a draft.
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={pending} onClick={() => run(() => startExperimentAction(store, test.id))} className={primary}>
              Start now
            </button>
            <button type="button" disabled={pending} onClick={() => run(() => unscheduleExperimentAction(store, test.id))} className={button}>
              Back to a draft
            </button>
          </div>
        </section>
      )}
      {test.status === "running" && (
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5" aria-labelledby="ab-stop">
          <h2 id="ab-stop" className="text-lg font-semibold">Running</h2>
          <p className="text-sm text-muted">
            Stopping ends the test for everyone: they see your page as it is again, and what was counted is kept. Only stop when you want to decide.
            {test.plannedEnd && ` It is planned to run until ${new Date(test.plannedEnd).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "Europe/Oslo" })}.`}
          </p>
          {confirm === "stop" ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              Stop the test now?
              <button type="button" disabled={pending} onClick={() => run(() => stopExperimentAction(store, test.id), () => setConfirm(null))} className="min-h-10 rounded-md bg-red-700 px-4 text-white disabled:opacity-50">
                Stop the test
              </button>
              <button type="button" onClick={() => setConfirm(null)} className="underline">
                Keep it running
              </button>
            </div>
          ) : (
            <div>
              <button type="button" onClick={() => setConfirm("stop")} className={button}>
                Stop the test
              </button>
            </div>
          )}
        </section>
      )}
      {test.status === "stopped" && (
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5" aria-labelledby="ab-decide">
          <h2 id="ab-decide" className="text-lg font-semibold">Decide</h2>
          <p className="text-sm text-muted">
            The test is stopped and visitors see your page as it was. Choose a version to make it your page, or keep the original.{" "}
            {test.part
              ? `A version replaces ${test.part.label} in the page at once, and nothing else: anything you changed on the page since stays.`
              : "A version replaces the page's content at once; the address stays."}
            {test.stopReason === "guardrail" && " Kaizen stopped it because a version was clearly selling less."}
            {test.stopReason === "planned_end" && " It stopped itself at its planned end."}
          </p>
          <div className="flex flex-wrap gap-3">
            {test.variants
              .filter((v) => v.key !== "a")
              .map((v) =>
                confirm === `apply-${v.key}` ? (
                  <span key={v.key} className="flex flex-wrap items-center gap-2 text-sm">
                    {test.part ? `Replace ${test.part.label} with the one in ${v.name}?` : `Replace the page with ${v.name}?`}
                    <button type="button" disabled={pending} onClick={() => run(() => applyVariantAction(store, test.id, v.key), () => setConfirm(null))} className="min-h-10 rounded-md bg-foreground px-4 text-background disabled:opacity-50">
                      Yes, use {v.name}
                    </button>
                    <button type="button" onClick={() => setConfirm(null)} className="underline">
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button key={v.key} type="button" onClick={() => setConfirm(`apply-${v.key}`)} className={primary}>
                    Use {v.name}
                  </button>
                ),
              )}
            <button type="button" disabled={pending} onClick={() => run(() => discardExperimentAction(store, test.id))} className={button}>
              Keep the original
            </button>
          </div>
        </section>
      )}
      {(test.status === "applied" || test.status === "discarded") && (
        <p className="rounded-lg border border-border bg-background p-4 text-sm">
          {test.status === "applied"
            ? `${test.variants.find((v) => v.key === test.appliedVariant)?.name ?? "A version"} is now your page.`
            : "The original was kept."}{" "}
          The test is finished and its results stay here.
        </p>
      )}
      {test.status !== "applied" && test.status !== "discarded" && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {renaming ? (
            <>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-label="Name" className={`${input} max-w-xs`} />
              <button type="button" disabled={pending} onClick={() => run(() => renameExperimentAction(store, test.id, { name }), () => setRenaming(false))} className={button}>
                Save name
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setRenaming(true)} className="underline">
              Rename
            </button>
          )}
        </div>
      )}
    </div>
  );
}
