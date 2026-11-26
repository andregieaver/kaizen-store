"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/admin/ui/button";
import { ConfirmButton } from "@/components/admin/ui/confirm-button";
import { countWords } from "@/lib/admin-fill";
import type { ProjectsOpInput } from "@/lib/projects-ops";

import { useAct, type ProjectsAct } from "./use-act";

/**
 * One operation on a button (D903): reviewing a project, using statuses of its own, resetting or deleting a list. With `ask` it asks first
 * (in the action's own words); with `after` the page moves there once it is done (a deleted list's page is gone); with `done` it says what
 * it did. A refusal is said beside it.
 */
export function ActButton({
  op,
  act,
  label,
  ask,
  after,
  done,
  kind = "secondary",
}: {
  op: ProjectsOpInput;
  act: ProjectsAct;
  label: string;
  ask?: { question: string; confirm: string; danger?: boolean };
  after?: string;
  /** What to say once it succeeded ("3 tasks unticked."), with the count it answered. */
  done?: { one: string; many: string };
  kind?: "secondary" | "quiet" | "danger";
}) {
  const router = useRouter();
  const { run, pending, said } = useAct(act);
  const [told, setTold] = useState<string | null>(null);
  const go = () =>
    run(op, (answer) => {
      if (!answer.ok) return;
      if (done) setTold(countWords(answer.count ?? 0, done));
      if (after) router.push(after);
    });
  return (
    <span className="inline-flex flex-col gap-1">
      {ask ? (
        <ConfirmButton kind={kind} danger={ask.danger ?? true} question={ask.question} confirm={ask.confirm} action={go} disabled={pending}>
          {label}
        </ConfirmButton>
      ) : (
        <Button kind={kind} onClick={go} disabled={pending} aria-busy={pending}>
          {label}
        </Button>
      )}
      <span role="status" aria-live="polite" className={`text-sm ${said ? "text-danger-text" : "text-muted"}`}>
        {said ?? told}
      </span>
    </span>
  );
}
