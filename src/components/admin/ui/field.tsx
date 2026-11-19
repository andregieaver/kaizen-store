import { useId, type ComponentProps, type ReactNode } from "react";

/**
 * A form's fields (code review step 1.12, D818): `Field` is a label, the control, a hint under it and the problem under that, tied to the
 * control for a screen reader (`aria-describedby`, `aria-invalid`); `TextInput`, `Select` and `TextArea` are the control's box, the class
 * string pages wrote out by hand (`min-h-10 rounded-md border border-line bg-card px-3`). None holds state, so a server page and a client
 * part both draw them; the admin's one focus ring comes from `admin.css`. A box written out by hand is counted by the ratchet
 * (`adminFiles.rawFields`, `src/server/ratchet.scan.test.ts`), so a new screen uses these.
 */

export type FieldLook = {
  /** 36 px and narrower padding, for a table row or a toolbar; 40 px otherwise. */
  dense?: boolean;
  /** As wide as its box. */
  full?: boolean;
};

const BOX = "rounded-md border border-line bg-card text-sm font-normal aria-invalid:border-danger-text";

/** The classes of a field's box: a text input or a select. */
export function fieldClass({ dense = false, full = false }: FieldLook = {}): string {
  return [dense ? "min-h-9 px-2" : "min-h-10 px-3", full ? "w-full" : "", BOX].filter(Boolean).join(" ");
}

const join = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(" ");

/** A line of text: an `input` in the field's box (any `type` but a checkbox or radio). */
export function TextInput({ dense, full, className, ...rest }: ComponentProps<"input"> & FieldLook) {
  return <input className={join(fieldClass({ dense, full }), className)} {...rest} />;
}

/** A choice from a list: a native `select` in the field's box, its `option`s as children. */
export function Select({ dense, full, className, children, ...rest }: ComponentProps<"select"> & FieldLook) {
  return (
    <select className={join(fieldClass({ dense, full }), className)} {...rest}>
      {children}
    </select>
  );
}

type TextAreaProps = ComponentProps<"textarea"> & { full?: boolean };

/** Several lines of text, in the field's box. */
export function TextArea({ full, className, ...rest }: TextAreaProps) {
  return <textarea className={join("px-3 py-2", full && "w-full", BOX, className)} {...rest} />;
}

/** What a control needs to be its field's: its id (the label's `for`), and the hint and problem read with it. */
export type FieldControl = { id: string; required?: true; "aria-invalid"?: true; "aria-describedby"?: string };

/**
 * A labelled field. `children` draws the control with the props it must carry (`{(control) => <TextInput name="email" {...control} />}`),
 * so the label is really its label and the problem is read with it; a control drawn another way takes `id` and is passed as it is.
 * `required` marks the label and makes the control required; `problem` is what is wrong with what was typed, shown under the field.
 * Inside `ActionForm` or `QuietActionForm` a refusal's problem for the control's `name` is put at the foot of this box by the form itself
 * (`data-field`, code review step 1.15, D829), so a server page's field needs no state to show it.
 */
export function Field({
  label,
  hint,
  problem,
  required = false,
  id: given,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  problem?: ReactNode;
  required?: boolean;
  /** The control's id, where the page needs to know it; one is made otherwise. */
  id?: string;
  className?: string;
  children: ReactNode | ((control: FieldControl) => ReactNode);
}) {
  const made = useId();
  const id = given ?? made;
  const hintId = hint ? `${id}-hint` : null;
  const problemId = problem ? `${id}-problem` : null;
  const describedBy = [hintId, problemId].filter(Boolean).join(" ");
  const control: FieldControl = {
    id,
    ...(required ? { required: true as const } : {}),
    ...(problem ? { "aria-invalid": true as const } : {}),
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
  };
  return (
    <div data-field="" className={join("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required && (
          <span aria-hidden className="text-danger-text">
            {" *"}
          </span>
        )}
      </label>
      {typeof children === "function" ? children(control) : children}
      {hintId && (
        <p id={hintId} className="text-xs font-normal text-muted">
          {hint}
        </p>
      )}
      {problemId && (
        <p id={problemId} className="text-sm text-danger-text">
          {problem}
        </p>
      )}
    </div>
  );
}
