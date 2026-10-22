"use client";

import { useId, useState } from "react";

import {
  MODAL_CLASS_MAX,
  MODAL_DAYS_MAX,
  MODAL_DAYS_MIN,
  MODAL_FREQUENCIES,
  MODAL_KEY_MAX,
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

import { fillWords } from "@/lib/admin-fill";
import type { BlocksMessages } from "@/lib/admin-messages/blocks.en";
import { blocksEn } from "@/lib/admin-messages/blocks.en";

import { useAdminText } from "./admin-text";
import { Check, Choices, NumberField, TextField, fieldClass, smallButton } from "./block-fields";

type ModalWords = BlocksMessages["modal"];

/** A modal's refusal from `page-modal.ts` (written in English for the page's check) in the admin's language; one not known stays as written. */
function problemText(text: string, w: ModalWords): string {
  const en = blocksEn.modal.problems;
  const pairs: [string, string][] = [
    [en.noName, w.problems.noName],
    [fillWords(en.tooLong, { max: MODAL_KEY_MAX }), fillWords(w.problems.tooLong, { max: MODAL_KEY_MAX })],
    [en.badKey, w.problems.badKey],
    [en.spaces, w.problems.spaces],
    [fillWords(en.badClass, { max: MODAL_CLASS_MAX }), fillWords(w.problems.badClass, { max: MODAL_CLASS_MAX })],
    [en.noOpen, w.problems.noOpen],
    [fillWords(en.days, { min: MODAL_DAYS_MIN, max: MODAL_DAYS_MAX }), fillWords(w.problems.days, { min: MODAL_DAYS_MIN, max: MODAL_DAYS_MAX })],
    [en.noClose, w.problems.noClose],
  ];
  return pairs.find(([english]) => english === text)?.[1] ?? text;
}

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
  const w = useAdminText("blocks").modal;

  return (
    <div className="flex flex-col gap-4 border-t border-line pt-4">
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
            <span className="font-medium">{w.switch}</span>
            <span className="text-xs text-muted">{w.switchHint}</span>
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
  const w = useAdminText("blocks").modal;
  const problems = modalProblems(modal).map((problem) => problemText(problem, w));
  const keyId = useId();
  const classId = useId();
  const triggers = modal.triggers;
  const setTriggers = (patch: Partial<ModalTriggers>) => set({ triggers: { ...triggers, ...patch } });
  const taken = otherKeys.includes(modal.key);
  const ownKeyIssue = keyProblem(modal.key);
  const keyIssue = ownKeyIssue ? problemText(ownKeyIssue, w) : taken ? w.taken : null;
  const ownClassIssue = triggers.className !== undefined ? classProblem(triggers.className) : null;
  const classIssue = ownClassIssue ? problemText(ownClassIssue, w) : null;
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
          className="rounded-md border border-danger-text p-3 text-sm text-danger-text"
        >
          {w.leftOut}
        </p>
      )}
      <TextField
        label={w.name}
        value={modal.name ?? ""}
        max={MODAL_NAME_MAX}
        placeholder={w.namePlaceholder}
        hint={w.nameHint}
        onChange={rename}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor={keyId} className="text-sm font-medium">
          {w.address}
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
            className={`${fieldClass} w-56 aria-invalid:border-danger-text`}
          />
          <CopyLink text={modalHash(modal.key)} disabled={Boolean(keyIssue)} />
        </div>
        <span id={`${keyId}-hint`} className={`text-xs ${keyIssue ? "text-danger-text " : "text-muted"}`}>
          {keyIssue ?? fillWords(w.addressHint, { hash: modalHash(modal.key) })}
        </span>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">{w.opensWhen}</legend>
        <Check
          label={w.button}
          hint={fillWords(w.buttonHint, { hash: modalHash(modal.key) })}
          checked={Boolean(triggers.button)}
          onChange={(button) => setTriggers({ button: button || undefined })}
        />
        <Check
          label={w.class}
          hint={w.classHint}
          checked={triggers.className !== undefined}
          onChange={(on) => setTriggers({ className: on ? "" : undefined })}
        />
        {triggers.className !== undefined && (
          <div className="flex flex-col gap-1 pl-7">
            <label htmlFor={classId} className="text-sm font-medium">
              {w.className}
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
              className={`${fieldClass} w-64 aria-invalid:border-danger-text`}
            />
            <span
              id={`${classId}-hint`}
              className={`text-xs ${classIssue ? "text-danger-text " : "text-muted"}`}
            >
              {classIssue ?? w.oneClass}
            </span>
          </div>
        )}
        <Check
          label={w.exit}
          hint={w.exitHint}
          checked={Boolean(triggers.exitIntent)}
          onChange={(exitIntent) => setTriggers({ exitIntent: exitIntent || undefined })}
        />
        <Check
          label={w.timer}
          hint={w.timerHint}
          checked={Boolean(triggers.timer)}
          onChange={(on) => setTriggers({ timer: on ? { seconds: 5 } : undefined })}
        />
        {triggers.timer && (
          <div className="pl-7">
            <NumberField
              label={w.after}
              unit="seconds"
              min={MODAL_SECONDS_MIN}
              max={MODAL_SECONDS_MAX}
              value={triggers.timer.seconds}
              onChange={(seconds) => setTriggers({ timer: { seconds } })}
            />
          </div>
        )}
        <p className="text-xs text-muted">{w.byItself}</p>
      </fieldset>

      <div className="flex flex-col gap-3">
        <Choices
          legend={w.howOften}
          hint={w.howOftenHint}
          options={(Object.keys(MODAL_FREQUENCIES) as ModalFrequency[]).map((value) => ({
            value,
            label: w.frequencies[value] ?? MODAL_FREQUENCIES[value],
          }))}
          value={modal.frequency}
          onChange={(frequency) => set({ frequency, days: frequency === "days" ? (modal.days ?? 7) : undefined })}
        />
        {modal.frequency === "days" && (
          <NumberField
            label={w.notAgain}
            unit="days"
            min={MODAL_DAYS_MIN}
            max={MODAL_DAYS_MAX}
            value={modal.days ?? 7}
            onChange={(days) => set({ days })}
          />
        )}
        {modal.frequency !== "always" && (
          <p className="text-xs text-muted">{w.remembered}</p>
        )}
      </div>

      <Choices
        legend={w.size}
        hint={w.sizeHint}
        options={(Object.keys(MODAL_SIZES) as ModalSize[]).map((value) => ({ value, label: w.sizes[value] ?? MODAL_SIZES[value].label }))}
        value={modal.size}
        onChange={(size) => set({ size })}
      />
      <Choices
        legend={w.position}
        options={(Object.keys(MODAL_POSITIONS) as ModalPosition[]).map((value) => ({
          value,
          label: w.positions[value] ?? MODAL_POSITIONS[value],
        }))}
        value={modal.position ?? "center"}
        onChange={(position) => set({ position: position === "center" ? undefined : position })}
      />
      <Choices
        legend={w.dimming}
        options={(Object.keys(MODAL_OVERLAYS) as ModalOverlay[]).map((value) => ({
          value,
          label: w.overlays[value] ?? MODAL_OVERLAYS[value].label,
        }))}
        value={modal.overlay ?? "medium"}
        onChange={(overlay) => set({ overlay: overlay === "medium" ? undefined : overlay })}
      />
      <div className="flex flex-col gap-3">
        <Check
          label={w.close}
          hint={w.closeHint}
          checked={closable}
          disabled={closable && !overlayCloses}
          onChange={(on) => set({ closeButton: on ? undefined : false })}
        />
        <Check
          label={w.outside}
          checked={overlayCloses}
          disabled={overlayCloses && !closable}
          onChange={(on) => set({ closeOnOverlay: on ? undefined : false })}
        />
      </div>
      <p className="text-xs text-muted">{w.style}</p>

      {problems.length > 0 && (
        <ul
          role="alert"
          className="flex flex-col gap-1 rounded-md border border-danger-text p-3 text-sm text-danger-text"
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
  const w = useAdminText("blocks").modal;
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
      {copied ? w.copied : fillWords(w.copy, { text })}
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
  const w = useAdminText("blocks").modal;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {w.opens}
      </label>
      <select
        id={id}
        value={current?.key ?? ""}
        onChange={(event) => onPick(event.target.value ? modalHash(event.target.value) : "")}
        className={fieldClass}
      >
        <option value="">
          {current || modals.length > 0 ? w.noneUse : w.noModal}
        </option>
        {modals.map((modal) => (
          <option key={modal.key} value={modal.key}>
            {modal.name?.trim() || modal.key}
          </option>
        ))}
      </select>
      <span
        className={`text-xs ${(current && !current.triggers.button) || leftOut ? "text-danger-text " : "text-muted"}`}
      >
        {current && !current.triggers.button
          ? w.notFromButton
          : leftOut
            ? w.leftOutShort
            : chosen && !current
              ? fillWords(w.noSuch, { name: chosen })
              : w.setsAddress}
      </span>
    </div>
  );
}
