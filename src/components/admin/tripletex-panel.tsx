import Link from "next/link";

import { checkTripletexDocumentAction, postTripletexAgainAction, retryTripletexDocumentAction } from "@/app/admin/(gated)/[store]/integrations/tripletex/actions";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { failureWords } from "@/lib/tripletex-errors";
import type { DocumentInTripletex, TripletexConnection } from "@/server/tripletex";

const card = "rounded-lg border border-line bg-card p-5";

type Kind = "work_invoice" | "work_credit_note" | "shop_invoice" | "shop_credit_note";

const wordsOf = (lang: AdminLang) => adminText(lang, "notifications").integrations.tripletex;

/** Why a document waits, in words: a reason of its own (`blocks`), else what its failure says. */
function reasonOf(w: ReturnType<typeof wordsOf>, state: DocumentInTripletex): string | null {
  if (!state.errorKey) return null;
  if (state.errorKey in w.blocks) return w.blocks[state.errorKey as keyof typeof w.blocks];
  return failureWords({ key: state.errorKey, class: state.state === "failed" ? "transient" : "rule" }, w.failures);
}

/**
 * Tripletex on a document's own page (D453): the document and its credit notes, each with its voucher number or why it waits, and
 * Try again for one that waits for a person (owners). Shown only to a store connected to Tripletex.
 */
export function TripletexDocumentsPanel({
  lang,
  storeSlug,
  documents,
  states,
  owner,
}: {
  lang: AdminLang;
  storeSlug: string;
  documents: readonly { kind: Kind; localId: string; number: string }[];
  states: ReadonlyMap<string, DocumentInTripletex>;
  owner: boolean;
}) {
  const w = wordsOf(lang);
  const p = w.panel;
  return (
    <section aria-labelledby="tripletex-documents" className={card}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="tripletex-documents" className="text-title text-ink">
          Tripletex
        </h2>
        <Link href={`/admin/${storeSlug}/integrations/tripletex`} className="text-sm underline">
          {p.manage}
        </Link>
      </div>
      <ul className="flex flex-col gap-3 text-sm">
        {documents.map((d) => {
          const state = states.get(`${d.kind}:${d.localId}`);
          const name = fillWords(w.documents[d.kind], { number: d.number });
          const status = !state
            ? p.notSent
            : state.state === "synced"
              ? `${state.voucher ? fillWords(p.booked, { voucher: state.voucher }) : p.bookedNoNumber}${state.attached ? ` · ${p.withPdf}` : ""}`
              : state.state === "skipped"
                ? p.skipped
                : state.state === "blocked" || state.state === "drifted"
                  ? w.problemsTitle
                  : p.onItsWay;
          const reason = state && state.state !== "synced" ? reasonOf(w, state) : null;
          const waitsForPerson = state?.state === "blocked" || state?.state === "failed";
          const gone = state?.state === "drifted";
          return (
            <li key={`${d.kind}:${d.localId}`} className="flex flex-col gap-1">
              <span>
                <span className="font-medium">{name}</span> · {status}
              </span>
              {reason && <span className="text-muted">{reason}</span>}
              {state?.detail && state.state !== "synced" && <span className="text-muted">{fillWords(w.tripletexSaid, { detail: state.detail })}</span>}
              {owner && waitsForPerson && (
                <ActionForm action={retryTripletexDocumentAction.bind(null, storeSlug, d.kind, d.localId)} className="mt-1">
                  <SubmitButton variant="secondary">{w.tryAgain}</SubmitButton>
                </ActionForm>
              )}
              {owner && gone && (
                <ActionForm action={postTripletexAgainAction.bind(null, storeSlug, d.kind, d.localId)} className="mt-1">
                  <SubmitButton variant="secondary">{p.postAgain}</SubmitButton>
                </ActionForm>
              )}
              {/* Lisa's: whether the voucher is still there, read back; it changes nothing in Tripletex. */}
              {owner && state?.state === "synced" && (
                <ActionForm action={checkTripletexDocumentAction.bind(null, storeSlug, d.kind, d.localId)} className="mt-1">
                  <SubmitButton variant="secondary">{p.check}</SubmitButton>
                </ActionForm>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Work's settings (D453): the store's books in a line, with the way to Tripletex's page. */
export function TripletexAccountingCard({ lang, storeSlug, connection, needYou }: { lang: AdminLang; storeSlug: string; connection: TripletexConnection | null; needYou: number }) {
  const w = wordsOf(lang);
  const p = w.panel;
  const href = `/admin/${storeSlug}/integrations/tripletex`;
  const status = !connection
    ? p.notConnected
    : connection.state === "on" && needYou > 0
      ? w.listStatus.problems
      : connection.state === "on"
        ? fillWords(w.connectedTo, { company: connection.company.name })
        : w.listStatus[connection.state];
  return (
    <section aria-labelledby="tripletex-accounting" className={card}>
      <h2 id="tripletex-accounting" className="mb-1 text-title text-ink">
        {p.cardTitle}
      </h2>
      <p className="mb-3 text-sm text-muted">
        Tripletex · {status}
      </p>
      <Link
        href={href}
        className={`inline-flex min-h-10 items-center rounded-pill px-4 text-sm font-medium ${connection ? "border border-edge hover:bg-sunken" : "bg-brand text-brand-ink"}`}
      >
        {connection ? p.manage : p.connect}
      </Link>
    </section>
  );
}
