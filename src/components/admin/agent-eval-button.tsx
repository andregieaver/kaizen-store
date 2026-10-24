"use client";

import { useState, useTransition } from "react";

import { fillWords } from "@/lib/admin-fill";

import { useAdminText } from "./admin-text";

export type AgentEvalOutcome =
  | { error: string }
  | { model: string; passed: number; total: number; ok: boolean; ms: number; failures: { id: string; problems: string[]; answer: string }[] };

/** Runs the agents' safety eval (PSI 2026-10-24, AST-09) and shows what failed and why. */
interface AgentEvalButtonProps {
  action(): Promise<AgentEvalOutcome>;
}

export function AgentEvalButton({ action }: AgentEvalButtonProps) {
  const w = useAdminText("settings").ai.form;
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AgentEvalOutcome | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setResult(await action()))}
        className="min-h-10 w-fit rounded-pill border border-edge px-4 text-sm font-medium hover:bg-sunken disabled:opacity-50"
      >
        {pending ? w.checking : w.checkAgents}
      </button>
      <div role="status" className="text-sm">
        {result && "error" in result && <p className="text-danger-text">✗ {result.error}</p>}
        {result && !("error" in result) && (
          <>
            <p className={result.ok ? "" : "text-danger-text"}>
              {result.ok ? w.passes : w.fails}
              {fillWords(w.agentsResult, { model: result.model, passed: result.passed, total: result.total, s: (result.ms / 1000).toFixed(1) })}
            </p>
            {result.failures.length > 0 && (
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
                {result.failures.map((failure) => (
                  <li key={failure.id}>
                    <span className="font-medium">{failure.id}</span>: {failure.problems.join("; ")}
                    {failure.answer && <code className="mt-0.5 block break-all text-xs text-muted">{fillWords(w.answered, { answer: failure.answer })}</code>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
