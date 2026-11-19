/**
 * Server code and tests only: an admin client module must not import this (admin-bundle.scan.test.ts).
 * The returns screens' English constants (D153, D312 A4), as the AI manager's tools and the
 * analytics read them; a screen reads the `returns` catalogue in the account's language.
 */
import type { WorkingRow } from "./return-refund";
import type { ReturnAction, ReturnKind, ReturnStatus } from "./return-status";
import type { ReturnReason } from "./withdrawal";
import { returnsEn } from "./admin-messages/returns.en";

const EN = returnsEn;

export const STATUS_LABELS: Record<ReturnStatus, string> = EN.labels.status;

/** What each status means for the person who works the return, a line under the status. */
export const STATUS_HINTS: Record<ReturnStatus, string> = EN.labels.statusHints;

export const KIND_LABELS: Record<ReturnKind, string> = EN.labels.kind;

export const KIND_HINTS: Record<ReturnKind, string> = EN.labels.kindHints;

export const REASON_LABELS: Record<ReturnReason, string> = EN.labels.reason;

export const ACTION_LABELS: Record<ReturnAction, string> = EN.labels.action;

export const WORKING_LABELS: Record<WorkingRow["key"], string> = EN.labels.working;

export const CAPPED_WORDS: Record<"zero" | "refundable", string> = EN.labels.capped;
