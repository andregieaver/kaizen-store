import type { Metadata } from "next";

import { DomainMoveSteps } from "@/components/admin/domain-move-steps";
import { ButtonLink, PageHeader } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import { MOVE_KEEP_DAYS, type MoveGoal } from "@/lib/domain-move";
import { movePlan } from "@/server/domain-move";
import { requireOwnerRole } from "@/server/permissions";

import { checkNameserversAction, disconnectAction, revealCodeAction, signInAgainAction, stayHereAction, switchBackAction, switchNameserversAction } from "./actions";

export const metadata: Metadata = { title: "Move a domain" };

const GOALS: readonly MoveGoal[] = ["registrar", "dns", "elsewhere", "leave"];

/**
 * Moving one of the store's domains away (D315 8): the owner picks what they want in plain words, and the page lists that move's steps,
 * each checked by code. Owners only; it works on a closed store too (the owner's key is allowed there).
 */
export default async function MoveDomainPage({ params, searchParams }: PageProps<"/admin/[store]/settings/domains/move/[domain]">) {
  const { store: slug, domain } = await params;
  const member = await requireOwnerRole(slug);
  const lang = adminLangOf(member.account.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const words = adminText(lang, "domains").move;
  const apex = decodeURIComponent(domain).toLowerCase();
  const goalParam = (await searchParams).goal;
  const goal = GOALS.find((g) => g === goalParam) ?? null;
  const base = `/admin/${slug}/settings/domains`;
  const here = `${base}/move/${encodeURIComponent(apex)}`;
  const date = (iso: string | null) => (iso ? new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Oslo" }).format(new Date(iso)) : null);

  const header = <PageHeader back={{ href: base, label: words.back }} title={fillWords(words.title, { domain: apex })} description={words.intro} />;
  const choices = (
    <nav className="flex flex-wrap gap-2" aria-label={words.open}>
      {GOALS.map((g) => (
        <ButtonLink key={g} href={`${here}?goal=${g}`} kind={g === goal ? "strong" : "secondary"} aria-current={g === goal ? "page" : undefined}>
          {words.goals[g]}
        </ButtonLink>
      ))}
    </nav>
  );
  if (!goal) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        {choices}
      </div>
    );
  }

  const plan = await movePlan(member.store.id, apex, goal);
  if (!plan.ok) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <p className="text-body text-danger-text">{plan.problems.join(" ")}</p>
      </div>
    );
  }
  const { facts } = plan;
  const blockerWords = words.transfer.blockers;
  const adviceWords = words.transfer.advice;
  const fmt = (values: Record<string, string>) => ({ ...values, ...(values.date ? { date: date(values.date) ?? values.date } : {}) });
  const keptUntil = facts.zone?.leavingAt ? new Date(new Date(facts.zone.leavingAt).getTime() + MOVE_KEEP_DAYS * 86_400_000).toISOString() : null;

  return (
    <div className="flex flex-col gap-6">
      {header}
      {choices}
      <DomainMoveSteps
        words={words}
        view={{
          apex,
          steps: plan.steps,
          exportHref: `${here}/export`,
          zone: facts.zone ? { status: facts.zone.status, movedTo: facts.zone.movedTo, leavingOn: date(facts.zone.leavingAt), keptUntil: date(keptUntil) } : null,
          registeredHere: Boolean(facts.registration),
          registeredHereNote: facts.registration ? null : fillWords(words.transfer.notHere, { domain: apex }),
          transferStatus: facts.registration?.status ?? null,
          movedOn: date(facts.registration?.transferredOutAt ?? null),
          blockers: facts.transfer.blockers.map((b) => fillWords(blockerWords[b.code], fmt(b.values))),
          advice: facts.transfer.advice.map((a) => fillWords(adviceWords[a.code], fmt(a.values))),
          registrantEmail: facts.registrantEmail,
          connected: facts.connected.map((d) => d.hostname),
        }}
        actions={{
          check: checkNameserversAction.bind(null, slug, apex),
          switch: switchNameserversAction.bind(null, slug, apex),
          switchBack: switchBackAction.bind(null, slug, apex),
          reveal: revealCodeAction.bind(null, slug, apex),
          stay: stayHereAction.bind(null, slug, apex),
          disconnect: disconnectAction.bind(null, slug, apex),
          signInAgain: signInAgainAction.bind(null, slug, apex),
        }}
      />
    </div>
  );
}
