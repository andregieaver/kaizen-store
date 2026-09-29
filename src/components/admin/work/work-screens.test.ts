import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { RunningTimer, TimeEntryItem } from "@/server/work-time";
import type { AssignmentSummary, WorkAssignmentItem, WorkClientItem, WorkTaskItem } from "@/server/work";
import type { AssignmentChoice } from "@/server/work-choices";
import { EMPTY_TIME_FILTERS } from "@/lib/work-ui";
import { timerFromServer } from "@/lib/work-timer-ui";

// The actions are server code (they import the database); the screens only call them when a button is pressed.
vi.mock("@/app/admin/(gated)/[store]/work/actions", () => {
  const action = () => vi.fn(async () => ({ ok: true }));
  return {
    createClientAction: action(),
    updateClientAction: action(),
    archiveClientAction: action(),
    deleteClientAction: action(),
    createAssignmentAction: action(),
    updateAssignmentAction: action(),
    setAssignmentStatusAction: action(),
    deleteAssignmentAction: action(),
    createTaskAction: action(),
    renameTaskAction: action(),
    setTaskStatusAction: action(),
    setTaskEstimateAction: action(),
    reorderTasksAction: action(),
    deleteTaskAction: action(),
    logTimeAction: action(),
    setEntryNoteAction: action(),
    deleteTimeEntryAction: action(),
    startTimerAction: action(),
    stopTimerAction: action(),
    discardTimerAction: action(),
    runningTimerAction: vi.fn(async () => null),
  };
});
// The invoice screens' places (`invoice-slots`) read invoices with server code and call its actions.
vi.mock("server-only", () => ({}));
vi.mock("@/app/admin/(gated)/[store]/work/invoice-actions", () => ({}));
vi.mock("@/app/admin/(gated)/[store]/work/invoice-view-actions", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import { AssignmentStatusControl } from "./assignment-actions";
import { AssignmentSummaryCard } from "./assignment-detail";
import { AssignmentForm } from "./assignment-form";
import { ArchiveClientButton, DeleteClientButton, EditClientButton, NewClientButton } from "./client-actions";
import { ClientAssignments, ClientDetails, ClientFigures } from "./client-detail";
import { ClientForm } from "./client-form";
import { ClientsList } from "./clients-list";
import { AssignmentInvoicesSlot, BillUnbilledTimeSlot, ClientInvoicesSlot } from "./invoice-slots";
import { LogTimeForm } from "./log-time-form";
import { QuickTimer } from "./quick-timer";
import { TasksPanel } from "./tasks-panel";
import { TimeEntryList } from "./time-entry-list";
import { TimeFiltersForm } from "./time-filters";
import { TimePanel } from "./time-panel";
import { TimerAlertDialog, TimerBar } from "./timer-bar";
import { TimerContext } from "./timer-context";
import { TimerToggle } from "./timer-controls";
import type { WorkTimer } from "./use-work-timer";

/**
 * The Work screens are server-rendered pages and client forms that render on the
 * server too: this holds that each draws in every state (empty, busy, archived,
 * a timer running, each stage of an estimate) and says what it should.
 */

const html = (element: ReactElement) => renderToString(element).replace(/<!-- -->/g, "");

const BASE = "/admin/kaffe/work";

// --- Fixtures ------------------------------------------------------------------------

const client = (over: Partial<WorkClientItem> = {}): WorkClientItem => ({
  id: "c1",
  name: "Acme AB",
  legalName: "Acme Aktiebolag",
  organisationNumber: "556677-8899",
  vatNumber: "SE556677889901",
  country: "SE",
  billingAddress: { line1: "Storgatan 1", line2: "", postalCode: "111 22", city: "Stockholm" },
  billingEmail: "ap@acme.example",
  contactName: "Anna Berg",
  phone: "+46 8 123 456",
  locale: "sv",
  currency: "SEK",
  defaultHourlyRateMinor: 110_000,
  paymentDays: 30,
  business: true,
  vatTreatment: "reverse_charge",
  customerCompanyId: null,
  customerId: null,
  usePrepaid: true,
  notes: "Send invoices to accounts payable.",
  archivedAt: null,
  sortOrder: 0,
  createdAt: "2026-09-01T08:00:00.000Z",
  activeAssignments: 2,
  loggedMinutes: 900,
  billableMinutes: 780,
  unbilledMinutes: 300,
  ...over,
});

const summary = (over: Partial<AssignmentSummary> = {}): AssignmentSummary => ({
  loggedMinutes: 300,
  billableMinutes: 270,
  unbilledMinutes: 270,
  rateMinor: 110_000,
  rateSource: "client",
  billableAmountMinor: 495_000,
  unbilledAmountMinor: 495_000,
  estimatedMinutes: 600,
  remainingMinutes: 300,
  utilisationPercent: 50,
  stage: "ok",
  invoiced: false,
  ...over,
});

const assignment = (over: Partial<WorkAssignmentItem> = {}): WorkAssignmentItem => ({
  id: "a1",
  clientId: "c1",
  name: "Website rebuild",
  status: "active",
  billingType: "hourly",
  hourlyRateMinor: null,
  fixedAmountMinor: null,
  estimatedMinutes: 600,
  startDate: "2026-09-01",
  endDate: null,
  estimateAlertMinutes: 10,
  estimateAlertPopup: true,
  estimateAlertSound: false,
  sortOrder: 0,
  createdBy: null,
  createdAt: "2026-09-01T08:00:00.000Z",
  clientName: "Acme AB",
  clientArchived: false,
  currency: "SEK",
  summary: summary(),
  draftInvoiceId: null,
  issuedInvoices: 0,
  ...over,
});

const task = (over: Partial<WorkTaskItem> = {}): WorkTaskItem => ({
  id: "t1",
  assignmentId: "a1",
  title: "Design",
  status: "open",
  estimatedMinutes: 120,
  sortOrder: 0,
  createdAt: "2026-09-01T08:00:00.000Z",
  loggedMinutes: 60,
  billableMinutes: 60,
  remainingMinutes: 60,
  utilisationPercent: 50,
  stage: "ok",
  ...over,
});

const choice: AssignmentChoice = {
  id: "a1",
  name: "Website rebuild",
  clientId: "c1",
  clientName: "Acme AB",
  status: "active",
  tasks: [
    { id: "t1", title: "Design", done: false },
    { id: "t2", title: "Build", done: true },
  ],
};
const other: AssignmentChoice = { ...choice, id: "a2", name: "Support", tasks: [] };

const entry = (over: Partial<TimeEntryItem> = {}): TimeEntryItem => ({
  id: "e1",
  assignmentId: "a1",
  assignmentName: "Website rebuild",
  clientId: "c1",
  clientName: "Acme AB",
  taskId: "t1",
  taskTitle: "Design",
  accountId: "me",
  accountName: "Kari",
  workDate: "2026-09-28",
  minutes: 90,
  billable: true,
  note: "Kick-off call",
  prepaidMinutes: 0,
  invoiceableMinutes: 90,
  invoiceLineId: null,
  invoiceId: null,
  invoiceStatus: null,
  invoiceNumber: null,
  locked: false,
  createdAt: "2026-09-28T09:00:00.000Z",
  ...over,
});

const server = (over: Partial<RunningTimer> = {}): RunningTimer => ({
  accountId: "me",
  assignmentId: "a1",
  assignmentName: "Website rebuild",
  clientId: "c1",
  clientName: "Acme AB",
  taskId: "t1",
  taskTitle: "Design",
  startedAt: "2026-09-29T10:00:00.000Z",
  serverNow: "2026-09-29T10:12:34.000Z",
  elapsedSeconds: 754,
  estimate: null,
  ...over,
});

const estimateOf = (left: number, minutes: number | null = 10): RunningTimer["estimate"] => ({
  target: "task",
  estimatedMinutes: 120,
  // 12 minutes have run: `left` is what is left after them.
  loggedMinutes: 120 - left - 12,
  remainingAtStartMinutes: left + 12,
  settings: { minutes, popup: true, sound: false },
  stage: "ok",
  alert: null,
});

const api = (over: Partial<WorkTimer> = {}): WorkTimer => ({
  storeSlug: "kaffe",
  timer: null,
  pendingEntry: null,
  now: 0,
  start: () => {},
  stop: () => {},
  discard: () => {},
  busy: false,
  status: "",
  error: null,
  dismissError: () => {},
  alert: null,
  dismissAlert: () => {},
  ...over,
});

const inTimer = (value: WorkTimer | null, child: ReactElement) =>
  html(createElement(TimerContext.Provider, { value }, child));

// --- The running timer --------------------------------------------------------------------

describe("the running timer bar", () => {
  it("draws nothing but its live region while no timer runs", () => {
    const out = inTimer(api(), createElement(TimerBar));
    expect(out).toContain('role="status"');
    expect(out).not.toContain("Running timer");
    expect(inTimer(null, createElement(TimerBar))).toBe("");
  });

  it("shows the clock as the server read it, what it runs on, and Stop", () => {
    const out = inTimer(api({ timer: timerFromServer(server(), 0) }), createElement(TimerBar));
    expect(out).toContain('aria-label="Running timer"');
    expect(out).toContain('role="timer"');
    expect(out).toContain("0:12:34");
    expect(out).toContain("Design, Website rebuild");
    expect(out).toContain("for Acme AB");
    expect(out).toContain(`/admin/kaffe/work/assignments/a1`);
    expect(out).toContain("Stop");
    expect(out).toContain("Discard");
  });

  it("says what is left of the estimate, in words, at each stage", () => {
    const at = (left: number, minutes: number | null = 10) =>
      inTimer(
        api({ timer: timerFromServer(server({ estimate: estimateOf(left, minutes) }), 0) }),
        createElement(TimerBar),
      );
    const ok = at(60);
    expect(ok).toContain("1h left of the task&#x27;s estimate");
    expect(ok).toContain("text-muted");
    const near = at(5);
    expect(near).toContain("5m left");
    expect(near).toContain("text-amber-800");
    // 12 minutes ran after the estimate was read: 0 left is used up, -3 is over.
    expect(at(0)).toContain("Used up");
    const over = at(-3);
    expect(over).toContain("3m over");
    expect(over).toContain("text-red-700");
    // Warnings off do not hide that it is over.
    expect(at(-3, null)).toContain("text-red-700");
  });

  it("shows a clock that is still starting, and what went wrong with a press", () => {
    const starting = inTimer(
      api({ timer: { ...timerFromServer(server(), 0), key: "pending" } }),
      createElement(TimerBar),
    );
    expect(starting).toContain("Starting …");
    expect(starting).toContain("disabled");
    const failed = inTimer(api({ error: "That assignment no longer exists." }), createElement(TimerBar));
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("That assignment no longer exists.");
    expect(failed).toContain("Dismiss");
  });

  it("puts what happened in a live region for a screen reader", () => {
    expect(inTimer(api({ status: "Timer stopped. 13m logged on Design." }), createElement(TimerBar))).toContain(
      "Timer stopped. 13m logged on Design.",
    );
  });
});

describe("the estimate popup", () => {
  it("is closed while there is no warning", () => {
    expect(inTimer(api(), createElement(TimerAlertDialog))).not.toContain("estimate is nearly used up");
  });

  it("says what is nearly used up, and offers Stop and carrying on", () => {
    const timer = timerFromServer(server({ estimate: estimateOf(5) }), 0);
    const near = inTimer(api({ timer, alert: { stage: "near", timer } }), createElement(TimerAlertDialog));
    expect(near).toContain("Nearly at the estimate");
    expect(near).toContain("The estimate for Design (2h) is nearly used up.");
    expect(near).toContain("Stop the timer");
    expect(near).toContain("Keep going");
    const over = inTimer(api({ timer, alert: { stage: "over", timer } }), createElement(TimerAlertDialog));
    expect(over).toContain("Estimate used up");
    expect(over).toContain("keeps running");
  });
});

describe("the start and stop buttons", () => {
  const target = {
    assignmentId: "a1",
    assignmentName: "Website rebuild",
    clientId: "c1",
    clientName: "Acme AB",
    taskId: "t1",
    taskTitle: "Design",
  };
  const toggle = (value: WorkTimer | null) => inTimer(value, createElement(TimerToggle, { target, subject: "Design" }));

  it("draws nothing without a timer to talk to", () => {
    expect(toggle(null)).toBe("");
  });
  it("starts a timer when none runs, and says what it is on", () => {
    const out = toggle(api());
    expect(out).toContain("Start");
    expect(out).toContain("a timer on Design");
  });
  it("stops the timer that runs on it, and starts on the others (which stops that one)", () => {
    expect(toggle(api({ timer: timerFromServer(server(), 0) }))).toContain("the timer on Design");
    expect(toggle(api({ timer: timerFromServer(server({ taskId: "t2", taskTitle: "Build" }), 0) }))).toContain(
      "Stops the running timer and logs its time",
    );
    expect(toggle(api({ timer: timerFromServer(server({ taskId: null }), 0) }))).toContain("Start");
  });
});

// --- Clients ---------------------------------------------------------------------------------

const countries = [
  { code: "NO", name: "Norway" },
  { code: "SE", name: "Sweden" },
];
const formShared = {
  storeSlug: "kaffe",
  countries,
  currencies: ["NOK", "SEK", "EUR"],
  defaults: { currency: "NOK", locale: "nb-NO", paymentDays: 14 },
  sellerCountry: "NO",
} satisfies Partial<ComponentProps<typeof ClientForm>>;

describe("the client form", () => {
  it("draws a new client with every field labelled and the store's defaults", () => {
    const out = html(createElement(ClientForm, formShared));
    for (const label of [
      "Name",
      "Contact person",
      "Invoice email",
      "Legal name",
      "Organisation number",
      "Address",
      "Postal code",
      "City",
      "Country",
      "VAT number",
      "Currency",
      "Hourly rate",
      "Days to pay",
      "Language of their invoices",
      "VAT treatment",
      "Notes",
    ]) {
      expect(out).toContain(`>${label}</label>`);
    }
    expect(out).toContain("Add client");
    expect(out).toContain('placeholder="14"');
    expect(out).toContain('value="NOK" selected');
    // Norwegian documents for a Norwegian store.
    expect(out).toContain('<option value="nb" selected');
    expect(out).toContain("Domestic VAT");
    expect(out).not.toContain('role="alert"');
  });

  it("draws an existing client with what it has, and says when another VAT treatment is usual", () => {
    const c = client({ vatTreatment: "domestic" });
    const out = html(createElement(ClientForm, { ...formShared, client: c }));
    expect(out).toContain("Save client");
    expect(out).toContain('value="Acme AB"');
    expect(out).toContain('value="Storgatan 1"');
    expect(out).toContain('value="1100.00"');
    expect(out).toContain('value="30"');
    expect(out).toContain('value="SEK" selected');
    // A business in Sweden with a VAT number, for a Norwegian seller: outside the scope.
    expect(out).toContain("outside the scope of vat is usual");
  });

  it("does not suggest what it already has, and locks the treatment for a private customer", () => {
    const same = html(createElement(ClientForm, { ...formShared, client: client({ vatTreatment: "outside_scope" }) }));
    expect(same).not.toContain("is usual");
    const privateCustomer = html(
      createElement(ClientForm, { ...formShared, client: client({ business: false, vatTreatment: "domestic" }) }),
    );
    expect(privateCustomer).toMatch(/<select[^>]*name="vatTreatment"[^>]*disabled/);
    expect(privateCustomer).toContain("always charged VAT");
  });

  it("keeps a language the client already has that is not one of the four", () => {
    const out = html(createElement(ClientForm, { ...formShared, client: client({ locale: "fi" }) }));
    expect(out).toContain('<option value="fi" selected');
  });
});

describe("the buttons that open forms and act on a client", () => {
  it("open in a dialog and act on the client", () => {
    const shared = { ...formShared };
    expect(html(createElement(NewClientButton, shared))).toContain("New client");
    expect(html(createElement(EditClientButton, { ...shared, client: client() }))).toContain("Edit client");
    expect(html(createElement(ArchiveClientButton, { storeSlug: "kaffe", clientId: "c1", archived: false }))).toContain(
      "Archive",
    );
    expect(html(createElement(ArchiveClientButton, { storeSlug: "kaffe", clientId: "c1", archived: true }))).toContain(
      "Bring back",
    );
    expect(html(createElement(DeleteClientButton, { storeSlug: "kaffe", clientId: "c1", name: "Acme AB" }))).toContain(
      "Delete client",
    );
  });
});

describe("the client list", () => {
  it("invites the first client when there are none", () => {
    const out = html(createElement(ClientsList, { base: BASE, clients: [], query: "", show: "active" }));
    expect(out).toContain("You have no clients yet");
    expect(out).toContain('role="search"');
    expect(out).not.toContain(">Clear<");
  });

  it("says nothing matches, and offers to clear, when filtered", () => {
    const out = html(createElement(ClientsList, { base: BASE, clients: [], query: "zzz", show: "archived" }));
    expect(out).toContain("No client matches");
    expect(out).toContain('value="zzz"');
    expect(out).toContain(">Clear<");
    expect(out).toContain('<option value="archived" selected');
  });

  it("lists clients with their figures and links", () => {
    const out = html(
      createElement(ClientsList, {
        base: BASE,
        clients: [
          client(),
          client({
            id: "c2",
            name: "Beta AS",
            contactName: null,
            billingEmail: null,
            activeAssignments: 0,
            loggedMinutes: 0,
            unbilledMinutes: 0,
            archivedAt: "2026-09-10T00:00:00.000Z",
          }),
        ],
        query: "",
        show: "all",
      }),
    );
    expect(out).toContain('href="/admin/kaffe/work/clients/c1"');
    expect(out).toContain("Acme AB");
    expect(out).toContain("Anna Berg · ap@acme.example");
    expect(out).toContain("15h");
    expect(out).toContain("5h");
    expect(out).toContain("Beta AS");
    expect(out).toContain("Archived");
    expect(out).toContain("No active assignments · nothing unbilled");
    expect(out).toContain("None");
    expect(out).toContain("<caption");
  });
});

describe("the client page's parts", () => {
  it("shows the details as they will be billed", () => {
    const out = html(createElement(ClientDetails, { client: client(), locale: "nb-NO", paymentDaysDefault: 14 }));
    expect(out).toContain("Acme Aktiebolag");
    expect(out).toContain("Storgatan 1, 111 22 Stockholm");
    expect(out).toContain("SE556677889901");
    expect(out).toContain("Swedish");
    expect(out).toContain("Reverse charge");
    expect(out).toContain("A business");
    expect(out).toContain("Send invoices to accounts payable.");
    expect(out).toContain(">30<");
    expect(out).toContain("without VAT");
  });

  it("says what is not set, and which default applies", () => {
    const out = html(
      createElement(ClientDetails, {
        client: client({
          legalName: null,
          vatNumber: null,
          billingAddress: { line1: "", line2: "", postalCode: "", city: "" },
          paymentDays: null,
          defaultHourlyRateMinor: null,
          notes: null,
          business: false,
          vatTreatment: "domestic",
        }),
        locale: "en",
        paymentDaysDefault: 14,
      }),
    );
    expect(out).toContain("Not set");
    expect(out).toContain("14 (your default)");
    expect(out).toContain("A private customer");
    expect(out).not.toContain("Notes");
  });

  it("counts what is going on and what is not on an invoice", () => {
    expect(html(createElement(ClientFigures, { client: client() }))).toContain("5h");
    const none = html(createElement(ClientFigures, { client: client({ unbilledMinutes: 0 }) }));
    expect(none).toContain("Nothing");
  });

  it("lists the assignments, with their rates, estimates and what is not invoiced", () => {
    const out = html(
      createElement(ClientAssignments, {
        base: BASE,
        locale: "nb-NO",
        assignments: [
          assignment(),
          assignment({
            id: "a2",
            name: "Audit",
            status: "done",
            billingType: "fixed_fee",
            fixedAmountMinor: 1_500_000,
            summary: summary({
              estimatedMinutes: null,
              unbilledMinutes: 0,
              unbilledAmountMinor: 0,
              rateSource: "none",
            }),
          }),
        ],
      }),
    );
    expect(out).toContain('href="/admin/kaffe/work/assignments/a1"');
    expect(out).toContain("Website rebuild");
    expect(out).toContain("Active");
    expect(out).toContain("(client&#x27;s rate)");
    expect(out).toContain("of 10h");
    expect(out).toContain("Audit");
    expect(out).toContain("Done");
    expect(out).toContain("Fixed fee");
    expect(out).toContain("fixed");
    expect(out).toContain("None");
  });

  it("explains an empty list", () => {
    expect(html(createElement(ClientAssignments, { base: BASE, locale: "en", assignments: [] }))).toContain(
      "No assignments yet",
    );
  });
});

// --- Assignments ------------------------------------------------------------------------------

describe("the assignment form", () => {
  const shared = {
    storeSlug: "kaffe",
    clientId: "c1",
    currency: "SEK",
    clientRateMinor: 110_000,
    locale: "nb-NO",
    estimateAlert: { minutes: 10, popup: true, sound: false },
  };

  it("draws a new hourly assignment with the client's rate in the hint and the warnings' defaults", () => {
    const out = html(createElement(AssignmentForm, shared));
    for (const label of [
      "Name",
      "Billing",
      "Status",
      "Hourly rate (SEK)",
      "Estimate",
      "Start",
      "End",
      "Warn this many minutes before",
    ]) {
      expect(out).toContain(`>${label}</label>`);
    }
    expect(out).toContain("Add assignment");
    expect(out).toContain("Empty bills at the client&#x27;s rate");
    expect(out).toMatch(/name="alertMinutes"[^>]*value="10"/);
    expect(out).toMatch(/name="alertPopup"[^>]*checked/);
    expect(out).not.toMatch(/name="alertSound"[^>]*checked/);
    expect(out).not.toContain("Fixed fee (");
  });

  it("says when the client has no rate", () => {
    expect(html(createElement(AssignmentForm, { ...shared, clientRateMinor: null }))).toContain(
      "The client has no rate",
    );
  });

  it("draws an existing fixed fee with its estimate as the field reads it", () => {
    const a = assignment({
      billingType: "fixed_fee",
      fixedAmountMinor: 1_500_000,
      estimatedMinutes: 150,
      estimateAlertMinutes: null,
      estimateAlertPopup: false,
    });
    const out = html(createElement(AssignmentForm, { ...shared, assignment: a }));
    expect(out).toContain("Save assignment");
    expect(out).toContain("Fixed fee (SEK)");
    expect(out).toContain('value="15000.00"');
    expect(out).toContain('value="2h 30m"');
    expect(out).not.toContain("Hourly rate (SEK)");
    expect(out).not.toMatch(/name="alertMinutes"[^>]*value="\d/);
    expect(out).not.toMatch(/name="alertPopup"[^>]*checked/);
  });

  it("offers another client only when told it may move", () => {
    expect(html(createElement(AssignmentForm, shared))).not.toContain("can move to another client");
    const out = html(
      createElement(AssignmentForm, {
        ...shared,
        assignment: assignment(),
        moveTo: [
          { id: "c1", name: "Acme AB" },
          { id: "c2", name: "Beta AS" },
        ],
      }),
    );
    expect(out).toContain("can move to another client");
    expect(out).toContain("Beta AS");
  });
});

describe("the assignment page's parts", () => {
  it("shows progress, how it is billed and what is not invoiced", () => {
    const out = html(createElement(AssignmentSummaryCard, { assignment: assignment(), base: BASE, locale: "nb-NO" }));
    expect(out).toContain('role="progressbar"');
    expect(out).toContain('aria-valuenow="50"');
    expect(out).toContain("5h");
    expect(out).toContain("of <span");
    expect(out).toContain("50 %");
    expect(out).toContain("bg-emerald-600");
    expect(out).toContain("Hourly, ");
    expect(out).toContain("4h 30m, ");
    expect(out).toContain("10 minutes before, with a message");
    expect(out).toContain('href="/admin/kaffe/work/clients/c1"');
  });

  it("colours the bar amber when nearly used up and red when over, and says so in words", () => {
    const near = html(
      createElement(AssignmentSummaryCard, {
        assignment: assignment({ summary: summary({ loggedMinutes: 595 }) }),
        base: BASE,
        locale: "en",
      }),
    );
    expect(near).toContain("bg-amber-500");
    expect(near).toContain("Nearly used up");
    const over = html(
      createElement(AssignmentSummaryCard, {
        assignment: assignment({ summary: summary({ loggedMinutes: 660 }) }),
        base: BASE,
        locale: "en",
      }),
    );
    expect(over).toContain("bg-red-600");
    expect(over).toContain("Over the estimate");
    expect(over).toContain("1h over");
    expect(over).toContain('style="width:100%"');
  });

  it("asks for an estimate when there is none, and says so when warnings are off", () => {
    const out = html(
      createElement(AssignmentSummaryCard, {
        assignment: assignment({
          estimatedMinutes: null,
          estimateAlertMinutes: null,
          summary: summary({ estimatedMinutes: null }),
        }),
        base: BASE,
        locale: "en",
      }),
    );
    expect(out).not.toContain('role="progressbar"');
    expect(out).toContain("No estimate.");
    expect(out).toContain("Off");
  });

  it("counts the running timer's whole minutes on its own assignment", () => {
    const value = api({ timer: { ...timerFromServer(server(), 0), startMs: 0 }, now: 0 });
    const out = inTimer(
      value,
      createElement(AssignmentSummaryCard, {
        assignment: assignment({ summary: summary({ loggedMinutes: 300 }) }),
        base: BASE,
        locale: "en",
      }),
    );
    // 300 logged plus the 12 whole minutes the server read.
    expect(out).toContain("5h 12m");
    expect(out).toContain("(timer running)");
  });

  it("draws the status control", () => {
    const out = html(
      createElement(AssignmentStatusControl, { storeSlug: "kaffe", assignmentId: "a1", status: "paused" }),
    );
    expect(out).toContain(">Status</label>");
    expect(out).toContain('<option value="paused" selected');
  });
});

describe("the tasks panel", () => {
  const panel = (tasks: WorkTaskItem[], value: WorkTimer | null = null) =>
    inTimer(
      value,
      createElement(TasksPanel, {
        storeSlug: "kaffe",
        assignmentId: "a1",
        assignmentName: "Website rebuild",
        clientId: "c1",
        clientName: "Acme AB",
        tasks,
        alertMinutes: 10,
        choice,
        today: "2026-09-29",
      }),
    );

  it("invites the first task, with the add form ready", () => {
    const out = panel([]);
    expect(out).toContain("No tasks yet");
    expect(out).toContain('aria-label="Add a task"');
    expect(out).toContain(">New task</label>");
    expect(out).toContain("Estimate for the new task");
    expect(out).toContain("Add task");
  });

  it("lists tasks with a name, an estimate, what is left and every way to move them", () => {
    const out = panel([
      task(),
      task({
        id: "t2",
        title: "Build",
        status: "done",
        estimatedMinutes: null,
        loggedMinutes: 30,
        remainingMinutes: null,
        utilisationPercent: null,
      }),
    ]);
    expect(out).toContain('aria-label="Name of Design"');
    expect(out).toContain('value="Design"');
    expect(out).toContain('value="2h"');
    expect(out).toContain("1h logged");
    expect(out).toContain("1h left");
    expect(out).toContain('aria-label="Estimate for Design"');
    expect(out).toContain('aria-label="Design is done"');
    expect(out).toMatch(/aria-label="Build is done"[^>]*/);
    expect(out).toContain('aria-label="Drag Design to reorder"');
    expect(out).toContain("Move up");
    expect(out).toContain("Move down");
    expect(out).toContain("Log time");
    expect(out).toContain("Delete");
    // Nothing above the first task and nothing below the last.
    expect(out.match(/disabled=""[^>]*>Move up/g)?.length ?? 0).toBe(1);
    expect(out.match(/disabled=""[^>]*>Move down/g)?.length ?? 0).toBe(1);
  });

  it("marks the stages of a task's estimate in words as well as colour", () => {
    const near = panel([task({ loggedMinutes: 115 })]);
    expect(near).toContain("5m left");
    expect(near).toContain("text-amber-800");
    const over = panel([task({ loggedMinutes: 150 })]);
    expect(over).toContain("30m over");
    expect(over).toContain("text-red-700");
  });

  it("moves the estimate with a timer running on the task, and offers Stop there", () => {
    const value = api({ timer: { ...timerFromServer(server(), 0), startMs: 0 } });
    const out = panel([task({ loggedMinutes: 100 })], value);
    // 100 logged and 12 running: 8 left of 120, which is under the 10-minute threshold.
    expect(out).toContain("1h 52m logged");
    expect(out).toContain("8m left");
    expect(out).toContain("the timer on Design");
  });
});

describe("time entries", () => {
  const viewer = { accountId: "me", owner: false };
  const list = (entries: TimeEntryItem[], props: Partial<ComponentProps<typeof TimeEntryList>> = {}) =>
    html(createElement(TimeEntryList, { storeSlug: "kaffe", entries, viewer, locale: "en-GB", ...props }));

  it("says when there is none", () => {
    expect(list([])).toContain("No time logged.");
    expect(list([], { empty: "Nothing here." })).toContain("Nothing here.");
  });

  it("shows an entry with its day, length, task, person, assignment and an editable note", () => {
    const out = list([entry()]);
    expect(out).toContain("28/09/2026");
    expect(out).toContain("1h 30m");
    expect(out).toContain("Design");
    expect(out).toContain("Kari");
    expect(out).toContain('href="/admin/kaffe/work/assignments/a1"');
    expect(out).toContain('href="/admin/kaffe/work/clients/c1"');
    expect(out).toContain('value="Kick-off call"');
    expect(out).toContain('aria-label="Note for 1h 30m on 28/09/2026"');
    expect(out).toContain("Delete");
  });

  it("can leave out the assignment and the person", () => {
    const out = list([entry()], { showAssignment: false, showPerson: false });
    expect(out).not.toContain("Website rebuild");
    expect(out).not.toContain("Kari");
  });

  it("marks time that is not billable, and time on a draft, whose minutes are fixed", () => {
    const out = list([entry({ billable: false }), entry({ id: "e2", invoiceStatus: "draft", invoiceLineId: "l1" })]);
    expect(out).toContain("Not billable");
    expect(out).toContain("On a draft invoice");
    expect(out.match(/>Delete</g)?.length ?? 0).toBe(1);
  });

  it("holds time on an issued invoice fixed and says which invoice", () => {
    const out = list([entry({ invoiceStatus: "sent", locked: true, invoiceNumber: "2026-14" })]);
    expect(out).toContain("Invoiced 2026-14");
    expect(out).toContain("On an issued invoice");
    expect(out).not.toContain(">Delete");
    expect(out).not.toContain('placeholder="Add a note"');
  });

  it("lets others read what they may not change, and owners change anything", () => {
    const theirs = entry({ accountId: "you" });
    const readOnly = list([theirs]);
    expect(readOnly).toContain("Logged by someone else");
    expect(readOnly).toContain("Kick-off call");
    expect(readOnly).not.toContain('placeholder="Add a note"');
    const owner = list([theirs], { viewer: { accountId: "me", owner: true } });
    expect(owner).toContain('placeholder="Add a note"');
  });
});

describe("logging time", () => {
  const form = (choices: AssignmentChoice[], props: Partial<ComponentProps<typeof LogTimeForm>> = {}) =>
    html(createElement(LogTimeForm, { storeSlug: "kaffe", today: "2026-09-29", choices, ...props }));

  it("asks for the day, the time and a note, and starts on today", () => {
    const out = form([choice]);
    expect(out).toContain(">Day</label>");
    expect(out).toContain(">Time</label>");
    expect(out).toContain(">Note</label>");
    expect(out).toContain('value="2026-09-29"');
    expect(out).toContain('max="2026-09-29"');
    expect(out).toContain("1h30, 1:30, 1.5h or 90m");
    expect(out).toMatch(/name="billable"[^>]*checked/);
    // One assignment is not a choice; its tasks are.
    expect(out).not.toContain(">Assignment</label>");
    expect(out).toContain("Task (optional)");
    expect(out).toContain("Build (done)");
  });

  it("starts on the task it was opened from", () => {
    expect(form([choice], { assignmentId: "a1", taskId: "t1" })).toMatch(/<option value="t1" selected/);
  });

  it("lets the assignment be chosen when there are several", () => {
    const out = form([choice, other]);
    expect(out).toContain(">Assignment</label>");
    expect(out).toContain("Acme AB: Support");
  });

  it("says there is nothing to log time on", () => {
    expect(form([])).toContain("There is no assignment to log time on");
  });
});

describe("an assignment's time", () => {
  const panel = (entries: TimeEntryItem[], truncated = false) =>
    html(
      createElement(TimePanel, {
        storeSlug: "kaffe",
        choice,
        entries,
        today: "2026-09-29",
        viewer: { accountId: "me", owner: false },
        locale: "en",
        truncated,
      }),
    );

  it("invites the first entry", () => {
    const out = panel([]);
    expect(out).toContain("No time logged yet. Log time by hand, or start a timer.");
    expect(out).toContain("Log time");
    expect(out).not.toContain("Search time");
  });

  it("totals what it shows and offers to search and filter by task", () => {
    const out = panel([entry(), entry({ id: "e2", minutes: 30, taskId: null, taskTitle: null })]);
    expect(out).toContain("Search time");
    expect(out).toContain("All tasks");
    expect(out).toContain("No task");
    expect(out).toContain("2 entries, 2h");
    expect(panel([entry()], true)).toContain("(the most recent are shown)");
  });
});

describe("the Time page", () => {
  const filters = (over = {}) => ({ ...EMPTY_TIME_FILTERS, ...over });
  const form = (over: Partial<ComponentProps<typeof TimeFiltersForm>> = {}) =>
    html(
      createElement(TimeFiltersForm, {
        base: BASE,
        filters: filters(),
        clients: [{ id: "c1", label: "Acme AB" }],
        assignments: [{ id: "a1", label: "Acme AB: Website rebuild" }],
        people: null,
        today: "2026-09-29",
        ...over,
      }),
    );

  it("filters by every field the page has, labelled", () => {
    const out = form();
    for (const label of ["Client", "Assignment", "Search", "From", "To", "Billable", "Invoicing"]) {
      expect(out).toContain(label);
    }
    expect(out).toContain('role="search"');
    expect(out).toContain("Not on an invoice");
    expect(out).not.toContain(">Person");
    expect(out).not.toContain("Clear");
  });

  it("offers owners a person, keeps what is set and offers to clear it", () => {
    const out = form({
      people: [{ id: "p1", label: "Kari" }],
      filters: filters({ clientId: "c1", billing: "unbilled", from: "2026-09-01" }),
    });
    expect(out).toContain(">Person");
    expect(out).toContain("Everyone");
    expect(out).toContain("Clear 3 filters");
    expect(out).toContain('<option value="c1" selected');
    expect(out).toContain('<option value="unbilled" selected');
    expect(out).toContain('value="2026-09-01"');
  });

  it("links the days it names", () => {
    const out = form();
    expect(out).toContain("from=2026-09-29&amp;to=2026-09-29");
    expect(out).toContain("from=2026-09-23&amp;to=2026-09-29");
    expect(out).toContain("from=2026-09-01&amp;to=2026-09-29");
  });

  it("starts a timer or logs time on an assignment that is open", () => {
    const out = inTimer(
      api(),
      createElement(QuickTimer, { storeSlug: "kaffe", choices: [choice, other], today: "2026-09-29" }),
    );
    expect(out).toContain("Track time");
    expect(out).toContain("<optgroup");
    expect(out).toContain("Website rebuild");
    expect(out).toContain("Start timer");
    expect(out).toContain("Log time by hand");
    expect(out).toContain("Task (optional)");
  });

  it("says there is nothing to track time on", () => {
    expect(
      inTimer(api(), createElement(QuickTimer, { storeSlug: "kaffe", choices: [], today: "2026-09-29" })),
    ).toContain("no active assignment");
  });
});

describe("the places for the invoice screens", () => {
  it("mark where invoices go on the client and assignment pages (the invoice screens fill them: see invoice-issued.test.ts)", () => {
    const c = html(
      createElement(ClientInvoicesSlot, {
        storeSlug: "kaffe",
        clientId: "c1",
        clientName: "Acme AB",
        currency: "SEK",
        locale: "en",
        archived: false,
        unbilledMinutes: 0,
      }),
    );
    expect(c).toContain('data-slot="client-invoices"');
    expect(c).toContain("Invoices");
    const a = html(
      createElement(AssignmentInvoicesSlot, {
        storeSlug: "kaffe",
        assignmentId: "a1",
        assignmentName: "Website rebuild",
        clientId: "c1",
        currency: "SEK",
        locale: "en",
        draftInvoiceId: null,
        issuedInvoices: 0,
        unbilledMinutes: 0,
        unbilledAmountMinor: 0,
      }),
    );
    expect(a).toContain('data-slot="assignment-invoices"');
    expect(a).toContain(">New invoice<");
    expect(
      html(
        createElement(BillUnbilledTimeSlot, {
          storeSlug: "kaffe",
          scope: { clientId: "c1" },
          currency: "SEK",
          locale: "en",
          unbilledMinutes: 0,
          unbilledAmountMinor: 0,
        }),
      ),
    ).toBe("");
  });
});
