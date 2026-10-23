"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import {
  BRREG_NAME_MIN,
  classifyQuery,
  formatOrganisationNumber,
  readableName,
  type BrregCompany,
  type BrregHit,
} from "@/lib/brreg";

import type { BrregLookup as Lookup, BrregSearch as Search } from "@/server/brreg";

import { fillWords } from "@/lib/admin-fill";
import { useAdminText } from "./admin-text";
import { control, errorText, hintText, secondaryButton } from "./work/work-parts";

type Status =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "hits"; hits: BrregHit[]; total: number; text: string }
  | { kind: "message"; text: string; tone: "info" | "error" };


/**
 * Fills in a form from Brønnøysundregistrene (`src/server/brreg.ts`): type an organisation number and the company
 * is fetched, or type a name and pick from what the register finds. A Work client and a shop's company account both
 * use it; each passes the two server actions it may call (`lookup`, `search`), so who may ask is its own rule.
 * Nothing is saved from here: `onPick` puts the details into the form, where every field can still be changed. Someone typing a name sees matches after a pause;
 * Enter or the button asks straight away. An answer that arrives after a newer question is dropped.
 */
export function BrregLookup({
  lookup,
  search,
  onPick,
}: {
  lookup: (input: string) => Promise<Lookup>;
  search: (input: string) => Promise<Search>;
  onPick: (company: BrregCompany) => void;
}) {
  const w = useAdminText("bookings").brreg;
  const id = useId();
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const latest = useRef(0);

  const lookNumber = async (text: string, ticket: number) => {
    const result = await lookup(text);
    if (ticket !== latest.current) return;
    if (result.ok) {
      setStatus({ kind: "idle" });
      setInput("");
      onPick(result.company);
    } else if (result.reason === "not_found") {
      setStatus({
        kind: "message",
        tone: "error",
        text: w.notFound,
      });
    } else if (result.reason === "invalid") {
      setStatus({
        kind: "message",
        tone: "error",
        text: w.invalid,
      });
    } else {
      setStatus({ kind: "message", tone: "error", text: w.unavailable });
    }
  };

  const lookName = async (text: string, ticket: number) => {
    const result = await search(text);
    if (ticket !== latest.current) return;
    if (!result.ok) {
      setStatus(
        result.reason === "too_short" ? { kind: "idle" } : { kind: "message", tone: "error", text: w.unavailable },
      );
    } else if (result.hits.length === 0) {
      setStatus({
        kind: "message",
        tone: "info",
        text: `No company found for “${text}”.`,
      });
    } else {
      setStatus({ kind: "hits", hits: result.hits, total: result.total, text });
    }
  };

  const ask = async (text: string) => {
    const query = classifyQuery(text);
    const ticket = ++latest.current;
    if (query.kind === "empty") return setStatus({ kind: "idle" });
    if (query.kind === "number") {
      if (!query.valid) {
        return setStatus({
          kind: "message",
          tone: "error",
          text: w.invalidDigits,
        });
      }
      setStatus({ kind: "busy" });
      return lookNumber(query.digits, ticket);
    }
    if (query.text.length < BRREG_NAME_MIN) return setStatus({ kind: "idle" });
    setStatus({ kind: "busy" });
    return lookName(query.text, ticket);
  };

  // A name is searched for after a pause in typing; a number waits for Enter or the button.
  useEffect(() => {
    const query = classifyQuery(input);
    if (query.kind !== "name" || query.text.length < 3) return;
    const timer = setTimeout(() => void ask(input), 450);
    return () => clearTimeout(timer);
    // `ask` closes over the store and the latest ticket only, so it is not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(input);
  };

  const choose = (hit: BrregHit) => {
    const ticket = ++latest.current;
    setStatus({ kind: "busy" });
    void lookNumber(hit.organisationNumber, ticket);
  };

  const busy = status.kind === "busy";

  return (
    <div className="rounded-panel bg-sunken p-4">
      <label htmlFor={`${id}-input`} className="mb-1 block text-sm font-medium">
        {w.label}
      </label>
      <p id={`${id}-hint`} className={`mb-2 ${hintText}`}>
        {w.hint}
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          id={`${id}-input`}
          type="search"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void ask(input);
            }
          }}
          placeholder={w.placeholder}
          maxLength={100}
          autoComplete="off"
          aria-describedby={`${id}-hint ${id}-status`}
          className={`${control} min-w-0 flex-1`}
        />
        <button type="button" onClick={submit} disabled={busy || input.trim() === ""} className={secondaryButton}>
          {busy ? w.looking : w.lookUp}
        </button>
      </div>

      <div id={`${id}-status`} role="status" aria-live="polite" className="mt-2 text-sm">
        {status.kind === "message" &&
          (status.tone === "error" ? (
            <p className={errorText}>{status.text}</p>
          ) : (
            <p className="text-muted">{status.text}</p>
          ))}
        {status.kind === "hits" && (
          <>
            <ul
              aria-label={w.found}
              className="flex flex-col divide-y divide-line rounded-md border border-line bg-card"
            >
              {status.hits.map((hit) => (
                <li key={hit.organisationNumber}>
                  <button
                    type="button"
                    onClick={() => choose(hit)}
                    className="flex w-full flex-wrap items-baseline justify-between gap-x-3 px-3 py-2 text-left hover:bg-sunken"
                  >
                    <span className="font-medium">{readableName(hit.legalName)}</span>
                    <span className="text-xs text-muted">
                      {formatOrganisationNumber(hit.organisationNumber)}
                      {hit.organisationForm ? ` · ${hit.organisationForm}` : ""}
                      {hit.place ? ` · ${hit.place}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {status.total > status.hits.length && (
              <p className={`mt-1 ${hintText}`}>
                {status.total.toLocaleString("en")} companies match. Type more of the name to narrow it down.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * What a lookup did to the form, in words, and what to look at before saving: no VAT number if the company is not in
 * the VAT register, no address, and a warning for a company that is bankrupt, being wound up or deleted.
 */
export function RegisterNote({ company, fills }: { company: BrregCompany; fills: "client" | "company" }) {
  const w = useAdminText("bookings").brreg;
  return (
    <div role="status" className="rounded-md border border-line px-3 py-2 text-sm">
      <p>
        {fillWords(w.filled, {
          name: company.legalName,
          number: formatOrganisationNumber(company.organisationNumber),
          form: company.organisationFormName ? ` (${company.organisationFormName})` : "",
        })}
      </p>
      {fills === "client" && !company.vatRegistered && (
        <p className={hintText}>{w.noVat}</p>
      )}
      {fills === "client" && !company.address && (
        <p className={hintText}>{w.noAddress}</p>
      )}
      {company.warnings.map((warning) => (
        <p key={warning} className="font-medium text-danger-text">
          {warning}
        </p>
      ))}
    </div>
  );
}
