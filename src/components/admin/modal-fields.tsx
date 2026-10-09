"use client";

import { useId, useState } from "react";

import {
  MODAL_CLASS_MAX,
  MODAL_DAYS_MAX,
  MODAL_DAYS_MIN,
  MODAL_FREQUENCIES,
  MODAL_KEY_MAX,
  MODAL_LEFT_OUT,
  MODAL_LEFT_OUT_SHORT,
  MODAL_NAME_MAX,
  MODAL_OVERLAYS,
  MODAL_POSITIONS,
  MODAL_SECONDS_MAX,
  MODAL_SECONDS_MIN,
  MODAL_SIZES,
  classProblem,
  keyFromHash,
  keyProblem,
  modalHash,
  modalProblems,
  modalRows,
  newModal,
  slugifyKey,
  uniqueKey,
  type ModalFrequency,
  type ModalOverlay,
  type ModalPosition,
  type ModalSize,
  type ModalTriggers,
  type RowModal,
} from "@/lib/page-modal";
import { rowShows, type PageRow } from "@/lib/page-content";
import type { RowPatch } from "@/lib/page-rows";

import { Check, Choices, NumberField, TextField, fieldClass, smallButton } from "./block-fields";

/**
 * A row's Modal setting in its dialog (D121): whether the row is drawn in a
 * dialog instead of the page, what opens it, how often, and how it looks.
 * The row's own Style tab gives the panel its background, border, corners and
 * shadow. Checked as the page is saved (`pageInput`); the same messages are
 * shown here as they arise.
 */
export function ModalFields({
  row,
  rows,
  onChange,
}: {
  row: PageRow;
  rows: PageRow[];
  onChange: (patch: RowPatch) => void;
}) {
  const switchId = useId();
  const modal = row.modal;
  const otherKeys = modalRows(rows).flatMap((other) => (other.id !== row.id && other.modal ? [other.modal.key] : []));
  const set = (patch: Partial<RowModal>) => modal && onChange({ modal: { ...modal, ...patch } });

  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      <div className="flex flex-col gap-1">
        <label htmlFor={switchId} className="flex items-start gap-3 text-sm">
          <input
            id={switchId}
            type="checkbox"
            checked={Boolean(modal)}
            onChange={(event) =>
              onChange({ modal: event.target.checked ? newModal(uniqueKey("modal", otherKeys)) : undefined })
            }
            className="mt-0.5 size-4 shrink-0"
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">Show this row in a modal</span>
            <span className="text-xs text-muted">
              The row leaves the page and opens in a window over it: a sign-up, an offer, a video, a notice or a contact
              form. Build it as any row. In a footer or header it is on every page.
            </span>
          </span>
        </label>
      </div>
      {modal && <ModalSettings modal={modal} otherKeys={otherKeys} set={set} onSite={rowShows(row)} />}
    </div>
  );
}

function ModalSettings({
  modal,
  otherKeys,
  set,
  onSite,
}: {
  modal: RowModal;
  otherKeys: string[];
  set: (patch: Partial<RowModal>) => void;
  /** Whether anything in the row shows on the site: else the modal is left out of it. */
  onSite: boolean;
}) {
  const problems = modalProblems(modal);
  const keyId = useId();
  const classId = useId();
  const triggers = modal.triggers;
  const setTriggers = (patch: Partial<ModalTriggers>) => set({ triggers: { ...triggers, ...patch } });
  const taken = otherKeys.includes(modal.key);
  const keyIssue = keyProblem(modal.key) ?? (taken ? "Another modal on this page has this address name." : null);
  const classIssue = triggers.className !== undefined ? classProblem(triggers.className) : null;
  const closable = modal.closeButton !== false;
  const overlayCloses = modal.closeOnOverlay !== false;

  // While the address name follows the name, a new name gives it a new address; once it is edited by hand, it stays.
  const follows = modal.key === uniqueKey(modal.name?.trim() ? slugifyKey(modal.name) : "modal", otherKeys);
  const rename = (name: string) => {
    const label = name.trim();
    set({
      name: label ? name : undefined,
      ...(follows ? { key: uniqueKey(label ? slugifyKey(label) : "modal", otherKeys) } : {}),
    });
  };

  return (
    <div className="flex flex-col gap-5 pl-7">
      {!onSite && (
        <p
          data-modal-left-out
          className="rounded-md border border-red-700 p-3 text-sm text-red-700 dark:text-red-400"
        >
          {MODAL_LEFT_OUT}
        </p>
      )}
      <TextField
        label="Name"
        value={modal.name ?? ""}
        max={MODAL_NAME_MAX}
        placeholder="Newsletter sign-up"
        hint="Only for you: the builder shows it on the row."
        onChange={rename}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor={keyId} className="text-sm font-medium">
          Address name
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">#modal-</span>
          <input
            id={keyId}
            value={modal.key}
            maxLength={MODAL_KEY_MAX}
            spellCheck={false}
            aria-invalid={Boolean(keyIssue)}
            aria-describedby={`${keyId}-hint`}
            onChange={(event) => set({ key: event.target.value.toLowerCase() })}
            className={`${fieldClass} w-56 aria-invalid:border-red-700`}
          />
          <CopyLink text={modalHash(modal.key)} disabled={Boolean(keyIssue)} />
        </div>
        <span id={`${keyId}-hint`} className={`text-xs ${keyIssue ? "text-red-700 dark:text-red-400" : "text-muted"}`}>
          {keyIssue ??
            `A link to ${modalHash(modal.key)} opens this modal. Changing the name changes links already made to it.`}
        </span>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">Opens when</legend>
        <Check
          label="A button or link is pressed"
          hint={`Give a button the action Opens a modal, or link any text, menu item or button to ${modalHash(modal.key)}.`}
          checked={Boolean(triggers.button)}
          onChange={(button) => setTriggers({ button: button || undefined })}
        />
        <Check
          label="An element with a class is pressed"
          hint="Add the class to any button, image or text with Advanced → CSS classes. Best on a button or a link, which a keyboard can reach."
          checked={triggers.className !== undefined}
          onChange={(on) => setTriggers({ className: on ? "" : undefined })}
        />
        {triggers.className !== undefined && (
          <div className="flex flex-col gap-1 pl-7">
            <label htmlFor={classId} className="text-sm font-medium">
              Class name
            </label>
            <input
              id={classId}
              value={triggers.className}
              maxLength={MODAL_CLASS_MAX}
              spellCheck={false}
              placeholder="open-newsletter"
              aria-invalid={Boolean(classIssue)}
              aria-describedby={`${classId}-hint`}
              onChange={(event) => setTriggers({ className: event.target.value.trim() })}
              className={`${fieldClass} w-64 aria-invalid:border-red-700`}
            />
            <span
              id={`${classId}-hint`}
              className={`text-xs ${classIssue ? "text-red-700 dark:text-red-400" : "text-muted"}`}
            >
              {classIssue ?? "One class, written without the dot."}
            </span>
          </div>
        )}
        <Check
          label="The visitor is about to leave (exit intent)"
          hint="On a computer: when the pointer leaves the top of the window, after about 3 seconds on the page. A touch screen has no pointer to leave with, so there it opens when the visitor scrolls back up quickly after reading down at least 30% of the page."
          checked={Boolean(triggers.exitIntent)}
          onChange={(exitIntent) => setTriggers({ exitIntent: exitIntent || undefined })}
        />
        <Check
          label="A timer runs out"
          hint="Counted from when the page is shown."
          checked={Boolean(triggers.timer)}
          onChange={(on) => setTriggers({ timer: on ? { seconds: 5 } : undefined })}
        />
        {triggers.timer && (
          <div className="pl-7">
            <NumberField
              label="After"
              unit="seconds"
              min={MODAL_SECONDS_MIN}
              max={MODAL_SECONDS_MAX}
              value={triggers.timer.seconds}
              onChange={(seconds) => setTriggers({ timer: { seconds } })}
            />
          </div>
        )}
        <p className="text-xs text-muted">
          A timer and exit intent open the modal by themselves: at most once a page view, never on top of another modal,
          never on the cart, checkout or account pages and never in the builder. A button or a class always opens it.
        </p>
      </fieldset>

      <div className="flex flex-col gap-3">
        <Choices
          legend="How often it opens by itself"
          hint="timer and exit intent"
          options={(Object.keys(MODAL_FREQUENCIES) as ModalFrequency[]).map((value) => ({
            value,
            label: MODAL_FREQUENCIES[value],
          }))}
          value={modal.frequency}
          onChange={(frequency) => set({ frequency, days: frequency === "days" ? (modal.days ?? 7) : undefined })}
        />
        {modal.frequency === "days" && (
          <NumberField
            label="Not again for"
            unit="days"
            min={MODAL_DAYS_MIN}
            max={MODAL_DAYS_MAX}
            value={modal.days ?? 7}
            onChange={(days) => set({ days })}
          />
        )}
        {modal.frequency !== "always" && (
          <p className="text-xs text-muted">
            Once closed, it is remembered in the visitor&apos;s browser, but only if they allow preferences in the
            cookie choices (it is then listed on the Cookies page); otherwise it stays closed until the page is loaded
            again.
          </p>
        )}
      </div>

      <Choices
        legend="Size"
        hint="use a one-column row for a small modal"
        options={(Object.keys(MODAL_SIZES) as ModalSize[]).map((value) => ({ value, label: MODAL_SIZES[value].label }))}
        value={modal.size}
        onChange={(size) => set({ size })}
      />
      <Choices
        legend="Position"
        options={(Object.keys(MODAL_POSITIONS) as ModalPosition[]).map((value) => ({
          value,
          label: MODAL_POSITIONS[value],
        }))}
        value={modal.position ?? "center"}
        onChange={(position) => set({ position: position === "center" ? undefined : position })}
      />
      <Choices
        legend="Dimming behind it"
        options={(Object.keys(MODAL_OVERLAYS) as ModalOverlay[]).map((value) => ({
          value,
          label: MODAL_OVERLAYS[value].label,
        }))}
        value={modal.overlay ?? "medium"}
        onChange={(overlay) => set({ overlay: overlay === "medium" ? undefined : overlay })}
      />
      <div className="flex flex-col gap-3">
        <Check
          label="Show a close button"
          hint="Escape closes it either way."
          checked={closable}
          disabled={closable && !overlayCloses}
          onChange={(on) => set({ closeButton: on ? undefined : false })}
        />
        <Check
          label="A click outside it closes it"
          checked={overlayCloses}
          disabled={overlayCloses && !closable}
          onChange={(on) => set({ closeOnOverlay: on ? undefined : false })}
        />
      </div>
      <p className="text-xs text-muted">
        The row&apos;s Style tab gives the modal its background, border, rounded corners and shadow. Its spacing is the
        space inside.
      </p>

      {problems.length > 0 && (
        <ul
          role="alert"
          className="flex flex-col gap-1 rounded-md border border-red-700 p-3 text-sm text-red-700 dark:text-red-400"
        >
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Copies the modal's link, `#modal-key`, to paste where it should open from. */
function CopyLink({ text, disabled }: { text: string; disabled: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => {});
      }}
      className={smallButton}
    >
      {copied ? "Copied" : `Copy link ${text}`}
    </button>
  );
}

/**
 * A button's "Opens a modal" (D121): chooses one of the page's modals, which
 * sets the button's address to `#modal-{key}`. A modal in the footer or
 * header is linked to by typing its address.
 */
export function ModalPicker({ rows, href, onPick }: { rows: PageRow[]; href: string; onPick: (href: string) => void }) {
  const id = useId();
  const modals = modalRows(rows).flatMap((row) => (row.modal ? [row.modal] : []));
  const chosen = keyFromHash(href.trim());
  const current = modals.find((modal) => modal.key === chosen);
  const leftOut = modalRows(rows).some((row) => row.modal?.key === chosen && !rowShows(row));
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        Opens a modal
      </label>
      <select
        id={id}
        value={current?.key ?? ""}
        onChange={(event) => onPick(event.target.value ? modalHash(event.target.value) : "")}
        className={fieldClass}
      >
        <option value="">
          {current || modals.length > 0 ? "None: use the address above" : "This page has no modal yet"}
        </option>
        {modals.map((modal) => (
          <option key={modal.key} value={modal.key}>
            {modal.name?.trim() || modal.key}
          </option>
        ))}
      </select>
      <span
        className={`text-xs ${(current && !current.triggers.button) || leftOut ? "text-red-700 dark:text-red-400" : "text-muted"}`}
      >
        {current && !current.triggers.button
          ? "That modal is not set to open from a button or link: switch that on in its row's settings."
          : leftOut
            ? MODAL_LEFT_OUT_SHORT
            : chosen && !current
              ? `No modal on this page has the address name ${chosen}; a modal in the footer or header may.`
              : "Sets the address to #modal-… of a modal built as a row on this page. For one in the footer or header, type its address above."}
      </span>
    </div>
  );
}
