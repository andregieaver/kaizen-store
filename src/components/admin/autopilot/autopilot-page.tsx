import Link from "next/link";

import { ActionForm, type FormState } from "@/components/admin/action-form";
import { Button, ButtonLink, Card, Chip, List, ListRow, PageHeader, RowActions, RowLead } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import type { AssistantMessages } from "@/lib/admin-messages/assistant.en";
import { adminText } from "@/lib/admin-text";
import { formatUsd } from "@/lib/ai-cost";
import { AUTONOMY_AREAS, AUTONOMY_LEVELS, levelOf } from "@/lib/autopilot-autonomy";
import { FINISHED_STEPS } from "@/lib/autopilot-plans";
import type { AutopilotOverview } from "@/server/autopilot-overview";
import type { Plan, PlanStep } from "@/server/autopilot-plans";

/**
 * The Autopilot page (D309, `docs/ai-autopilot.md` 7.5), a store's and Kaizena Flow's: Decisions first (what waits on the owner, each with its
 * buttons), then Plans, Goals and Settings, one deliberate step away. Words from the `assistant` catalogue's `autopilot`; the plans' own
 * titles, results and questions are the plans', as written.
 */

type Action = { (state: FormState, form: FormData): Promise<FormState> };

export type AutopilotActions = { decide: Action; answer: Action; plan: Action; dropGoal: Action; settings: Action };

export const AUTOPILOT_TABS = ["decisions", "plans", "goals", "settings"] as const;
export type AutopilotTab = (typeof AUTOPILOT_TABS)[number];

export function AutopilotPage({
  overview,
  base,
  assistantHref,
  siteName,
  tab,
  lang,
  actions,
  links,
}: {
  overview: AutopilotOverview;
  /** The page's own address. */
  base: string;
  assistantHref: string;
  siteName: string;
  tab: AutopilotTab;
  lang: AdminLang;
  actions: AutopilotActions;
  /** Where the owner-only things are done (the store's settings pages). */
  links: { payments?: string; plan?: string };
}) {
  const w = adminText(lang, "assistant");
  const a = w.autopilot;
  const waiting = overview.calls.length + overview.questions.length + overview.ownerOnly.length;
  const tabClass = (on: boolean) => `rounded-pill px-3 py-1.5 text-sm ${on ? "bg-sunken text-ink" : "text-muted hover:bg-sunken"}`;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back={{ href: assistantHref, label: w.name }} title={a.title} description={fillWords(a.description, { site: siteName })} />
      <nav aria-label={a.title} className="flex flex-wrap gap-1">
        {AUTOPILOT_TABS.map((t) => (
          <Link key={t} href={t === "decisions" ? base : `${base}?tab=${t}`} className={tabClass(tab === t)} aria-current={tab === t ? "page" : undefined}>
            {a.tabs[t]}
            {t === "decisions" && waiting > 0 ? ` (${waiting})` : ""}
          </Link>
        ))}
      </nav>
      {overview.settings.paused && (
        <p role="status" className="rounded-panel border border-warning-line bg-warning-soft p-4 text-warning-text">
          {a.paused}
        </p>
      )}
      {tab === "decisions" && <Decisions overview={overview} words={a} actions={actions} links={links} />}
      {tab === "plans" && <Plans plans={overview.plans} words={a} action={actions.plan} assistantHref={assistantHref} />}
      {tab === "goals" && <Goals goals={overview.goals} words={a} action={actions.dropGoal} />}
      {tab === "settings" && <Settings overview={overview} words={a} action={actions.settings} />}
    </div>
  );
}

type Words = AssistantMessages["autopilot"];

function Decisions({ overview, words: a, actions, links }: { overview: AutopilotOverview; words: Words; actions: AutopilotActions; links: { payments?: string; plan?: string } }) {
  const d = a.decisions;
  if (overview.calls.length + overview.questions.length + overview.ownerOnly.length === 0) {
    return <Card><p className="text-body text-muted">{d.empty}</p></Card>;
  }
  return (
    <>
      {overview.calls.length > 0 && (
        <Card title={d.calls} count={overview.calls.length}>
          <List label={d.calls}>
            {overview.calls.map((call) => (
              <ListRow key={call.id}>
                <RowLead title={call.summary} sub={call.plan ? fillWords(d.fromPlan, { plan: call.plan.title }) : undefined} />
                <RowActions>
                  <ActionForm action={actions.decide} successMessage={d.approved} className="flex gap-2">
                    <input type="hidden" name="approval" value={call.id} />
                    <Button type="submit" name="approve" value="yes" kind="main" size="dense">
                      {d.approve}
                    </Button>
                    <Button type="submit" name="approve" value="no" size="dense">
                      {d.decline}
                    </Button>
                  </ActionForm>
                </RowActions>
              </ListRow>
            ))}
          </List>
        </Card>
      )}
      {overview.questions.length > 0 && (
        <Card title={d.questions} count={overview.questions.length}>
          <div className="flex flex-col gap-4">
            {overview.questions.map((q) => (
              <div key={`${q.planId}:${q.step}`} className="flex flex-col gap-2 rounded-panel bg-sunken p-4">
                <p className="text-caption text-muted">{fillWords(d.fromPlan, { plan: q.planTitle })}</p>
                <p className="text-body-strong text-ink">{q.question.text}</p>
                <ActionForm action={actions.answer} successMessage={d.answered} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="plan" value={q.planId} />
                  <input type="hidden" name="step" value={q.step} />
                  {q.question.options.length > 0 ? (
                    q.question.options.map((option, i) => (
                      <Button key={option} type="submit" name="answer" value={option} kind={i === 0 ? "main" : "secondary"} size="dense">
                        {option}
                      </Button>
                    ))
                  ) : (
                    <>
                      <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm">
                        {d.yourAnswer}
                        <input name="answer" required maxLength={500} className="min-h-10 rounded-lg border border-edge bg-card px-3 text-sm" />
                      </label>
                      <Button type="submit" kind="main" size="dense">
                        {d.answer}
                      </Button>
                    </>
                  )}
                </ActionForm>
              </div>
            ))}
          </div>
        </Card>
      )}
      {overview.ownerOnly.length > 0 && (
        <Card title={d.ownerOnly}>
          <List label={d.ownerOnly}>
            {overview.ownerOnly.map((key) => (
              <ListRow key={key}>
                <RowLead title={d[key]} />
                {links[key] && (
                  <RowActions>
                    <ButtonLink href={links[key]} size="dense">
                      {d.open}
                    </ButtonLink>
                  </RowActions>
                )}
              </ListRow>
            ))}
          </List>
        </Card>
      )}
    </>
  );
}

const PLAN_SIGNAL = { draft: "neutral", running: "positive", paused: "warning", done: "positive", stopped: "neutral" } as const;
const STEP_SIGNAL = { pending: "neutral", running: "insight", waiting: "warning", asking: "warning", done: "positive", skipped: "neutral", cancelled: "neutral" } as const;

function Plans({ plans, words: a, action, assistantHref }: { plans: AutopilotOverview["plans"]; words: Words; action: Action; assistantHref: string }) {
  const p = a.plans;
  if (plans.length === 0) {
    return (
      <Card>
        <p className="text-body text-muted">{p.empty}</p>
        <div className="mt-4">
          <ButtonLink href={assistantHref} kind="main">
            {p.newPlan}
          </ButtonLink>
        </div>
      </Card>
    );
  }
  return (
    <>
      {plans.map(({ plan, steps }) => (
        <PlanCard key={plan.id} plan={plan} steps={steps} words={a} action={action} />
      ))}
    </>
  );
}

function PlanCard({ plan, steps, words: a, action }: { plan: Plan; steps: PlanStep[]; words: Words; action: Action }) {
  const p = a.plans;
  const done = steps.filter((s) => s.status === "done").length;
  const buttons: ("start" | "resume" | "pause" | "stop")[] =
    plan.status === "draft" ? ["start", "stop"] : plan.status === "running" ? ["pause", "stop"] : plan.status === "paused" ? ["resume", "stop"] : [];
  return (
    <Card
      title={plan.title}
      aside={<Chip signal={PLAN_SIGNAL[plan.status]}>{p.status[plan.status]}</Chip>}
      description={[fillWords(p.steps, { done, all: steps.length }), plan.pauseReason].filter(Boolean).join(" · ")}
    >
      {plan.summary && <p className="mb-3 text-body text-ink-2">{plan.summary}</p>}
      <ol className="flex flex-col divide-y divide-line">
        {steps.map((s) => (
          <li key={s.id} className="flex flex-col gap-1 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-body ${FINISHED_STEPS.includes(s.status) ? "text-ink-2" : "text-ink"}`}>{s.title}</span>
              <Chip signal={STEP_SIGNAL[s.status]}>{p.step[s.status]}</Chip>
            </div>
            {s.result?.done && <p className="text-caption text-muted">{s.result.done}</p>}
            {s.result?.problem && <p className="text-caption text-danger-text">{s.result.problem}</p>}
            {s.answer && s.status !== "asking" && <p className="text-caption text-muted">{fillWords(p.answeredWith, { answer: s.answer })}</p>}
          </li>
        ))}
      </ol>
      {buttons.length > 0 && (
        <ActionForm action={action} successMessage={p.started} className="mt-4 flex flex-wrap gap-2">
          <input type="hidden" name="plan" value={plan.id} />
          <input type="hidden" name="version" value={plan.version} />
          {buttons.map((b) => (
            <Button key={b} type="submit" name="do" value={b} kind={b === "start" || b === "resume" ? "main" : b === "stop" ? "danger" : "secondary"} size="dense">
              {p[b]}
            </Button>
          ))}
        </ActionForm>
      )}
    </Card>
  );
}

function Goals({ goals, words: a, action }: { goals: AutopilotOverview["goals"]; words: Words; action: Action }) {
  const g = a.goals;
  if (goals.length === 0) return <Card><p className="text-body text-muted">{g.empty}</p></Card>;
  return (
    <>
      {goals.map((goal) => (
        <Card
          key={goal.id}
          title={goal.title}
          aside={<Chip signal={goal.status === "met" ? "positive" : goal.status === "dropped" ? "neutral" : "insight"}>{g[goal.status === "met" ? "met" : goal.status === "dropped" ? "dropped" : "active"]}</Chip>}
          description={goal.dueOn ? fillWords(g.due, { date: goal.dueOn }) : undefined}
        >
          {goal.vision && <p className="mb-3 text-body text-ink-2">{goal.vision}</p>}
          <ul className="flex flex-col divide-y divide-line">
            {goal.progress.map((t, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-body text-ink">{t.target}</span>
                <span className="flex items-center gap-2 text-body text-ink-2">
                  {t.met === null ? g.notMeasured : t.now}
                  {t.met === true && <Chip signal="positive">{g.met}</Chip>}
                </span>
                {t.missing && <span className="w-full text-caption text-muted">{t.missing}</span>}
              </li>
            ))}
          </ul>
          {goal.status === "active" && (
            <ActionForm action={action} successMessage={g.droppedNow} className="mt-4">
              <input type="hidden" name="goal" value={goal.id} />
              <Button type="submit" size="dense">
                {g.drop}
              </Button>
            </ActionForm>
          )}
        </Card>
      ))}
    </>
  );
}

function Settings({ overview, words: a, action }: { overview: AutopilotOverview; words: Words; action: Action }) {
  const s = a.settings;
  const settings = overview.settings;
  return (
    <Card title={a.tabs.settings} description={s.intro}>
      <ActionForm action={action} successMessage={s.saved} className="flex flex-col gap-6">
        <label className="flex items-start gap-3">
          <input type="checkbox" name="running" defaultChecked={!settings.paused} className="mt-1" />
          <span className="flex flex-col">
            <span className="text-body-strong text-ink">{s.running}</span>
            <span className="text-caption text-muted">{s.runningHelp}</span>
          </span>
        </label>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-title text-ink">{s.levels}</legend>
          {AUTONOMY_AREAS.map((area) => (
            <label key={area} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-body text-ink">{a.areas[area]}</span>
              <select name={`level_${area}`} defaultValue={levelOf(settings, area)} className="min-h-10 min-w-56 rounded-lg border border-edge bg-card px-3 text-sm">
                {AUTONOMY_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {a.levelNames[level]}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <p className="text-caption text-muted">{s.never}</p>
        </fieldset>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-title text-ink">{s.budgets}</legend>
          <label className="flex flex-col gap-1 text-sm">
            {s.aiMonthly}
            <input
              name="ai_monthly"
              type="number"
              min={0}
              step="0.01"
              defaultValue={settings.budgets.aiMonthlyUsd ?? ""}
              className="min-h-10 max-w-40 rounded-lg border border-edge bg-card px-3 text-sm"
            />
            <span className="text-caption text-muted">{fillWords(s.aiMonthlyHelp, { spent: formatUsd(overview.costMicros) })}</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {s.discount}
            <input name="discount_percent" type="number" min={0} max={100} defaultValue={settings.budgets.discountPercent} className="min-h-10 max-w-40 rounded-lg border border-edge bg-card px-3 text-sm" />
            <span className="text-caption text-muted">{s.discountHelp}</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {s.priceChange}
            <input name="price_change_percent" type="number" min={0} max={1000} defaultValue={settings.budgets.priceChangePercent} className="min-h-10 max-w-40 rounded-lg border border-edge bg-card px-3 text-sm" />
            <span className="text-caption text-muted">{s.priceChangeHelp}</span>
          </label>
        </fieldset>
        <div>
          <Button type="submit" kind="main">
            {s.save}
          </Button>
        </div>
      </ActionForm>
    </Card>
  );
}
