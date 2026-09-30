"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  deleteDraftInvoiceAction,
  invoiceReadinessAction,
  releaseTimeFromInvoiceAction,
  saveDraftInvoiceAction,
} from "@/app/admin/(gated)/(owner)/account/work/s/[store]/invoice-actions";
import { Modal } from "@/components/admin/modal";
import { AutosaveQueue, type SaveState } from "@/lib/work-autosave";
import {
  ROUND_UP_STEPS_MINUTES,
  roundUpHours,
  type RoundUpStep,
} from "@/lib/work-calc";
import { dueOn, formatDay } from "@/lib/work-dates";
import {
  blankRow,
  headerFromInvoice,
  languageName,
  liveExtra,
  mergeServerRows,
  previewRows,
  problemCount,
  quantityField,
  readDraft,
  readQuantity,
  rowFromLine,
  sameRows,
  type DraftHeaderValues,
  type LineRow,
} from "@/lib/work-invoice-ui";
import { liveMinutes } from "@/lib/work-timer-ui";
import { VAT_TREATMENT_LABELS, type VatContext } from "@/lib/work-vat";
import type { InvoiceDetail, InvoiceReadiness } from "@/server/work-invoices";
import type { LineTime } from "@/server/work-invoice-screens";
import { OFFERABLE_CURRENCIES } from "@/lib/money";

import { IssueDialog } from "./invoice-issue-dialog";
import { InvoiceLinesEditor } from "./invoice-lines-editor";
import { ReadinessList } from "./invoice-readiness";
import { InvoiceTotalsView } from "./invoice-totals";
import { UnbilledTimeDialog } from "./invoice-unbilled-dialog";
import { useWorkTimerApi } from "./timer-context";
import {
  card,
  control,
  Field,
  hintText,
  primaryButton,
  Problems,
  secondaryButton,
  smallButton,
  smallControl,
} from "./work-parts";
import { workBase } from "@/lib/work-paths";

export type DraftEditorProps = {
  storeSlug: string;
  locale: string;
  /** A draft's detail (`getWorkInvoiceDetail`). */
  detail: InvoiceDetail;
  vat: { sellerVatRegistered: boolean; standardRateBp: number };
  /** The client's assignments on a fixed fee: logged time never rewrites their lines. */
  fixedFeeAssignmentIds: string[];
  timeByLine: Record<string, LineTime[]>;
  /** What a new line is priced at: the assignment's rate, else the client's. */
  newLineRateMinor: number | null;
  nextNumber: string | null;
  /** Suggested exchange rates by invoice currency. */
  fxSuggestions: Record<string, string>;
};

const AUTOSAVE_MS = 600;

const SAVE_TEXT: Record<SaveState, string> = {
  idle: "Changes are saved as you type.",
  pending: "Changes not saved yet …",
  saving: "Saving …",
  saved: "All changes saved.",
  invalid: "Not saved: something needs another look.",
  error: "Not saved.",
};

/**
 * The draft invoice (docs/work.md 7.2 WP6, from Life's `invoice-detail.tsx` and lines editor): its details, its
 * lines with live totals, the checklist before issuing, and the buttons that issue, add unbilled time and delete.
 *
 * Everything typed is saved by itself 600 ms after the last change, as one save of the whole draft (`saveDraft`),
 * queued behind one already on its way (`AutosaveQueue`); the state of it is always in view. A draft's totals
 * are worked out here with the functions the server prices it with (`previewRows`), so they are what will be
 * issued; while the person's clock runs on a task that has a line, its time ticks into that line. What the server
 * changes meanwhile (a task added, a timer stopped, time attached) is merged into what is on screen without
 * touching what the person is typing (`mergeServerRows`).
 */
export function DraftEditor(props: DraftEditorProps) {
  const { storeSlug, locale, detail, vat } = props;
  const { invoice, client, assignment } = detail;
  const router = useRouter();
  const timer = useWorkTimerApi();

  const list = `${workBase(storeSlug)}/invoices`;
  const ctx: VatContext = useMemo(
    () => ({
      sellerVatRegistered: vat.sellerVatRegistered,
      clientTreatment: client.vatTreatment,
      clientBusiness: client.business,
      standardRateBp: vat.standardRateBp,
    }),
    [
      vat.sellerVatRegistered,
      vat.standardRateBp,
      client.vatTreatment,
      client.business,
    ],
  );

  // --- What is on screen, in state (to draw) and refs (for the autosave to read when it runs) -------------
  const [initial] = useState(() => {
    const startHeader = headerFromInvoice(invoice);
    const startRows = detail.lines.map((line) =>
      rowFromLine(line, invoice.currency),
    );
    const read = readDraft({
      clientId: client.id,
      assignmentId: invoice.assignmentId,
      header: startHeader,
      rows: startRows,
    });
    return {
      header: startHeader,
      rows: startRows,
      key: read.ok ? read.key : null,
    };
  });
  const [header, setHeaderState] = useState<DraftHeaderValues>(initial.header);
  const [rows, setRowsState] = useState<LineRow[]>(initial.rows);
  const headerRef = useRef(initial.header);
  const rowsRef = useRef(initial.rows);
  /** The rows as the server last had them (saved, or read on the page): what "changed since" is measured from. */
  const baseRef = useRef(initial.rows);
  const keyCounter = useRef(0);

  const [save, setSave] = useState<{ state: SaveState; message?: string }>({
    state: "idle",
  });
  const [saveCount, setSaveCount] = useState(0);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const clearFocus = useCallback(() => setFocusKey(null), []);

  const readNow = useCallback(() => {
    const read = readDraft({
      clientId: client.id,
      assignmentId: invoice.assignmentId,
      header: headerRef.current,
      rows: rowsRef.current,
    });
    return read.ok
      ? { value: { input: read.input, rows: rowsRef.current }, key: read.key }
      : null;
  }, [client.id, invoice.assignmentId]);

  // The queue calls `readNow` and the save from timers and event handlers only, never while rendering.
  const [queue] = useState(
    // eslint-disable-next-line react-hooks/refs -- the refs are read when the pause is over, not during render
    () =>
      new AutosaveQueue({
        delayMs: AUTOSAVE_MS,
        savedKey: initial.key,
        read: readNow,
        onState: (state, message) => setSave({ state, message }),
        save: async ({ input, rows: snapshot }) => {
          const result = await saveDraftInvoiceAction(
            storeSlug,
            invoice.id,
            input,
          );
          if (!result.ok)
            return { ok: false, message: result.problems.join(" ") };
          // New lines got their ids (and tasks): take them in, so the next save updates them and never adds them again.
          const saved = new Map(
            snapshot.map((row, index) => [row.key, result.lines[index]]),
          );
          const adopt = (row: LineRow): LineRow => {
            const hit = saved.get(row.key);
            return hit ? { ...row, id: hit.id, taskId: hit.taskId } : row;
          };
          baseRef.current = snapshot.map(adopt);
          rowsRef.current = rowsRef.current.map(adopt);
          setRowsState(rowsRef.current);
          setSaveCount((count) => count + 1);
          return { ok: true };
        },
      }),
  );

  const setRows = useCallback(
    (next: LineRow[]) => {
      rowsRef.current = next;
      setRowsState(next);
      queue.touch();
    },
    [queue],
  );
  const setHeader = (change: Partial<DraftHeaderValues>) => {
    headerRef.current = { ...headerRef.current, ...change };
    setHeaderState(headerRef.current);
    queue.touch();
  };

  // --- What the server says, when it changes (a task, a timer, time attached, a save) ------------------
  const serverRows = useMemo(
    () => detail.lines.map((line) => rowFromLine(line, invoice.currency)),
    [detail.lines, invoice.currency],
  );
  const serverKey = useMemo(() => JSON.stringify(serverRows), [serverRows]);
  const syncedKey = useRef(serverKey);
  useEffect(() => {
    if (serverKey === syncedKey.current) return;
    syncedKey.current = serverKey;
    const merged = mergeServerRows(
      rowsRef.current,
      baseRef.current,
      serverRows,
      headerRef.current.currency,
    );
    baseRef.current = serverRows;
    rowsRef.current = merged;
    setRowsState(merged);
    const now = readNow();
    if (now && sameRows(merged, serverRows, headerRef.current.currency))
      queue.markSaved(now.key);
    else queue.touch();
  }, [serverKey, serverRows, queue, readNow]);

  // Leaving with something not saved: try to save it, and warn when the browser is closed.
  useEffect(() => {
    return () => {
      void queue.flush();
    };
  }, [queue]);
  const unsaved =
    save.state === "pending" ||
    save.state === "saving" ||
    save.state === "error" ||
    save.state === "invalid";
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  // --- What the person reads ------------------------------------------------------------------------------
  const currency = header.currency;
  const read = useMemo(
    () =>
      readDraft({
        clientId: client.id,
        assignmentId: invoice.assignmentId,
        header,
        rows,
      }),
    [client.id, invoice.assignmentId, header, rows],
  );
  const problems = read.ok ? null : read.problems;
  const fixedFee = useMemo(
    () => new Set(props.fixedFeeAssignmentIds),
    [props.fixedFeeAssignmentIds],
  );
  const extra = timer
    ? liveExtra(
        rows,
        (assignmentId, taskId) =>
          liveMinutes(timer.timer, timer.pendingEntry, timer.now, {
            assignmentId,
            taskId,
          }),
        fixedFee,
      )
    : new Map<string, number>();
  const live = previewRows(ctx, currency, rows, extra);
  const settled = previewRows(ctx, currency, rows);
  const ticking = extra.size > 0;

  // --- The checklist: read again after each save and when the exchange rate changes ---------------------
  const [readiness, setReadiness] = useState<InvoiceReadiness | null>(
    detail.readiness,
  );
  const [checking, setChecking] = useState(false);
  const [fxRate, setFxRate] = useState("");
  const checkRequest = useRef(0);
  const checkReadiness = useCallback(async () => {
    const request = (checkRequest.current += 1);
    setChecking(true);
    try {
      const result = await invoiceReadinessAction(
        storeSlug,
        invoice.id,
        fxRate.trim() || null,
      );
      if (request === checkRequest.current && result.ok && result.readiness)
        setReadiness(result.readiness);
    } catch {
      /* the list stays as it was; the server checks again when issuing */
    } finally {
      if (request === checkRequest.current) setChecking(false);
    }
  }, [storeSlug, invoice.id, fxRate]);
  const firstCheck = useRef(true);
  useEffect(() => {
    if (firstCheck.current) {
      firstCheck.current = false;
      return;
    }
    const later = setTimeout(() => void checkReadiness(), 300);
    return () => clearTimeout(later);
  }, [saveCount, checkReadiness]);

  // --- Actions ---------------------------------------------------------------------------------------------
  const [issueOpen, setIssueOpen] = useState(false);
  const [unbilledOpen, setUnbilledOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actionProblems, setActionProblems] = useState<string[]>([]);
  const [busy, startBusy] = useTransition();
  const [deleteProblems, setDeleteProblems] = useState<string[]>([]);
  const [roundStep, setRoundStep] = useState<RoundUpStep>(15);
  // The details are closed until asked for, to keep the lines near the top; a mistake in them opens them.
  const [detailsOpen, setDetailsOpen] = useState(false);

  const makeRow = useCallback(() => {
    keyCounter.current += 1;
    const row = blankRow(`new-${keyCounter.current}`, {
      rateMinor: props.newLineRateMinor,
      currency: headerRef.current.currency,
      assignmentId: invoice.assignmentId,
    });
    setFocusKey(row.key);
    return row;
  }, [props.newLineRateMinor, invoice.assignmentId]);

  const openIssue = () => {
    setActionProblems([]);
    startBusy(async () => {
      const saved = await queue.flush();
      if (!saved) {
        setActionProblems([
          "The invoice has changes that could not be saved yet. Fix what is marked and try again.",
        ]);
        return;
      }
      void checkReadiness();
      setIssueOpen(true);
    });
  };

  const release = (entryIds: string[]) => {
    setActionProblems([]);
    startBusy(async () => {
      if (!(await queue.flush())) {
        setActionProblems([
          "Fix what is marked on the invoice first, so its changes can be saved.",
        ]);
        return;
      }
      try {
        const result = await releaseTimeFromInvoiceAction(storeSlug, entryIds);
        if (!result.ok) setActionProblems(result.problems);
      } catch {
        setActionProblems([
          "The time could not be released. Check your connection and try again.",
        ]);
      }
    });
  };

  const roundUp = () => {
    setRows(
      rows.map((row) => {
        const quantity =
          row.unit === "hour" ? readQuantity(row.quantity, "hour") : null;
        if (quantity === null || quantity === 0) return row;
        const rounded = roundUpHours(quantity, roundStep);
        return rounded === quantity
          ? row
          : { ...row, quantity: quantityField(rounded), quantityManual: true };
      }),
    );
  };

  const remove = () => {
    setDeleteProblems([]);
    startBusy(async () => {
      try {
        const result = await deleteDraftInvoiceAction(storeSlug, invoice.id);
        if (result.ok) {
          queue.stop();
          router.push(list);
        } else setDeleteProblems(result.problems);
      } catch {
        setDeleteProblems([
          "The draft could not be deleted. Check your connection and try again.",
        ]);
      }
    });
  };

  const blocked =
    save.state === "pending" || save.state === "saving"
      ? "Your changes are still being saved."
      : save.state === "invalid"
        ? "Fix the fields that are marked first."
        : save.state === "error"
          ? "The last save failed. Try saving again first."
          : null;

  const inherited =
    invoice.paymentDays === null ? invoice.effectivePaymentDays : null;
  const typedDays = /^\d+$/.test(header.paymentDays.trim())
    ? Number(header.paymentDays.trim())
    : null;
  const dueDays =
    typedDays !== null && typedDays >= 1 && typedDays <= 90
      ? typedDays
      : invoice.effectivePaymentDays;
  const currencies = OFFERABLE_CURRENCIES.includes(currency)
    ? OFFERABLE_CURRENCIES
    : [currency, ...OFFERABLE_CURRENCIES];
  const hoursRows = rows.some((row) => row.unit === "hour");
  const treatment = client.business
    ? VAT_TREATMENT_LABELS[client.vatTreatment].label
    : "Domestic VAT (a private customer)";
  const headerErrors = problems?.header ?? {};
  const detailsShown = detailsOpen || Object.keys(headerErrors).length > 0;
  const summary =
    problems && problemCount(problems) > 0
      ? [
          `${problemCount(problems)} ${problemCount(problems) === 1 ? "field needs" : "fields need"} another look. They are marked below.`,
        ]
      : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1" aria-live="polite">
          <p className="text-sm" role="status" data-testid="save-status">
            {save.state === "error"
              ? `${SAVE_TEXT.error} ${save.message ?? ""}`
              : save.state === "invalid" && summary[0]
                ? `Not saved. ${summary[0]}`
                : SAVE_TEXT[save.state]}
          </p>
          {save.state === "error" && (
            <button
              type="button"
              onClick={() => void queue.retry()}
              className={`${smallButton} self-start`}
            >
              Try saving again
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`${list}/${invoice.id}/print`}
            className={secondaryButton}
          >
            Preview document
          </Link>
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            className={secondaryButton}
          >
            Delete draft
          </button>
          <button
            type="button"
            onClick={openIssue}
            disabled={busy}
            className={primaryButton}
          >
            Issue invoice …
          </button>
        </div>
      </div>
      <Problems messages={actionProblems} />

      <section aria-labelledby="details-heading" className={card}>
        <h2 id="details-heading" className="font-medium">
          <button
            type="button"
            onClick={() => setDetailsOpen(!detailsShown)}
            aria-expanded={detailsShown}
            aria-controls="invoice-details"
            className="flex w-full items-center gap-2 text-left"
          >
            {detailsShown ? (
              <ChevronDown aria-hidden className="size-4 shrink-0" />
            ) : (
              <ChevronRight aria-hidden className="size-4 shrink-0" />
            )}
            Details
            {!detailsShown && (
              <span className="min-w-0 truncate text-sm font-normal text-muted">
                {[
                  client.name,
                  assignment?.name,
                  currency,
                  `${dueDays} days to pay`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </button>
        </h2>
        <div id="invoice-details" hidden={!detailsShown} className="mt-4">
          <dl className="mb-5 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">Client</dt>
              <dd>
                <Link
                  href={`${workBase(storeSlug)}/clients/${client.id}`}
                  className="underline"
                >
                  {client.name}
                </Link>
              </dd>
            </div>
            {assignment && (
              <div>
                <dt className="text-muted">Assignment</dt>
                <dd>{assignment.name}</dd>
              </div>
            )}
            <div>
              <dt className="text-muted">Language of the document</dt>
              <dd>{languageName(invoice.locale)}</dd>
            </div>
            <div>
              <dt className="text-muted">VAT treatment</dt>
              <dd>
                {vat.sellerVatRegistered
                  ? treatment
                  : "No VAT: your business is not registered for VAT"}
                <span className={`block ${hintText}`}>
                  Set on the{" "}
                  <Link
                    href={`${workBase(storeSlug)}/clients/${client.id}`}
                    className="underline"
                  >
                    client
                  </Link>{" "}
                  and in{" "}
                  <Link
                    href={`${workBase(storeSlug)}/settings`}
                    className="underline"
                  >
                    Work settings
                  </Link>
                  .
                </span>
              </dd>
            </div>
          </dl>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Currency" error={headerErrors.currency}>
              {(fieldProps) => (
                <select
                  {...fieldProps}
                  value={currency}
                  onChange={(event) =>
                    setHeader({ currency: event.target.value })
                  }
                  className={control}
                >
                  {currencies.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field
              label="Days to pay"
              error={headerErrors.paymentDays}
              hint={`${inherited !== null && header.paymentDays.trim() === "" ? `Follows the client and your settings: ${inherited} days. ` : ""}If issued today it is due ${formatDay(dueOn(detail.today, dueDays), locale)}.`}
            >
              {(fieldProps) => (
                <input
                  {...fieldProps}
                  value={header.paymentDays}
                  onChange={(event) =>
                    setHeader({ paymentDays: event.target.value })
                  }
                  inputMode="numeric"
                  placeholder={String(
                    inherited ?? invoice.effectivePaymentDays,
                  )}
                  autoComplete="off"
                  className={control}
                />
              )}
            </Field>
            <Field
              label="Your reference"
              error={headerErrors.reference}
              hint="The client's own reference, such as an order number. Printed on the invoice."
            >
              {(fieldProps) => (
                <input
                  {...fieldProps}
                  value={header.reference}
                  onChange={(event) =>
                    setHeader({ reference: event.target.value })
                  }
                  maxLength={120}
                  autoComplete="off"
                  className={control}
                />
              )}
            </Field>
            <Field
              label="Period from"
              error={headerErrors.serviceFrom}
              hint="When the work was done, if different from the issue date. Empty takes it from the time on the lines."
            >
              {(fieldProps) => (
                <input
                  {...fieldProps}
                  type="date"
                  value={header.serviceFrom}
                  onChange={(event) =>
                    setHeader({ serviceFrom: event.target.value })
                  }
                  className={control}
                />
              )}
            </Field>
            <Field label="Period to" error={headerErrors.serviceTo}>
              {(fieldProps) => (
                <input
                  {...fieldProps}
                  type="date"
                  value={header.serviceTo}
                  onChange={(event) =>
                    setHeader({ serviceTo: event.target.value })
                  }
                  className={control}
                />
              )}
            </Field>
            {readiness?.needsFxRate && (
              <Field
                label={`Exchange rate: 1 ${currency} in ${readiness.homeCurrency ?? "your currency"}`}
                hint={`The VAT is also stated in ${readiness.homeCurrency ?? "your currency"}. Used when you issue; not saved before.`}
              >
                {(fieldProps) => (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      {...fieldProps}
                      value={fxRate}
                      onChange={(event) => setFxRate(event.target.value)}
                      inputMode="decimal"
                      autoComplete="off"
                      className={`${control} max-w-36`}
                    />
                    {props.fxSuggestions[currency] && (
                      <button
                        type="button"
                        onClick={() => setFxRate(props.fxSuggestions[currency])}
                        className={smallButton}
                      >
                        Use {props.fxSuggestions[currency]}
                      </button>
                    )}
                  </div>
                )}
              </Field>
            )}
          </div>
          <Field
            label="Notes for the client"
            error={headerErrors.notes}
            className="mt-4"
            hint="Printed on the invoice."
          >
            {(fieldProps) => (
              <textarea
                {...fieldProps}
                value={header.notes}
                onChange={(event) => setHeader({ notes: event.target.value })}
                rows={3}
                maxLength={4100}
                className={`${control} py-2`}
              />
            )}
          </Field>
        </div>
      </section>

      <section
        id="invoice-lines"
        aria-labelledby="lines-heading"
        className={card}
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="lines-heading" className="font-medium">
            Lines
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setUnbilledOpen(true)}
              disabled={busy}
              className={smallButton}
            >
              Add unbilled time
            </button>
            {hoursRows && (
              <span className="flex items-center gap-1">
                <label htmlFor="round-step" className="sr-only">
                  Round hours up to
                </label>
                <select
                  id="round-step"
                  value={roundStep}
                  onChange={(event) =>
                    setRoundStep(Number(event.target.value) as RoundUpStep)
                  }
                  className={smallControl}
                >
                  {ROUND_UP_STEPS_MINUTES.map((step) => (
                    <option key={step} value={step}>
                      {step} min
                    </option>
                  ))}
                </select>
                <button type="button" onClick={roundUp} className={smallButton}>
                  Round hours up
                </button>
              </span>
            )}
          </div>
        </div>
        <p className={`mb-4 ${hintText}`}>
          Prices are without VAT. Hours from logged time are rounded to two
          decimals (20 minutes is 0.33 h). An hour you type yourself is kept as
          you typed it.
        </p>
        <InvoiceLinesEditor
          rows={rows}
          onRows={setRows}
          makeRow={makeRow}
          currency={currency}
          locale={locale}
          preview={live}
          errors={problems?.lines ?? {}}
          timeByLine={props.timeByLine}
          onRelease={release}
          releasing={busy}
          focusKey={focusKey}
          onFocused={clearFocus}
        />
        <div className="mt-6 border-t border-border pt-4">
          {live ? (
            <InvoiceTotalsView
              totals={live.totals}
              currency={currency}
              locale={locale}
              notes={live.noteKeys}
              live={ticking}
            />
          ) : (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              These amounts are too large to add up. Check the quantities and
              prices.
            </p>
          )}
        </div>
        <Problems messages={problems?.general ?? []} />
      </section>

      <section aria-labelledby="ready-heading" className={card}>
        <h2 id="ready-heading" className="mb-3 font-medium">
          Before you issue
        </h2>
        {readiness ? (
          <ReadinessList
            readiness={readiness}
            storeSlug={storeSlug}
            clientId={client.id}
            checking={checking}
          />
        ) : (
          <p className="text-sm text-muted">Checking …</p>
        )}
      </section>

      <IssueDialog
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        storeSlug={storeSlug}
        invoiceId={invoice.id}
        clientId={client.id}
        currency={currency}
        locale={locale}
        totalMinor={settled?.totals.totalMinor ?? 0}
        readiness={readiness}
        nextNumber={props.nextNumber}
        today={detail.today}
        paymentDays={dueDays}
        fxSuggestion={props.fxSuggestions[currency] ?? null}
        fxRate={fxRate}
        onFxRate={setFxRate}
        blocked={
          blocked ??
          (settled === null ? "The amounts are too large to add up." : null)
        }
        onNotReady={() => void checkReadiness()}
      />
      <UnbilledTimeDialog
        open={unbilledOpen}
        onClose={() => setUnbilledOpen(false)}
        storeSlug={storeSlug}
        invoiceId={invoice.id}
        clientId={client.id}
        assignmentId={invoice.assignmentId}
        fixedFee={assignment?.billingType === "fixed_fee"}
        currency={currency}
        locale={locale}
        beforeAdd={() => queue.flush()}
      />
      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete this draft?"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            The draft and its {rows.length}{" "}
            {rows.length === 1 ? "line" : "lines"} are deleted. No invoice
            number is used.
            {assignment
              ? ` The assignment "${assignment.name}", its tasks and your logged time stay.`
              : " Your assignments, tasks and logged time stay."}{" "}
            Time that was on its lines can be billed again.
          </p>
          <Problems messages={deleteProblems} />
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteOpen(false)}
              className={secondaryButton}
            >
              Keep the draft
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className={primaryButton}
            >
              {busy ? "Deleting …" : "Delete draft"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
