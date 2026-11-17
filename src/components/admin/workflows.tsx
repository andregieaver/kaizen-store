"use client";

import { useState, useTransition } from "react";

import { fillWords } from "@/lib/admin-fill";
import type { NotificationsMessages } from "@/lib/admin-messages/notifications.en";
import { PLATFORM_WORKFLOWS } from "@/lib/platform-workflows";
import { listValues, OPERATORS, SEGMENT_FIELD, STORE_WORKFLOWS, type AnyWorkflowInput, type WorkflowAction, type WorkflowCondition, type WorkflowField } from "@/lib/workflows";

import { useAdminText } from "./admin-text";
import { Button, Card, Chip, List, ListRow, RowDate, RowLead } from "./ui";

type Saved = { ok: true } | { ok: false; problems: string[] };
type Plain = { ok: true; message?: string } | { ok: false; message: string };
type TestAnswer = { ok: true; found: boolean; matched: boolean; about: string | null; actions: { kind: string; would: string }[]; schedule: boolean } | { ok: false; message: string };
type AsyncSaved = Promise<Saved>;
type AsyncPlain = Promise<Plain>;
type AsyncTest = Promise<TestAnswer>;

/** Whose workflows: a store's (D356) or Kaizena Flow's own, on its events (D516). */
export type WorkflowScope = "store" | "platform";
const kitOf = (scope: WorkflowScope) => (scope === "platform" ? PLATFORM_WORKFLOWS : STORE_WORKFLOWS);

export type WorkflowView = AnyWorkflowInput & {
  id: string;
  enabled: boolean;
  tested: boolean;
  runs: { id: string; when: string; status: string; matched: boolean | null }[];
};

export type WorkflowActions = {
  save: (id: string | null, input: AnyWorkflowInput) => AsyncSaved;
  test: (id: string) => AsyncTest;
  switchOn: (id: string, on: boolean) => AsyncPlain;
  remove: (id: string) => AsyncPlain;
};

const FIELD = "min-h-10 rounded-md border border-line bg-card px-3 text-sm";

/** The store's saved segments, for *the customer is in segment X* (ecosystem plan E3.6, D718). */
type SegmentChoice = { id: string; name: string };
const SEGMENT_OPS: readonly WorkflowCondition["op"][] = ["is", "is_not"];
const opsOf = (field: string): readonly WorkflowCondition["op"][] => (field === SEGMENT_FIELD ? SEGMENT_OPS : OPERATORS);

type Words = NotificationsMessages["workflows"];

/** A condition in a line: its field, its comparison and its value; a segment by its name. */
function conditionLine(c: WorkflowCondition, w: Words, segments: readonly SegmentChoice[]): string {
  if (c.field === SEGMENT_FIELD) return `${w.fields[c.field] ?? c.field} ${w.segmentOps[c.op] ?? c.op} ${segments.find((s) => s.id === c.value)?.name ?? w.goneSegment}`;
  return `${w.fields[c.field] ?? c.field} ${w.ops[c.op]} ${c.value}`;
}

function blankAction(kind: WorkflowAction["kind"], endpoint: string | null): WorkflowAction {
  switch (kind) {
    case "tag_order":
    case "tag_customer":
      return { kind, tag: "" };
    case "note_order":
      return { kind, text: "" };
    case "email_staff":
      return { kind, subject: "", text: "" };
    case "post_slack":
      return { kind, text: "" };
    case "send_request":
      return { kind, endpointId: endpoint ?? "" };
    case "ask_ai_manager":
      return { kind, question: "" };
    case "hold_order":
      return { kind, reason: "" };
  }
}

type FlowWords = NotificationsMessages["workflows"];

/**
 * A condition's value in words (E3.3, D718): yes or no, a field's choice by its label, a product by its name (`valueLabels`, the page's), and
 * each of an `is_one_of`'s values so.
 */
export function valueWords(c: WorkflowCondition, field: WorkflowField | undefined, w: FlowWords, valueLabels: Record<string, string> = {}): string {
  const one = (value: string) => {
    const v = value.trim().toLowerCase();
    if (field?.kind === "yes_no") return w.yesNo[v as "yes" | "no"] ?? value;
    return w.choiceLabels[c.field]?.[v] ?? valueLabels[v] ?? value;
  };
  return c.op === "is_one_of" ? listValues(c.value).map(one).join(", ") : one(c.value);
}

/** A condition's value as typed: yes or no and a field's choices are chosen; any other value, and a list, is written. */
function ValueInput({ c, field, w, onChange }: { c: WorkflowCondition; field: WorkflowField | undefined; w: FlowWords; onChange: (value: string) => void }) {
  const choices = field?.kind === "yes_no" ? ["yes", "no"] : (field?.choices ?? null);
  if (choices && (c.op === "is" || c.op === "is_not"))
    return (
      <select value={c.value} onChange={(e) => onChange(e.target.value)} aria-label={w.value} className={FIELD}>
        <option value="" disabled>
          {w.value}
        </option>
        {choices.map((v) => (
          <option key={v} value={v}>
            {field?.kind === "yes_no" ? w.yesNo[v as "yes" | "no"] : (w.choiceLabels[c.field]?.[v] ?? v)}
          </option>
        ))}
      </select>
    );
  const hint = c.op === "is_one_of" ? `${w.listHint}${choices ? `: ${choices.join(", ")}` : ""}` : w.value;
  return <input value={c.value} onChange={(e) => onChange(e.target.value)} placeholder={hint} aria-label={w.value} className={FIELD} />;
}

/** Makes or changes a workflow: when, only if, then. Saved off. */
export function WorkflowEditor({
  start,
  endpoints,
  triggerLabels,
  save,
  onDone,
  scope = "store",
  namePlaceholder,
  segments = [],
}: {
  start: (AnyWorkflowInput & { id: string | null }) | null;
  endpoints: { id: string; name: string }[];
  triggerLabels: Record<string, string>;
  save: WorkflowActions["save"];
  onDone: () => void;
  scope?: WorkflowScope;
  /** The name's example, when the store's (*Tag big orders*) does not fit. */
  namePlaceholder?: string;
  /** The store's segments; without any, *the customer is in segment X* is not offered. */
  segments?: SegmentChoice[];
}) {
  const w = useAdminText("notifications").workflows;
  const kit = kitOf(scope);
  const [pending, run] = useTransition();
  const [problems, setProblems] = useState<string[]>([]);
  const [name, setName] = useState(start?.name ?? "");
  const [trigger, setTrigger] = useState<string>(start?.trigger ?? kit.triggers[0]);
  const [schedule, setSchedule] = useState(start?.schedule ?? { every: "day" as const, at: "08:00", weekday: null });
  const [conditions, setConditions] = useState<WorkflowCondition[]>(start?.conditions ?? []);
  const [actions, setActions] = useState<WorkflowAction[]>(start?.actions ?? [blankAction("email_staff", null)]);
  const fields = kit.fieldsFor(trigger).filter((f) => f.kind !== "segment" || segments.length > 0);
  const allowed = kit.actionsFor(trigger);
  // A condition moved to *the customer's segment* starts in the first segment; moved away, it starts empty again.
  const withField = (c: WorkflowCondition, field: string): WorkflowCondition =>
    field === SEGMENT_FIELD ? { field, op: "is", value: segments[0]?.id ?? "" } : c.field === SEGMENT_FIELD ? { field, op: "is", value: "" } : { ...c, field, value: "" };
  const setAction = (i: number, next: WorkflowAction) => setActions(actions.map((a, j) => (j === i ? next : a)));

  return (
    <form
      aria-busy={pending}
      className="flex flex-col gap-5"
      action={() =>
        run(async () => {
          const input: AnyWorkflowInput = { name, trigger, schedule: trigger === "schedule" ? schedule : null, conditions: trigger === "schedule" ? [] : conditions, actions };
          const answer = await save(start?.id ?? null, input);
          if (answer.ok) onDone();
          else setProblems(answer.problems);
        })
      }
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        {w.name}
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder={namePlaceholder ?? w.namePlaceholder} className={`${FIELD} font-normal`} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {w.trigger}
        <select
          value={trigger}
          onChange={(e) => {
            const next = e.target.value;
            setTrigger(next);
            setConditions([]);
            setActions(actions.filter((a) => kit.actionsFor(next).includes(a.kind)));
          }}
          className={`${FIELD} font-normal`}
        >
          {kit.triggers.map((t) => (
            <option key={t} value={t}>
              {t === "schedule" ? w.schedule : (triggerLabels[t] ?? t)}
            </option>
          ))}
        </select>
      </label>
      {trigger === "schedule" ? (
        <div className="flex flex-wrap gap-3">
          <select value={schedule.every} onChange={(e) => setSchedule({ ...schedule, every: e.target.value as "day" | "week", weekday: e.target.value === "week" ? (schedule.weekday ?? 1) : null })} className={FIELD} aria-label={w.schedule}>
            <option value="day">{w.every.day}</option>
            <option value="week">{w.every.week}</option>
          </select>
          {schedule.every === "week" && (
            <label className="flex items-center gap-2 text-sm">
              {w.weekday}
              <select value={schedule.weekday ?? 1} onChange={(e) => setSchedule({ ...schedule, weekday: Number(e.target.value) })} className={FIELD}>
                {w.weekdays.map((day, i) => (
                  <option key={day} value={i + 1}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            {w.at}
            <input type="time" value={schedule.at} onChange={(e) => setSchedule({ ...schedule, at: e.target.value })} className={FIELD} />
          </label>
        </div>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{w.conditions}</legend>
          {conditions.length === 0 && <p className="text-sm text-muted">{w.noConditions}</p>}
          {conditions.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select value={c.field} onChange={(e) => setConditions(conditions.map((x, j) => (j === i ? withField(x, e.target.value) : x)))} className={FIELD} aria-label={w.conditions}>
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {w.fields[f.key] ?? f.key}
                  </option>
                ))}
              </select>
              <select value={c.op} onChange={(e) => setConditions(conditions.map((x, j) => (j === i ? { ...x, op: e.target.value as WorkflowCondition["op"] } : x)))} className={FIELD} aria-label={w.conditions}>
                {opsOf(c.field).map((op) => (
                  <option key={op} value={op}>
                    {c.field === SEGMENT_FIELD ? w.segmentOps[op] : w.ops[op]}
                  </option>
                ))}
              </select>
              {c.field === SEGMENT_FIELD ? (
                <select value={c.value} onChange={(e) => setConditions(conditions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} aria-label={w.segment} className={FIELD}>
                  {segments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ) : (
                <ValueInput c={c} field={fields.find((f) => f.key === c.field)} w={w} onChange={(value) => setConditions(conditions.map((x, j) => (j === i ? { ...x, value } : x)))} />
              )}
              <Button kind="quiet" size="dense" onClick={() => setConditions(conditions.filter((_, j) => j !== i))}>
                {w.remove}
              </Button>
            </div>
          ))}
          {fields.length > 0 && (
            <div>
              <Button size="dense" onClick={() => setConditions([...conditions, { field: fields[0].key, op: "is", value: "" }])}>
                {w.addCondition}
              </Button>
            </div>
          )}
        </fieldset>
      )}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">{w.actions}</legend>
        {actions.map((a, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-panel border border-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <select value={a.kind} onChange={(e) => setAction(i, blankAction(e.target.value as WorkflowAction["kind"], endpoints[0]?.id ?? null))} className={FIELD} aria-label={w.actions}>
                {allowed.map((kind) => (
                  <option key={kind} value={kind}>
                    {w.actionKinds[kind]}
                  </option>
                ))}
              </select>
              <Button kind="quiet" size="dense" onClick={() => setActions(actions.filter((_, j) => j !== i))}>
                {w.remove}
              </Button>
            </div>
            {(a.kind === "tag_order" || a.kind === "tag_customer") && (
              <input value={a.tag} onChange={(e) => setAction(i, { ...a, tag: e.target.value })} maxLength={40} placeholder={w.tag} aria-label={w.tag} className={FIELD} />
            )}
            {a.kind === "email_staff" && (
              <>
                <input value={a.subject} onChange={(e) => setAction(i, { ...a, subject: e.target.value })} maxLength={120} placeholder={w.subject} aria-label={w.subject} className={FIELD} />
                <textarea value={a.text} onChange={(e) => setAction(i, { ...a, text: e.target.value })} maxLength={2000} placeholder={w.text} aria-label={w.text} className={`${FIELD} min-h-20 py-2`} />
              </>
            )}
            {a.kind === "note_order" && (
              <textarea value={a.text} onChange={(e) => setAction(i, { ...a, text: e.target.value })} maxLength={1000} placeholder={w.text} aria-label={w.text} className={`${FIELD} min-h-20 py-2`} />
            )}
            {a.kind === "post_slack" && (
              <textarea value={a.text} onChange={(e) => setAction(i, { ...a, text: e.target.value })} maxLength={2000} placeholder={w.text} aria-label={w.text} className={`${FIELD} min-h-20 py-2`} />
            )}
            {a.kind === "send_request" &&
              (endpoints.length === 0 ? (
                <p className="text-sm text-muted">{w.noEndpoints}</p>
              ) : (
                <select value={a.endpointId} onChange={(e) => setAction(i, { ...a, endpointId: e.target.value })} aria-label={w.endpoint} className={FIELD}>
                  {endpoints.map((endpoint) => (
                    <option key={endpoint.id} value={endpoint.id}>
                      {endpoint.name}
                    </option>
                  ))}
                </select>
              ))}
            {a.kind === "ask_ai_manager" && (
              <textarea value={a.question} onChange={(e) => setAction(i, { ...a, question: e.target.value })} maxLength={400} placeholder={w.question} aria-label={w.question} className={`${FIELD} min-h-20 py-2`} />
            )}
            {a.kind === "hold_order" && (
              <label className="flex flex-col gap-1 text-sm">
                <input value={a.reason} onChange={(e) => setAction(i, { ...a, reason: e.target.value })} maxLength={200} placeholder={w.reason} aria-label={w.reason} className={FIELD} />
                <span className="text-muted">{w.reasonHint}</span>
              </label>
            )}
          </div>
        ))}
        {actions.length < 10 && (
          <div>
            <Button size="dense" onClick={() => setActions([...actions, blankAction(allowed.includes("email_staff") ? "email_staff" : allowed[0], endpoints[0]?.id ?? null)])}>
              {w.addAction}
            </Button>
          </div>
        )}
      </fieldset>
      {problems.length > 0 && (
        <ul role="alert" className="list-disc pl-5 text-sm text-danger-text">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button kind="main" type="submit" disabled={pending}>
          {pending ? w.saving : w.save}
        </Button>
        {start && (
          <Button kind="quiet" onClick={onDone}>
            {w.cancel}
          </Button>
        )}
      </div>
    </form>
  );
}

/** The New workflow card: the editor, then a line that it was saved off. */
export function NewWorkflow(props: {
  endpoints: { id: string; name: string }[];
  triggerLabels: Record<string, string>;
  save: WorkflowActions["save"];
  scope?: WorkflowScope;
  namePlaceholder?: string;
  segments?: SegmentChoice[];
}) {
  const w = useAdminText("notifications").workflows;
  const [key, setKey] = useState(0);
  const [saved, setSaved] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      {saved && (
        <p role="status" className="text-sm text-positive-text">
          {w.savedOff}
        </p>
      )}
      <WorkflowEditor
        key={key}
        start={null}
        {...props}
        onDone={() => {
          setSaved(true);
          setKey((k) => k + 1);
        }}
      />
    </div>
  );
}

/** One workflow: what it does, test, switch, change, delete, its runs. */
export function WorkflowCard({
  flow,
  endpoints,
  triggerLabels,
  canWrite,
  actions,
  scope = "store",
  valueLabels,
  segments = [],
}: {
  flow: WorkflowView;
  endpoints: { id: string; name: string }[];
  triggerLabels: Record<string, string>;
  canWrite: boolean;
  actions: WorkflowActions;
  scope?: WorkflowScope;
  /** Names for values a condition holds by id (a product's), from the page. */
  valueLabels?: Record<string, string>;
  segments?: SegmentChoice[];
}) {
  const w = useAdminText("notifications").workflows;
  const fieldOf = (key: string) => kitOf(scope).fieldsFor(flow.trigger).find((f) => f.key === key);
  const [pending, run] = useTransition();
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [test, setTest] = useState<TestAnswer | null>(null);
  const when = flow.trigger === "schedule" ? `${flow.schedule?.every === "week" ? w.every.week : w.every.day}, ${flow.schedule?.at ?? ""}` : (triggerLabels[flow.trigger] ?? flow.trigger);
  const state = (
    <Chip signal={flow.enabled ? "positive" : "neutral"} dot>
      {flow.enabled ? w.on : w.off}
    </Chip>
  );
  const plain = (act: () => AsyncPlain) =>
    run(async () => {
      const answer = await act();
      setMessage(answer.ok ? (answer.message ? { ok: true, text: answer.message } : null) : { ok: false, text: answer.message });
    });
  if (editing)
    return (
      <Card title={flow.name} level={3} compact>
        <WorkflowEditor start={flow} endpoints={endpoints} triggerLabels={triggerLabels} save={actions.save} onDone={() => setEditing(false)} scope={scope} segments={segments} />
      </Card>
    );
  return (
    <Card title={flow.name} description={when} aside={state} level={3} compact className="flex flex-col gap-3">
      <p className="text-sm text-ink-2">
        {flow.conditions.length > 0 &&
          `${w.conditions}: ${flow.conditions
            .map((c) => (c.field === SEGMENT_FIELD ? conditionLine(c, w, segments) : `${w.fields[c.field] ?? c.field} ${w.ops[c.op]} ${valueWords(c, fieldOf(c.field), w, valueLabels)}`))
            .join("; ")}. `}
        {`${w.actions}: ${flow.actions.map((a) => w.actionKinds[a.kind]).join(", ")}.`}
      </p>
      {!flow.tested && !flow.enabled && <p className="text-sm text-warning-text">{w.untested}</p>}
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={pending}
            onClick={() =>
              run(async () => {
                setTest(await actions.test(flow.id));
              })
            }
          >
            {pending ? w.testing : w.test}
          </Button>
          <Button disabled={pending || (!flow.enabled && !flow.tested && !(test && test.ok))} onClick={() => plain(() => actions.switchOn(flow.id, !flow.enabled))}>
            {flow.enabled ? w.switchOff : w.switchOn}
          </Button>
          <Button disabled={pending} onClick={() => setEditing(true)}>
            {w.edit}
          </Button>
          <Button kind="danger" disabled={pending} onClick={() => window.confirm(fillWords(w.deleteQuestion, { name: flow.name })) && plain(() => actions.remove(flow.id))}>
            {w.delete}
          </Button>
        </div>
      )}
      {test && (
        <div role="status" className="rounded-panel bg-sunken p-3 text-sm">
          {!test.ok ? (
            <p className="text-danger-text">{test.message}</p>
          ) : !test.found ? (
            <p>{w.testNone}</p>
          ) : !test.matched ? (
            <p>{fillWords(w.testNoMatch, { about: test.about ?? "-" })}</p>
          ) : (
            <>
              <p>{test.schedule ? w.testSchedule : fillWords(w.testMatch, { about: test.about ?? "-" })}</p>
              <ul className="list-disc pl-5">
                {test.actions.map((a, i) => (
                  <li key={i}>{`${w.actionKinds[a.kind] ?? a.kind}: ${a.would}`}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-positive-text" : "text-danger-text"}`}>
          {message.text}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <h4 className="text-body-strong text-ink">{w.runs}</h4>
        {flow.runs.length === 0 ? (
          <p className="text-sm text-muted">{w.noRuns}</p>
        ) : (
          <List label={w.runs}>
            {flow.runs.map((r) => (
              <ListRow key={r.id}>
                <RowLead title={w.runStatuses[r.status] ?? r.status} sub={r.matched === false ? w.notMatched : undefined} />
                <RowDate>{r.when}</RowDate>
              </ListRow>
            ))}
          </List>
        )}
      </div>
    </Card>
  );
}
