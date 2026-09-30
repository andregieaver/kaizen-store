"use client";

import { useRouter } from "next/navigation";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";

import { copyProgressPath } from "@/lib/store-copy-paths";
import type { CopyChoices, StoreCopyActions } from "@/lib/store-copy";
import { suggestSlug } from "@/lib/slug";
import {
  COPY_KINDS,
  KIND_WORDS,
  LIST_STEP,
  NEVER_COPIED,
  STATE_LABELS,
  addIds,
  buildInput,
  clearIds,
  filterRows,
  initialWizard,
  needsDataConfirmation,
  selectedLine,
  setMode,
  statusLabel,
  summarySentence,
  toggleId,
  wizardProblems,
  type CopyKind,
  type CopyMode,
  type WizardProblem,
  type WizardState,
} from "@/lib/store-copy-wizard";

const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";
const errorText = "text-sm text-red-700 dark:text-red-400";
const button = "min-h-10 rounded-md border border-border bg-background px-3 text-sm disabled:opacity-40";

/** Where a problem sends the person: the field that has to change. */
const fieldId = (problem: WizardProblem): string => {
  switch (problem.field) {
    case "name":
      return "copy-name";
    case "slug":
      return "copy-slug";
    case "confirmDataUse":
      return "copy-confirm";
    default:
      return `copy-${problem.field}-search`;
  }
};

type Row = { id: string; title: string; secondary: string; badge: string; image: string | null };

/** The light rows of each list, as the checklist draws them. */
function rowsOf(choices: CopyChoices, kind: CopyKind): Row[] {
  if (kind === "products") {
    return choices.products.map((p) => ({
      id: p.id,
      title: p.title,
      secondary: p.handle,
      badge: statusLabel(p.status),
      image: p.image,
    }));
  }
  return choices[kind].map((p) => ({
    id: p.id,
    title: p.title,
    secondary: `/${p.slug}`,
    badge: STATE_LABELS[p.state],
    image: null,
  }));
}

const rowText = (row: Row) => `${row.title} ${row.secondary} ${row.badge}`;

const ChecklistRow = memo(function ChecklistRow({
  row,
  checked,
  thumbnail,
  onToggle,
}: {
  row: Row;
  checked: boolean;
  thumbnail: boolean;
  onToggle: (id: string, on: boolean) => void;
}) {
  return (
    <li>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-1.5 hover:bg-foreground/5">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onToggle(row.id, event.target.checked)}
          className="size-4 shrink-0"
        />
        {thumbnail &&
          (row.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- a small admin thumbnail
            <img src={row.image} alt="" loading="lazy" className="size-10 shrink-0 rounded object-cover" />
          ) : (
            <span aria-hidden className="size-10 shrink-0 rounded bg-foreground/10" />
          ))}
        <span className="flex min-w-0 flex-1 flex-col text-sm">
          <span className="truncate font-medium">{row.title}</span>
          <span className="truncate text-muted">{row.secondary}</span>
        </span>
        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted">{row.badge}</span>
      </label>
    </li>
  );
});

/** The searchable, scrollable list one kind is ticked from. Long lists show a hundred rows at a time. */
function Checklist({
  kind,
  rows,
  picked,
  update,
  invalid,
  errorId,
}: {
  kind: CopyKind;
  rows: Row[];
  picked: string[];
  update: (change: (state: WizardState) => WizardState) => void;
  invalid: boolean;
  errorId: string;
}) {
  const words = KIND_WORDS[kind];
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(LIST_STEP);
  const shown = useMemo(() => filterRows(rows, query, rowText), [rows, query]);
  const ticked = useMemo(() => new Set(picked), [picked]);
  const onToggle = useCallback(
    (id: string, on: boolean) => update((state) => toggleId(state, kind, id, on)),
    [update, kind],
  );
  const visible = shown.slice(0, limit);
  const thumbnails = kind === "products";
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-md border border-border p-3">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Search {words.many}
        <input
          id={`copy-${kind}-search`}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(LIST_STEP);
          }}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          className={control}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={button}
          disabled={shown.length === 0}
          onClick={() =>
            update((state) =>
              addIds(
                state,
                kind,
                shown.map((row) => row.id),
              ),
            )
          }
        >
          Select all shown ({shown.length.toLocaleString("en")})
        </button>
        <button
          type="button"
          className={button}
          disabled={picked.length === 0}
          onClick={() => update((state) => clearIds(state, kind))}
        >
          Clear
        </button>
        <p role="status" aria-live="polite" className="text-sm text-muted">
          {selectedLine(ticked.size, rows.length)}
        </p>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">No {words.many} match the search.</p>
      ) : (
        <div
          role="group"
          aria-label={`${words.title} to copy`}
          className="max-h-80 overflow-y-auto rounded-md border border-border"
        >
          <ul className="divide-y divide-border">
            {visible.map((row) => (
              <ChecklistRow
                key={row.id}
                row={row}
                checked={ticked.has(row.id)}
                thumbnail={thumbnails}
                onToggle={onToggle}
              />
            ))}
          </ul>
          {shown.length > visible.length && (
            <div className="border-t border-border p-2">
              <button type="button" className={button} onClick={() => setLimit((n) => n + LIST_STEP)}>
                Show {Math.min(LIST_STEP, shown.length - visible.length).toLocaleString("en")} more (
                {(shown.length - visible.length).toLocaleString("en")} left)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const MODE_LABELS: { mode: CopyMode; label: string }[] = [
  { mode: "all", label: "All" },
  { mode: "selected", label: "Selected" },
  { mode: "none", label: "None" },
];

/** All, Selected or None for one kind, with the checklist under Selected. */
function KindChoice({
  kind,
  choices,
  state,
  update,
  problem,
  hint,
}: {
  kind: CopyKind;
  choices: CopyChoices;
  state: WizardState;
  update: (change: (state: WizardState) => WizardState) => void;
  problem: WizardProblem | undefined;
  hint: string;
}) {
  const words = KIND_WORDS[kind];
  const rows = useMemo(() => rowsOf(choices, kind), [choices, kind]);
  const mode = state.options[kind].mode;
  const errorId = `copy-${kind}-error`;
  return (
    <fieldset className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-background p-5">
      <legend className="px-1 text-base font-medium">{words.title}</legend>
      <p className="text-sm text-muted">{hint}</p>
      {rows.length === 0 ? (
        <p className="text-sm">This store has no {words.many} to copy.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {MODE_LABELS.map(({ mode: value, label }) => (
              <label key={value} className="flex min-h-10 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`copy-${kind}-mode`}
                  value={value}
                  checked={mode === value}
                  onChange={() => update((current) => setMode(current, kind, value))}
                  className="size-4"
                />
                {label}
                {value === "all" && <span className="text-muted">({rows.length.toLocaleString("en")})</span>}
              </label>
            ))}
          </div>
          {mode === "selected" && (
            <Checklist
              kind={kind}
              rows={rows}
              picked={state.picked[kind]}
              update={update}
              invalid={Boolean(problem)}
              errorId={errorId}
            />
          )}
          {problem && (
            <p id={errorId} className={errorText}>
              {problem.message}
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}

/** A collapsed list of what is or is not copied. */
function Details({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="rounded-lg border border-border bg-background p-4 text-sm">
      <summary className="cursor-pointer font-medium">{summary}</summary>
      <div className="mt-3 flex flex-col gap-2">{children}</div>
    </details>
  );
}

/**
 * The wizard for duplicating a store (D129): one screen, sections in the order a person decides them. Everything
 * chosen is kept here and sent as one input; the server checks it all again. `initial` and `initialMessages` only
 * let the tests draw other states.
 */
export function StoreCopyWizard({
  choices,
  start,
  initial,
  initialMessages,
}: {
  choices: CopyChoices;
  start: StoreCopyActions["start"];
  initial?: WizardState;
  initialMessages?: string[];
}) {
  const router = useRouter();
  const [state, setState] = useState<WizardState>(() => initial ?? initialWizard(choices.source.name));
  const [showErrors, setShowErrors] = useState(Boolean(initialMessages?.length));
  const [messages, setMessages] = useState<string[]>(initialMessages ?? []);
  const [pending, startPending] = useTransition();
  const [sent, setSent] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const reasonId = useId();
  const update = useCallback((change: (state: WizardState) => WizardState) => setState(change), []);

  const problems = wizardProblems(state);
  const blocked = problems.length > 0;
  const busy = pending || sent;
  const problemFor = (field: WizardProblem["field"]) =>
    showErrors ? problems.find((p) => p.field === field) : undefined;
  const { options } = state;
  const sentence = summarySentence(state, choices);
  const slugHint = suggestSlug(state.name);

  useEffect(() => {
    if (messages.length > 0) alertRef.current?.focus();
  }, [messages]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (blocked) {
      setShowErrors(true);
      setMessages([]);
      document.getElementById(fieldId(problems[0]))?.focus();
      return;
    }
    setMessages([]);
    startPending(async () => {
      try {
        const result = await start(buildInput(choices.source.slug, state));
        if (result.ok) {
          setSent(true);
          router.push(copyProgressPath(result.id));
        } else setMessages(result.problems.length > 0 ? result.problems : ["The copy could not be started."]);
      } catch {
        setMessages(["The copy could not be started. Try again in a moment."]);
      }
    });
  };

  const nameProblem = problemFor("name");
  const slugProblem = problemFor("slug");
  const confirmProblem = problemFor("confirmDataUse");

  return (
    <form onSubmit={submit} noValidate aria-busy={busy} className="flex max-w-3xl flex-col gap-5">
      {(messages.length > 0 || (showErrors && blocked)) && (
        <div
          ref={alertRef}
          role="alert"
          tabIndex={-1}
          className="rounded-lg border border-red-700 p-4 text-sm text-red-700 dark:border-red-400 dark:text-red-400"
        >
          <p className="font-medium">
            {messages.length > 0 ? "The copy was not started." : "Some choices need another look."}
          </p>
          <ul className="list-disc pl-5">
            {(messages.length > 0 ? messages : problems.map((p) => p.message)).map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      <fieldset className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-background p-5">
        <legend className="px-1 text-base font-medium">The new store</legend>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Store name
          <input
            id="copy-name"
            name="name"
            value={state.name}
            onChange={(event) => update((s) => ({ ...s, name: event.target.value }))}
            required
            aria-required
            maxLength={80}
            aria-invalid={nameProblem ? true : undefined}
            aria-describedby={nameProblem ? "copy-name-error" : undefined}
            className={control}
          />
        </label>
        {nameProblem && (
          <p id="copy-name-error" className={errorText}>
            {nameProblem.message}
          </p>
        )}
        <label className="flex flex-col gap-1 text-sm font-medium">
          Store address
          <span className="flex items-center gap-1">
            <span className="text-muted" aria-hidden>
              /s/
            </span>
            <input
              id="copy-slug"
              name="slug"
              value={state.slug}
              onChange={(event) => update((s) => ({ ...s, slug: event.target.value }))}
              placeholder={slugHint}
              pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]"
              aria-invalid={slugProblem ? true : undefined}
              aria-describedby={slugProblem ? "copy-slug-hint copy-slug-error" : "copy-slug-hint"}
              className={`${control} flex-1`}
            />
          </span>
          <span id="copy-slug-hint" className="font-normal text-muted">
            Lowercase letters, numbers and hyphens. Leave empty to make one from the name.
          </span>
        </label>
        {slugProblem && (
          <p id="copy-slug-error" className={errorText}>
            {slugProblem.message}
          </p>
        )}
        <p className="text-sm text-muted">
          A copy of {choices.source.name}. It starts closed, with you as its owner, so you can look it over before
          opening it.
        </p>
      </fieldset>

      {COPY_KINDS.map((kind) => (
        <KindChoice
          key={kind}
          kind={kind}
          choices={choices}
          state={state}
          update={update}
          problem={problemFor(kind)}
          hint={
            kind === "pages"
              ? "Pages come with what they use: menus, header and footer, categories, tags and pictures."
              : kind === "products"
                ? "Products come with their variants, prices, pictures, categories, tags and subscription plans."
                : "Blog posts come with their categories, tags and pictures."
          }
        />
      ))}

      <fieldset className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-background p-5">
        <legend className="px-1 text-base font-medium">People and orders</legend>
        <div className="flex flex-col gap-1">
          <label className="flex min-h-10 items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={options.customers && choices.customers > 0}
              disabled={choices.customers === 0}
              onChange={(event) =>
                update((s) => ({ ...s, options: { ...s.options, customers: event.target.checked } }))
              }
              aria-describedby="copy-customers-note"
              className="size-4"
            />
            Customers
            <span className="font-normal text-muted">({choices.customers.toLocaleString("en")})</span>
          </label>
          <p id="copy-customers-note" className="pl-6 text-sm text-muted">
            The shoppers, with their addresses, groups and companies. Passwords, sessions, carts, wish lists and
            marketing consents are not copied, and people who unsubscribed stay unsubscribed.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label className="flex min-h-10 items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={options.orders && choices.orders > 0}
              disabled={choices.orders === 0}
              onChange={(event) => update((s) => ({ ...s, options: { ...s.options, orders: event.target.checked } }))}
              aria-describedby="copy-orders-note"
              className="size-4"
            />
            Order history
            <span className="font-normal text-muted">({choices.orders.toLocaleString("en")})</span>
          </label>
          <p id="copy-orders-note" className="pl-6 text-sm text-muted">
            Read-only history: lines, totals, dates and the customer are kept, and each order is marked as copied and
            numbered C-, then the original number. No payments, refunds, invoices or emails are copied, nothing is sent
            and stock does not change. The new store&apos;s own order numbers start fresh. An order whose customer is
            not copied keeps the contact details written on the order.
          </p>
        </div>
        {needsDataConfirmation(options) && (
          <div className="flex flex-col gap-1 rounded-md border border-border p-3">
            <label className="flex min-h-10 items-start gap-2 text-sm font-medium">
              <input
                id="copy-confirm"
                type="checkbox"
                checked={options.confirmDataUse}
                onChange={(event) =>
                  update((s) => ({ ...s, options: { ...s.options, confirmDataUse: event.target.checked } }))
                }
                aria-required
                aria-invalid={confirmProblem ? true : undefined}
                aria-describedby={confirmProblem ? "copy-confirm-error" : undefined}
                className="mt-1 size-4"
              />
              I confirm that I may use this customer data in the new store.
            </label>
            {confirmProblem && (
              <p id="copy-confirm-error" className={errorText}>
                {confirmProblem.message}
              </p>
            )}
          </div>
        )}
      </fieldset>

      <Details summary="Always copied">
        <p>The store&apos;s settings come with every copy, except secrets:</p>
        {choices.settings.length > 0 ? (
          <ul className="list-disc pl-5">
            {choices.settings.map((setting) => (
              <li key={setting.label}>
                {setting.label} ({setting.count.toLocaleString("en")})
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">
            Design, menus, markets, languages, shipping and the rest of the store&apos;s settings.
          </p>
        )}
      </Details>
      <Details summary="Never copied">
        <ul className="list-disc pl-5">
          {NEVER_COPIED.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Details>

      <section aria-label="Summary" className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5">
        <p id={hintId} className="text-sm">
          {sentence}
        </p>
        {blocked && (
          <p id={reasonId} className="text-sm">
            <span className="font-medium">Not ready to start:</span> {problems[0].message}
          </p>
        )}
        <div>
          <button
            type="submit"
            aria-disabled={blocked || busy}
            aria-describedby={blocked ? `${hintId} ${reasonId}` : hintId}
            className={`min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background ${blocked || busy ? "opacity-40" : ""}`}
          >
            {busy ? "Starting the copy …" : "Start copy"}
          </button>
        </div>
      </section>
    </form>
  );
}
