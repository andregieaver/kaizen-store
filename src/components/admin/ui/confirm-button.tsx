"use client";

import { lazy, Suspense, useRef, useState, useTransition, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal, useFormStatus } from "react-dom";

import { buttonClass, type ButtonKind, type ButtonSize } from "./button";

/**
 * A button that asks first (code review step 1.12, D818; the admin usability audit's H3/H5 row): pressed, it opens the admin's dialog
 * (`Modal`) with the action's own words: what happens (`question`, its first sentence the dialog's title), the confirm word (`confirm`)
 * and *Cancel* (where focus starts, and what Escape and the backdrop do). On yes it runs `action`, or, without one, submits the form it is
 * in as its submitter (its `name`, `value` and `formAction` go with it), so it is a form's delete button and a row's own button alike.
 * Never `window.confirm` (the ratchet counts the files that call it, `adminRepeats.confirmFiles`). The dialog's code, its words among it
 * (`common.form.cancel`), loads on the first hover, focus or press, so no screen's first scripts carry them: this module reads no
 * catalogue, as it is a client reference of every route whose server code reaches the kit's index, the storefront's included. Without a
 * script a submit button submits, as a plain one does.
 */

type ConfirmDialog = typeof import("./confirm-dialog");
const loadDialog = (): Promise<ConfirmDialog> => import("./confirm-dialog");
const Dialog = lazy(loadDialog);

/** A question split for the dialog: its first sentence the title, the rest under it ("Remove Hook? Nothing more is sent to it."). */
export function splitQuestion(question: string): { title: string; detail: string } {
  const at = question.search(/[?!](\s|$)/);
  if (at === -1 || at === question.length - 1) return { title: question.trim(), detail: "" };
  return { title: question.slice(0, at + 1).trim(), detail: question.slice(at + 1).trim() };
}

/** What a refused action said, from the shapes the admin's actions answer with (`{ ok: false, problems }`, `{ ok: false, problem }`, `{ ok: false, message }`). */
export function refusalOf(result: unknown): string | null {
  if (!result || typeof result !== "object" || !("ok" in result) || result.ok !== false) return null;
  const answer = result as { problems?: unknown; problem?: unknown; message?: unknown };
  if (Array.isArray(answer.problems) && answer.problems.length > 0) return answer.problems.join(" ");
  if (typeof answer.problem === "string") return answer.problem;
  if (typeof answer.message === "string") return answer.message;
  return null;
}

export type ConfirmButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "type" | "children"> & {
  /** What happens, as a question in the action's own words ("Delete SUMMER10? Orders that used it keep their discount."). */
  question: string;
  /** More under the question in the dialog: a list of what goes with it. */
  more?: ReactNode;
  /** The confirm button's word ("Delete"). */
  confirm: string;
  /** The confirm button as `danger` (the default: deleting, ending, refusing) or as the `main` action. */
  danger?: boolean;
  /** The way back's word where *Cancel* would be read as the action's own ("Keep the order" beside *Cancel order*). */
  cancel?: string;
  /** Ask only when it matters: false submits (or runs the action) at once, as a plain button (a refund recorded, not sent). */
  ask?: boolean;
  /** Run on yes; a refusal it answers (`{ ok: false, problems }`) is shown under the button. Without it, the form is submitted. */
  action?: () => unknown;
  /** The button's look: a kit kind, or `none` for the classes in `className` alone. */
  kind?: ButtonKind | "none";
  size?: ButtonSize;
  full?: boolean;
  icon?: ReactNode;
  /** What the button says while it works ("Deleting …"); its own words otherwise, disabled and `aria-busy`. */
  busy?: ReactNode;
  children?: ReactNode;
};

export function ConfirmButton({
  question,
  more,
  confirm,
  danger = true,
  cancel,
  ask = true,
  action,
  kind = "secondary",
  size = "card",
  full = false,
  icon,
  busy,
  className,
  children,
  disabled,
  ...rest
}: ConfirmButtonProps) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [running, start] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);
  const status = useFormStatus();
  // The form is working on this button's submission (its own action, or its name and value), not another button's.
  const submitting =
    !action &&
    status.pending &&
    (rest.formAction ? status.action === rest.formAction : rest.name ? status.data?.get(rest.name) === String(rest.value ?? "") : true);
  const working = running || submitting;
  const classes = kind === "none" ? className : [buttonClass(kind, size, full), className].filter(Boolean).join(" ");
  const warm = () => void loadDialog().catch(() => undefined);

  const run = (act: () => unknown) => start(async () => setRefusal(refusalOf(await act())));
  const yes = () => {
    setOpen(false);
    setRefusal(null);
    if (action) {
      run(action);
      return;
    }
    const self = button.current;
    self?.form?.requestSubmit(self);
  };

  return (
    <>
      <button
        {...rest}
        ref={button}
        type={action ? "button" : "submit"}
        className={classes}
        disabled={disabled || working}
        aria-busy={working || undefined}
        aria-haspopup={ask ? "dialog" : undefined}
        onPointerEnter={ask ? warm : undefined}
        onFocus={ask ? warm : undefined}
        onClick={(event) => {
          if (!ask) {
            // As a plain button: a submit button submits by itself; an action runs now.
            if (action) run(action);
            return;
          }
          event.preventDefault();
          warm();
          setOpen(true);
        }}
      >
        {kind !== "icon" && icon}
        {kind === "icon" ? icon : working ? (busy ?? children) : children}
      </button>
      {refusal && (
        <span role="alert" className="text-sm text-danger-text">
          {refusal}
        </span>
      )}
      {open &&
        createPortal(
          <Suspense fallback={null}>
            <Dialog {...splitQuestion(question)} more={more} confirm={confirm} cancel={cancel} danger={danger} onCancel={() => setOpen(false)} onConfirm={yes} />
          </Suspense>,
          document.body,
        )}
    </>
  );
}
