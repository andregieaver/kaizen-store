import Link from "next/link";
import { useId } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { buttonClass, Card, Chip } from "@/components/admin/ui";
import { ACTIVITY_DURATION_MAX, ACTIVITY_KINDS, ACTIVITY_NOTE_MAX, ACTIVITY_TITLE_MAX } from "@/lib/activities";
import { countWords, fillWords } from "@/lib/admin-fill";
import type { DealsMessages } from "@/lib/admin-messages/deals.en";

import type { ActivityFormValues, ActivityView } from "./activity-view";

type Words = DealsMessages["activities"];
type FormAction = (state: FormState, form: FormData) => Promise<FormState>;

/** What a member who may change customers can do to activities (none for one who may only read); the home's *Today* only marks done. */
export type ActivityActions = {
  done: (id: string, done: boolean) => () => Promise<void>;
  add?: FormAction;
  change?: (id: string) => FormAction;
  remove?: (id: string) => FormAction;
};

const control = "min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal";
const summaryButton = `${buttonClass("secondary", "dense")} cursor-pointer list-none [&::-webkit-details-marker]:hidden`;

/**
 * A deal's, a person's or a company's activities (S3, D468), on their page: what is still to do by when it is due, each done with one
 * press; what is done folded below; and Add activity, a call today for the viewer unless they choose otherwise. Each one opens to be
 * changed or deleted.
 */
export function ActivitiesCard({
  items,
  words,
  actions,
  team,
  me,
  blank,
}: {
  items: ActivityView[];
  words: Words;
  actions: ActivityActions | null;
  team: { id: string; name: string }[];
  me: string;
  /** The new activity's form: about this page's deal, person or company. */
  blank: ActivityFormValues;
}) {
  const open = items.filter((a) => !a.done);
  const done = items.filter((a) => a.done);
  return (
    <Card title={words.title} compact>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{words.none}</p>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          {open.length > 0 && (
            <ul className="flex flex-col divide-y divide-line">
              {open.map((a) => (
                <ActivityRow key={a.id} activity={a} words={words} actions={actions} team={team} me={me} />
              ))}
            </ul>
          )}
          {done.length > 0 && (
            <details>
              <summary className="cursor-pointer text-muted">{countWords(done.length, words.doneCount)}</summary>
              <ul className="flex flex-col divide-y divide-line">
                {done.map((a) => (
                  <ActivityRow key={a.id} activity={a} words={words} actions={actions} team={team} me={me} />
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {actions?.add && (
        <details className="mt-4">
          <summary className={summaryButton}>{words.add}</summary>
          {/* Keyed by how many there are, so the form is blank again once the new one is listed. */}
          <ActionForm key={items.length} action={actions.add} className="group mt-4 flex flex-col gap-4">
            <ActivityFields words={words} values={blank} team={team} me={me} />
            <div>
              <SubmitButton>{words.save}</SubmitButton>
            </div>
          </ActionForm>
        </details>
      )}
    </Card>
  );
}

/** One activity: done with one press, what and when, and, for a member who may, Change. */
export function ActivityRow({
  activity: a,
  words,
  actions,
  team,
  me,
  lateChip = true,
}: {
  activity: ActivityView;
  words: Words;
  actions: ActivityActions | null;
  team: { id: string; name: string }[];
  me: string;
  /** Off under *Today*'s own Late heading, which says it already. */
  lateChip?: boolean;
}) {
  return (
    <li className="flex items-start gap-3 py-2 text-sm">
      <DoneMark activity={a} words={words} actions={actions} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className={a.done ? "text-muted line-through" : "text-ink"}>
          <span className="text-muted">{words.kinds[a.kind]} · </span>
          {a.title}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted">
          {a.late && lateChip && <Chip signal="danger">{words.late}</Chip>}
          {a.when && <span className={a.late ? "text-danger-text" : undefined}>{a.when}</span>}
          {a.done && <span>{a.done}</span>}
          {a.forWhom && <span>{a.forWhom}</span>}
          {a.about && (
            <Link href={a.about.href} className="underline">
              {a.about.label}
            </Link>
          )}
        </p>
        {a.note && <p className="whitespace-pre-line text-ink-2">{a.note}</p>}
        {actions?.change && actions.remove && (
          <details className="mt-1">
            <summary className="w-fit cursor-pointer text-ink-2 underline">{words.change}</summary>
            <ActionForm action={actions.change(a.id)} className="group mt-3 flex flex-col gap-4">
              <ActivityFields words={words} values={a.values} team={team} me={me} />
              <div>
                <SubmitButton>{words.saveChange}</SubmitButton>
              </div>
            </ActionForm>
            <ActionForm action={actions.remove(a.id)} className="mt-3">
              <SubmitButton variant="secondary">{words.remove}</SubmitButton>
            </ActionForm>
          </details>
        )}
      </div>
    </li>
  );
}

/** The round mark before an activity: a button that marks it done (or not) for a member who may, else only what it is. */
function DoneMark({ activity: a, words, actions }: { activity: ActivityView; words: Words; actions: ActivityActions | null }) {
  const look = `mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border ${a.done ? "border-positive-line bg-positive-soft text-positive-text" : "border-edge bg-card"}`;
  const tick = (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`size-4 ${a.done ? "" : "opacity-0"}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
  if (!actions) return <span className={look}>{tick}</span>;
  return (
    <form action={actions.done(a.id, !a.done)}>
      <button
        type="submit"
        aria-label={fillWords(a.done ? words.markOpen : words.markDone, { title: a.title })}
        aria-pressed={Boolean(a.done)}
        className={`${look} hover:bg-sunken [&:hover_svg]:opacity-60 [&[aria-pressed=true]:hover_svg]:opacity-100`}
      >
        {tick}
      </button>
    </form>
  );
}

/** An activity's fields: what it is, what to do, when (a length for a meeting), who does it and a note; what it is about stays hidden. */
export function ActivityFields({ words, values, team, me }: { words: Words; values: ActivityFormValues; team: { id: string; name: string }[]; me: string }) {
  const hint = useId();
  return (
    <>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">{words.kind}</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {ACTIVITY_KINDS.map((kind) => (
            <label
              key={kind}
              className="cursor-pointer rounded-pill border border-edge px-3 py-1.5 text-sm has-[:checked]:border-ink has-[:checked]:bg-sunken has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2"
            >
              <input type="radio" name="kind" value={kind} defaultChecked={values.kind === kind} className="sr-only" />
              {words.kinds[kind]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {words.titleLabel}
        <input name="title" required maxLength={ACTIVITY_TITLE_MAX} defaultValue={values.title} placeholder={words.titlePlaceholder} className={control} />
      </label>
      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {words.dueOn}
          <input type="date" name="dueOn" required defaultValue={values.dueOn} className={control} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {words.dueTime}
          <input type="time" name="dueTime" defaultValue={values.dueTime} aria-describedby={hint} className={control} />
        </label>
        {/* A length belongs to a meeting: shown only while Meeting is chosen. */}
        <label className="hidden flex-col gap-1 text-sm font-medium group-has-[[value=meeting]:checked]:flex">
          {words.duration}
          <input type="number" name="duration" min={1} max={ACTIVITY_DURATION_MAX} step={1} inputMode="numeric" defaultValue={values.duration} className={`${control} w-32`} />
        </label>
      </div>
      <p id={hint} className="-mt-2 text-sm text-muted">
        {words.dueTimeHint}
      </p>
      {team.length > 1 ? (
        <label className="flex flex-col gap-1 text-sm font-medium">
          {words.assignee}
          <select name="assigneeId" defaultValue={values.assigneeId || me} className={`${control} max-w-xs`}>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id === me ? words.me : m.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="assigneeId" value={values.assigneeId || me} />
      )}
      <label className="flex flex-col gap-1 text-sm font-medium">
        {words.note}
        <textarea name="note" rows={2} maxLength={ACTIVITY_NOTE_MAX} defaultValue={values.note} className={`${control} py-2`} />
      </label>
      <input type="hidden" name="customerId" value={values.customerId} />
      <input type="hidden" name="companyId" value={values.companyId} />
      <input type="hidden" name="dealId" value={values.dealId} />
    </>
  );
}
