"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { hint, primary, secondary } from "@/components/admin/data/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { MOVE_STEPS, type MoveState, type MoveStep, type ReadyCheck } from "@/lib/shopify-move";
import type { MoveProblem } from "@/server/shopify-move";

import { useAdminText } from "../admin-text";

export type MoveActions = {
  start: () => Promise<{ ok: boolean; problem?: MoveProblem }>;
  schedule: (local: string) => Promise<{ ok: boolean; problem?: MoveProblem }>;
  cancel: () => Promise<{ ok: boolean }>;
  advance: () => Promise<{ moving: boolean }>;
};

/**
 * Move day, part 1 (D445 step 7a): *Ready to move?* with what holds the move back and what is only said, then *Move my shop* or a time of
 * the owner's choosing; while it moves, the steps tick themselves off (the page asks the server to go on every few seconds); then *Your shop
 * has moved*, with the address as what comes next.
 */
export function ShopMove({
  state,
  checks,
  canMove,
  locale,
  timeZone,
  hrefs,
  actions,
}: {
  state: MoveState;
  checks: ReadyCheck[];
  canMove: boolean;
  locale: string;
  timeZone: string;
  hrefs: Record<ReadyCheck["key"], string> & { steps: Record<MoveStep, string>; address: string };
  actions: MoveActions;
}) {
  const w = useAdminText("moving").move;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [choosing, setChoosing] = useState(false);
  const [local, setLocal] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const moving = state.status === "moving";

  useEffect(() => {
    if (!moving) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      const result = await actions.advance().catch(() => ({ moving: true }));
      router.refresh();
      if (!stop && result.moving) timer = setTimeout(tick, 3000);
    };
    let timer = setTimeout(tick, 1500);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [moving, actions, router]);

  const when = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short", timeZone }).format(new Date(iso));
    } catch {
      return iso;
    }
  };
  const press = (action: () => Promise<{ ok: boolean; problem?: MoveProblem }>) =>
    start(async () => {
      setProblem(null);
      const result = await action();
      if (!result.ok) setProblem(w.problems[result.problem ?? "gone"]);
      else setChoosing(false);
      router.refresh();
    });

  if (moving || state.status === "moved") {
    return (
      <section aria-labelledby="shop-move" className="flex flex-col gap-3" aria-busy={moving}>
        <h3 id="shop-move" className="text-base font-medium">
          {state.status === "moved" ? w.moved : w.title}
        </h3>
        <ul className="flex flex-col gap-2 text-sm" aria-live="polite">
          {MOVE_STEPS.map((step) => {
            const s = state.steps[step];
            const figure =
              s.stage === "done" && step === "catch_up" && (s.done ?? 0) > 0
                ? countWords(s.done ?? 0, w.caughtUp)
                : s.stage === "done" && step === "links" && (s.done ?? 0) > 0
                  ? countWords(s.done ?? 0, w.linked)
                  : null;
            return (
              <li key={step} className="flex flex-col gap-0.5">
                <span>
                  <span className="font-medium">{w.steps[step]}</span>: {w.stages[s.stage]}
                  {figure ? ` · ${figure}` : ""}
                </span>
                {s.stage === "failed" && s.problem && (
                  <span className={hint}>
                    {w.stepProblems[s.problem]}{" "}
                    <Link href={hrefs.steps[step]} className="underline underline-offset-2">
                      {w.stepFix[step]}
                    </Link>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {state.status === "moved" && (
          <div className="flex flex-col gap-2">
            <p className="text-sm">{w.movedText}</p>
            <div>
              <Link href={hrefs.address} className={primary}>
                {w.next}
              </Link>
            </div>
          </div>
        )}
      </section>
    );
  }

  const line = (c: ReadyCheck): string => {
    const words = w.checks[c.key];
    if (c.key === "links") return c.of === 0 && !c.ok ? w.checks.links.unread : fillWords(c.ok ? w.checks.links.ok : w.checks.links.no, { n: c.n ?? 0, of: c.of ?? 0 });
    if (c.key === "waiting") return c.ok ? w.checks.waiting.ok : countWords(c.n ?? 0, w.checks.waiting.no);
    return c.ok ? (words as { ok: string }).ok : (words as { no: string }).no;
  };

  return (
    <section aria-labelledby="shop-move" className="flex flex-col gap-3">
      <h3 id="shop-move" className="text-base font-medium">
        {w.title}
      </h3>
      <ul className="flex flex-col gap-1 text-sm">
        {checks.map((c) => (
          <li key={c.key}>
            <span aria-hidden="true">{c.ok ? "✓ " : c.blocks ? "✗ " : "· "}</span>
            {line(c)}
            {!c.ok && (
              <>
                {" "}
                <Link href={hrefs[c.key]} className="underline underline-offset-2">
                  {w.fix[c.key]}
                </Link>
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="text-sm">{w.text}</p>
      {state.missed && state.status === "none" && <p className={hint}>{fillWords(w.missed, { when: when(state.missed) })}</p>}
      {state.status === "scheduled" && state.at ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm">{fillWords(w.scheduled, { when: when(state.at) })}</p>
          <button type="button" disabled={pending} className={secondary} onClick={() => press(actions.cancel)}>
            {w.cancel}
          </button>
          <p className={hint}>{w.ttl}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending || !canMove} className={primary} onClick={() => press(actions.start)}>
              {pending ? w.starting : w.start}
            </button>
            {!choosing && (
              <button type="button" disabled={pending || !canMove} className={secondary} onClick={() => setChoosing(true)}>
                {w.choose}
              </button>
            )}
          </div>
          {choosing && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-sm font-medium">
                {w.when}
                <input type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} className="min-h-10 rounded-md border border-line bg-card px-3 text-sm" />
              </label>
              <button type="button" disabled={pending} className={primary} onClick={() => press(() => actions.schedule(local))}>
                {w.save}
              </button>
              <button type="button" disabled={pending} className={secondary} onClick={() => setChoosing(false)}>
                {w.cancel}
              </button>
            </div>
          )}
        </div>
      )}
      {problem && (
        <p className={hint} role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}
