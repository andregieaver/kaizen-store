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
  LIST_STEP,
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
  type CopyWizardWords,
  type WizardProblem,
  type WizardState,
} from "@/lib/store-copy-wizard";
import { CARD_CLASS } from "@/components/admin/ui";
import { useAdminLang, useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";

const control =
  "min-h-10 rounded-md border border-line bg-card px-3 font-normal";
const errorText = "text-sm text-danger-text";
const button =
  "min-h-10 rounded-pill border border-edge bg-card px-3 text-sm disabled:opacity-40";

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

type Row = {
  id: string;
  title: string;
  secondary: string;
  badge: string;
  image: string | null;
};

/** The light rows of each list, as the checklist draws them. */
function rowsOf(
  choices: CopyChoices,
  kind: CopyKind,
  words: CopyWizardWords,
): Row[] {
  if (kind === "products") {
    return choices.products.map((p) => ({
      id: p.id,
      title: p.title,
      secondary: p.handle,
      badge: statusLabel(p.status, words),
      image: p.image,
    }));
  }
  return choices[kind].map((p) => ({
    id: p.id,
    title: p.title,
    secondary: `/${p.slug}`,
    badge: words.states[p.state],
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
      <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-1.5 hover:bg-inverse/5">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onToggle(row.id, event.target.checked)}
          className="size-4 shrink-0"
        />
        {thumbnail &&
          (row.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- a small admin thumbnail
            <img
              src={row.image}
              alt=""
              loading="lazy"
              className="size-10 shrink-0 rounded object-cover"
            />
          ) : (
            <span
              aria-hidden
              className="size-10 shrink-0 rounded bg-inverse/10"
            />
          ))}
        <span className="flex min-w-0 flex-1 flex-col text-sm">
          <span className="truncate font-medium">{row.title}</span>
          <span className="truncate text-muted">{row.secondary}</span>
        </span>
        <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs text-muted">
          {row.badge}
        </span>
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
  const w = useAdminText("platform").copyWizard;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const words = w.kinds[kind];
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(LIST_STEP);
  const shown = useMemo(() => filterRows(rows, query, rowText), [rows, query]);
  const ticked = useMemo(() => new Set(picked), [picked]);
  const onToggle = useCallback(
    (id: string, on: boolean) =>
      update((state) => toggleId(state, kind, id, on)),
    [update, kind],
  );
  const visible = shown.slice(0, limit);
  const thumbnails = kind === "products";
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-md border border-line p-3">
      <label className="flex flex-col gap-1 text-sm font-medium">
        {fillWords(w.search, { many: words.many })}
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
          {fillWords(w.selectShown, { n: shown.length.toLocaleString(locale) })}
        </button>
        <button
          type="button"
          className={button}
          disabled={picked.length === 0}
          onClick={() => update((state) => clearIds(state, kind))}
        >
          {w.clear}
        </button>
        <p role="status" aria-live="polite" className="text-sm text-muted">
          {selectedLine(ticked.size, rows.length, w.lib, locale)}
        </p>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">
          {fillWords(w.noMatch, { many: words.many })}
        </p>
      ) : (
        <div
          role="group"
          aria-label={fillWords(w.toCopy, { title: words.title })}
          className="max-h-80 overflow-y-auto rounded-md border border-line"
        >
          <ul className="divide-y divide-line">
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
            <div className="border-t border-line p-2">
              <button
                type="button"
                className={button}
                onClick={() => setLimit((n) => n + LIST_STEP)}
              >
                {fillWords(w.showMore, {
                  n: Math.min(
                    LIST_STEP,
                    shown.length - visible.length,
                  ).toLocaleString(locale),
                  left: (shown.length - visible.length).toLocaleString(locale),
                })}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const MODES: CopyMode[] = ["all", "selected", "none"];

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
  const w = useAdminText("platform").copyWizard;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const words = w.kinds[kind];
  const rows = useMemo(
    () => rowsOf(choices, kind, w.lib),
    [choices, kind, w.lib],
  );
  const mode = state.options[kind].mode;
  const errorId = `copy-${kind}-error`;
  return (
    <fieldset className={`flex min-w-0 flex-col gap-2 p-5 ${CARD_CLASS}`}>
      <legend className="px-1 text-base font-medium">{words.title}</legend>
      <p className="text-sm text-muted">{hint}</p>
      {rows.length === 0 ? (
        <p className="text-sm">
          {fillWords(w.noneToCopy, { many: words.many })}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {MODES.map((value) => (
              <label
                key={value}
                className="flex min-h-10 items-center gap-2 text-sm"
              >
                <input
                  type="radio"
                  name={`copy-${kind}-mode`}
                  value={value}
                  checked={mode === value}
                  onChange={() =>
                    update((current) => setMode(current, kind, value))
                  }
                  className="size-4"
                />
                {w.modes[value]}
                {value === "all" && (
                  <span className="text-muted">
                    ({rows.length.toLocaleString(locale)})
                  </span>
                )}
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
function Details({
  summary,
  children,
}: {
  summary: string;
  children: ReactNode;
}) {
  return (
    <details className="rounded-panel border border-line bg-card p-4 text-sm">
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
  const w = useAdminText("platform").copyWizard;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const [state, setState] = useState<WizardState>(
    () => initial ?? initialWizard(choices.source.name, w.lib),
  );
  const [showErrors, setShowErrors] = useState(
    Boolean(initialMessages?.length),
  );
  const [messages, setMessages] = useState<string[]>(initialMessages ?? []);
  const [pending, startPending] = useTransition();
  const [sent, setSent] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const reasonId = useId();
  const update = useCallback(
    (change: (state: WizardState) => WizardState) => setState(change),
    [],
  );

  const problems = wizardProblems(state, w.lib, locale);
  const blocked = problems.length > 0;
  const busy = pending || sent;
  const problemFor = (field: WizardProblem["field"]) =>
    showErrors ? problems.find((p) => p.field === field) : undefined;
  const { options } = state;
  const sentence = summarySentence(state, choices, w.lib, locale);
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
        } else
          setMessages(
            result.problems.length > 0 ? result.problems : [w.couldNotStart],
          );
      } catch {
        setMessages([w.tryAgain]);
      }
    });
  };

  const nameProblem = problemFor("name");
  const slugProblem = problemFor("slug");
  const confirmProblem = problemFor("confirmDataUse");

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-busy={busy}
      className="flex max-w-3xl flex-col gap-5"
    >
      {(messages.length > 0 || (showErrors && blocked)) && (
        <div
          ref={alertRef}
          role="alert"
          tabIndex={-1}
          className="rounded-lg border border-danger-text p-4 text-sm text-danger-text"
        >
          <p className="font-medium">
            {messages.length > 0 ? w.notStarted : w.anotherLook}
          </p>
          <ul className="list-disc pl-5">
            {(messages.length > 0
              ? messages
              : problems.map((p) => p.message)
            ).map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      <fieldset className={`flex min-w-0 flex-col gap-3 p-5 ${CARD_CLASS}`}>
        <legend className="px-1 text-base font-medium">{w.newStore}</legend>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.name}
          <input
            id="copy-name"
            name="name"
            value={state.name}
            onChange={(event) =>
              update((s) => ({ ...s, name: event.target.value }))
            }
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
          {w.address}
          <span className="flex items-center gap-1">
            <span className="text-muted" aria-hidden>
              /s/
            </span>
            <input
              id="copy-slug"
              name="slug"
              value={state.slug}
              onChange={(event) =>
                update((s) => ({ ...s, slug: event.target.value }))
              }
              placeholder={slugHint}
              pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]"
              aria-invalid={slugProblem ? true : undefined}
              aria-describedby={
                slugProblem
                  ? "copy-slug-hint copy-slug-error"
                  : "copy-slug-hint"
              }
              className={`${control} flex-1`}
            />
          </span>
          <span id="copy-slug-hint" className="font-normal text-muted">
            {w.slugHint}
          </span>
        </label>
        {slugProblem && (
          <p id="copy-slug-error" className={errorText}>
            {slugProblem.message}
          </p>
        )}
        <p className="text-sm text-muted">
          {fillWords(w.copyOf, { name: choices.source.name })}
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
          hint={w.hints[kind]}
        />
      ))}

      <fieldset className={`flex min-w-0 flex-col gap-3 p-5 ${CARD_CLASS}`}>
        <legend className="px-1 text-base font-medium">{w.people}</legend>
        <div className="flex flex-col gap-1">
          <label className="flex min-h-10 items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={options.customers && choices.customers > 0}
              disabled={choices.customers === 0}
              onChange={(event) =>
                update((s) => ({
                  ...s,
                  options: { ...s.options, customers: event.target.checked },
                }))
              }
              aria-describedby="copy-customers-note"
              className="size-4"
            />
            {w.customers}
            <span className="font-normal text-muted">
              ({choices.customers.toLocaleString(locale)})
            </span>
          </label>
          <p id="copy-customers-note" className="pl-6 text-sm text-muted">
            {w.customersNote}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label className="flex min-h-10 items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={options.orders && choices.orders > 0}
              disabled={choices.orders === 0}
              onChange={(event) =>
                update((s) => ({
                  ...s,
                  options: { ...s.options, orders: event.target.checked },
                }))
              }
              aria-describedby="copy-orders-note"
              className="size-4"
            />
            {w.orders}
            <span className="font-normal text-muted">
              ({choices.orders.toLocaleString(locale)})
            </span>
          </label>
          <p id="copy-orders-note" className="pl-6 text-sm text-muted">
            {w.ordersNote}
          </p>
        </div>
        {needsDataConfirmation(options) && (
          <div className="flex flex-col gap-1 rounded-md border border-line p-3">
            <label className="flex min-h-10 items-start gap-2 text-sm font-medium">
              <input
                id="copy-confirm"
                type="checkbox"
                checked={options.confirmDataUse}
                onChange={(event) =>
                  update((s) => ({
                    ...s,
                    options: {
                      ...s.options,
                      confirmDataUse: event.target.checked,
                    },
                  }))
                }
                aria-required
                aria-invalid={confirmProblem ? true : undefined}
                aria-describedby={
                  confirmProblem ? "copy-confirm-error" : undefined
                }
                className="mt-1 size-4"
              />
              {w.confirm}
            </label>
            {confirmProblem && (
              <p id="copy-confirm-error" className={errorText}>
                {confirmProblem.message}
              </p>
            )}
          </div>
        )}
      </fieldset>

      {/* The owner's own wording of the customer emails (D238): a copy group of its own, off unless ticked. */}
      <fieldset className={`flex min-w-0 flex-col gap-3 p-5 ${CARD_CLASS}`}>
        <legend className="px-1 text-base font-medium">{w.emailTexts}</legend>
        <div className="flex flex-col gap-1">
          <label className="flex min-h-10 items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              name="emailTexts"
              checked={options.emailTexts === true}
              onChange={(event) =>
                update((s) => ({
                  ...s,
                  options: { ...s.options, emailTexts: event.target.checked },
                }))
              }
              aria-describedby="copy-email-texts-note"
              className="size-4"
            />
            {w.emailTextsLabel}
          </label>
          <p id="copy-email-texts-note" className="pl-6 text-sm text-muted">
            {w.emailTextsNote}
          </p>
        </div>
      </fieldset>

      <Details summary={w.always}>
        <p>{w.alwaysNote}</p>
        {choices.settings.length > 0 ? (
          <ul className="list-disc pl-5">
            {choices.settings.map((setting) => (
              <li key={setting.label}>
                {w.lib.settingLabels[setting.label] ?? setting.label} (
                {setting.count.toLocaleString(locale)})
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">{w.alwaysFallback}</p>
        )}
      </Details>
      <Details summary={w.never}>
        <ul className="list-disc pl-5">
          {w.lib.neverCopied.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Details>

      <section
        aria-label={w.summary}
        className={`flex flex-col gap-3 p-5 ${CARD_CLASS}`}
      >
        <p id={hintId} className="text-sm">
          {sentence}
        </p>
        {blocked && (
          <p id={reasonId} className="text-sm">
            <span className="font-medium">{w.notReady}</span>{" "}
            {problems[0].message}
          </p>
        )}
        <div>
          <button
            type="submit"
            aria-disabled={blocked || busy}
            aria-describedby={blocked ? `${hintId} ${reasonId}` : hintId}
            className={`min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink ${blocked || busy ? "opacity-40" : ""}`}
          >
            {busy ? w.starting : w.start}
          </button>
        </div>
      </section>
    </form>
  );
}
