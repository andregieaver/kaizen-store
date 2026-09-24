"use client";

import { useActionState, useState } from "react";

import {
  passwordSignInAction,
  requestCodeAction,
  verifyCodeAction,
  type SignInState,
} from "@/app/s/[store]/[market]/account/actions";

export type SignInLabels = {
  intro: string;
  email: string;
  sendCode: string;
  sending: string;
  code: string;
  signIn: string;
  signingIn: string;
  newCode: string;
  otherEmail: string;
  usePassword: string;
  useCode: string;
  password: string;
};

const input = "min-h-11 w-full rounded-md border border-border bg-background px-3";
const button = "min-h-11 rounded-full bg-foreground px-5 font-medium text-background disabled:opacity-40";
const link = "self-start text-sm underline";

/**
 * Sign in to My account (D28): an emailed six-digit code by default, a
 * password for those who chose one. Nothing here says whether an address
 * has an account.
 */
export function AccountSignIn({ store, market, labels }: { store: string; market: string; labels: SignInLabels }) {
  const [mode, setMode] = useState<"code" | "password">("code");
  const [codeState, requestCode, requesting] = useActionState(requestCodeAction.bind(null, store, market), {
    step: "email",
    email: "",
    message: null,
    error: false,
  } satisfies SignInState);
  const [verifyState, verify, verifying] = useActionState(
    async (previous: SignInState, form: FormData) => verifyCodeAction(store, market, { ...previous, email: codeState.email }, form),
    { step: "code", email: "", message: null, error: false } satisfies SignInState,
  );
  const [passwordState, signIn, signingIn] = useActionState(passwordSignInAction.bind(null, store, market), {
    step: "password",
    email: "",
    message: null,
    error: false,
  } satisfies SignInState);

  if (mode === "password") {
    return (
      <div className="flex flex-col gap-4">
        <form action={signIn} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 font-medium">
            {labels.email}
            <input name="email" type="email" required autoComplete="email" defaultValue={passwordState.email || codeState.email} className={input} />
          </label>
          <label className="flex flex-col gap-1 font-medium">
            {labels.password}
            <input name="password" type="password" required autoComplete="current-password" className={input} />
          </label>
          <Message state={passwordState} />
          <button type="submit" disabled={signingIn} className={button}>
            {signingIn ? labels.signingIn : labels.signIn}
          </button>
        </form>
        <button type="button" onClick={() => setMode("code")} className={link}>
          {labels.useCode}
        </button>
      </div>
    );
  }

  if (codeState.step === "code") {
    return (
      <div className="flex flex-col gap-4">
        <p role="status">{codeState.message}</p>
        <form action={verify} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 font-medium">
            {labels.code}
            <input
              name="code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              maxLength={7}
              className={`${input} max-w-40 font-mono text-xl tracking-widest`}
            />
          </label>
          <Message state={verifyState} />
          <button type="submit" disabled={verifying} className={button}>
            {verifying ? labels.signingIn : labels.signIn}
          </button>
        </form>
        <form action={requestCode} className="flex flex-wrap gap-4">
          <input type="hidden" name="email" value={codeState.email} />
          <button type="submit" disabled={requesting} className="text-sm underline">
            {labels.newCode}
          </button>
          <button type="button" onClick={() => location.reload()} className="text-sm underline">
            {labels.otherEmail}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p>{labels.intro}</p>
      <form action={requestCode} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 font-medium">
          {labels.email}
          <input name="email" type="email" required autoComplete="email" defaultValue={codeState.email} className={input} />
        </label>
        <Message state={codeState} />
        <button type="submit" disabled={requesting} className={button}>
          {requesting ? labels.sending : labels.sendCode}
        </button>
      </form>
      <button type="button" onClick={() => setMode("password")} className={link}>
        {labels.usePassword}
      </button>
    </div>
  );
}

function Message({ state }: { state: SignInState }) {
  return (
    <p role="alert" className="text-sm text-red-700 empty:hidden dark:text-red-400">
      {state.error ? state.message : null}
    </p>
  );
}
