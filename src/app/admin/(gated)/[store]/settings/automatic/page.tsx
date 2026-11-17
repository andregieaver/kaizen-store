import type { Metadata } from "next";

import { AdminLink, Card, CARD_CLASS, Chip, List, ListRow, PageHeader, RowDate, RowLead } from "@/components/admin/ui";
import type { AutomaticMessages } from "@/lib/admin-messages/automatic.en";
import type { MarketingMessages } from "@/lib/admin-messages/marketing.en";
import type { NotificationsMessages } from "@/lib/admin-messages/notifications.en";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { activeLines, lineHref, whenPaidSteps, type ActiveLine, type AutomaticOverview, type PaidStep } from "@/lib/automatic";
import type { AutomationKind } from "@/lib/automation-kinds";
import { EVENTS } from "@/lib/integrations";
import { automaticOverview } from "@/server/automatic";
import { requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Automatic" };

/**
 * Settings → Automatic (ecosystem plan E3.3, D718): everything in the store that runs by itself, in one place, so *what happens when an order
 * is paid?* takes one screen instead of seven. For Homer, plain lines: what happens when an order is paid, in its order, and what runs by itself
 * now, each with when it last did and a link to where it is changed. For Lisa, behind *Details*: every part, on or off, with what starts it and
 * what it does. `settings:read`; it changes nothing.
 */
export default async function AutomaticPage({ params }: PageProps<"/admin/[store]/settings/automatic">) {
  const member = await requirePermission((await params).store, "settings:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const all = adminText(lang, "notifications");
  const w = adminText(lang, "automatic").overview;
  const automations = adminText(lang, "marketing").automations;
  const kinds = (kind: AutomationKind) => (kind === "back_in_stock" ? automations.backInStock : automations.kinds[kind]);
  const flowWords = all.workflows;
  const base = `/admin/${store.slug}`;
  const overview = await automaticOverview(store);
  const steps = whenPaidSteps(overview);
  const lines = activeLines(overview);
  const trigger = (id: string) => all.integrations.events[id]?.label ?? EVENTS.find((e) => e.id === id)?.label ?? id;
  const when = (iso: string) => new Date(iso).toLocaleString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone || "Europe/Oslo" });
  /** When it last did something: never for what keeps its own runs, or not within the 30 days an email is looked for. */
  const last = (at: string | null, kept: boolean) => fillWords(w.last, { when: at ? when(at) : kept ? w.notYet : w.notLately });
  const keepsRuns = (kind: (ActiveLine | PaidStep)["kind"]) => kind === "workflow" || kind === "rule" || kind === "endpoint" || kind === "integration" || kind === "autopilot";

  const stepText = (step: PaidStep): string => {
    switch (step.kind) {
      case "confirmation":
        return w.paid.confirmation;
      case "workflow":
        return fillWords(w.paid.workflow, { name: step.name });
      case "rule":
        return fillWords(w.paid.rule, { name: step.name });
      case "staff_email":
        return step.recipients === 0 ? w.paid.staffNobody : countWords(step.recipients, w.paid.staffEmail);
      case "push":
        return countWords(step.devices, w.paid.push);
      case "endpoint":
        return fillWords(w.paid.endpoint, { name: step.name });
      case "integration":
        return w.paid.integration[step.provider];
    }
  };

  const lineText = (line: ActiveLine): { title: string; sub: string | null } => {
    switch (line.kind) {
      case "workflow":
        return {
          title: fillWords(w.line.workflow, { name: line.name }),
          sub: line.schedule
            ? fillWords(line.schedule.every === "week" ? w.sub.everyWeek : w.sub.everyDay, { at: line.schedule.at })
            : fillWords(w.sub.when, { trigger: trigger(line.trigger) }),
        };
      case "rule":
        return { title: fillWords(w.line.rule, { name: line.name }), sub: w.sub.paid };
      case "email_automation":
        return { title: fillWords(w.line.emailAutomation, { name: kinds(line.automation).title }), sub: kinds(line.automation).does };
      case "cart_reminders":
        return { title: countWords(line.steps, w.line.cartReminders), sub: null };
      case "review_requests":
        return { title: countWords(line.days, w.line.reviewRequests), sub: null };
      case "staff_alert":
        return { title: countWords(line.recipients, w.line.staffAlert, { name: all.staff.alerts[line.event] ?? line.event }), sub: null };
      case "push":
        return { title: countWords(line.devices, w.line.push), sub: null };
      case "endpoint":
        return { title: fillWords(w.line.endpoint, { name: line.name }), sub: line.failing ? w.sub.failing : countWords(line.topics, w.sub.events) };
      case "integration":
        return { title: w.line.integration[line.provider], sub: countWords(line.events, w.sub.events) };
      case "autopilot":
        return { title: w.line.autopilot, sub: null };
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={<>{w.description}</>} />
      {steps.length > 0 && (
        <Card title={w.paidTitle} description={w.paidDescription}>
          <ol className="flex flex-col divide-y divide-line" data-automatic="paid">
            {steps.map((step, i) => (
              <li key={`${step.kind}-${i}`} className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 py-3">
                <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sunken text-caption text-ink-2 tabular-nums">
                  {i + 1}
                </span>
                <RowLead title={stepText(step)} href={lineHref(step, base)} sub={`${step.soon ? w.withinMinute : w.atOnce} · ${last(step.lastAt, keepsRuns(step.kind))}`} />
              </li>
            ))}
          </ol>
        </Card>
      )}
      <Card title={w.runningTitle} description={w.runningDescription} count={lines.length}>
        {lines.length === 0 ? (
          <p className="text-body text-muted">{w.none}</p>
        ) : (
          <List label={w.runningTitle}>
            {lines.map((line, i) => {
              const text = lineText(line);
              return (
                <ListRow key={`${line.kind}-${i}`} href={lineHref(line, base)}>
                  <RowLead title={text.title} sub={text.sub ?? undefined} />
                  <RowDate>{last(line.lastAt, keepsRuns(line.kind))}</RowDate>
                </ListRow>
              );
            })}
          </List>
        )}
      </Card>
      <Details overview={overview} words={w} flowWords={flowWords} kinds={kinds} alerts={all.staff.alerts} trigger={trigger} base={base} />
    </div>
  );
}

/** Lisa's view: every part, on or off, with what starts it and what it does, behind one disclosure. */
function Details({
  overview: o,
  words: w,
  flowWords,
  kinds,
  alerts,
  trigger,
  base,
}: {
  overview: AutomaticOverview;
  words: AutomaticMessages["overview"];
  flowWords: NotificationsMessages["workflows"];
  kinds: (kind: AutomationKind) => Pick<MarketingMessages["automations"]["backInStock"], "title" | "does">;
  alerts: Record<string, string>;
  trigger: (id: string) => string;
  base: string;
}) {
  const state = (on: boolean) => (
    <Chip signal={on ? "positive" : "neutral"} dot>
      {on ? w.on : w.off}
    </Chip>
  );
  const actions = (list: readonly string[]) => fillWords(w.facts.actions, { actions: list.map((k) => flowWords.actionKinds[k] ?? k).join(", ") || w.facts.none });
  const group = (title: string, href: string, rows: { key: string; name: string; on: boolean; facts: string[] }[]) =>
    rows.length === 0 ? null : (
      <section key={title} className="flex flex-col gap-2">
        <h3 className="text-body-strong text-ink">
          <AdminLink href={href} className="underline-offset-2 hover:underline">
            {title}
          </AdminLink>
        </h3>
        <ul role="list" className="divide-y divide-line">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-body">
              <span className="min-w-0 flex-1 basis-56 text-ink">{row.name}</span>
              <span className="text-caption text-muted">{row.facts.join(" · ")}</span>
              {state(row.on)}
            </li>
          ))}
        </ul>
      </section>
    );
  return (
    <details className={`group ${CARD_CLASS}`} data-automatic="details">
      <summary className="flex min-h-14 cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-6 py-3 [&::-webkit-details-marker]:hidden">
        <span className="text-body-strong text-ink">{w.details}</span>
        <span className="text-caption text-muted">{w.detailsHint}</span>
      </summary>
      <div className="flex flex-col gap-6 px-6 pb-6">
        {group(
          w.groups.workflows,
          `${base}/settings/workflows`,
          o.workflows.map((f) => ({
            key: f.id,
            name: f.name,
            on: f.enabled,
            facts: [
              fillWords(w.facts.trigger, { trigger: f.schedule ? flowWords.schedule : trigger(f.trigger) }),
              countWords(f.conditions, w.facts.conditions),
              actions(f.actions),
              countWords(f.runsLastDay, w.facts.runsDay),
            ],
          })),
        )}
        {o.shop &&
          group(
            w.groups.rules,
            `${base}/settings/automation`,
            o.rules.map((r) => ({ key: r.id, name: r.name, on: r.enabled, facts: [countWords(r.conditions, w.facts.conditions), actions(r.actions.map(ruleActionAsWorkflow))] })),
          )}
        {group(
          w.groups.emails,
          `${base}/automations`,
          o.emailAutomations.map((a) => ({ key: a.kind, name: kinds(a.kind).title, on: a.enabled, facts: [kinds(a.kind).does] })),
        )}
        {o.shop &&
          group(w.groups.carts, `${base}/cart-reminders`, [
            { key: "carts", name: w.groups.carts, on: o.cartReminders.enabled && o.cartReminders.activeSteps > 0, facts: [countWords(o.cartReminders.activeSteps, w.facts.steps)] },
          ])}
        {o.reviewRequests &&
          group(w.groups.reviews, `${base}/reviews`, [
            { key: "reviews", name: w.groups.reviews, on: o.reviewRequests.enabled, facts: [fillWords(w.facts.days, { n: o.reviewRequests.days })] },
          ])}
        {group(w.groups.staff, `${base}/settings/notifications/staff`, [
          ...o.staffAlerts.map((a) => ({
            key: a.event,
            name: alerts[a.event] ?? a.event,
            on: a.recipients > 0 && (a.event !== "summary" || o.summary !== "off"),
            facts: [countWords(a.recipients, w.facts.recipients), ...(a.event === "summary" ? [w.facts.summary[o.summary]] : [])],
          })),
        ])}
        {group(w.groups.devices, "/admin/account", [{ key: "push", name: w.groups.devices, on: o.push.devices > 0, facts: [countWords(o.push.devices, w.facts.devices)] }])}
        {group(
          w.groups.endpoints,
          `${base}/integrations/endpoints`,
          o.endpoints.map((e) => ({ key: e.id, name: e.name, on: e.enabled, facts: [fillWords(w.facts.topics, { topics: e.topics.map(trigger).join(", ") }), ...(e.failing ? [w.sub.failing] : [])] })),
        )}
        {group(
          w.groups.services,
          `${base}/integrations`,
          o.integrations.map((i) => ({ key: i.provider, name: w.line.integration[i.provider], on: i.enabled, facts: [fillWords(w.facts.topics, { topics: i.events.map(trigger).join(", ") || w.facts.none })] })),
        )}
        {o.autopilot &&
          group(w.groups.autopilot, `${base}/assistant/autopilot`, [
            {
              key: "autopilot",
              name: w.groups.autopilot,
              on: o.autopilot.reacts && !o.autopilot.paused,
              facts: [o.autopilot.paused ? w.facts.paused : o.autopilot.reacts ? w.facts.reacts : w.facts.notReacting],
            },
          ])}
      </div>
    </details>
  );
}

/** A rule's action in a workflow's words, as `actionToWorkflow()` moves it. */
const ruleActionAsWorkflow = (kind: string) => ({ tag: "tag_order", notify: "email_staff", hold: "hold_order", ask: "ask_ai_manager" })[kind] ?? kind;
