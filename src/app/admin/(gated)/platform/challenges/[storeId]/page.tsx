import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ButtonLink, Card, Chip, PageHeader } from "@/components/admin/ui";
import { adminDate, PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { formatPercent } from "@/lib/analytics-core";
import { formatAmount } from "@/lib/analytics-format";
import { mayFreeze } from "@/lib/challenge-baseline";
import { RATIO_KEYS, type RatioKey } from "@/lib/challenge-scoreboard";
import { utcDay } from "@/lib/autopilot-challenge";
import { CONSOLE_WORDS } from "@/lib/admin-words/console";
import { requirePlatformReader } from "@/server/auth";
import { scoreboardOf } from "@/server/challenge-scoreboard";

import { freezeBaselineAction, removeOriginalAction, saveOriginalAction } from "../actions";

export const metadata: Metadata = { title: "Scoreboard" };

const input = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/**
 * The referee's scoreboard of one challenge store (`docs/100-day-challenge.md` 3.3, E7, D623): the clone and the original side by side on one
 * definition, each ratio with who is ahead, the leader on two of three, the 80 % ad-money rule, the clone's AI and plan counted as its costs,
 * and the original's signed periods with the form to add one (an owner of the platform; every role reads). Read live.
 */
export default async function ChallengeScoreboardPage({ params }: PageProps<"/admin/platform/challenges/[storeId]">) {
  await connection();
  const admin = await requirePlatformReader();
  const { storeId } = await params;
  if (!z.uuid().safeParse(storeId).success) notFound();
  const s = await scoreboardOf(storeId);
  if (!s) notFound();
  const lang = adminLangOf(admin.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const all = CONSOLE_WORDS[lang].challenges;
  const w = all.board;
  const money = (minor: number | null) => (minor === null ? w.notKnown : formatAmount(minor, s.currency, locale));
  const ratio = (key: RatioKey, value: number | null) =>
    value === null ? w.none : key === "margin" ? formatPercent(value, 1) : key === "perKrone" ? value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : money(value);
  const share = (v: number | null) => (v === null ? w.none : formatPercent(v, 0));
  const canWrite = admin.platformAdmin;
  const b = s.board;
  const rows: { label: string; clone: string; original: string; ahead?: string }[] = [
    { label: w.figures.netSales, clone: money(s.clone?.netSalesMinor ?? null), original: money(s.original?.netSalesMinor ?? null) },
    { label: w.figures.contribution, clone: money(s.clone?.contributionMinor ?? null), original: money(s.original?.contributionMinor ?? null) },
    { label: w.figures.marketing, clone: money(s.clone?.marketingMinor ?? null), original: money(s.original?.marketingMinor ?? null) },
    {
      label: w.figures.sessions,
      clone: s.clone?.sessions === null || s.clone === null ? w.notKnown : s.clone.sessions.toLocaleString(locale),
      original: s.original?.sessions === null || s.original === null ? w.notKnown : s.original.sessions.toLocaleString(locale),
    },
    ...RATIO_KEYS.map((key) => ({
      label: w.figures[key],
      clone: ratio(key, b?.ratios[key].clone ?? null),
      original: ratio(key, b?.ratios[key].original ?? null),
      ahead: b?.ratios[key].ahead ? w.leaders[b.ratios[key].ahead!] : w.none,
    })),
  ];
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={fillWords(w.title, { store: s.storeName })} description={w.description} actions={<ButtonLink href="/admin/platform/challenges">{w.back}</ButtonLink>} />

      <Card>
        <div className="flex flex-col gap-4">
          {b && (
            <p className="text-body text-ink">
              {b.leader === "clone" || b.leader === "original" ? (
                <Chip signal={b.leader === "clone" ? "positive" : "warning"} dot>
                  {fillWords(w.leads, { leader: w.leaders[b.leader] })}
                </Chip>
              ) : (
                <span className="text-ink-2">{b.leader === "even" ? w.even : w.noLeader}</span>
              )}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-body">
              <thead className="text-caption text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-4" />
                  <th scope="col" className="py-2 pr-4">{w.clone}</th>
                  <th scope="col" className="py-2 pr-4">{w.original}</th>
                  <th scope="col" className="py-2 pr-4">{w.ahead}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.label}>
                    <th scope="row" className="py-2 pr-4 font-normal text-ink-2">{r.label}</th>
                    <td className="py-2 pr-4 text-ink tabular-nums">{r.clone}</td>
                    <td className="py-2 pr-4 text-ink tabular-nums">{r.original}</td>
                    <td className="py-2 pr-4 text-ink-2">{r.ahead ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {s.spans.length > 0 && <p className="text-caption text-muted">{fillWords(w.spans, { spans: s.spans.map((sp) => fillWords(w.period, sp)).join(", ") })}</p>}
          <p className="text-body text-ink-2">
            {s.agreedAdMinor === null
              ? w.noAdMoney
              : fillWords(w.adMoney, { agreed: money(s.agreedAdMinor), clone: share(b?.ad.clone ?? null), original: share(b?.ad.original ?? null) })}
          </p>
          {b?.underSpent.map((side) => (
            <p key={side} className="text-body text-danger-text">
              {fillWords(w.underSpent, { side: w.leaders[side] })}
            </p>
          ))}
          {s.clone && <p className="text-caption text-muted">{fillWords(w.cloneCosts, { ai: money(s.clone.aiMinor), plan: money(s.clone.planMinor) })}</p>}
          {s.notes.length > 0 && (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-body text-ink-2">
              {s.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card title={w.baseline.title}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-3xl text-body text-ink-2">
            {s.challenge.baseline
              ? fillWords(w.baseline.frozen, {
                  when: adminDate(PLATFORM_TIME_ZONE, s.challenge.baseline.frozenAt, "dayTime", lang),
                  fee: `${formatPercent(s.challenge.baseline.costs.paymentFeeBps / 10_000, 2)} + ${formatAmount(s.challenge.baseline.costs.paymentFeeFixedMinor, s.challenge.baseline.currency, locale)}`,
                  shipping: formatAmount(s.challenge.baseline.costs.shippingCostMinor, s.challenge.baseline.currency, locale),
                  handling: formatAmount(s.challenge.baseline.costs.handlingCostMinor, s.challenge.baseline.currency, locale),
                  ad: s.challenge.baseline.adMoney === null ? w.baseline.none : money(s.agreedAdMinor),
                  withCost: s.challenge.baseline.variantsWithCost.toLocaleString(locale),
                  withoutCost: s.challenge.baseline.variantsWithoutCost.toLocaleString(locale),
                })
              : mayFreeze(s.challenge.dayOne, utcDay(new Date()))
                ? w.baseline.notFrozen
                : w.baseline.closed}
          </p>
          {canWrite && mayFreeze(s.challenge.dayOne, utcDay(new Date())) && (
            <ActionForm action={freezeBaselineAction.bind(null, storeId)} successMessage={w.baseline.frozenNow}>
              <SubmitButton variant={s.challenge.baseline ? "secondary" : "primary"}>{s.challenge.baseline ? w.baseline.freezeAgain : w.baseline.freeze}</SubmitButton>
            </ActionForm>
          )}
        </div>
      </Card>

      <Card title={w.periods} description={w.periodsText}>
        {s.challenge.original.length === 0 ? (
          <p className="text-body text-muted">{w.noPeriods}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {s.challenge.original.map((p) => {
              const contribution = p.netSalesMinor - p.cogsMinor - p.shippingMinor - p.paymentFeesMinor - p.marketingMinor - p.otherMinor;
              return (
                <li key={p.from} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span className="flex flex-col">
                    <span className="text-body text-ink tabular-nums">
                      {fillWords(w.period, { from: p.from, to: p.to })} · {w.figures.netSales.toLowerCase()} {formatAmount(p.netSalesMinor, p.currency, locale)} · {w.figures.contribution.toLowerCase()}{" "}
                      {formatAmount(contribution, p.currency, locale)}
                    </span>
                    <span className="text-caption text-muted">{fillWords(w.signed, { by: p.signedBy, on: p.signedOn })}</span>
                  </span>
                  {canWrite && (
                    <ActionForm action={removeOriginalAction.bind(null, storeId, p.from)} successMessage={w.removed}>
                      <SubmitButton variant="secondary">{w.remove}</SubmitButton>
                    </ActionForm>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {canWrite && (
        <Card title={w.add} description={w.addText}>
          <ActionForm action={saveOriginalAction.bind(null, storeId)} className="flex flex-col gap-4" successMessage={w.saved}>
            <div className="grid max-w-3xl gap-4 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm">
                {w.fields.from}
                <input name="from" type="date" required className={input} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {w.fields.to}
                <input name="to" type="date" required className={input} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {w.fields.currency}
                <input name="currency" type="text" required defaultValue={s.currency} maxLength={3} className={`${input} uppercase`} />
              </label>
            </div>
            <div className="grid max-w-3xl gap-4 sm:grid-cols-3">
              {(["netSales", "cogs", "shipping", "paymentFees", "marketing", "other"] as const).map((key) => (
                <label key={key} className="flex flex-col gap-1 text-sm">
                  {w.fields[key]}
                  <input name={key} type="text" inputMode="decimal" required={key === "netSales" || key === "cogs"} autoComplete="off" className={input} />
                </label>
              ))}
              <label className="flex flex-col gap-1 text-sm">
                {w.fields.sessions}
                <input name="sessions" type="number" min={0} step={1} className={input} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {w.fields.orders}
                <input name="orders" type="number" min={0} step={1} className={input} />
              </label>
            </div>
            <div className="grid max-w-3xl gap-4 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                {w.fields.signedBy}
                <input name="signedBy" type="text" required maxLength={120} autoComplete="off" className={input} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {w.fields.signedOn}
                <input name="signedOn" type="date" required className={input} />
              </label>
            </div>
            <div>
              <SubmitButton>{w.save}</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
