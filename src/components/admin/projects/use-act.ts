import { useState, useTransition } from "react";

import type { ProjectsAnswer, ProjectsOpInput } from "@/lib/projects-ops";

/** The area's one action, bound to the store by the page (D903). */
export type ProjectsAct = (op: ProjectsOpInput) => Promise<ProjectsAnswer>;

/**
 * Runs an operation in a transition and keeps its refusal to say in the screen's live line; a success says nothing, since the page is drawn
 * again with what changed. `then` sees the answer (a new row's id, how many changed).
 */
export function useAct(act: ProjectsAct) {
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<string | null>(null);
  const run = (op: ProjectsOpInput, then?: (answer: ProjectsAnswer) => void, before?: () => void) =>
    start(async () => {
      before?.();
      const answer = await act(op);
      setSaid(answer.ok ? null : answer.message);
      then?.(answer);
    });
  return { run, pending, said };
}
