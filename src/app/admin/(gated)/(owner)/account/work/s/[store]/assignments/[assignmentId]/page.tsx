import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AssignmentStatusControl, DeleteAssignmentButton } from "@/components/admin/work/assignment-actions";
import { AssignmentSummaryCard } from "@/components/admin/work/assignment-detail";
import { EditAssignmentButton } from "@/components/admin/work/client-actions";
import { AssignmentInvoicesSlot, BillUnbilledTimeSlot } from "@/components/admin/work/invoice-slots";
import { TasksPanel } from "@/components/admin/work/tasks-panel";
import { TimePanel } from "@/components/admin/work/time-panel";
import { TimerToggle } from "@/components/admin/work/timer-controls";
import { Badge } from "@/components/admin/work/work-parts";
import { WorkOff } from "@/components/admin/work/work-off";
import { todayIn } from "@/lib/work-dates";
import { formDefaults, getAssignmentDetail, getClient, listClients } from "@/server/work";
import { listAssignmentChoices } from "@/server/work-choices";
import { listTimeEntries } from "@/server/work-time";
import { workBase } from "@/lib/work-paths";
import { memberCan, requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Assignment" };

const ENTRY_LIMIT = 500;

/**
 * One assignment (D122): its progress against the estimate, its tasks, the time
 * logged on it and a timer to start on it or any task. Any member works on an
 * assignment; owners change any time entry, others their own.
 */
export default async function WorkAssignmentPage({
  params,
}: PageProps<"/admin/account/work/s/[store]/assignments/[assignmentId]">) {
  const { store: slug, assignmentId } = await params;
  const staffer = await requirePermission(slug, "settings:read");
  const { store, account } = staffer;
  if (!store.workOn) return <WorkOff storeSlug={store.slug} title="Assignment" />;
  const assignment = await getAssignmentDetail(store.id, assignmentId);
  if (!assignment) notFound();

  const s = assignment.summary;
  const untouched = s.loggedMinutes === 0 && assignment.draftInvoiceId === null && assignment.issuedInvoices === 0;
  const [entries, choices, defaults, client, clients] = await Promise.all([
    listTimeEntries(store.id, { assignmentId, limit: ENTRY_LIMIT }),
    listAssignmentChoices(store.id, [assignmentId]),
    formDefaults(store),
    getClient(store.id, assignment.clientId),
    untouched ? listClients(store.id) : Promise.resolve([]),
  ]);
  const choice = choices.find((c) => c.id === assignment.id);
  if (!choice) notFound();

  const base = workBase(store.slug);
  const locale = store.markets[0]?.locale ?? "en";
  const today = todayIn(store.timeZone);
  const viewer = { accountId: account.id, owner: memberCan(staffer, "owner") };
  const target = {
    storeSlug: store.slug,
    storeName: store.name,
    assignmentId: assignment.id,
    assignmentName: assignment.name,
    clientId: assignment.clientId,
    clientName: assignment.clientName,
    taskId: null,
    taskTitle: null,
  };
  // Where it could move: the clients in use, and the one it is with even if that one is archived.
  const moveTo = [
    ...clients.map(({ id, name }) => ({ id, name })),
    ...(clients.some((c) => c.id === assignment.clientId)
      ? []
      : [{ id: assignment.clientId, name: assignment.clientName }]),
  ];
  const STATUS_TONE = { active: "good", paused: "warn", done: "neutral" } as const;
  const STATUS_TEXT = { active: "Active", paused: "Paused", done: "Done" } as const;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <nav aria-label="Breadcrumb" className="text-sm">
          <Link href={`${base}/clients`} className="underline">
            Clients
          </Link>{" "}
          /{" "}
          <Link href={`${base}/clients/${assignment.clientId}`} className="underline">
            {assignment.clientName}
          </Link>
        </nav>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold [overflow-wrap:anywhere]">
              {assignment.name} <Badge tone={STATUS_TONE[assignment.status]}>{STATUS_TEXT[assignment.status]}</Badge>{" "}
              {s.invoiced && <Badge tone="good">Invoiced</Badge>}
            </h1>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <AssignmentStatusControl storeSlug={store.slug} assignmentId={assignment.id} status={assignment.status} />
            <TimerToggle target={target} subject={assignment.name} className="min-h-10" />
            <EditAssignmentButton
              storeSlug={store.slug}
              clientId={assignment.clientId}
              currency={assignment.currency}
              clientRateMinor={client?.defaultHourlyRateMinor ?? null}
              locale={locale}
              assignment={assignment}
              estimateAlert={defaults.estimateAlert}
              moveTo={untouched ? moveTo : undefined}
            />
          </div>
        </div>
      </div>

      <AssignmentSummaryCard assignment={assignment} base={base} locale={locale} />

      <BillUnbilledTimeSlot
        storeSlug={store.slug}
        scope={{ assignmentId: assignment.id }}
        currency={assignment.currency}
        locale={locale}
        unbilledMinutes={s.unbilledMinutes}
        unbilledAmountMinor={s.unbilledAmountMinor}
      />

      <TasksPanel
        storeSlug={store.slug}
        assignmentId={assignment.id}
        assignmentName={assignment.name}
        clientId={assignment.clientId}
        clientName={assignment.clientName}
        tasks={assignment.tasks}
        alertMinutes={assignment.estimateAlertMinutes}
        choice={choice}
        today={today}
      />

      <TimePanel
        storeSlug={store.slug}
        choice={choice}
        entries={entries.entries}
        today={today}
        viewer={viewer}
        locale={locale}
        truncated={entries.totals.count > entries.entries.length}
      />

      <AssignmentInvoicesSlot
        storeSlug={store.slug}
        assignmentId={assignment.id}
        assignmentName={assignment.name}
        clientId={assignment.clientId}
        currency={assignment.currency}
        locale={locale}
        draftInvoiceId={assignment.draftInvoiceId}
        issuedInvoices={assignment.issuedInvoices}
        unbilledMinutes={s.unbilledMinutes}
        unbilledAmountMinor={s.unbilledAmountMinor}
      />

      <section aria-labelledby="delete-heading" className="flex flex-col gap-2 border-t border-border pt-4">
        <h2 id="delete-heading" className="text-sm font-medium">
          Delete this assignment
        </h2>
        <p className="text-sm text-muted">
          Only an assignment with no time and no invoices can be deleted. Otherwise mark it done: its time and invoices
          stay explained.
        </p>
        <DeleteAssignmentButton
          storeSlug={store.slug}
          assignmentId={assignment.id}
          clientId={assignment.clientId}
          name={assignment.name}
        />
      </section>
    </div>
  );
}
