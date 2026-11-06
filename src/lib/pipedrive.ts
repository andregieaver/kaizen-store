import { normaliseEmail } from "./email-address";
import { minorUnitDigits } from "./money";
import { pageText } from "./web-page-text";

/**
 * Moving in from Pipedrive (S7 of `docs/own-books-and-sales.md`, D477), pure: what Pipedrive's API gives, read into what a store keeps.
 * Its API v2 (`/api/v2/…`, cursor pages of at most 500) serves organisations, persons, pipelines, stages, deals and activities; notes and
 * the token's own user are still v1 (`/v1/notes`, `/v1/users/me`). Records are read leniently: a field missing or of another shape is
 * left out, never guessed. Nothing here knows the network or a database.
 */

export const PIPEDRIVE_PAGE = 500;
export const PIPEDRIVE_HOST = "https://api.pipedrive.com";

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const id = (v: unknown): string | null => (typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" && /^\d+$/.test(v) ? v : str(obj(v)?.value) ?? null);
const day = (v: unknown): string | null => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const instant = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s.replace(" ", "T") : `${s.replace(" ", "T")}Z`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};

/** The primary item of a v2 `emails`/`phones` list (or v1's `email`/`phone`), else the first. */
function primaryOf(list: unknown): string | null {
  if (!Array.isArray(list)) return str(list);
  const items = list.map(obj).filter((i): i is Raw => !!i && !!str(i.value));
  return str((items.find((i) => i.primary === true) ?? items[0])?.value) ?? null;
}

export type PdOrganization = { id: string; name: string; address: string | null };
export type PdPerson = { id: string; name: string; email: string | null; phone: string | null; orgId: string | null };
export type PdPipeline = { id: string; name: string; order: number };
export type PdStage = { id: string; pipelineId: string; name: string; order: number; probability: number | null };
export type PdDeal = {
  id: string;
  title: string;
  status: "open" | "won" | "lost";
  pipelineId: string | null;
  stageId: string | null;
  personId: string | null;
  orgId: string | null;
  /** The deal's value in its currency's minor units, or null when it has none. */
  valueMinor: number | null;
  currency: string | null;
  expectedCloseOn: string | null;
  lostReason: string | null;
  closedAt: string | null;
  addedAt: string | null;
};
export type PdActivity = {
  id: string;
  kind: "call" | "meeting" | "task";
  /** Pipedrive's own type when it is not one of ours (email, deadline, lunch): kept in the note. */
  originalType: string | null;
  title: string;
  dueOn: string | null;
  dueTime: string;
  durationMinutes: number | null;
  done: boolean;
  doneAt: string | null;
  dealId: string | null;
  personId: string | null;
  orgId: string | null;
  note: string | null;
};
export type PdNote = { id: string; text: string; dealId: string | null; personId: string | null; orgId: string | null; addedAt: string | null };

export function readOrganization(raw: unknown): PdOrganization | null {
  const o = obj(raw);
  const oid = id(o?.id);
  const name = str(o?.name);
  if (!o || !oid || !name || o.is_deleted === true) return null;
  return { id: oid, name: name.slice(0, 200), address: str(obj(o.address)?.value) ?? str(o.address) };
}

export function readPerson(raw: unknown): PdPerson | null {
  const p = obj(raw);
  const pid = id(p?.id);
  if (!p || !pid || p.is_deleted === true) return null;
  const name = str(p.name) ?? [str(p.first_name), str(p.last_name)].filter(Boolean).join(" ");
  const typed = primaryOf(p.emails ?? p.email);
  const email = typed ? normaliseEmail(typed) : null;
  return { id: pid, name: (name || "").slice(0, 200), email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null, phone: primaryOf(p.phones ?? p.phone), orgId: id(p.org_id) };
}

export function readPipeline(raw: unknown): PdPipeline | null {
  const p = obj(raw);
  const pid = id(p?.id);
  const name = str(p?.name);
  return p && pid && name && p.is_deleted !== true ? { id: pid, name: name.slice(0, 80), order: Number(p.order_nr) || 0 } : null;
}

export function readStage(raw: unknown): PdStage | null {
  const s = obj(raw);
  const sid = id(s?.id);
  const pipelineId = id(s?.pipeline_id);
  const name = str(s?.name);
  if (!s || !sid || !pipelineId || !name || s.is_deleted === true) return null;
  const probability = typeof s.deal_probability === "number" && s.deal_probability >= 0 && s.deal_probability <= 100 ? Math.round(s.deal_probability) : null;
  return { id: sid, pipelineId, name: name.slice(0, 60), order: Number(s.order_nr) || 0, probability };
}

/** A value in a currency's minor units: 12 500.5 NOK is 1 250 050; null when it is none, not a number, or in a currency not kept here. */
export function toMinor(value: unknown, currency: string | null): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0 || !currency) return null;
  try {
    return Math.round(n * 10 ** minorUnitDigits(currency));
  } catch {
    return null;
  }
}

export function readDeal(raw: unknown): PdDeal | null {
  const d = obj(raw);
  const did = id(d?.id);
  const title = str(d?.title);
  const status = str(d?.status);
  if (!d || !did || !title || d.is_deleted === true || (status !== "open" && status !== "won" && status !== "lost")) return null;
  const currency = str(d.currency)?.toUpperCase() ?? null;
  return {
    id: did,
    title: title.slice(0, 200),
    status,
    pipelineId: id(d.pipeline_id),
    stageId: id(d.stage_id),
    personId: id(d.person_id),
    orgId: id(d.org_id),
    valueMinor: toMinor(d.value, currency && /^[A-Z]{3}$/.test(currency) ? currency : null),
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
    expectedCloseOn: day(d.expected_close_date),
    lostReason: str(d.lost_reason)?.slice(0, 500) ?? null,
    closedAt: instant(d.won_time ?? d.lost_time ?? d.close_time),
    addedAt: instant(d.add_time),
  };
}

/** Pipedrive's activity types into ours: a call, a meeting (or a lunch), and a task for the rest, its own type kept. */
function kindOf(type: string | null): { kind: PdActivity["kind"]; original: string | null } {
  if (type === "call") return { kind: "call", original: null };
  if (type === "meeting") return { kind: "meeting", original: null };
  if (type === "lunch") return { kind: "meeting", original: "lunch" };
  return { kind: "task", original: type && type !== "task" ? type : null };
}

/** `HH:MM` (or `HH:MM:SS`) as minutes, or null. */
function minutesOf(v: unknown): number | null {
  const m = str(v)?.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const total = Number(m[1]) * 60 + Number(m[2]);
  return total > 0 && total <= 720 ? total : null;
}

export function readActivity(raw: unknown): PdActivity | null {
  const a = obj(raw);
  const aid = id(a?.id);
  if (!a || !aid || a.is_deleted === true) return null;
  const { kind, original } = kindOf(str(a.type)?.toLowerCase() ?? null);
  const time = str(a.due_time)?.match(/^(\d{2}):(\d{2})/);
  const note = str(a.note) ? noteText(String(a.note)) : null;
  return {
    id: aid,
    kind,
    originalType: original,
    title: (str(a.subject) ?? original ?? kind).slice(0, 200),
    dueOn: day(a.due_date),
    dueTime: time ? `${time[1]}:${time[2]}` : "",
    durationMinutes: kind === "meeting" ? minutesOf(a.duration) : null,
    done: a.done === true || a.done === 1,
    doneAt: instant(a.marked_as_done_time),
    dealId: id(a.deal_id),
    personId: id(a.person_id),
    orgId: id(a.org_id),
    note: note ? note.slice(0, 2000) : null,
  };
}

/** A note's words as text: Pipedrive keeps notes as HTML. */
export function noteText(html: string): string {
  return pageText(`<div>${html}</div>`, "text/html", 10_000).text.replace(/\n{3,}/g, "\n\n").trim();
}

export function readNote(raw: unknown): PdNote | null {
  const n = obj(raw);
  const nid = id(n?.id);
  const text = str(n?.content) ? noteText(String(n?.content)) : "";
  if (!n || !nid || !text) return null;
  return { id: nid, text: text.slice(0, 5000), dealId: id(n.deal_id), personId: id(n.person_id), orgId: id(n.org_id), addedAt: instant(n.add_time) };
}

/** Everything read from an account, as the import and its dry run see it. */
export type PdAccount = { organizations: PdOrganization[]; persons: PdPerson[]; pipelines: PdPipeline[]; stages: PdStage[]; deals: PdDeal[]; activities: PdActivity[]; notes: PdNote[] };

/** Why a record does not come over. */
export type PdSkip = "person_no_email" | "deal_no_one" | "deal_no_stage" | "activity_no_one" | "activity_no_day" | "note_no_one";

export type PdPlan = {
  companies: number;
  customers: number;
  pipelines: number;
  stages: number;
  deals: { open: number; won: number; lost: number };
  activities: number;
  notes: number;
  skipped: Partial<Record<PdSkip, number>>;
};

/**
 * What an import of the account would bring, counted, and what it would leave out and why: a person needs an email (a customer is one); a
 * deal needs a person who comes over or an organisation, and a stage of a pipeline that comes over; an activity needs a day and someone or
 * a deal it is about that comes over; a note too.
 */
export function planImport(a: PdAccount): PdPlan {
  const skipped: Partial<Record<PdSkip, number>> = {};
  const skip = (why: PdSkip) => (skipped[why] = (skipped[why] ?? 0) + 1);
  const orgs = new Set(a.organizations.map((o) => o.id));
  const people = new Set(a.persons.filter((p) => p.email || (skip("person_no_email"), false)).map((p) => p.id));
  const pipelines = new Set(a.pipelines.map((p) => p.id));
  const stages = new Set(a.stages.filter((s) => pipelines.has(s.pipelineId)).map((s) => s.id));
  const deals = a.deals.filter((d) => {
    if (!(d.personId && people.has(d.personId)) && !(d.orgId && orgs.has(d.orgId))) return skip("deal_no_one"), false;
    if (!d.stageId || !stages.has(d.stageId)) return skip("deal_no_stage"), false;
    return true;
  });
  const dealIds = new Set(deals.map((d) => d.id));
  const about = (x: { dealId: string | null; personId: string | null; orgId: string | null }) =>
    (!!x.dealId && dealIds.has(x.dealId)) || (!!x.personId && people.has(x.personId)) || (!!x.orgId && orgs.has(x.orgId));
  const activities = a.activities.filter((x) => (!x.dueOn ? (skip("activity_no_day"), false) : about(x) || (skip("activity_no_one"), false)));
  const notes = a.notes.filter((n) => about(n) || (skip("note_no_one"), false));
  return {
    companies: orgs.size,
    customers: people.size,
    pipelines: pipelines.size,
    stages: stages.size,
    deals: { open: deals.filter((d) => d.status === "open").length, won: deals.filter((d) => d.status === "won").length, lost: deals.filter((d) => d.status === "lost").length },
    activities: activities.length,
    notes: notes.length,
    skipped,
  };
}
