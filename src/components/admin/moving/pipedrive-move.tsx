"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";

import { field, hint, primary, secondary } from "@/components/admin/data/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import type { PdPlan, PdRun, PdSkip } from "@/lib/pipedrive";

import { useAdminText } from "../admin-text";
import { ShopifyDisconnect } from "./shopify-connect";

type ConnectProblem = "empty" | "not_a_token" | "no_key" | "refused" | "unreachable" | "forbidden";

/** What the card shows of a run: its counts and how far it is (`step` of `steps` feeds), never the ids a check keeps. */
export type PipedriveRunView = Pick<PdRun, "mode" | "status" | "feed" | "plan" | "already" | "problem"> & { total: number; step: number; steps: number };

export type PipedriveActions = {
  connect: (token: string) => Promise<{ ok: true } | { ok: false; problem: ConnectProblem }>;
  start: (mode: PdRun["mode"]) => Promise<{ ok: boolean }>;
  advance: () => Promise<{ moving: boolean }>;
  disconnect: () => Promise<{ ok: boolean }>;
};

/**
 * Moving in from Pipedrive (D477) on Settings → Moving in. For Homer one field and *Connect Pipedrive*, then *See what comes over*, then
 * *Bring it over*: each press says what it will do, and a run moves on while the page is open (and without it, by the dispatcher). Lisa
 * reads what was left out and why, and brings over what is new later.
 */
export function PipedriveMove({
  connected,
  run,
  actions,
  dealsHref,
}: {
  connected: { name: string; hint: string; when: string } | null;
  run: PipedriveRunView | null;
  actions: PipedriveActions;
  dealsHref: string;
}) {
  const w = useAdminText("moving").pipedrive;
  const router = useRouter();
  const [pending, start] = useTransition();
  const running = run?.status === "running";

  useEffect(() => {
    if (!running) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      const result = await actions.advance().catch(() => ({ moving: true }));
      router.refresh();
      if (!stop && result.moving) timer = setTimeout(tick, 1500);
    };
    let timer = setTimeout(tick, 300);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [running, actions, router]);

  const begin = (mode: PdRun["mode"]) =>
    start(async () => {
      await actions.start(mode);
      router.refresh();
    });

  if (!connected) return <ConnectForm connect={actions.connect} />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium">{fillWords(w.connected, { name: connected.name })}</p>
        <p className={hint}>{fillWords(w.token, { hint: connected.hint, when: connected.when })}</p>
      </div>

      {!run && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">{w.checkHelp}</p>
          <div>
            <button type="button" className={primary} disabled={pending} onClick={() => begin("check")}>
              {w.check}
            </button>
          </div>
        </div>
      )}

      {run && running && <Progress run={run} />}

      {run && run.status === "failed" && (
        <div className="flex flex-col gap-2">
          <p role="alert" className="rounded-card bg-sunken p-3 text-sm">
            {w.failed[run.problem ?? "unexpected"]}
          </p>
          {run.problem !== "token_refused" && (
            <div>
              <button type="button" className={primary} disabled={pending} onClick={() => begin(run.mode)}>
                {w.tryAgain}
              </button>
            </div>
          )}
        </div>
      )}

      {run && run.status === "done" && (
        <div className="flex flex-col gap-3">
          <Plan title={run.mode === "check" ? w.willCome : w.came} plan={run.plan} total={run.total} already={run.already} />
          <div className="flex flex-wrap items-center gap-2">
            {run.mode === "check" ? (
              <>
                {run.total > 0 && (
                  <button type="button" className={primary} disabled={pending} onClick={() => begin("import")}>
                    {pending ? w.bringing : w.bring}
                  </button>
                )}
                <button type="button" className={secondary} disabled={pending} onClick={() => begin("check")}>
                  {w.checkAgain}
                </button>
              </>
            ) : (
              <>
                <Link href={dealsHref} className={primary}>
                  {w.openDeals}
                </Link>
                <button type="button" className={secondary} disabled={pending} onClick={() => begin("import")}>
                  {w.bringAgain}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <GoodToKnow />
      <ShopifyDisconnect disconnect={actions.disconnect} label={w.disconnect} ask={w.disconnectAsk} />
    </div>
  );
}

function ConnectForm({ connect }: { connect: PipedriveActions["connect"] }) {
  const w = useAdminText("moving").pipedrive;
  const router = useRouter();
  const id = useId();
  const [token, setToken] = useState("");
  const [problem, setProblem] = useState<ConnectProblem | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setProblem(null);
            const result = await connect(token);
            if (!result.ok) setProblem(result.problem);
            else {
              setToken("");
              router.refresh();
            }
          });
        }}
      >
        <label htmlFor={`${id}-token`} className="text-sm font-medium">
          {w.label}
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id={`${id}-token`}
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${id}-help`}
            className={`${field} min-w-56 flex-1 font-mono`}
          />
          <button type="submit" disabled={pending || token.trim() === ""} className={primary}>
            {pending ? w.connecting : w.connect}
          </button>
        </div>
        <p id={`${id}-help`} className={hint}>
          {w.help}
        </p>
        {problem && (
          <p role="alert" className="text-sm">
            {problem === "forbidden" ? w.problems.unreachable : w.problems[problem]}
          </p>
        )}
      </form>
      <GoodToKnow />
    </div>
  );
}

function Progress({ run }: { run: PipedriveRunView }) {
  const w = useAdminText("moving").pipedrive;
  const share = Math.round(((run.step - 1) / run.steps) * 100);
  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <p className="text-sm font-medium">{run.mode === "check" ? w.checking : w.importing}</p>
      <div className="h-2 w-full overflow-hidden rounded-full bg-sunken" aria-hidden>
        <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${Math.max(4, share)}%` }} />
      </div>
      <p className={hint}>
        {fillWords(w.reading, { feed: w.feeds[run.feed] })} {run.step}/{run.steps}. {w.stayOpen}
      </p>
      {run.total > 0 && <Counts plan={run.plan} />}
    </div>
  );
}

function Counts({ plan }: { plan: PdPlan }) {
  const c = useAdminText("moving").pipedrive.counts;
  const lines: string[] = [];
  const add = (n: number, words: { one: string; many: string }) => n > 0 && lines.push(countWords(n, words, { n }));
  add(plan.companies, c.companies);
  add(plan.customers, c.customers);
  add(plan.pipelines, c.pipelines);
  add(plan.stages, c.stages);
  add(plan.deals.open, c.open);
  add(plan.deals.won, c.won);
  add(plan.deals.lost, c.lost);
  add(plan.activities, c.activities);
  add(plan.notes, c.notes);
  return (
    <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function Plan({ title, plan, total, already }: { title: string; plan: PdPlan; total: number; already: number }) {
  const w = useAdminText("moving").pipedrive;
  const skipped = (Object.entries(plan.skipped) as [PdSkip, number][]).filter(([, n]) => n > 0);
  return (
    <section className="flex flex-col gap-2 rounded-panel bg-sunken p-4" aria-label={title}>
      <h3 className="text-base font-medium">{title}</h3>
      {total > 0 ? <Counts plan={plan} /> : <p className="text-sm">{w.nothingNew}</p>}
      {already > 0 && <p className={hint}>{countWords(already, w.already, { n: already })}</p>}
      {skipped.length > 0 && (
        <details className="text-sm">
          <summary className="w-fit cursor-pointer underline underline-offset-2">
            {w.leftOut} ({skipped.reduce((sum, [, n]) => sum + n, 0)})
          </summary>
          <ul className="mt-2 list-disc pl-5">
            {skipped.map(([why, n]) => (
              <li key={why}>{countWords(n, w.skipped[why], { n })}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function GoodToKnow() {
  const w = useAdminText("moving").pipedrive.good;
  return (
    <details className="text-sm">
      <summary className="w-fit cursor-pointer underline underline-offset-2">{w.title}</summary>
      <ul className="mt-2 list-disc pl-5">
        <li>{w.subscribed}</li>
        <li>{w.email}</li>
        <li>{w.notes}</li>
        <li>{w.team}</li>
        <li>{w.again}</li>
      </ul>
    </details>
  );
}
