"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { RFM_SEGMENTS, type RfmSegment } from "@/lib/analytics-customers";
import {
  CONDITION_KIND_WORDS,
  CONDITIONS_MAX,
  CONSENTS,
  newCondition,
  type Condition,
  type ConditionKind,
  type Consent,
  type SegmentRules,
} from "@/lib/segments";

import type { PreviewResult } from "@/app/admin/(gated)/[store]/segments/actions";

import { CARD_CLASS } from "./ui";

type Props = {
  storeSlug: string;
  segmentId: string | null;
  initial: { name: string; rules: SegmentRules };
  /** The main currency and its minor-unit digits, for the money condition. */
  currency: string;
  digits: number;
  groups: { id: string; name: string }[];
  tags: { key: string; label: string }[];
  countries: { code: string; name: string }[];
  languages: { code: string; name: string }[];
  rfmReady: boolean;
  preview: (storeSlug: string, rules: unknown) => Promise<PreviewResult>;
  save: (storeSlug: string, id: string | null, input: unknown) => Promise<{ ok: false; problem: string } | void>;
  starters?: { key: string; name: string; line: string; rules: SegmentRules }[];
};

const CONSENT_LABELS: Record<Consent, string> = {
  subscribed: "Want your emails",
  pending: "Waiting for their link",
  unsubscribed: "Unsubscribed",
  none: "Never asked",
};

const KINDS = Object.keys(CONDITION_KIND_WORDS) as ConditionKind[];

const field = "min-h-10 rounded-md border border-line bg-card px-3";

/**
 * The rule builder of a segment (D296): a name, *all* or *any*, and conditions from the closed list, counted as they change (a short pause, then
 * `previewSegmentAction`, numbers only). Saving sends the whole rule set to the server, which checks it again.
 */
export function SegmentEditor(props: Props) {
  const [name, setName] = useState(props.initial.name);
  const [rules, setRules] = useState<SegmentRules>(props.initial.rules);
  const [count, setCount] = useState<PreviewResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { preview, storeSlug } = props;

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      preview(storeSlug, rules).then(setCount, () => setCount({ ok: false, problem: "The count could not be made." }));
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [rules, preview, storeSlug]);

  const setCondition = (index: number, next: Condition) => setRules((r) => ({ ...r, conditions: r.conditions.map((c, i) => (i === index ? next : c)) }));
  const remove = (index: number) => setRules((r) => ({ ...r, conditions: r.conditions.filter((_, i) => i !== index) }));
  const add = (kind: ConditionKind) => setRules((r) => ({ ...r, conditions: [...r.conditions, newCondition(kind)] }));

  const submit = () =>
    startSave(async () => {
      setProblem(null);
      const result = await props.save(storeSlug, props.segmentId, { name, rules });
      if (result && !result.ok) setProblem(result.problem);
    });

  return (
    <div className="flex flex-col gap-6">
      {props.starters && rules.conditions.length === 0 && (
        <section aria-labelledby="starters" className="flex flex-col gap-3">
          <h2 id="starters" className="text-title text-ink">Start from</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {props.starters.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => {
                  setName(s.name);
                  setRules(s.rules);
                }}
                className={`${CARD_CLASS} p-4 text-left hover:bg-sunken`}
              >
                <span className="block text-body-strong text-ink">{s.name}</span>
                <span className="block text-caption text-muted">{s.line}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="segment-name" className="text-body-strong text-ink">
          Name
        </label>
        <input id="segment-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className={`${field} max-w-md`} />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-body-strong text-ink">Who is in it</legend>
        {rules.conditions.length > 1 && (
          <label className="flex items-center gap-2 text-body text-ink-2">
            People who match
            <select value={rules.match} onChange={(e) => setRules((r) => ({ ...r, match: e.target.value as "all" | "any" }))} className={field}>
              <option value="all">all of these</option>
              <option value="any">any of these</option>
            </select>
          </label>
        )}
        {rules.conditions.length === 0 && <p className="text-body text-muted">No conditions: everyone. Add one to narrow it down.</p>}
        <ol className="flex flex-col gap-2">
          {rules.conditions.map((c, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-panel border border-line bg-card p-3">
              <span className="min-w-36 text-body-strong text-ink">{CONDITION_KIND_WORDS[c.kind]}</span>
              <ConditionFields condition={c} onChange={(next) => setCondition(i, next)} {...props} />
              <button type="button" onClick={() => remove(i)} className="ml-auto rounded-pill px-3 py-1 text-ink-2 hover:bg-sunken" aria-label={`Remove ${CONDITION_KIND_WORDS[c.kind]}`}>
                Remove
              </button>
            </li>
          ))}
        </ol>
        {rules.conditions.length < CONDITIONS_MAX && (
          <label className="flex items-center gap-2 text-body text-ink-2">
            Add a condition
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) add(e.target.value as ConditionKind);
              }}
              className={field}
            >
              <option value="">Choose…</option>
              {KINDS.filter((k) => k !== "rfm" || props.rfmReady).map((k) => (
                <option key={k} value={k}>
                  {CONDITION_KIND_WORDS[k]}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>

      <p role="status" aria-live="polite" className="text-body text-ink">
        {count === null
          ? "Counting…"
          : count.ok
            ? `${count.people.toLocaleString("en-GB")} ${count.people === 1 ? "person" : "people"}, ${count.subscribed.toLocaleString("en-GB")} of them want your emails.${count.moneyUnknown > 0 ? ` ${count.moneyUnknown} could not be judged on money: their orders are in a currency with no rate.` : ""}${count.capped ? " Only the 100,000 most recent people were read." : ""}`
            : count.problem}
      </p>

      {problem && (
        <p role="alert" className="text-body text-danger-text">
          {problem}
        </p>
      )}
      <div>
        <button type="button" onClick={submit} disabled={saving} className="min-h-11 rounded-pill bg-brand px-5 text-brand-ink disabled:opacity-40">
          {saving ? "Saving…" : "Save segment"}
        </button>
      </div>
    </div>
  );
}

function Choices<T extends string>({ options, chosen, onChange, label }: { options: { value: T; label: string }[]; chosen: readonly T[]; onChange: (next: T[]) => void; label: string }) {
  return (
    <span role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <label key={o.value} className="inline-flex items-center gap-1 rounded-pill border border-line px-3 py-1 text-body">
          <input
            type="checkbox"
            checked={chosen.includes(o.value)}
            onChange={(e) => onChange(e.target.checked ? [...chosen, o.value] : chosen.filter((v) => v !== o.value))}
          />
          {o.label}
        </label>
      ))}
    </span>
  );
}

function ConditionFields({ condition: c, onChange, currency, digits, groups, tags, countries, languages }: { condition: Condition; onChange: (next: Condition) => void } & Props) {
  const number = (value: number, set: (n: number) => void, label: string) => (
    <input type="number" min={0} aria-label={label} value={value} onChange={(e) => set(Math.max(0, Math.floor(Number(e.target.value) || 0)))} className={`${field} w-24`} />
  );
  switch (c.kind) {
    case "consent":
      return <Choices label="Email consent" options={CONSENTS.map((v) => ({ value: v, label: CONSENT_LABELS[v] }))} chosen={c.statuses} onChange={(statuses) => onChange({ ...c, statuses })} />;
    case "orders":
      return (
        <>
          <select aria-label="How many" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as typeof c.op })} className={field}>
            <option value="atLeast">at least</option>
            <option value="atMost">at most</option>
            <option value="exactly">exactly</option>
          </select>
          {number(c.value, (value) => onChange({ ...c, value }), "Orders")}
          <span className="text-body text-ink-2">orders</span>
        </>
      );
    case "spent": {
      const scale = 10 ** digits;
      return (
        <>
          <select aria-label="How much" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as typeof c.op })} className={field}>
            <option value="atLeast">at least</option>
            <option value="atMost">at most</option>
          </select>
          {number(Math.round(c.minor / scale), (n) => onChange({ ...c, minor: n * scale }), `Amount in ${currency}`)}
          <span className="text-body text-ink-2">{currency}, without VAT</span>
        </>
      );
    }
    case "lastOrder":
      return (
        <>
          <select aria-label="When" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as typeof c.op, days: e.target.value === "never" ? undefined : (c.days ?? 30) })} className={field}>
            <option value="within">in the last</option>
            <option value="before">more than</option>
            <option value="never">never ordered</option>
          </select>
          {c.op !== "never" && (
            <>
              {number(c.days ?? 30, (days) => onChange({ ...c, days: Math.max(1, days) }), "Days")}
              <span className="text-body text-ink-2">{c.op === "before" ? "days ago" : "days"}</span>
            </>
          )}
        </>
      );
    case "firstOrder":
      return (
        <>
          <select aria-label="When" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as typeof c.op })} className={field}>
            <option value="within">in the last</option>
            <option value="before">more than</option>
          </select>
          {number(c.days, (days) => onChange({ ...c, days: Math.max(1, days) }), "Days")}
          <span className="text-body text-ink-2">{c.op === "before" ? "days ago" : "days"}</span>
        </>
      );
    case "rfm":
      return <Choices label="Customer type" options={RFM_SEGMENTS.map((g) => ({ value: g, label: g }))} chosen={c.groups} onChange={(groups) => onChange({ ...c, groups: groups as RfmSegment[] })} />;
    case "country":
      return <Choices label="Country" options={countries.map((x) => ({ value: x.code, label: x.name }))} chosen={c.codes} onChange={(codes) => onChange({ ...c, codes })} />;
    case "language":
      return <Choices label="Language" options={languages.map((x) => ({ value: x.code, label: x.name }))} chosen={c.codes} onChange={(codes) => onChange({ ...c, codes })} />;
    case "group":
      return groups.length === 0 ? (
        <span className="text-body text-muted">The store has no customer groups yet.</span>
      ) : (
        <Choices label="Customer group" options={groups.map((g) => ({ value: g.id, label: g.name }))} chosen={c.ids} onChange={(ids) => onChange({ ...c, ids })} />
      );
    case "company":
    case "account":
      return (
        <select aria-label={CONDITION_KIND_WORDS[c.kind]} value={c.has ? "yes" : "no"} onChange={(e) => onChange({ ...c, has: e.target.value === "yes" })} className={field}>
          <option value="yes">{c.kind === "company" ? "buys for a company" : "has an account"}</option>
          <option value="no">{c.kind === "company" ? "does not buy for a company" : "has no account"}</option>
        </select>
      );
    case "tag":
      return tags.length === 0 ? (
        <span className="text-body text-muted">No one is tagged yet. Tag people on their customer page.</span>
      ) : (
        <Choices label="Tags" options={tags.map((t) => ({ value: t.label, label: t.label }))} chosen={c.tags.filter((t) => t !== "")} onChange={(next) => onChange({ ...c, tags: next })} />
      );
  }
}
