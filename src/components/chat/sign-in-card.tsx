"use client";

import { useEffect, useRef, useState } from "react";

import type { ConversationRef, VisitorReply } from "@/lib/support-visitor";

/** The sign-in card's words (D216, 2.1); `codeSent` holds `{email}`. */
export type SignInCardLabels = {
  intro: string;
  email: string;
  sendCode: string;
  codeSent: string;
  code: string;
  signIn: string;
  otherEmail: string;
  done: string;
  otherAccount: string;
};

const isReply = (body: unknown): body is VisitorReply => Boolean(body && typeof body === "object" && Array.isArray((body as VisitorReply).messages) && (body as VisitorReply).state);

/**
 * The sign-in card in the chat (D216, 2.1, step 9): the email, then the six-digit code it was sent, through the chat's own routes,
 * which sign the visitor in to the store as its sign-in page does and link the conversation to them. Focus moves into the card only
 * when the visitor asked for it (`focus`), and to the code field once a code is on its way.
 */
export function SignInCard({
  labels,
  sorry,
  site,
  conversation,
  after,
  focus,
  onSignedIn,
}: {
  labels: SignInCardLabels;
  sorry: string;
  site: { store?: string; market?: string };
  conversation: ConversationRef;
  after: number;
  focus: boolean;
  onSignedIn: (reply: VisitorReply) => void;
}) {
  const [step, setStep] = useState<"email" | "code" | "done">("email");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focus) emailRef.current?.focus();
  }, [focus]);
  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  async function post(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...site, conversation, after, ...body }),
    });
    return { ok: response.ok, status: response.status, body: ((await response.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  }

  async function sendCode(address: string) {
    setBusy(true);
    setProblem(null);
    try {
      const answer = await post("/api/chat/sign-in", { email: address });
      if (answer.ok) {
        setEmail(address);
        setStep("code");
      } else setProblem(typeof answer.body.error === "string" ? answer.body.error : sorry);
    } catch {
      setProblem(sorry);
    } finally {
      setBusy(false);
    }
  }

  async function signIn(code: string) {
    setBusy(true);
    setProblem(null);
    try {
      const answer = await post("/api/chat/sign-in/code", { email, code });
      const signedIn = answer.body.signedIn === true;
      if (answer.ok && isReply(answer.body)) {
        if (signedIn) setStep("done");
        else setProblem(typeof answer.body.error === "string" ? answer.body.error : labels.otherAccount);
        onSignedIn(answer.body);
      } else setProblem(typeof answer.body.error === "string" ? answer.body.error : sorry);
    } catch {
      setProblem(sorry);
    } finally {
      setBusy(false);
    }
  }

  if (step === "done") {
    return (
      <li className="flex justify-center">
        <p className="text-center text-xs text-muted">{labels.done}</p>
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
      {step === "email" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void sendCode(String(new FormData(event.currentTarget).get("email") ?? "").trim());
          }}
          className="flex flex-col gap-2"
          aria-busy={busy || undefined}
        >
          <p>{labels.intro}</p>
          <label className="flex flex-col gap-1">
            <span>{labels.email}</span>
            <input ref={emailRef} name="email" type="email" required autoComplete="email" maxLength={254} className="rounded-lg border border-border bg-background px-3 py-2 text-base" />
          </label>
          {problem && <p role="alert">{problem}</p>}
          <button type="submit" disabled={busy} className="button-primary self-start rounded-button px-3 py-1.5 disabled:opacity-50">
            {labels.sendCode}
          </button>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void signIn(String(new FormData(event.currentTarget).get("code") ?? ""));
          }}
          className="flex flex-col gap-2"
          aria-busy={busy || undefined}
        >
          <p>{labels.codeSent.replace("{email}", email)}</p>
          <label className="flex flex-col gap-1">
            <span>{labels.code}</span>
            <input
              ref={codeRef}
              name="code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              maxLength={7}
              className="rounded-lg border border-border bg-background px-3 py-2 text-base tracking-widest"
            />
          </label>
          {problem && <p role="alert">{problem}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy} className="button-primary rounded-button px-3 py-1.5 disabled:opacity-50">
              {labels.signIn}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setProblem(null);
              }}
              className="underline"
            >
              {labels.otherEmail}
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
