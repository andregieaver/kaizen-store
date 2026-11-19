"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { problemId, type FormAnswer } from "@/lib/form-problems";

/**
 * What `ActionForm` and `QuietActionForm` share to answer a submission where it was made (code review step 1.15, D829). The form owns the
 * DOM it draws, so a refusal's problems are put there, under their fields, whoever drew the field: a server page's `Field`, a raw label
 * or a client part. Only the two forms import this.
 */

/** A problem's look under its field: `Field`'s own (`ui/field.tsx`), in roles a public page's form also has (`text-danger-text`). */
const PROBLEM_CLASS = "text-sm text-danger-text";

/** Where a field's message goes: at the foot of the kit's `Field` (after its hint), after a group's fieldset, or after the field's label or the field. */
function anchorOf(controls: HTMLElement[], form: HTMLFormElement): { parent: Element; before: Node | null } | null {
  const [first] = controls;
  const box = first.closest("[data-field]");
  if (box && form.contains(box)) return { parent: box, before: null };
  // A group of radios or boxes sharing the name: under the group as a whole.
  const group = controls.length > 1 ? first.closest("fieldset") : null;
  if (group && form.contains(group)) return { parent: group, before: null };
  const last = controls[controls.length - 1];
  const label = last.closest("label");
  // A message inside the label would become part of the field's name: it goes after the label.
  let after: Element = label && form.contains(label) ? label : last;
  // And after the field's own hint, which stays next to it: a line its `aria-describedby` names.
  const hints = new Set((last.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean));
  while (after.nextElementSibling && hints.has(after.nextElementSibling.id)) after = after.nextElementSibling;
  return after.parentElement ? { parent: after.parentElement, before: after.nextSibling } : null;
}

/** The fields a refusal names, by name: every element of that name the form holds, hidden inputs aside. */
function controlsOf(form: HTMLFormElement, name: string): HTMLElement[] {
  return [...form.querySelectorAll<HTMLElement>(`[name="${CSS.escape(name)}"]`)].filter((element) => element.getAttribute("type") !== "hidden");
}

/** Brings a field and its message into view, unless both already are, and moves the focus to the field. */
function reveal(control: HTMLElement, line: HTMLElement) {
  const top = control.getBoundingClientRect().top;
  const bottom = line.getBoundingClientRect().bottom;
  if (top < 0 || bottom > window.innerHeight) control.scrollIntoView({ block: "center" });
  control.focus({ preventScroll: true });
}

const NONE: ReadonlySet<string> = new Set();

/**
 * Shows a refusal's problems where they belong: each problem that names a field (`fields`) right under that field, the field marked
 * `aria-invalid` and described by it (its hint kept), the first of them in the page's order scrolled into view and focused; a refusal with
 * no field it can place scrolls the form's list (`list`) into view instead. Everything it adds is taken away again on the next answer.
 * Returns what the list at the form's foot shows: the problems that name no field, and those whose field the form does not hold.
 */
export function useProblemsAtFields(form: RefObject<HTMLFormElement | null>, list: RefObject<HTMLElement | null>, answer: FormAnswer, formKey: string): string[] {
  const [missed, setMissed] = useState<{ answer: FormAnswer; messages: ReadonlySet<string> } | null>(null);
  useLayoutEffect(() => {
    const root = form.current;
    if (!root || answer.status !== "error") return;
    const undo: (() => void)[] = [];
    const shown: { control: HTMLElement; line: HTMLElement }[] = [];
    const lost = new Set<string>();
    for (const [name, message] of Object.entries(answer.fields ?? {})) {
      const controls = controlsOf(root, name);
      const anchor = controls.length > 0 ? anchorOf(controls, root) : null;
      if (!anchor) {
        lost.add(message);
        continue;
      }
      const id = problemId(formKey, name);
      for (const control of controls) {
        const invalid = control.getAttribute("aria-invalid");
        const described = control.getAttribute("aria-describedby");
        control.setAttribute("aria-invalid", "true");
        control.setAttribute("aria-describedby", [...new Set([...(described ?? "").split(/\s+/).filter(Boolean), id])].join(" "));
        undo.push(() => {
          if (invalid === null) control.removeAttribute("aria-invalid");
          else control.setAttribute("aria-invalid", invalid);
          if (described === null) control.removeAttribute("aria-describedby");
          else control.setAttribute("aria-describedby", described);
        });
      }
      const line = document.createElement("p");
      line.id = id;
      line.className = PROBLEM_CLASS;
      line.dataset.problem = name;
      line.textContent = message;
      anchor.parent.insertBefore(line, anchor.before);
      undo.push(() => line.remove());
      shown.push({ control: controls[0], line });
    }
    const first = shown.sort((a, b) => (a.control.compareDocumentPosition(b.control) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))[0];
    if (first) reveal(first.control, first.line);
    else if (answer.messages.length > 0) list.current?.scrollIntoView({ block: "nearest" });
    // Which fields the form holds is known only from the DOM it committed; the list redraws before the paint, and only when one is missing.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (lost.size > 0) setMissed({ answer, messages: lost });
    return () => {
      for (const step of undo.reverse()) step();
    };
  }, [form, list, answer, formKey]);
  if (answer.status !== "error") return [];
  const tied = new Set(Object.values(answer.fields ?? {}));
  const lost = missed?.answer === answer ? missed.messages : NONE;
  return answer.messages.filter((message) => !tied.has(message) || lost.has(message));
}

/**
 * Marks the button that sent the form `data-submitting` while the form works, so the admin's stylesheet spins that one (`admin.css`): a
 * server page's button reads no form state of its own. Call `mark` with the submit event's submitter.
 */
export function useSubmitterMark(pending: boolean): (submitter: Element | null | undefined) => void {
  const pressed = useRef<Element | null>(null);
  useEffect(() => {
    if (pending) return;
    pressed.current?.removeAttribute("data-submitting");
    pressed.current = null;
  }, [pending]);
  return (submitter) => {
    pressed.current?.removeAttribute("data-submitting");
    pressed.current = submitter ?? null;
    pressed.current?.setAttribute("data-submitting", "");
  };
}

/**
 * Whether the person has changed the form since `answer` came: the first `input` or `change` after a success takes *Saved* away, so it never
 * stands beside edits it did not save. Spread `listen` on the form.
 */
export function useEditedSince(answer: FormAnswer): { edited: boolean; listen: { onInput: () => void; onChange: () => void } } {
  const [editedAfter, setEditedAfter] = useState<FormAnswer | null>(null);
  const edit = () => {
    if (answer.status === "ok" && editedAfter !== answer) setEditedAfter(answer);
  };
  return { edited: editedAfter === answer, listen: { onInput: edit, onChange: edit } };
}
