"use client";

import { useState, useTransition } from "react";

import { fillWords } from "@/lib/admin-fill";
import { TOKEN_KINDS, type TokenKind } from "@/lib/admin-api";

import { useAdminText } from "./admin-text";
import { Button } from "./ui";
import { ConfirmButton } from "./ui/confirm-button";

type Answer = { ok: true; token?: string } | { ok: false; message: string };
type Async = Promise<Answer>;

/** One scope to tick, in the owner's words with its name beside. */
function ScopeBox({ scope, words }: { scope: string; words: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name="scopes" value={scope} className="mt-0.5 size-4" />
      <span>
        {words}
        <code className="block text-xs text-muted">{scope}</code>
      </span>
    </label>
  );
}

/**
 * Makes an Admin API token (D355) and shows it once. The everyday scopes are ticked in the open; the powers (D440: what the AI manager asks
 * the owner's yes for) wait under *Customise*, one deliberate step away.
 */
export function MakeApiToken({
  scopes,
  powers,
  make,
  scopeWords,
  namePlaceholder,
  kinds = false,
}: {
  scopes: string[];
  powers: string[];
  make: (form: FormData) => Async;
  /** What each scope allows, when they are not the stores' (Kaizena Flow's own API, D518). */
  scopeWords?: Record<string, string>;
  /** The name's example, when the store's (*Warehouse*) does not fit. */
  namePlaceholder?: string;
  /** Round 27 (D700): start from the ready kinds of token (a store's); Choose yourself shows every scope. */
  kinds?: boolean;
}) {
  const w = useAdminText("notifications").apiTokens;
  const wordsOf = (scope: string) => scopeWords?.[scope] ?? w.scopeWords[scope] ?? scope;
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [key, setKey] = useState(0);
  const [kind, setKind] = useState<TokenKind>(kinds ? "warehouse" : "custom");
  if (token)
    return (
      <div role="status" className="flex flex-col gap-2 rounded-panel border border-warning-line bg-warning-soft p-4 text-sm">
        <p className="text-body-strong text-ink">{w.tokenTitle}</p>
        <p className="text-ink-2">{w.tokenOnce}</p>
        <code className="break-all rounded-panel bg-card px-3 py-2 font-mono text-xs text-ink">{token}</code>
        <div className="flex gap-2">
          <Button onClick={() => void navigator.clipboard?.writeText(token).then(() => setCopied(true))}>{copied ? w.copied : w.copy}</Button>
          <Button
            kind="quiet"
            onClick={() => {
              setToken(null);
              setCopied(false);
            }}
          >
            {w.done}
          </Button>
        </div>
      </div>
    );
  return (
    <form
      key={key}
      aria-busy={pending}
      className="flex flex-col gap-4"
      action={(form) =>
        start(async () => {
          const answer = await make(form);
          if (answer.ok) {
            setProblem(null);
            setKey((k) => k + 1);
            if (answer.token) setToken(answer.token);
          } else setProblem(answer.message);
        })
      }
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        {w.name}
        <input name="name" required maxLength={80} placeholder={namePlaceholder ?? w.namePlaceholder} className="min-h-10 rounded-md border border-line bg-card px-3 font-normal" />
      </label>
      {kinds && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{w.kind}</legend>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {(["warehouse", "accounting", "read", "custom"] as const).map((k) => (
              <label
                key={k}
                className="flex cursor-pointer flex-col gap-0.5 rounded-panel border border-line p-3 text-sm has-checked:border-ink has-checked:ring-1 has-checked:ring-ink has-focus-visible:outline-2"
              >
                <span className="flex items-center gap-2">
                  <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="size-4" />
                  {w.kinds[k].name}
                </span>
                <span className="text-xs text-muted">{w.kinds[k].sub}</span>
              </label>
            ))}
          </div>
          {kind !== "custom" && (
            <>
              <p className="text-sm text-ink-2">{w.kinds[kind].does}</p>
              {TOKEN_KINDS[kind].map((scope) => (
                <input key={scope} type="hidden" name="scopes" value={scope} />
              ))}
            </>
          )}
        </fieldset>
      )}
      {kind === "custom" && (
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{w.scopes}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {scopes.map((scope) => (
            <ScopeBox key={scope} scope={scope} words={wordsOf(scope)} />
          ))}
        </div>
        {powers.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-sm font-medium">{w.powers}</summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {powers.map((scope) => (
                <ScopeBox key={scope} scope={scope} words={wordsOf(scope)} />
              ))}
            </div>
          </details>
        )}
      </fieldset>
      )}
      {problem && (
        <p role="alert" className="text-sm text-danger-text">
          {problem}
        </p>
      )}
      <div>
        <Button kind="main" type="submit" disabled={pending} className="max-sm:w-full">
          {pending ? w.making : w.make}
        </Button>
      </div>
    </form>
  );
}

/** Revokes one token after asking in the admin's dialog; a refusal is shown beside the button. */
export function RevokeApiToken({ name, revoke }: { name: string; revoke: () => Async }) {
  const w = useAdminText("notifications").apiTokens;
  return (
    <span className="flex items-center gap-2">
      <ConfirmButton kind="danger" size="dense" question={fillWords(w.revokeQuestion, { name })} confirm={w.revoke} action={revoke}>
        {w.revoke}
      </ConfirmButton>
    </span>
  );
}
