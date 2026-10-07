"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import type { FeatureBlocker, FeatureGroupId, FeatureId, FeatureRow } from "@/lib/store-features";

/** What a switch's server action answers (`switchFeatureAction`). */
export type SwitchResult = { ok: true } | { ok: false; problems: string[]; blockers?: FeatureBlocker[]; warnings?: string[]; needsConfirmation?: boolean };

export type FeaturesViewProps = {
  /** The store's admin address: `/admin/{store}`. */
  base: string;
  owner: boolean;
  shop: FeatureRow;
  groups: { id: FeatureGroupId; label: string; rows: FeatureRow[] }[];
  count: { on: number; total: number };
  /** Switches a feature; `confirmed` once the owner has read the warnings. */
  onSwitch: (id: FeatureId, on: boolean, confirmed: boolean) => Promise<SwitchResult>;
};

/**
 * The Features page (D178): the online shop's master switch, then each group's features with a switch each. Switching on is at once;
 * switching off opens a panel under the row with what disappears, and what blocks it (with links) or what to confirm. Non-owners see it read
 * only. Drawn in the admin's semantic tokens (D149), full width, with large targets for a phone.
 */
export function FeaturesView({ base, owner, shop, groups, count, onSwitch }: FeaturesViewProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Features</h1>
        <p className="text-sm text-muted">
          Switch on what your store uses; the rest stays out of your way. Nothing is deleted when you switch something off.
        </p>
        <p className="text-sm font-medium" data-testid="feature-count">
          {count.on} of {count.total} on
        </p>
        {!owner && <p className="text-sm">Only an owner can switch features on or off.</p>}
      </div>

      <section aria-labelledby="feature-group-shop" className="rounded-lg border border-border bg-surface">
        <h2 id="feature-group-shop" className="sr-only">
          Online shop
        </h2>
        <ul>
          <FeatureItem row={shop} base={base} owner={owner} onSwitch={onSwitch} master />
        </ul>
      </section>

      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`feature-group-${group.id}`} className="rounded-lg border border-border bg-surface">
          <h2 id={`feature-group-${group.id}`} className="px-4 pt-4 font-medium">
            {group.label}
          </h2>
          <ul className="divide-y divide-border">
            {group.rows.map((row) => (
              <FeatureItem key={row.id} row={row} base={base} owner={owner} onSwitch={onSwitch} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

type ItemProps = {
  row: FeatureRow;
  base: string;
  owner: boolean;
  master?: boolean;
  onSwitch: FeaturesViewProps["onSwitch"];
};

function FeatureItem({ row, base, owner, master = false, onSwitch }: ItemProps) {
  const [confirming, setConfirming] = useState(false);
  const [answer, setAnswer] = useState<SwitchResult | null>(null);
  const [pending, start] = useTransition();
  const asleep = row.kept && !row.on;
  // A feature whose needs are off cannot be switched on; one kept on but asleep can still be put down.
  const locked = row.missing.length > 0 && !row.kept;
  const disabled = !owner || pending || locked;
  const blockers = answer && !answer.ok && answer.blockers ? answer.blockers : row.blockers;
  const warnings = answer && !answer.ok && answer.warnings ? answer.warnings : row.warnings;
  const panelId = `feature-${row.id}-off`;

  const send = (on: boolean, confirmed: boolean) =>
    start(async () => {
      const result = await onSwitch(row.id, on, confirmed);
      setAnswer(result);
      if (result.ok) setConfirming(false);
      else if (result.needsConfirmation || result.blockers?.length) setConfirming(true);
    });

  const press = () => {
    setAnswer(null);
    if (row.kept) setConfirming(true);
    else send(true, false);
  };

  return (
    <li className={`flex flex-col gap-3 p-4 ${row.missing.length > 0 ? "opacity-70" : ""}`} data-feature={row.id}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span id={`feature-${row.id}-label`} className={master ? "text-lg font-semibold" : "font-medium"}>
              {row.label}
            </span>
            {row.inUse && !master && <span className="rounded border border-border px-1.5 py-0.5 text-xs text-muted">In use</span>}
          </div>
          <p className="text-sm text-muted">{row.words}</p>
          {row.missing.length > 0 && (
            <p className="text-sm">
              Needs {row.missing.join(" and ")}
              {asleep ? ". Its switch is kept for when that is on." : "."}
            </p>
          )}
          {row.on && !master && (
            <Link href={`${base}${row.setupPath}`} className="inline-flex min-h-11 w-fit items-center text-sm font-medium underline underline-offset-2">
              Set up <span className="sr-only">{row.label.toLowerCase()}</span>
            </Link>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={row.kept}
          aria-labelledby={`feature-${row.id}-label`}
          aria-controls={confirming ? panelId : undefined}
          disabled={disabled}
          onClick={press}
          className="group flex min-h-11 min-w-14 shrink-0 items-center justify-center disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span
            aria-hidden="true"
            className={`relative inline-flex h-7 w-12 items-center rounded-full border border-border transition-colors ${row.kept ? "bg-foreground" : "bg-background"}`}
          >
            <span
              className={`absolute size-5 rounded-full shadow-sm transition-transform ${row.kept ? "translate-x-6 bg-background" : "translate-x-1 bg-muted"}`}
            />
          </span>
        </button>
      </div>

      {answer && !answer.ok && !confirming && (
        <ul role="alert" className="flex flex-col gap-1 text-sm">
          {answer.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      {confirming && (
        <OffPanel
          id={panelId}
          row={row}
          base={base}
          blockers={blockers}
          warnings={warnings}
          pending={pending}
          problems={answer && !answer.ok && !answer.needsConfirmation && blockers.length === 0 ? answer.problems : []}
          onConfirm={() => send(false, true)}
          onCancel={() => {
            setConfirming(false);
            setAnswer(null);
          }}
        />
      )}
    </li>
  );
}

type PanelProps = {
  id: string;
  row: FeatureRow;
  base: string;
  blockers: FeatureBlocker[];
  warnings: string[];
  pending: boolean;
  /** What the server answered besides blockers and warnings. */
  problems: string[];
  onConfirm: () => void;
  onCancel: () => void;
};

/** The confirmation under a feature being switched off: what disappears, then what blocks it (with links, and no way on) or what to confirm. */
export function OffPanel({ id, row, base, blockers, warnings, pending, problems, onConfirm, onCancel }: PanelProps) {
  const blocked = blockers.length > 0;
  return (
    <div id={id} role="region" aria-label={`Switch off ${row.label}`} className="flex flex-col gap-3 rounded-md border border-border bg-background p-4 text-sm">
      <p className="font-medium">Switch off {row.label.toLowerCase()}?</p>
      <p>{row.offWords}</p>
      {blocked ? (
        <>
          <p className="font-medium">It can&apos;t be switched off yet:</p>
          <ul className="flex flex-col gap-2">
            {blockers.map((b) => (
              <li key={b.text}>
                {b.text}{" "}
                <Link href={`${base}${b.path}`} className="inline-flex min-h-11 items-center font-medium underline underline-offset-2">
                  Open
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        warnings.length > 0 && (
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )
      )}
      {problems.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {!blocked && (
          <button
            type="button"
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={onConfirm}
            className="min-h-11 rounded-md bg-foreground px-4 font-medium text-background disabled:opacity-60"
          >
            Switch off
          </button>
        )}
        <button type="button" onClick={onCancel} className="min-h-11 rounded-md border border-border px-4 font-medium">
          {blocked ? "Close" : "Keep it on"}
        </button>
      </div>
    </div>
  );
}
