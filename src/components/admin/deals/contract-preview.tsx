import { ContractDocumentView } from "@/components/documents/contract-document-view";
import { fillWords } from "@/lib/admin-fill";
import type { DealsMessages } from "@/lib/admin-messages/deals.en";
import type { ContractSnapshot, FillProblem } from "@/lib/contract-fields";

/**
 * A contract's preview on the admin's pages (D695, D857), without state, so the draft's live editor and a page drawn on the server use the
 * same parts: whether it is ready to go out and what still stops it, and the document on its white paper.
 */

type Words = DealsMessages["contracts"];

export function ContractReadiness({ ok, problems, words: w, live = false }: { ok: boolean; problems: readonly FillProblem[]; words: Words; live?: boolean }) {
  const text = (problem: FillProblem) =>
    problem.kind === "missing_field" ? fillWords(w.fill.missing_field, { field: `{${problem.key}} (${w.fields[problem.key]})` }) : w.fill[problem.kind];
  return (
    <div className="mb-4 rounded-panel bg-sunken p-3 text-sm" {...(live && { role: "status", "aria-live": "polite" as const })}>
      {ok ? (
        <p className="text-ink">{w.ready}</p>
      ) : (
        <>
          <p className="font-medium text-ink">{w.notReady}</p>
          <ul className="mt-1 list-disc pl-5 text-ink-2">
            {problems.map((p, i) => (
              <li key={i}>{text(p)}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function ContractPaper({ snapshot, css }: { snapshot: ContractSnapshot; css: string }) {
  return (
    <div className="rounded-panel border border-line bg-white p-6 text-black">
      <style>{css}</style>
      <ContractDocumentView snapshot={snapshot} level={2} />
    </div>
  );
}
