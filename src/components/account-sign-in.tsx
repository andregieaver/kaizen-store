"use client";

import { useActionState, useId, useRef, useState, type KeyboardEvent } from "react";

import {
  passwordSignInAction,
  registerAction,
  requestCodeAction,
  requestResetAction,
  resetPasswordAction,
  verifyCodeAction,
  type RegisterState,
  type ResetState,
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

export type ResetLabels = {
  email: string;
  sendCode: string;
  sending: string;
  code: string;
  newCode: string;
  resetIntro: string;
  newPassword: string;
  passwordRule: string;
  saveAndSignIn: string;
  signingIn: string;
};

export type AccessLabels = SignInLabels &
  ResetLabels & {
    tabSignIn: string;
    tabRegister: string;
    registerIntro: string;
    name: string;
    register: string;
    registering: string;
    forgotPassword: string;
    chooseNewPassword: string;
  };

const input = "min-h-11 w-full rounded-md border border-border bg-background px-3";
const button = "min-h-11 button-primary px-5 font-medium disabled:opacity-40";
const link = "self-start text-sm underline";
const hint = "text-sm font-normal text-muted";

type Tab = "sign-in" | "register";
const TABS: Tab[] = ["sign-in", "register"];

/**
 * Signing in to My account and creating one, as two tabs (D28, D32).
 * Signing in is by emailed code, or a password for those who chose one;
 * a forgotten password is replaced with an emailed code.
 */
export function AccountAccess({
  store,
  market,
  labels,
  initialTab = "sign-in",
}: {
  store: string;
  market: string;
  labels: AccessLabels;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const id = useId();
  const tabs = useRef<Record<Tab, HTMLButtonElement | null>>({ "sign-in": null, register: null });

  // Arrow keys move between the tabs, as in any tab list.
  const onKeyDown = (event: KeyboardEvent) => {
    const i = TABS.indexOf(tab);
    const next =
      event.key === "ArrowRight"
        ? TABS[(i + 1) % TABS.length]
        : event.key === "ArrowLeft"
          ? TABS[(i + TABS.length - 1) % TABS.length]
          : event.key === "Home"
            ? TABS[0]
            : event.key === "End"
              ? TABS[TABS.length - 1]
              : null;
    if (!next) return;
    event.preventDefault();
    setTab(next);
    tabs.current[next]?.focus();
  };

  return (
    <div className="flex flex-col gap-6">
      <div
        role="tablist"
        onKeyDown={onKeyDown}
        className="grid grid-cols-2 gap-1 rounded-button bg-surface p-1"
      >
        {TABS.map((value) => (
          <button
            key={value}
            ref={(el) => {
              tabs.current[value] = el;
            }}
            id={`${id}-${value}-tab`}
            type="button"
            role="tab"
            aria-selected={tab === value}
            aria-controls={`${id}-${value}-panel`}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => setTab(value)}
            className={`min-h-11 rounded-button px-4 font-medium transition-colors ${
              tab === value ? "bg-background shadow-sm" : "text-muted hover:text-foreground"
            }`}
          >
            {value === "sign-in" ? labels.tabSignIn : labels.tabRegister}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-${tab}-panel`} aria-labelledby={`${id}-${tab}-tab`}>
        {tab === "sign-in" ? (
          <AccountSignIn store={store} market={market} labels={labels} />
        ) : (
          <Register store={store} market={market} labels={labels} onSignIn={() => setTab("sign-in")} />
        )}
      </div>
    </div>
  );
}

/**
 * Sign in to My account (D28): an emailed six-digit code by default, a
 * password for those who chose one, and a new password by emailed code
 * for those who forgot it. Nothing here says whether an address has an
 * account.
 */
function AccountSignIn({ store, market, labels }: { store: string; market: string; labels: AccessLabels }) {
  const [mode, setMode] = useState<"code" | "password" | "reset">("code");
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

  if (mode === "reset") {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">{labels.chooseNewPassword}</h2>
        <PasswordReset store={store} market={market} labels={labels} />
        <button type="button" onClick={() => setMode("password")} className={link}>
          {labels.usePassword}
        </button>
      </div>
    );
  }

  if (mode === "password") {
    return (
      <div className="flex flex-col gap-4">
        <form action={signIn} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 font-medium">
            {labels.email}
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              defaultValue={passwordState.email || codeState.email}
              className={input}
            />
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
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <button type="button" onClick={() => setMode("reset")} className={link}>
            {labels.forgotPassword}
          </button>
          <button type="button" onClick={() => setMode("code")} className={link}>
            {labels.useCode}
          </button>
        </div>
      </div>
    );
  }

  if (codeState.step === "code") {
    return (
      <div className="flex flex-col gap-4">
        <p role="status">{codeState.message}</p>
        <form action={verify} className="flex flex-col gap-3">
          <CodeInput label={labels.code} />
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

/** Name, email and a password; an email the store knows chooses a new password instead (D32). */
function Register({
  store,
  market,
  labels,
  onSignIn,
}: {
  store: string;
  market: string;
  labels: AccessLabels;
  onSignIn: () => void;
}) {
  const [state, register, registering] = useActionState(registerAction.bind(null, store, market), {
    email: "",
    name: "",
    message: null,
    known: null,
  } satisfies RegisterState);
  const id = useId();

  if (state.known) {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="rounded-md border border-border bg-surface p-4">
          {state.message}
        </p>
        <h2 className="text-lg font-medium">{labels.chooseNewPassword}</h2>
        <PasswordReset store={store} market={market} labels={labels} email={state.email} />
        {state.known === "account" && (
          <button type="button" onClick={onSignIn} className={link}>
            {labels.tabSignIn}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p>{labels.registerIntro}</p>
      <form action={register} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 font-medium">
          {labels.name}
          <input name="name" autoComplete="name" defaultValue={state.name} maxLength={200} className={input} />
        </label>
        <label className="flex flex-col gap-1 font-medium">
          {labels.email}
          <input name="email" type="email" required autoComplete="email" defaultValue={state.email} className={input} />
        </label>
        <NewPassword id={id} label={labels.password} rule={labels.passwordRule} />
        <p role="alert" className="text-sm text-red-700 empty:hidden dark:text-red-400">
          {state.message}
        </p>
        <button type="submit" disabled={registering} className={button}>
          {registering ? labels.registering : labels.register}
        </button>
      </form>
    </div>
  );
}

/**
 * A new password with an emailed code (D32): the code proves the inbox is
 * the shopper's, so every order with the email joins the account.
 */
export function PasswordReset({
  store,
  market,
  labels,
  email: given,
}: {
  store: string;
  market: string;
  labels: ResetLabels;
  /** The email, when already known: only the button to send the code shows. */
  email?: string;
}) {
  const [requestState, request, requesting] = useActionState(requestResetAction.bind(null, store, market), {
    step: "email",
    email: given ?? "",
    message: null,
    error: false,
  } satisfies ResetState);
  const [resetState, reset, resetting] = useActionState(
    async (previous: ResetState, form: FormData) =>
      resetPasswordAction(store, market, { ...previous, email: requestState.email }, form),
    { step: "code", email: "", message: null, error: false } satisfies ResetState,
  );
  const id = useId();

  if (requestState.step === "code") {
    return (
      <div className="flex flex-col gap-4">
        <p role="status">{requestState.message}</p>
        <form action={reset} className="flex flex-col gap-3">
          <CodeInput label={labels.code} />
          <NewPassword id={id} label={labels.newPassword} rule={labels.passwordRule} />
          <Message state={resetState} />
          <button type="submit" disabled={resetting} className={button}>
            {resetting ? labels.signingIn : labels.saveAndSignIn}
          </button>
        </form>
        <form action={request}>
          <input type="hidden" name="email" value={requestState.email} />
          <button type="submit" disabled={requesting} className="text-sm underline">
            {labels.newCode}
          </button>
        </form>
      </div>
    );
  }

  return (
    <form action={request} className="flex flex-col gap-3">
      <p>{labels.resetIntro}</p>
      {given ? (
        <>
          <input type="hidden" name="email" value={given} />
          <p className="font-medium">{given}</p>
        </>
      ) : (
        <label className="flex flex-col gap-1 font-medium">
          {labels.email}
          <input name="email" type="email" required autoComplete="email" defaultValue={requestState.email} className={input} />
        </label>
      )}
      <Message state={requestState} />
      <button type="submit" disabled={requesting} className={button}>
        {requesting ? labels.sending : labels.sendCode}
      </button>
    </form>
  );
}

function NewPassword({ id, label, rule }: { id: string; label: string; rule: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1 font-medium">
        {label}
        <input
          name="password"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          aria-describedby={`${id}-rule`}
          className={input}
        />
      </label>
      <p id={`${id}-rule`} className={hint}>
        {rule}
      </p>
    </div>
  );
}

function CodeInput({ label }: { label: string }) {
  return (
    <label className="flex flex-col gap-1 font-medium">
      {label}
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
  );
}

function Message({ state }: { state: { error: boolean; message: string | null } }) {
  return (
    <p role="alert" className="text-sm text-red-700 empty:hidden dark:text-red-400">
      {state.error ? state.message : null}
    </p>
  );
}
