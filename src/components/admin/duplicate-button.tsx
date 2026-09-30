"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { DuplicateResult } from "@/lib/page-duplicate";

/**
 * "Duplicate" in a list of pages (D126): the copy is made as a draft on the server and the person lands in its editor.
 * The action is bound to the owner and the kind of page; a refusal is shown under the button, where it was asked.
 */
export function DuplicateButton({
  id,
  title,
  adminBase,
  duplicate,
}: {
  id: string;
  title: string;
  adminBase: string;
  duplicate: (id: string) => Promise<DuplicateResult>;
}) {
  const router = useRouter();
  const [busy, startBusy] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  const run = () =>
    startBusy(async () => {
      setProblem(null);
      const outcome = await duplicate(id);
      if (outcome.ok) router.push(`${adminBase}/${outcome.id}`);
      else setProblem(outcome.problems[0] ?? "The copy could not be made.");
    });

  return (
    <>
      <button type="button" onClick={run} disabled={busy} className="underline disabled:opacity-50">
        {busy ? "Duplicating …" : "Duplicate"}
        <span className="sr-only"> {title}</span>
      </button>
      {problem && (
        <span role="alert" className="block text-red-700 dark:text-red-400">
          {problem}
        </span>
      )}
    </>
  );
}
