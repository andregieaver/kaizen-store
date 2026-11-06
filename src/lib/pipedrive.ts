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
  /** When it entered its stage, as Pipedrive says. */
  stageEnteredAt: string | null;
  /** The Pipedrive user who owns it. */
  ownerId: string | null;
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
  /** The Pipedrive user it is for. */
  ownerId: string | null;
};
export type PdNote = { id: string; text: string; dealId: string | null; personId: string | null; orgId: string | null; addedAt: string | null };

export function readOrganization(raw: unknown): PdOrganization | null {
  const o = obj(raw);
  const oid = id(o?.id);
  const name = str(o?.name);
  if (!o || !oid || !name || o.is_deleted === true) return null;
  return { id: oid, name: name.slice(0, 200).trim(), address: str(obj(o.address)?.value) ?? str(o.address) };
}

export function readPerson(raw: unknown): PdPerson | null {
  const p = obj(raw);
  const pid = id(p?.id);
  if (!p || !pid || p.is_deleted === true) return null;
  const name = str(p.name) ?? [str(p.first_name), str(p.last_name)].filter(Boolean).join(" ");
  const typed = primaryOf(p.emails ?? p.email);
  const email = typed ? normaliseEmail(typed) : null;
  return { id: pid, name: (name || "").slice(0, 200).trim(), email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null, phone: primaryOf(p.phones ?? p.phone), orgId: id(p.org_id) };
}

export function readPipeline(raw: unknown): PdPipeline | null {
  const p = obj(raw);
  const pid = id(p?.id);
  const name = str(p?.name);
  return p && pid && name && p.is_deleted !== true ? { id: pid, name: name.slice(0, 80).trim(), order: Number(p.order_nr) || 0 } : null;
}

export function readStage(raw: unknown): PdStage | null {
  const s = obj(raw);
  const sid = id(s?.id);
  const pipelineId = id(s?.pipeline_id);
  const name = str(s?.name);
  if (!s || !sid || !pipelineId || !name || s.is_deleted === true) return null;
  const probability = typeof s.deal_probability === "number" && s.deal_probability >= 0 && s.deal_probability <= 100 ? Math.round(s.deal_probability) : null;
  return { id: sid, pipelineId, name: name.slice(0, 60).trim(), order: Number(s.order_nr) || 0, probability };
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
    title: title.slice(0, 200).trim(),
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
    stageEnteredAt: instant(d.stage_change_time),
    ownerId: id(d.owner_id ?? d.user_id),
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
    title: (str(a.subject) ?? original ?? kind).replace(/\s+/g, " ").slice(0, 200).trim(),
    dueOn: day(a.due_date),
    dueTime: time ? `${time[1]}:${time[2]}` : "",
    durationMinutes: kind === "meeting" ? minutesOf(a.duration) : null,
    done: a.done === true || a.done === 1,
    doneAt: instant(a.marked_as_done_time),
    dealId: id(a.deal_id),
    personId: id(a.person_id),
    orgId: id(a.org_id),
    note: note ? note.slice(0, 2000).trim() : null,
    ownerId: id(a.owner_id ?? a.user_id),
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
  return { id: nid, text: text.slice(0, 5000).trim(), dealId: id(n.deal_id), personId: id(n.person_id), orgId: id(n.org_id), addedAt: instant(n.add_time) };
}

/** A Pipedrive user, for whom deals and activities are: matched to a member of the store's team by email. */
export type PdUser = { id: string; email: string };

export function readUser(raw: unknown): PdUser | null {
  const u = obj(raw);
  const uid = id(u?.id);
  const typed = str(u?.email);
  const email = typed ? normaliseEmail(typed) : null;
  return u && uid && email && u.active_flag !== false ? { id: uid, email } : null;
}

/** Each Pipedrive user who is a member of the team here, by their email: their account. */
export function ownersOf(users: readonly PdUser[], team: readonly { accountId: string; email: string }[]): Record<string, string> {
  const byEmail = new Map(team.map((m) => [normaliseEmail(m.email), m.accountId]));
  const out: Record<string, string> = {};
  for (const u of users) {
    const account = byEmail.get(u.email);
    if (account) out[u.id] = account;
  }
  return out;
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

export const emptyPlan = (): PdPlan => ({ companies: 0, customers: 0, pipelines: 0, stages: 0, deals: { open: 0, won: 0, lost: 0 }, activities: 0, notes: 0, skipped: {} });

/**
 * What is here as a run reads the account in its order (organisations, persons, pipelines, stages, deals, activities, notes): each record
 * that came over before, or comes over now, by its Pipedrive id. A deal keeps its person and organisation, for its notes; `orgPeople` are the
 * organisations with at least one person here, for theirs.
 */
export type PdHere = {
  organization: ReadonlySet<string>;
  person: ReadonlySet<string>;
  pipeline: ReadonlySet<string>;
  stage: ReadonlySet<string>;
  deal: ReadonlyMap<string, { personId: string | null; orgId: string | null }>;
  orgPeople: ReadonlySet<string>;
};

const has = (set: ReadonlySet<string>, v: string | null) => !!v && set.has(v);

/**
 * Whether each kind comes over, and why not: a person needs an email (a customer is one); a stage, its pipeline; a deal, a person or an
 * organisation that is here, and a stage that is; an activity, a day and a deal, person or organisation that is here; a note, someone to be
 * kept on (notes are kept by a person's email): its person, its deal's, or one of its organisation's people.
 */
export function personSkip(p: PdPerson): PdSkip | null {
  return p.email ? null : "person_no_email";
}

export function stageComes(s: PdStage, here: PdHere): boolean {
  return here.pipeline.has(s.pipelineId);
}

export function dealSkip(d: PdDeal, here: PdHere): PdSkip | null {
  if (!has(here.person, d.personId) && !has(here.organization, d.orgId)) return "deal_no_one";
  return has(here.stage, d.stageId) ? null : "deal_no_stage";
}

export function activitySkip(a: PdActivity, here: PdHere): PdSkip | null {
  if (!a.dueOn) return "activity_no_day";
  return here.deal.has(a.dealId ?? "") || has(here.person, a.personId) || has(here.organization, a.orgId) ? null : "activity_no_one";
}

/** Whom a note could be kept on, in order: its person, its deal's person; then a person of its deal's organisation, or of its own. */
export function noteHomes(n: PdNote, here: Pick<PdHere, "deal">): { persons: string[]; orgs: string[] } {
  const deal = n.dealId ? here.deal.get(n.dealId) : undefined;
  const persons = [n.personId, deal?.personId ?? null].filter((v): v is string => !!v);
  const orgs = [deal?.orgId ?? null, n.orgId].filter((v): v is string => !!v);
  return { persons: [...new Set(persons)], orgs: [...new Set(orgs)] };
}

export function noteSkip(n: PdNote, here: PdHere): PdSkip | null {
  const homes = noteHomes(n, here);
  return homes.persons.some((p) => here.person.has(p)) || homes.orgs.some((o) => here.orgPeople.has(o)) ? null : "note_no_one";
}

/** The run's feeds, in the order a run reads them: each needs only what the ones before it bring. */
export const PD_FEEDS = ["users", "organizations", "persons", "pipelines", "stages", "deals", "activities", "notes"] as const;
export type PdFeed = (typeof PD_FEEDS)[number];

export type PdRecord = PdUser | PdOrganization | PdPerson | PdPipeline | PdStage | PdDeal | PdActivity | PdNote;

/** The reader of each feed's raw records. */
export const PD_READERS: Record<PdFeed, (raw: unknown) => PdRecord | null> = {
  users: readUser,
  organizations: readOrganization,
  persons: readPerson,
  pipelines: readPipeline,
  stages: readStage,
  deals: readDeal,
  activities: readActivity,
  notes: readNote,
};

/** The link kind of a feed's records (`crm_move_links.kind`); users are matched, never linked. */
export const PD_LINK_KIND = {
  organizations: "organization",
  persons: "person",
  pipelines: "pipeline",
  stages: "stage",
  deals: "deal",
  activities: "activity",
  notes: "note",
} as const satisfies Record<Exclude<PdFeed, "users">, string>;
export type PdLinkKind = (typeof PD_LINK_KIND)[keyof typeof PD_LINK_KIND];

/** Why a record of a feed does not come over, given what is here; null when it does. */
export function skipOf(feed: Exclude<PdFeed, "users">, record: PdRecord, here: PdHere): PdSkip | "quiet" | null {
  switch (feed) {
    case "persons":
      return personSkip(record as PdPerson);
    case "stages":
      // A stage of a pipeline that is not here: nothing to say, its deals say it.
      return stageComes(record as PdStage, here) ? null : "quiet";
    case "deals":
      return dealSkip(record as PdDeal, here);
    case "activities":
      return activitySkip(record as PdActivity, here);
    case "notes":
      return noteSkip(record as PdNote, here);
    default:
      return null;
  }
}

/** Counts one record that comes over in a plan. */
export function countIn(plan: PdPlan, feed: Exclude<PdFeed, "users">, record: PdRecord): void {
  if (feed === "organizations") plan.companies += 1;
  else if (feed === "persons") plan.customers += 1;
  else if (feed === "pipelines") plan.pipelines += 1;
  else if (feed === "stages") plan.stages += 1;
  else if (feed === "deals") plan.deals[(record as PdDeal).status] += 1;
  else if (feed === "activities") plan.activities += 1;
  else plan.notes += 1;
}

export function skipIn(plan: PdPlan, why: PdSkip): void {
  plan.skipped[why] = (plan.skipped[why] ?? 0) + 1;
}

/** What a check keeps of what is here between its pages: the ids only, never a name or an address. */
export type PdSeen = {
  organization: string[];
  person: string[];
  pipeline: string[];
  stage: string[];
  deal: Record<string, [string | null, string | null]>;
  orgPeople: string[];
};

export const emptySeen = (): PdSeen => ({ organization: [], person: [], pipeline: [], stage: [], deal: {}, orgPeople: [] });

export function hereOfSeen(seen: PdSeen): PdHere {
  return {
    organization: new Set(seen.organization),
    person: new Set(seen.person),
    pipeline: new Set(seen.pipeline),
    stage: new Set(seen.stage),
    deal: new Map(Object.entries(seen.deal).map(([k, [personId, orgId]]) => [k, { personId, orgId }])),
    orgPeople: new Set(seen.orgPeople),
  };
}

/** Marks a record as here in a check's seen ids. */
export function seeIn(seen: PdSeen, feed: Exclude<PdFeed, "users">, record: PdRecord): void {
  const r = record as { id: string };
  if (feed === "organizations") seen.organization.push(r.id);
  else if (feed === "persons") {
    seen.person.push(r.id);
    const org = (record as PdPerson).orgId;
    if (org && !seen.orgPeople.includes(org)) seen.orgPeople.push(org);
  } else if (feed === "pipelines") seen.pipeline.push(r.id);
  else if (feed === "stages") seen.stage.push(r.id);
  else if (feed === "deals") seen.deal[r.id] = [(record as PdDeal).personId, (record as PdDeal).orgId];
}

/**
 * A check's page: each record that came over before (`linked`, its row still here) is counted as already here; each other one is counted in
 * the plan as coming over or as left out, and what is here grows by those that come. Returns how many were already here.
 */
export function checkPage(feed: Exclude<PdFeed, "users">, records: readonly PdRecord[], seen: PdSeen, plan: PdPlan, linked: ReadonlySet<string> = new Set()): number {
  let already = 0;
  for (const record of records) {
    const rid = (record as { id: string }).id;
    if (linked.has(rid)) {
      already += 1;
      seeIn(seen, feed, record);
      continue;
    }
    const why = skipOf(feed, record, hereOfSeen(seen));
    if (why === "quiet") continue;
    if (why) skipIn(plan, why);
    else {
      countIn(plan, feed, record);
      seeIn(seen, feed, record);
    }
  }
  return already;
}

/**
 * What an import of the account would bring, counted, and what it would leave out and why (`skipOf`): the whole account read in the run's
 * order, as a check reads it page by page.
 */
export function planImport(a: PdAccount): PdPlan {
  const plan = emptyPlan();
  const seen = emptySeen();
  checkPage("organizations", a.organizations, seen, plan);
  checkPage("persons", a.persons, seen, plan);
  checkPage("pipelines", a.pipelines, seen, plan);
  checkPage("stages", a.stages, seen, plan);
  checkPage("deals", a.deals, seen, plan);
  checkPage("activities", a.activities, seen, plan);
  checkPage("notes", a.notes, seen, plan);
  return plan;
}

/**
 * A run (`crm_moves.run`): a check (reads only, and counts) or an import (brings over), feed by feed and page by page from `cursor`, each
 * page saved with what it counted, so a run picks up where it stopped. `owners` are the Pipedrive users who are members here; `seen` is a
 * check's. A run that failed says why; one Pipedrive did not answer is tried again, `tries` times at most.
 */
export type PdRun = {
  mode: "check" | "import";
  status: "running" | "done" | "failed";
  feed: PdFeed;
  cursor: string | null;
  plan: PdPlan;
  already: number;
  owners: Record<string, string>;
  seen?: PdSeen;
  tries: number;
  problem?: "token_refused" | "unreachable" | "too_slow" | "unexpected";
  by: string | null;
  startedAt: string;
  finishedAt?: string;
};

export const PD_TRIES = 5;

export function newRun(mode: PdRun["mode"], by: string | null, now: Date): PdRun {
  return { mode, status: "running", feed: "users", cursor: null, plan: emptyPlan(), already: 0, owners: {}, ...(mode === "check" ? { seen: emptySeen() } : {}), tries: 0, by, startedAt: now.toISOString() };
}

/** A kept run, read leniently: anything else is no run. */
export function runOf(raw: unknown): PdRun | null {
  const r = obj(raw);
  if (!r || (r.mode !== "check" && r.mode !== "import") || !["running", "done", "failed"].includes(String(r.status))) return null;
  if (!PD_FEEDS.includes(r.feed as PdFeed) || !obj(r.plan)) return null;
  return r as unknown as PdRun;
}

/** The feed after this one, or null at the end. */
export function nextFeed(feed: PdFeed): PdFeed | null {
  return PD_FEEDS[PD_FEEDS.indexOf(feed) + 1] ?? null;
}

/** How many records a plan brings, all kinds together. */
export function planTotal(plan: PdPlan): number {
  return plan.companies + plan.customers + plan.pipelines + plan.stages + plan.deals.open + plan.deals.won + plan.deals.lost + plan.activities + plan.notes;
}
