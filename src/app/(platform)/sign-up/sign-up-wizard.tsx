"use client";

import { useEffect, useEffectEvent, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { SubmitButton } from "@/components/admin/action-form";
import type { PlatformMessages } from "@/lib/platform-text";

/** One step of sign-up: its name in the list of steps, its heading, a line under it and its fields (drawn by the server). */
export type SignUpStep = { id: "store" | "look" | "you"; label: string; title: string; hint?: string; content: ReactNode };

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
/** What the last step repeats: the store's name and the look chosen (null where there was no choice). */
type Recap = { store: string; look: string | null };

/** The main button's look, the header's *Start your store* pill: Kaizena Flow's own pages have none of the admin's colours. */
const PRIMARY =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-foreground px-6 font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-40";

/**
 * Sign-up one step at a time (D456): the store, its look, then the person. Every step's fields stay in the one form, so going back keeps
 * what was typed and the server reads the form as before; only the shown step is drawn. Continue checks the step's fields with the
 * browser's own checks first, and Enter in a field means Continue. A field refused elsewhere, by the browser on sending or by the server
 * (`ActionForm` marks it `aria-invalid`), brings its step back and focuses it. Without scripts every step is shown, one under another,
 * with the send button at the end (`noscript:` in `globals.css`).
 */
export function SignUpWizard({ steps, submitLabel, note, words }: { steps: SignUpStep[]; submitLabel: string; note: ReactNode; words: PlatformMessages["signUp"]["steps"] }) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const headings = useRef<(HTMLHeadingElement | null)[]>([]);
  // `turn` draws again when the same step is asked for, so its focus is still moved.
  const [view, setView] = useState({ step: 0, turn: 0 });
  const [reached, setReached] = useState(0);
  const [recap, setRecap] = useState<Recap | null>(null);
  // Where the focus goes once the step is drawn: a field (and whether to say why the browser refused it), else the step's heading.
  const focus = useRef<{ field: Field | null; report: boolean } | null>(null);
  // While Continue checks fields itself, the `invalid` events that fires are its own.
  const checking = useRef(false);
  const last = steps.length - 1;
  const stepIndex = (stepId: SignUpStep["id"]) => steps.findIndex((step) => step.id === stepId);

  const show = (step: number, field: Field | null = null, report = false) => {
    focus.current = { field, report };
    if (step === last) setRecap(recapOf(root.current?.closest("form") ?? null));
    setReached((furthest) => Math.max(furthest, step));
    setView((now) => ({ step, turn: now.turn + 1 }));
  };

  /** To another step: back freely, forward only past steps whose fields the browser accepts, stopping at the first it refuses. */
  const goTo = (target: number) => {
    checking.current = true;
    try {
      for (let step = view.step; step < target; step += 1) {
        const refused = fieldsOf(root.current, step).find((field) => !field.checkValidity());
        if (!refused) continue;
        if (step === view.step) refused.reportValidity();
        else show(step, refused, true);
        return;
      }
    } finally {
      checking.current = false;
    }
    show(target);
  };

  useEffect(() => {
    const next = focus.current;
    focus.current = null;
    if (!next) return;
    if (next.field) {
      next.field.focus();
      if (next.report) next.field.reportValidity();
      return;
    }
    headings.current[view.step]?.focus({ preventScroll: true });
    if (root.current && root.current.getBoundingClientRect().top < 0) root.current.scrollIntoView({ block: "start" });
  }, [view]);

  // A field the browser refuses on sending, in a step not shown: the browser cannot point at it, so its step is shown and it says why there.
  const refusedOnSend = useEffectEvent((field: Field) => {
    const step = stepOf(field);
    if (step >= 0 && step !== view.step) show(step, field, true);
  });
  // A field the server refused (`aria-invalid`, set by `ActionForm`), the first in the form's order, in a step not shown.
  const refusedByServer = useEffectEvent(() => {
    const field = root.current?.querySelector<Field>('[aria-invalid="true"]');
    const step = stepOf(field ?? null);
    if (field && step >= 0 && step !== view.step) show(step, field);
  });

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    // The browser fires `invalid` on every refused field at once; the first, in the form's order, is the one to show.
    let handled = false;
    const invalid = (event: Event) => {
      if (checking.current || handled || !isField(event.target)) return;
      handled = true;
      queueMicrotask(() => {
        handled = false;
      });
      refusedOnSend(event.target);
    };
    // A chosen look's Preview opens that look: a variant's own preview where one is chosen (`SignUpLooks`), with the look the address chose too.
    const follow = (input: HTMLInputElement) => {
      const link = input.closest("[data-look-card]")?.querySelector<HTMLAnchorElement>("a[data-design-preview]");
      if (link && input.dataset.preview) link.href = input.dataset.preview;
    };
    const change = (event: Event) => {
      if (event.target instanceof HTMLInputElement && event.target.checked && event.target.dataset.preview) follow(event.target);
    };
    element.querySelectorAll<HTMLInputElement>("input[data-preview]:checked").forEach(follow);
    const marks = new MutationObserver(() => refusedByServer());
    element.addEventListener("invalid", invalid, true);
    element.addEventListener("change", change);
    marks.observe(element, { attributes: true, attributeFilter: ["aria-invalid"], subtree: true });
    return () => {
      element.removeEventListener("invalid", invalid, true);
      element.removeEventListener("change", change);
      marks.disconnect();
    };
  }, []);

  // Enter in a field means Continue until the last step, where it sends the form as usual.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing || view.step === last) return;
    if (!(event.target instanceof HTMLInputElement) || stepOf(event.target) !== view.step) return;
    event.preventDefault();
    goTo(view.step + 1);
  };

  const storeStep = stepIndex("store");
  const lookStep = stepIndex("look");
  return (
    <div ref={root} onKeyDown={onKeyDown} className="flex scroll-mt-24 flex-col gap-8">
      <ol aria-label={words.list} className="flex items-center gap-2 noscript:hidden">
        {steps.map((step, i) => {
          const here = i === view.step;
          const done = i < view.step;
          const dot = (
            <span
              aria-hidden="true"
              className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${here || done ? "bg-foreground text-background" : "border border-border text-muted"}`}
            >
              {done ? <CheckIcon /> : i + 1}
            </span>
          );
          const name = (
            <span className={here ? "font-medium" : "sr-only text-muted sm:not-sr-only"}>
              {step.label}
              {done && <span className="sr-only"> {words.done}</span>}
            </span>
          );
          return (
            <li key={step.id} className={`flex items-center gap-2 ${i < last ? "flex-1" : ""}`}>
              {here || i > reached ? (
                <span aria-current={here ? "step" : undefined} className="flex min-h-11 items-center gap-2 text-sm">
                  {dot}
                  {name}
                </span>
              ) : (
                <button type="button" onClick={() => goTo(i)} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full pr-2 text-sm underline-offset-4 hover:underline">
                  {dot}
                  {name}
                </button>
              )}
              {i < last && <span aria-hidden="true" className={`h-px min-w-3 flex-1 ${done ? "bg-foreground" : "bg-border"}`} />}
            </li>
          );
        })}
      </ol>
      {steps.map((step, i) => {
        const here = i === view.step;
        return (
          <section
            key={step.id}
            data-step={i}
            aria-labelledby={`${id}-${step.id}`}
            className={`${here ? "flex" : "hidden noscript:flex"} flex-col gap-6`}
          >
            <header className="flex flex-col gap-1.5">
              <p className="text-sm font-medium text-muted">{words.stepOf.replace("{n}", String(i + 1)).replace("{total}", String(steps.length))}</p>
              <h2
                id={`${id}-${step.id}`}
                ref={(heading) => {
                  headings.current[i] = heading;
                }}
                tabIndex={-1}
                className="text-2xl font-semibold tracking-tight outline-none"
              >
                {step.title}
              </h2>
              {step.hint && <p className="text-muted">{step.hint}</p>}
            </header>
            {i === last && recap && (recap.store || recap.look) && (
              <dl className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 rounded-xl bg-surface px-4 py-2 text-sm noscript:hidden">
                {recap.store && storeStep >= 0 && (
                  <RecapRow term={words.recapStore} value={recap.store} change={words.change} onChange={() => goTo(storeStep)} />
                )}
                {recap.look && lookStep >= 0 && <RecapRow term={words.recapLook} value={recap.look} change={words.change} onChange={() => goTo(lookStep)} />}
              </dl>
            )}
            {step.content}
            <div className={`flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-border pt-6 ${i < last ? "noscript:hidden" : ""}`}>
              {i > 0 && (
                <button
                  type="button"
                  onClick={() => goTo(i - 1)}
                  className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full pr-2 font-medium underline-offset-4 hover:underline noscript:hidden"
                >
                  <ArrowIcon back />
                  {words.back}
                </button>
              )}
              {i < last ? (
                <button type="button" onClick={() => goTo(i + 1)} className={`${PRIMARY} ml-auto cursor-pointer`}>
                  {words.next}
                  <ArrowIcon />
                </button>
              ) : (
                <span className="ml-auto">
                  <SubmitButton className={PRIMARY}>{submitLabel}</SubmitButton>
                </span>
              )}
            </div>
            {i === last && note}
          </section>
        );
      })}
    </div>
  );
}

/** One line of the last step's summary: what was chosen, and a way back to its step. */
function RecapRow({ term, value, change, onChange }: { term: string; value: string; change: string; onChange: () => void }) {
  return (
    <>
      <dt className="text-muted">{term}</dt>
      <dd className="truncate font-medium">{value}</dd>
      <dd>
        <button type="button" onClick={onChange} className="min-h-10 cursor-pointer underline underline-offset-4">
          {change}
          <span className="sr-only"> {term}</span>
        </button>
      </dd>
    </>
  );
}

/** The fields of a step, in the form's order. */
function fieldsOf(root: HTMLElement | null, step: number): Field[] {
  return [...(root?.querySelectorAll<Field>(`[data-step="${step}"] :is(input, textarea, select)`) ?? [])];
}

/** The step an element is in (its section's `data-step`), -1 outside the steps. */
function stepOf(element: Element | null): number {
  const section = element?.closest<HTMLElement>("[data-step]");
  return section ? Number(section.dataset.step) : -1;
}

function isField(target: EventTarget | null): target is Field {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

/** The store's name and the chosen look's name, read from the form as it is now. */
function recapOf(form: HTMLFormElement | null): Recap {
  const store = form?.elements.namedItem("storeName");
  const look = form?.querySelector<HTMLInputElement>('input[name="design"]:checked');
  return { store: store instanceof HTMLInputElement ? store.value.trim() : "", look: look?.dataset.label ?? null };
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowIcon({ back = false }: { back?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={`size-4 ${back ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
