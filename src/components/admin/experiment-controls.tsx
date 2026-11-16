"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  addVariantAction,
  deleteDraftAction,
  decideExperimentAction,
  removeVariantAction,
  renameExperimentAction,
  scheduleExperimentAction,
  startExperimentAction,
  stopExperimentAction,
  unscheduleExperimentAction,
  updateDraftAction,
} from "@/app/admin/(gated)/[store]/experiments/actions";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { experimentProblems } from "@/lib/experiment-words";
import { DEVICES, GOAL_WORDS, MAX_VARIANTS, type Device } from "@/lib/experiments";
import type { ExperimentInfo } from "@/server/experiment-admin";
import { Button, ButtonLink, Card, CARD_CLASS } from "@/components/admin/ui";
import type { NextStep } from "@/lib/experiment-card";
import { goalEstimate, type TrafficFacts } from "@/lib/experiment-traffic";

import { MoreMenu } from "./orders/order-folds";

import { PAGE_TYPE_COPY } from "./page-type-copy";
import { useAdminLang, useAdminText } from "./admin-text";
import { RuntimeEstimate } from "./runtime-estimate";

type Outcome = { ok: true } | { ok: false; problems: string[] };

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

/**
 * A draft's next step, in its header (D656, the record of round 1): change the version while it is still the original, then start the
 * test; scheduling the start, another version and deleting the draft are under More, each asking first where it cannot be undone.
 */
export function DraftActions({ store, test, ready }: { store: string; test: ExperimentInfo; ready: boolean }) {
  const { pending, problems, run, router } = useRun();
  const w = useAdminText("experiments");
  const d = w.draft;
  const c = w.draftCard;
  const base = `/admin/${store}/experiments`;
  const [ask, setAsk] = useState<"schedule" | "delete" | null>(null);
  const [at, setAt] = useState("");
  const unchanged = test.variants.find((v) => v.key !== "a" && !v.changed && v.pageId);
  return (
    <div className="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        {unchanged ? (
          <ButtonLink kind="main" size="header" href={`${base}/variants/${unchanged.pageId}`}>
            {fillWords(c.change, { name: unchanged.name })}
          </ButtonLink>
        ) : (
          <Button kind={ready ? "main" : "secondary"} size="header" disabled={pending} onClick={() => run(() => startExperimentAction(store, test.id))}>
            {c.start}
          </Button>
        )}
        <MoreMenu label={w.card.actions.more}>
          {!unchanged && (
            <Button kind="quiet" onClick={() => setAsk("schedule")}>
              {c.schedule}
            </Button>
          )}
          {test.variants.length < MAX_VARIANTS && (
            <Button kind="quiet" disabled={pending} onClick={() => run(() => addVariantAction(store, test.id))}>
              {d.addVersion}
            </Button>
          )}
          <Button kind="quiet" onClick={() => setAsk("delete")}>
            {d.deleteDraft}
          </Button>
        </MoreMenu>
      </div>
      {ask === "schedule" && (
        <div className={`flex flex-wrap items-end gap-2 p-3 ${CARD_CLASS}`}>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {c.startAt}
            <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal" />
          </label>
          <Button kind="secondary" disabled={pending || at === ""} onClick={() => run(() => scheduleExperimentAction(store, test.id, new Date(at).toISOString()), () => setAsk(null))}>
            {c.scheduleSave}
          </Button>
          <Button kind="quiet" onClick={() => setAsk(null)}>
            {w.card.actions.cancel}
          </Button>
        </div>
      )}
      {ask === "delete" && (
        <div role="alertdialog" aria-label={d.deleteAsk} className={`flex max-w-md flex-col gap-3 p-4 text-body ${CARD_CLASS}`}>
          <p>{d.deleteAsk}</p>
          <div className="flex flex-wrap gap-2">
            <Button kind="danger" disabled={pending} onClick={() => run(() => deleteDraftAction(store, test.id), () => router.push(base))}>
              {d.delete}
            </Button>
            <Button kind="quiet" onClick={() => setAsk(null)}>
              {d.keepIt}
            </Button>
          </div>
        </div>
      )}
      <Problems problems={problems} />
    </div>
  );
}

/**
 * A draft (D148, a record since D656): whether it is ready to start, as a checklist; each version with what it changes against the original
 * and its links to change and preview it; and the settings under Customise, with how long the test takes at the shop's own traffic.
 */
export function DraftPanel({
  store,
  test,
  markets,
  differences = {},
  problems: left = [],
  ready: givenReady,
  traffic = null,
}: {
  store: string;
  test: ExperimentInfo;
  markets: { code: string; name: string }[];
  /** What each version changes, in words (`versionDifferences()` said by `differenceLine()`). */
  differences?: Record<string, string[]>;
  /** What else stands in the way of a start, in words: the start checks (`startProblemsOf()`) the checklist does not already show. */
  problems?: string[];
  /** Whether the start checks found nothing at all. */
  ready?: boolean;
  /** The shop's traffic (`experimentTraffic()`), for how long the test takes. */
  traffic?: TrafficFacts | null;
}) {
  const { pending, problems, run } = useRun();
  const w = useAdminText("experiments");
  const d = w.draft;
  const c = w.draftCard;
  const numberLocale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const base = `/admin/${store}/experiments`;
  const [name, setName] = useState(test.name);
  const [hypothesis, setHypothesis] = useState(test.hypothesis);
  const [share, setShare] = useState(test.trafficShare);
  const [minDays, setMinDays] = useState(test.minDays);
  const [devices, setDevices] = useState<Device[]>(test.audience.devices ?? [...DEVICES]);
  const [chosen, setChosen] = useState<string[]>(test.audience.markets ?? []);
  const [saved, setSaved] = useState(false);
  const toggle = <T extends string>(list: T[], value: T, set: (next: T[]) => void) => set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const estimate = traffic ? goalEstimate({ facts: traffic, targetId: test.page.id, goal: test.goal, trafficShare: share, versions: test.variants.length, minDays, words: w, numberLocale }) : null;

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

  const versions = test.variants.filter((v) => v.key !== "a");
  const needsBlock = GOAL_WORDS[test.goal].needsBlock;
  const checks: { ok: boolean; text: string }[] = [
    ...versions.map((v) => ({ ok: v.changed, text: fillWords(v.changed ? c.changed : c.notChanged, { name: v.name }) })),
    { ok: test.page.published, text: test.page.published ? c.published : c.notPublished },
    { ok: !needsBlock || Boolean(test.goalBlock), text: needsBlock && !test.goalBlock ? c.goalMissing : fillWords(c.goalSet, { goal: w.goals[test.goal].label.toLowerCase() }) },
  ];
  // Anything else the start checks found (a version that changes more than the part, the limit of running tests …), said as they say it.
  const others = left;
  const ready = givenReady ?? (others.length === 0 && checks.every((check) => check.ok));

  return (
    <div className="flex flex-col gap-6">
      {test.scheduleProblem && (
        <p role="alert" className="rounded-md border border-warning-text p-3 text-sm">
          {test.scheduleProblem}
        </p>
      )}
      <Card title={c.readyTitle} className="flex flex-col gap-3" compact>
        <ul className="flex flex-col gap-2" data-checklist>
          {checks.map((check) => (
            <li key={check.text} className="flex items-start gap-2 text-body">
              <span aria-hidden className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-pill ${check.ok ? "bg-brand text-brand-ink" : "border-2 border-edge"}`}>
                {check.ok && <Check className="size-3" strokeWidth={3} />}
              </span>
              <span className={check.ok ? "text-ink" : "text-ink-2"}>
                <span className="sr-only">{check.ok ? c.done : c.toDo}: </span>
                {check.text}
              </span>
            </li>
          ))}
          {others.map((p) => (
            <li key={p} className="flex items-start gap-2 text-body text-danger-text">
              <span aria-hidden className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-pill border-2 border-danger-line" />
              {p}
            </li>
          ))}
        </ul>
        {ready && <p className="text-caption text-muted">{fillWords(c.allGood, { days: test.minDays })}</p>}
      </Card>

      <Card title={c.versionsTitle} className="flex flex-col gap-4" compact>
        <p className="text-sm text-muted">
          {test.part
            ? `${fillWords(d.partIntro, { part: test.part.label })}${test.part.modal ? (test.part.modal.byItself ? d.partByItself : d.partLinked) : ""}`
            : d.pageIntro}
        </p>
        <ul className="flex flex-col gap-3">
          {test.variants.map((v) => {
            const lines = differences[v.key] ?? [];
            return (
              <li key={v.key} className="flex flex-col gap-2 rounded-md border border-line p-3 text-sm" data-version={v.key}>
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-medium">{v.name}</span>
                    <span className="ml-2 text-xs text-muted">{fillWords(d.shareOf, { n: Math.round(v.share * 100) })}</span>
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
                </span>
                {v.key !== "a" &&
                  (lines.length === 0 ? (
                    <span className="text-caption text-muted">{w.card.different.none}</span>
                  ) : (
                    <ul className="flex list-disc flex-col gap-1 pl-5 text-caption text-ink-2">
                      {lines.slice(0, 5).map((line, i) => (
                        <li key={i} className="break-words">
                          {line}
                        </li>
                      ))}
                      {lines.length > 5 && <li className="list-none text-muted">{countWords(lines.length - 5, w.card.different.more)}</li>}
                    </ul>
                  ))}
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
              </li>
            );
          })}
        </ul>
      </Card>

      <Problems problems={problems} />

      <details className={`group ${CARD_CLASS}`} data-customise>
        <summary className="flex cursor-pointer list-none flex-col gap-0.5 p-5 [&::-webkit-details-marker]:hidden">
          <span className="text-body-strong text-ink">{w.start.customise}</span>
          <span className="text-caption text-muted">{c.customiseHint}</span>
        </summary>
        <div className="flex flex-col gap-4 border-t border-line p-5">
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
          <div className="flex flex-col gap-2">
            <h3 className="text-body-strong text-ink">{d.howLong}</h3>
            {estimate && (
              <p role="status" className={`rounded-md border p-3 text-sm ${estimate.tooLong ? "border-warning-text" : "border-line"}`}>
                {c.atYourTraffic}
                {estimate.sentence}
              </p>
            )}
            <RuntimeEstimate share={share} versions={test.variants.length} minDays={minDays} />
          </div>
          <div className="flex items-center gap-3">
            <Button kind="secondary" disabled={pending} onClick={save}>
              {d.save}
            </Button>
            {saved && <span role="status" className="text-sm text-muted">{d.saved}</span>}
          </div>
        </div>
      </details>
    </div>
  );
}

/**
 * What can be done to a test that has started, in its header (D655, the record of round 1): the one green button its stage asks for
 * (start a scheduled test, use the winner, keep the original), the rest behind More (rename, stop, the other choices), and a question
 * before anything changes. Deciding a running test stops it first (`decideExperimentAction`).
 */
export function TestActions({ store, test, next, best }: { store: string; test: ExperimentInfo; next: NextStep; best: string | null }) {
  const { pending, problems, run } = useRun();
  const w = useAdminText("experiments");
  const a = w.card.actions;
  const [ask, setAsk] = useState<string | null>(null);
  const [name, setName] = useState(test.name);
  if (test.status === "applied" || test.status === "discarded") return null;
  const versions = test.variants.filter((v) => v.key !== "a");
  const nameOf = (key: string) => versions.find((v) => v.key === key)?.name ?? key.toUpperCase();
  const running = test.status === "running";
  const deciding = test.status === "running" || test.status === "stopped";
  // The main choice: a scheduled test's start, the winner, or the original when the answer (or a broken split) says keep it; none while it learns.
  const main = test.status === "scheduled" ? "start" : next === "use" && best ? best : deciding && (next === "keep_original" || next === "start_again") ? "original" : null;
  const question =
    ask === "stop"
      ? a.stopAsk
      : ask === "original"
        ? a.keepAsk
        : ask
          ? test.part
            ? fillWords(a.usePart, { part: test.part.label, name: nameOf(ask) })
            : fillWords(a.usePage, { name: nameOf(ask) })
          : null;
  const yes = ask === "stop" ? a.yesStop : ask === "original" ? a.yesKeep : ask ? fillWords(a.yesUse, { name: nameOf(ask) }) : "";
  const confirm = () => {
    if (!ask) return;
    if (ask === "stop") run(() => stopExperimentAction(store, test.id), () => setAsk(null));
    else if (ask === "rename") run(() => renameExperimentAction(store, test.id, { name }), () => setAsk(null));
    else run(() => decideExperimentAction(store, test.id, ask), () => setAsk(null));
  };
  return (
    <div className="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        {main === "start" && (
          <Button kind="main" size="header" disabled={pending} onClick={() => run(() => startExperimentAction(store, test.id))}>
            {a.startNow}
          </Button>
        )}
        {main && main !== "start" && (
          <Button kind="main" size="header" disabled={pending} onClick={() => setAsk(main)}>
            {main === "original" ? a.keepOriginal : fillWords(a.use, { name: nameOf(main) })}
          </Button>
        )}
        <MoreMenu label={a.more}>
          {test.status === "scheduled" && (
            <Button kind="quiet" disabled={pending} onClick={() => run(() => unscheduleExperimentAction(store, test.id))}>
              {a.backToDraft}
            </Button>
          )}
          {deciding &&
            versions
              .filter((v) => v.key !== main)
              .map((v) => (
                <Button key={v.key} kind="quiet" onClick={() => setAsk(v.key)}>
                  {main && main !== "original" ? fillWords(a.useOther, { name: v.name }) : fillWords(a.use, { name: v.name })}
                </Button>
              ))}
          {deciding && main !== "original" && (
            <Button kind="quiet" onClick={() => setAsk("original")}>
              {a.keepOriginal}
            </Button>
          )}
          {running && (
            <Button kind="quiet" onClick={() => setAsk("stop")}>
              {a.stop}
            </Button>
          )}
          <Button kind="quiet" onClick={() => setAsk("rename")}>
            {a.rename}
          </Button>
        </MoreMenu>
      </div>
      {ask === "rename" ? (
        <div className={`flex flex-wrap items-center gap-2 p-3 ${CARD_CLASS}`}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-label={a.name} className={`${input} max-w-xs`} />
          <Button kind="secondary" disabled={pending} onClick={confirm}>
            {a.saveName}
          </Button>
          <Button kind="quiet" onClick={() => setAsk(null)}>
            {a.cancel}
          </Button>
        </div>
      ) : (
        question && (
          <div role="alertdialog" aria-label={question} className={`flex max-w-md flex-col gap-3 p-4 text-body ${CARD_CLASS}`}>
            <p>{question}</p>
            <div className="flex flex-wrap gap-2">
              <Button kind={ask === "stop" ? "danger" : "main"} disabled={pending} onClick={confirm}>
                {yes}
              </Button>
              <Button kind="quiet" onClick={() => setAsk(null)}>
                {a.cancel}
              </Button>
            </div>
          </div>
        )
      )}
      <Problems problems={problems} />
    </div>
  );
}
