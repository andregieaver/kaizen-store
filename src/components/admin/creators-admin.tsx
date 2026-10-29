"use client";

import { useState, useTransition } from "react";

import { useAdminText } from "@/components/admin/admin-text";
import { Button, Card, Chip, List, ListRow, RowActions, RowFact, RowLead } from "@/components/admin/ui";
import { bpsToPercent, percentToBps, type CreatorPayoutRow, type CreatorProblem, type CreatorResult, type CreatorRow, type CreatorSettings, type CreatorStatus } from "@/lib/creators";
import { formatMoney } from "@/lib/money";
import { parsePrice } from "@/lib/product-input";

type Words = ReturnType<typeof useAdminText<"loyalty">>["creators"];

const SIGNAL: Record<CreatorStatus, "positive" | "warning" | "neutral" | "danger"> = {
  applied: "warning",
  approved: "positive",
  declined: "neutral",
  stopped: "danger",
};

function useResult() {
  const [problem, setProblem] = useState<CreatorProblem | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const run = (work: () => Promise<CreatorResult>) =>
    start(async () => {
      setSaved(false);
      const result = await work();
      setProblem(result.ok ? null : result.problem);
      setSaved(result.ok);
    });
  return { problem, saved, pending, run };
}

/**
 * The creator programme's settings (D386): the switch, the commission, categories with their own and how long a link is remembered. An owner
 * edits; anyone else reads.
 */
export function CreatorSettingsForm({
  initial,
  categories,
  canEdit,
  save,
}: {
  initial: CreatorSettings;
  categories: { id: string; name: string }[];
  canEdit: boolean;
  save: (raw: unknown) => Promise<CreatorResult>;
}) {
  const w = useAdminText("loyalty").creators;
  const [enabled, setEnabled] = useState(initial.enabled);
  const [percent, setPercent] = useState(bpsToPercent(initial.commissionBps));
  const [days, setDays] = useState(String(initial.cookieDays));
  const [rows, setRows] = useState(Object.entries(initial.categoryBps).map(([id, bps]) => ({ id, percent: bpsToPercent(bps) })));
  const { problem, saved, pending, run } = useResult();
  const unused = categories.filter((c) => !rows.some((r) => r.id === c.id));

  const submit = () => {
    const commissionBps = percentToBps(percent);
    const categoryBps: Record<string, number> = {};
    for (const row of rows) {
      const bps = percentToBps(row.percent);
      if (bps === null) return run(async () => ({ ok: false, problem: "invalid" }));
      categoryBps[row.id] = bps;
    }
    if (commissionBps === null) return run(async () => ({ ok: false, problem: "invalid" }));
    run(() => save({ enabled, commissionBps, categoryBps, cookieDays: Number(days) }));
  };

  return (
    <Card title={w.settingsHeading} description={canEdit ? undefined : w.ownerNote}>
      <form
        aria-busy={pending}
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset disabled={!canEdit || pending} className="flex flex-col gap-4">
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-5" />
            <span className="text-body-strong text-ink">{w.enabled}</span>
          </label>
          <label className="flex max-w-xs flex-col gap-1">
            <span className="text-body text-ink-2">{w.commission}</span>
            <input value={percent} onChange={(e) => setPercent(e.target.value)} inputMode="decimal" className="input" />
          </label>
          <div className="flex flex-col gap-2">
            <span className="text-body-strong text-ink">{w.categoriesHeading}</span>
            <span className="text-caption text-muted">{w.categoriesHint}</span>
            {categories.length === 0 && <span className="text-caption text-muted">{w.noCategories}</span>}
            {rows.map((row, i) => (
              <div key={row.id} className="flex flex-wrap items-end gap-2">
                <span className="min-w-40 text-body text-ink">{categories.find((c) => c.id === row.id)?.name ?? row.id}</span>
                <label className="flex flex-col gap-1">
                  <span className="sr-only">{w.commission}</span>
                  <input
                    value={row.percent}
                    onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, percent: e.target.value } : r)))}
                    inputMode="decimal"
                    className="input w-24"
                  />
                </label>
                <Button kind="quiet" size="dense" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  {w.remove}
                </Button>
              </div>
            ))}
            {unused.length > 0 && (
              <label className="flex max-w-sm flex-col gap-1">
                <span className="text-body text-ink-2">{w.addCategory}</span>
                <select
                  value=""
                  onChange={(e) => e.target.value && setRows([...rows, { id: e.target.value, percent: percent }])}
                  className="select"
                >
                  <option value="">{w.category}</option>
                  {unused.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <label className="flex max-w-xs flex-col gap-1">
            <span className="text-body text-ink-2">{w.cookieDays}</span>
            <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" className="input" />
            <span className="text-caption text-muted">{w.cookieHint}</span>
          </label>
        </fieldset>
        {problem && (
          <p role="alert" className="text-body text-danger-text">
            {w.problems[problem]}
          </p>
        )}
        {saved && (
          <p role="status" className="text-body text-positive-text">
            {w.saved}
          </p>
        )}
        {canEdit && (
          <div>
            <Button kind="main" type="submit" disabled={pending}>
              {w.save}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

/** One creator in the list: who, their channel, code, figures and money, and what the person may do with them. */
function CreatorItem({
  row,
  w,
  locale,
  isOwner,
  decide,
  setRate,
  recordPayout,
}: {
  row: CreatorRow;
  w: Words;
  locale: string;
  isOwner: boolean;
  decide: (id: string, decision: "approve" | "decline" | "stop") => Promise<CreatorResult>;
  setRate: (id: string, bps: number | null) => Promise<CreatorResult>;
  recordPayout: (id: string, raw: unknown) => Promise<CreatorResult>;
}) {
  const { problem, pending, run } = useResult();
  const [rate, setRateText] = useState(row.commissionBps === null ? "" : bpsToPercent(row.commissionBps));
  const owedIn = row.balances.filter((b) => b.owedMinor > 0);
  const [currency, setCurrency] = useState(owedIn[0]?.currency ?? row.balances[0]?.currency ?? "");
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const erased = row.email === null;

  return (
    <ListRow>
      <div className="flex w-full flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <RowLead
            title={erased ? w.erased : row.name}
            sub={
              erased ? undefined : (
                <a href={row.channelUrl} target="_blank" rel="noopener noreferrer nofollow" className="underline">
                  {row.channelUrl}
                </a>
              )
            }
          />
          <Chip signal={SIGNAL[row.status]}>{w.status[row.status]}</Chip>
          {row.email && <RowFact sub={w.email}>{row.email}</RowFact>}
          {row.code && <RowFact sub={w.code}>{row.code}</RowFact>}
          <RowFact sub={w.orders}>{row.orders}</RowFact>
          <RowFact sub={w.visits}>{row.visits}</RowFact>
          <RowFact sub={w.owed}>
            {row.balances.length === 0 ? w.nothingOwed : row.balances.map((b) => formatMoney(b.owedMinor, b.currency, locale)).join(" · ")}
          </RowFact>
          {!erased && (
            <RowActions>
              {(row.status === "applied" || row.status === "declined" || row.status === "stopped") && (
                <Button kind="strong" size="dense" disabled={pending} onClick={() => run(() => decide(row.id, "approve"))}>
                  {row.status === "applied" ? w.approve : w.resume}
                </Button>
              )}
              {row.status === "applied" && (
                <Button size="dense" disabled={pending} onClick={() => run(() => decide(row.id, "decline"))}>
                  {w.decline}
                </Button>
              )}
              {row.status === "approved" && (
                <Button kind="danger" size="dense" disabled={pending} onClick={() => run(() => decide(row.id, "stop"))}>
                  {w.stop}
                </Button>
              )}
            </RowActions>
          )}
        </div>
        {isOwner && !erased && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-caption text-muted">{w.ownRate}</span>
              <input value={rate} placeholder={w.programmeRate} onChange={(e) => setRateText(e.target.value)} inputMode="decimal" className="input w-32" />
            </label>
            <Button
              size="dense"
              disabled={pending}
              onClick={() => {
                const bps = rate.trim() === "" ? null : percentToBps(rate);
                if (rate.trim() !== "" && bps === null) return run(async () => ({ ok: false, problem: "invalid" }));
                run(() => setRate(row.id, bps));
              }}
            >
              {w.setRate}
            </Button>
          </div>
        )}
        {isOwner && owedIn.length > 0 && (
          <form
            className="flex flex-wrap items-end gap-2"
            aria-busy={pending}
            onSubmit={(event) => {
              event.preventDefault();
              const minor = parsePrice(amount, currency);
              if (minor === null || minor <= 0) return run(async () => ({ ok: false, problem: "invalid" }));
              run(async () => {
                const result = await recordPayout(row.id, { currency, amountMinor: minor, paidOn, reference });
                if (result.ok) setAmount("");
                return result;
              });
            }}
          >
            <span className="w-full text-body-strong text-ink">{w.recordPayout}</span>
            <label className="flex flex-col gap-1">
              <span className="text-caption text-muted">{w.currency}</span>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="select">
                {owedIn.map((b) => (
                  <option key={b.currency} value={b.currency}>
                    {b.currency}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-caption text-muted">{w.amount}</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required className="input w-32" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-caption text-muted">{w.paidOn}</span>
              <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} required className="input" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-caption text-muted">{w.reference}</span>
              <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} className="input" />
            </label>
            <Button type="submit" size="dense" disabled={pending}>
              {w.recordPayout}
            </Button>
          </form>
        )}
        {problem && (
          <p role="alert" className="text-body text-danger-text">
            {w.problems[problem]}
          </p>
        )}
      </div>
    </ListRow>
  );
}

/** The store's creators, applications first (D386). */
export function CreatorsList({
  rows,
  locale,
  isOwner,
  decide,
  setRate,
  recordPayout,
}: {
  rows: CreatorRow[];
  locale: string;
  isOwner: boolean;
  decide: (id: string, decision: "approve" | "decline" | "stop") => Promise<CreatorResult>;
  setRate: (id: string, bps: number | null) => Promise<CreatorResult>;
  recordPayout: (id: string, raw: unknown) => Promise<CreatorResult>;
}) {
  const w = useAdminText("loyalty").creators;
  return (
    <Card title={w.listHeading}>
      {rows.length === 0 ? (
        <p className="text-body text-muted">{w.empty}</p>
      ) : (
        <List label={w.listHeading}>
          {rows.map((row) => (
            <CreatorItem key={row.id} row={row} w={w} locale={locale} isOwner={isOwner} decide={decide} setRate={setRate} recordPayout={recordPayout} />
          ))}
        </List>
      )}
    </Card>
  );
}

/** The payouts recorded, newest first, and the owner's download. */
export function CreatorPayouts({ rows, locale, csvAction }: { rows: CreatorPayoutRow[]; locale: string; csvAction: string | null }) {
  const w = useAdminText("loyalty").creators;
  return (
    <Card
      title={w.payoutsHeading}
      aside={
        csvAction && (
          <form method="post" action={csvAction}>
            <Button type="submit" size="dense">
              {w.download}
            </Button>
          </form>
        )
      }
    >
      {rows.length === 0 ? (
        <p className="text-body text-muted">{w.payoutsEmpty}</p>
      ) : (
        <table className="w-full text-left text-body">
          <thead>
            <tr className="text-eyebrow text-muted">
              <th scope="col">{w.paidOn}</th>
              <th scope="col">{w.creator}</th>
              <th scope="col">{w.amount}</th>
              <th scope="col">{w.reference}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="py-2 tabular-nums">{p.paidOn}</td>
                <td>{p.creatorName || w.erased}</td>
                <td className="tabular-nums">{formatMoney(p.amountMinor, p.currency, locale)}</td>
                <td>{p.reference}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
