import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { adminText } from "@/lib/admin-text";

import { ActionForm, idle, SubmitButton } from "./action-form";
import { FormWorkContext } from "./form-work";
import { QuietActionForm } from "./quiet-action-form";
import { Field, TextInput } from "./ui";
import { ConfirmButton } from "./ui/confirm-button";

/**
 * The two forms that answer (code review 1.15, D829), as drawn before anything is sent: a form that is not busy, its live region ready and
 * empty, its words from the common catalogue. What they do with an answer (each problem under its field, *Saved* gone on the next edit, the
 * pressed button busy) needs a browser: `e2e/signed-in/forms-answer.spec.ts`.
 */

const html = (node: Parameters<typeof renderToString>[0]) => renderToString(node).replace(/<!-- -->/g, "");
const read = (file: string) => readFileSync(join(__dirname, file), "utf8");

describe("ActionForm", () => {
  it("draws a form that is not busy, with an empty live region after its fields", () => {
    const out = html(h(ActionForm, { action: async () => idle, className: "grid gap-4", children: h("input", { name: "title" }) }));
    expect(out).toMatch(/^<form [^>]*class="grid gap-4"[^>]*aria-busy="false"/);
    expect(out).toContain('<input name="title"/><div role="status" aria-live="polite" class="text-sm"></div></form>');
  });

  it("takes Saved from the common words, in the person's language, and writes no English of its own", () => {
    expect(adminText("en", "common").form.saved).toBe("Saved.");
    expect(adminText("nb", "common").form.saved).toBe("Lagret.");
    for (const file of ["action-form.tsx", "quiet-action-form.tsx", "form-answer.ts"]) expect(read(file)).not.toMatch(/"Saved\.?"/);
  });
});

describe("QuietActionForm", () => {
  it("draws its children in a form that is not busy, with what the page gives the form, and nothing to say yet", () => {
    const out = html(h(QuietActionForm, { action: async () => undefined, className: "inline-flex", "aria-label": "Remove Spring", children: h("button", { type: "submit" }, "Remove") }));
    expect(out).toMatch(/^<form [^>]*aria-busy="false"[^>]*class="inline-flex"[^>]*aria-label="Remove Spring"/);
    expect(out).toContain('<button type="submit">Remove</button></form>');
    expect(out).not.toContain('role="alert"');
  });
});

describe("the buttons of a form that answers, while it works", () => {
  // What `ActionForm` and `QuietActionForm` hand down while their action runs: busy, and what was sent (`useFormStatus` does not see it).
  const working = (data: FormData, child: Parameters<typeof renderToString>[0]) => h(FormWorkContext.Provider, { value: { pending: true, data } }, child);

  it("SubmitButton is disabled and says it is working", () => {
    expect(html(h(SubmitButton, null, "Save"))).toMatch(/^<button type="submit"[^>]*>Save<\/button>$/);
    const out = html(working(new FormData(), h(SubmitButton, null, "Save")));
    expect(out).toMatch(/^<button type="submit"[^>]* disabled=""[^>]*>Working …<\/button>$/);
  });

  it("ConfirmButton is busy only when the form is sending its own name and value", () => {
    const sent = new FormData();
    sent.set("do", "delete");
    const button = (value: string) => h(ConfirmButton, { question: "Delete it?", confirm: "Delete", name: "do", value, busy: "Deleting …" }, "Delete");
    expect(html(working(sent, button("delete")))).toMatch(/disabled="" aria-busy="true"[^>]*>Deleting …<\/button>/);
    expect(html(working(sent, button("archive")))).not.toContain("aria-busy");
  });
});

describe("the kit's Field", () => {
  it("marks its box, so a form puts a refused field's problem at its foot", () => {
    const out = html(h(Field, { label: "Name", children: (control: { id: string }) => h(TextInput, { name: "name", ...control }) }));
    expect(out).toMatch(/^<div data-field="" class="flex min-w-0 flex-col gap-1">/);
  });
});
