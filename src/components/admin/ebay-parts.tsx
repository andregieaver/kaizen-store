"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useAdminText } from "@/components/admin/admin-text";
import { card, field, hint, label, primary, secondary } from "@/components/admin/data/ui";
import { countWords } from "@/lib/admin-fill";
import { EBAY_CARRIERS, EBAY_MARKETPLACES } from "@/lib/ebay";

type Step = { ok: true } | { ok: false; problem: string };

function useRun() {
  const router = useRouter();
  const [message, setMessage] = useState<{ tone: "ok" | "problem"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (job: () => Promise<Step | { ok: true; changed: number }>, done: (r: { ok: true; changed?: number }) => string) =>
    start(async () => {
      setMessage(null);
      const result = await job();
      if (!result.ok) return setMessage({ tone: "problem", text: result.problem });
      setMessage({ tone: "ok", text: done(result) });
      router.refresh();
    });
  const view = (
    <div role="status" aria-live="polite">
      {message && <p className={`text-sm ${message.tone === "problem" ? "text-danger-text" : ""}`}>{message.text}</p>}
    </div>
  );
  return { run, pending, view };
}

const SETTING_KEYS = ["fulfillmentPolicyId", "paymentPolicyId", "returnPolicyId", "merchantLocationKey", "categoryId"] as const;

/** The marketplace and what eBay asks every offer to name (D555). */
export function EbaySettingsForm({ initial, save }: { initial: Record<string, string>; save: (raw: Record<string, string>) => Promise<Step> }) {
  const w = useAdminText("notifications").integrations.ebay;
  const [values, setValues] = useState<Record<string, string>>({ marketplace: "EBAY_DE", ...initial });
  const { run, pending, view } = useRun();
  return (
    <form
      className={`${card} flex flex-col gap-3`}
      aria-label={w.settingsTitle}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => save(values), () => w.saved);
      }}
    >
      <h2 className="text-title text-ink">{w.settingsTitle}</h2>
      <p className={hint}>{w.settingsIntro}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className={label}>{w.marketplace}</span>
          <select value={values.marketplace} onChange={(e) => setValues({ ...values, marketplace: e.target.value })} className={field}>
            {Object.entries(EBAY_MARKETPLACES).map(([id, m]) => (
              <option key={id} value={id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        {SETTING_KEYS.map((k) => (
          <label key={k} className="flex flex-col gap-1">
            <span className={label}>{w[k]}</span>
            <input value={values[k] ?? ""} onChange={(e) => setValues({ ...values, [k]: e.target.value })} className={field} autoComplete="off" />
          </label>
        ))}
      </div>
      <button type="submit" disabled={pending} className={`${primary} self-start`}>
        {w.save}
      </button>
      {view}
    </form>
  );
}

export type EbayProductRow = { variantId: string; name: string; sku: string; state: "pending" | "listed" | "error" | "ended" | null; error: string | null };

/** Tick products and list them on eBay, or stop listing them. */
export function EbayProducts({ rows, choose }: { rows: EbayProductRow[]; choose: (ids: string[], on: boolean) => Promise<{ ok: true; changed: number } | { ok: false; problem: string }> }) {
  const w = useAdminText("notifications").integrations.ebay;
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const { run, pending, view } = useRun();
  const ids = [...chosen];
  const stateText = (r: EbayProductRow) => (r.state === "listed" ? w.listed : r.state === "pending" ? w.pending : r.state === "error" ? w.error.replace("{error}", r.error ?? "") : w.notListed);
  return (
    <section className="flex flex-col gap-3" aria-labelledby="ebay-products">
      <h2 id="ebay-products" className="text-title text-ink">
        {w.productsTitle}
      </h2>
      <p className={hint}>{w.productsIntro}</p>
      <ul className="flex flex-col divide-y divide-line rounded-panel border border-line bg-sunken">
        {rows.map((r) => (
          <li key={r.variantId} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
            <input
              type="checkbox"
              aria-label={r.name}
              className="size-5"
              checked={chosen.has(r.variantId)}
              onChange={() => {
                const next = new Set(chosen);
                if (next.has(r.variantId)) next.delete(r.variantId);
                else next.add(r.variantId);
                setChosen(next);
              }}
            />
            <span className="min-w-48 flex-1 font-medium">{r.name}</span>
            <span className="text-muted">{r.sku}</span>
            <span className={r.state === "error" ? "text-danger-text" : "text-muted"}>{stateText(r)}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending || ids.length === 0} onClick={() => run(() => choose(ids, true), (r) => countWords(r.changed ?? 0, w.changed))} className={primary}>
          {w.list}
        </button>
        <button type="button" disabled={pending || ids.length === 0} onClick={() => run(() => choose(ids, false), (r) => countWords(r.changed ?? 0, w.changed))} className={secondary}>
          {w.unlist}
        </button>
      </div>
      {view}
    </section>
  );
}

/** Mark one eBay order sent: the carrier and tracking number go to eBay. */
export function EbayMarkSent({ mark }: { mark: (carrier: string, tracking: string) => Promise<Step> }) {
  const w = useAdminText("notifications").integrations.ebay;
  const [carrier, setCarrier] = useState<string>("DHL");
  const [tracking, setTracking] = useState("");
  const { run, pending, view } = useRun();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => mark(carrier, tracking), () => w.sent);
      }}
    >
      <label className="flex flex-col gap-1 text-xs">
        {w.carrier}
        <select value={carrier} onChange={(e) => setCarrier(e.target.value)} className={field}>
          {EBAY_CARRIERS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        {w.tracking}
        <input value={tracking} onChange={(e) => setTracking(e.target.value)} className={`${field} w-48`} required />
      </label>
      <button type="submit" disabled={pending} className={secondary}>
        {w.markSent}
      </button>
      {view}
    </form>
  );
}

/** A button that runs a step and shows its answer (connect, disconnect). */
export function EbayButton({ text, act, tone = "secondary" }: { text: string; act: () => Promise<Step | void>; tone?: "primary" | "secondary" }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <span className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        className={`${tone === "primary" ? primary : secondary} self-start`}
        onClick={() =>
          start(async () => {
            const result = await act();
            if (result && !result.ok) setProblem(result.problem);
            else router.refresh();
          })
        }
      >
        {text}
      </button>
      {problem && <span className="text-sm text-danger-text">{problem}</span>}
    </span>
  );
}
