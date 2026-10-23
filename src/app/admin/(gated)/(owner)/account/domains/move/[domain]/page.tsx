import type { Metadata } from "next";

import { DomainMoveSteps } from "@/components/admin/domain-move-steps";
import { ButtonLink, PageHeader } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import { MOVE_KEEP_DAYS, type MoveGoal } from "@/lib/domain-move";
import { movePlan } from "@/server/domain-move";
import { requireAccount } from "@/server/auth";
import { accountHolder } from "@/server/domain-holder";

import { checkNameserversAction, disconnectAction, revealCodeAction, signInAgainAction, stayHereAction, switchBackAction, switchNameserversAction } from "./actions";

export const metadata: Metadata = { title: "Move a domain" };

const GOALS: readonly MoveGoal[] = ["registrar", "dns", "elsewhere", "leave"];

/**
 * Moving one of the account's domains away (D315 8, D317): as on a store's page, for the holder, whichever store uses the domain.
 */
export default async function MoveHeldDomainPage({ params, searchParams }: PageProps<"/admin/account/domains/move/[domain]">) {
  const { domain } = await params;
  const account = await requireAccount();
  const lang = adminLangOf(account.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const words = adminText(lang, "domains").move;
  const apex = decodeURIComponent(domain).toLowerCase();
  const goalParam = (await searchParams).goal;
  const goal = GOALS.find((g) => g === goalParam) ?? null;
  const base = "/admin/account/domains";
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

  const plan = await movePlan(accountHolder(account.id), apex, goal);
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
          check: checkNameserversAction.bind(null, apex),
          switch: switchNameserversAction.bind(null, apex),
          switchBack: switchBackAction.bind(null, apex),
          reveal: revealCodeAction.bind(null, apex),
          stay: stayHereAction.bind(null, apex),
          disconnect: disconnectAction.bind(null, apex),
          signInAgain: signInAgainAction.bind(null, apex),
        }}
      />
    </div>
  );
}
