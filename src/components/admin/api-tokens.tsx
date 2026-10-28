"use client";

import { useState, useTransition } from "react";

import { fillWords } from "@/lib/admin-fill";

import { useAdminText } from "./admin-text";
import { Button } from "./ui";

type Answer = { ok: true; token?: string } | { ok: false; message: string };
type Async = Promise<Answer>;

/** Makes an Admin API token (D355) and shows it once. */
export function MakeApiToken({ scopes, make }: { scopes: string[]; make: (form: FormData) => Async }) {
  const w = useAdminText("notifications").apiTokens;
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [key, setKey] = useState(0);
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
        <input name="name" required maxLength={80} placeholder={w.namePlaceholder} className="min-h-10 rounded-md border border-line bg-card px-3 font-normal" />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{w.scopes}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {scopes.map((scope) => (
            <label key={scope} className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="scopes" value={scope} className="mt-0.5 size-4" />
              <span>
                {w.scopeWords[scope] ?? scope}
                <code className="block text-xs text-muted">{scope}</code>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {problem && (
        <p role="alert" className="text-sm text-danger-text">
          {problem}
        </p>
      )}
      <div>
        <Button kind="main" type="submit" disabled={pending}>
          {pending ? w.making : w.make}
        </Button>
      </div>
    </form>
  );
}

/** Revokes one token after asking. */
export function RevokeApiToken({ name, revoke }: { name: string; revoke: () => Async }) {
  const w = useAdminText("notifications").apiTokens;
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <Button
        kind="danger"
        size="dense"
        disabled={pending}
        onClick={() =>
          window.confirm(fillWords(w.revokeQuestion, { name })) &&
          start(async () => {
            const answer = await revoke();
            setProblem(answer.ok ? null : answer.message);
          })
        }
      >
        {w.revoke}
      </Button>
      {problem && <span className="text-sm text-danger-text">{problem}</span>}
    </span>
  );
}
