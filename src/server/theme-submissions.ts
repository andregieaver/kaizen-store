import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { parseDesignSnapshot, type DesignSnapshot } from "@/lib/design-presets";
import {
  canMove,
  nextSlug,
  OPEN_SUBMISSIONS_MAX,
  SUBMISSION_LIMITS,
  submissionProblems,
  submittedPagesOf,
  themeSlugFrom,
  type SubmissionInput,
  type SubmissionKind,
  type SubmissionProblem,
  type SubmissionStatus,
} from "@/lib/theme-submissions";

import { audit, type Account, type Membership } from "./auth";
import { archiveDesign, archiveWithdrawnDraft, createDesign, giveThemeAddress, publishDesign, takeSnapshot, writeDesignLook } from "./design-presets";
import { memberCan } from "./permissions";
import type { TemplateDeps } from "./templates";
import { publishStarter } from "./store-starters";
import { adoptSubmittedContent, archiveSubmittedContent, makeSubmittedContent, pagesToSubmit } from "./submission-content";

/**
 * Themes from outside (D344, `docs/wave-7-storefront.md` J): the only writer of `commerce.theme_submissions` and of a theme's author. Anyone
 * who may change a store's website submits its live look, as a new theme or as an update of a theme they are the author of; Kaizena Flow's
 * admins review it (*Review* makes it a draft theme they can preview and check on the theme's own pages), then approve it (published through
 * `publishDesign()`, so the theme checks hold) or reject it with a reason the author reads.
 */

type Row = Record<string, unknown>;

export type SubmissionResult<T = object> = ({ ok: true } & T) | { ok: false; problems: string[]; fields?: SubmissionProblem[] };

const refuse = (problem: string, fields?: SubmissionProblem[]): { ok: false; problems: string[]; fields?: SubmissionProblem[] } => ({
  ok: false,
  problems: [problem],
  ...(fields ? { fields } : {}),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Submission = {
  id: string;
  kind: SubmissionKind;
  status: SubmissionStatus;
  title: string;
  summary: string;
  description: string;
  notes: string | null;
  authorName: string;
  accountId: string;
  storeId: string;
  storeName: string;
  storeSlug: string;
  presetId: string | null;
  /** The theme's name now, when it has one (an update's, or a new theme's once reviewed). */
  presetTitle: string | null;
  reason: string | null;
  createdAt: string;
  decidedAt: string | null;
  /** How many of the author store's pages it carries as the theme's content (D388); 0: the look only. */
  pages: number;
  /** The store template its pages were placed in at review (D388). */
  contentStarterId: string | null;
};

const SELECT = sql`
  select s.id, s.kind, s.status, s.title, s.summary, s.description, s.notes, s.author_name, s.account_id, s.store_id, st.name as store_name,
         st.slug as store_slug, s.preset_id, p.title as preset_title, s.reason, s.created_at, s.decided_at,
         coalesce(jsonb_array_length(case when jsonb_typeof(s.pages) = 'array' then s.pages end), 0) as page_count, s.content_starter_id
    from commerce.theme_submissions s
    join commerce.stores st on st.id = s.store_id
    left join commerce.design_presets p on p.id = s.preset_id`;

const iso = (value: unknown): string | null => (value ? new Date(String(value)).toISOString() : null);

function submissionOf(row: Row): Submission {
  return {
    id: String(row.id),
    kind: row.kind === "update" ? "update" : "theme",
    status: String(row.status) as SubmissionStatus,
    title: String(row.title),
    summary: String(row.summary ?? ""),
    description: String(row.description ?? ""),
    notes: row.notes ? String(row.notes) : null,
    authorName: String(row.author_name),
    accountId: String(row.account_id),
    storeId: String(row.store_id),
    storeName: String(row.store_name),
    storeSlug: String(row.store_slug),
    presetId: row.preset_id ? String(row.preset_id) : null,
    presetTitle: row.preset_title ? String(row.preset_title) : null,
    reason: row.reason ? String(row.reason) : null,
    createdAt: iso(row.created_at)!,
    decidedAt: iso(row.decided_at),
    pages: Number(row.page_count ?? 0),
    contentStarterId: row.content_starter_id ? String(row.content_starter_id) : null,
  };
}

/** The words as kept: trimmed at the ends, empty optional ones as nothing. */
function cleaned(input: SubmissionInput) {
  return {
    title: input.title.trim(),
    summary: input.summary.trim(),
    description: input.description.trim(),
    authorName: input.authorName.trim(),
    notes: input.notes?.trim() ? input.notes.trim() : null,
  };
}

/**
 * Why this store's look cannot be submitted by this member, or null: they may change its website, and it is a real, open store (never a
 * store template, a demo store or a theme's workspace, whose looks are the platform's).
 */
function storeRefusal(member: Membership): string | null {
  if (!memberCan(member, "website:write")) return "Only someone who may change this store's website can share its look.";
  const { store } = member;
  if (store.isTemplate || store.starter) return "A demo store's or starting content's look is shared from the Themes pages.";
  if (store.status !== "active") return "Only an open store's look can be shared.";
  return null;
}

async function openCount(accountId: string): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.theme_submissions where account_id = ${accountId}::uuid and status in ('waiting', 'reviewing')
  `);
  return Number(row?.n ?? 0);
}

async function insertSubmission(
  member: Membership,
  kind: SubmissionKind,
  presetId: string | null,
  words: ReturnType<typeof cleaned>,
  snapshot: DesignSnapshot,
  withPages: boolean,
): Promise<string> {
  // The store's published pages as the theme's content (D388), copied as a template is now, so the store can change after.
  const pages = withPages ? await pagesToSubmit(member.store.id) : [];
  const [row] = await db().execute<Row>(sql`
    insert into commerce.theme_submissions (account_id, store_id, kind, preset_id, title, summary, description, notes, author_name, snapshot, pages)
    values (${member.account.id}::uuid, ${member.store.id}::uuid, ${kind}, ${presetId}::uuid, ${words.title}, ${words.summary}, ${words.description},
      ${words.notes}, ${words.authorName}, ${JSON.stringify(snapshot)}::jsonb, ${pages.length > 0 ? JSON.stringify(pages) : null}::jsonb)
    returning id
  `);
  return String(row.id);
}

/**
 * Submits the store's live look as a new theme: taken now by `takeSnapshot()` (the look only, never the store's words or products) and kept
 * with the submission, so the store can change after. Audited as `store.theme_submitted`.
 */
export async function submitTheme(member: Membership, input: SubmissionInput, options: { pages?: boolean } = {}): Promise<SubmissionResult<{ id: string }>> {
  const refusal = storeRefusal(member);
  if (refusal) return refuse(refusal);
  const fields = submissionProblems(input, "theme");
  if (fields.length > 0) return refuse(problemWords(fields), fields);
  if ((await openCount(member.account.id)) >= OPEN_SUBMISSIONS_MAX) {
    return refuse(`You have ${OPEN_SUBMISSIONS_MAX} looks waiting to be reviewed. Wait for an answer, or withdraw one, before sharing another.`);
  }
  const taken = await takeSnapshot(member.store.id);
  if (!taken.ok) return taken;
  const words = cleaned(input);
  const id = await insertSubmission(member, "theme", null, words, taken.snapshot, options.pages === true);
  await audit(member.account.id, member.store.id, "store.theme_submitted", { submission: id, kind: "theme", pages: options.pages === true }, {
    area: "website",
    target: { type: "theme_submission", id },
  });
  return { ok: true, id };
}

/**
 * Submits the store's live look as an update of a theme its author made (the database refuses anyone else), with what's new in their words.
 * The theme's name, line and description stay its own; the update changes its look.
 */
export async function submitThemeUpdate(
  member: Membership,
  presetId: string,
  input: Pick<SubmissionInput, "notes" | "authorName">,
  options: { pages?: boolean } = {},
): Promise<SubmissionResult<{ id: string }>> {
  const refusal = storeRefusal(member);
  if (refusal) return refuse(refusal);
  if (!UUID.test(presetId)) return refuse("Unknown theme.");
  const [theme] = await db().execute<Row>(sql`
    select title, summary, description, author_name from commerce.design_presets
     where id = ${presetId}::uuid and author_id = ${member.account.id}::uuid and archived_at is null
  `);
  if (!theme) return refuse("Only a theme's author can send an update of it.");
  const full: SubmissionInput = {
    title: String(theme.title),
    summary: String(theme.summary ?? ""),
    description: String(theme.description ?? ""),
    authorName: input.authorName.trim() || String(theme.author_name),
    notes: input.notes ?? null,
  };
  const fields = submissionProblems(full, "update");
  if (fields.length > 0) return refuse(problemWords(fields), fields);
  if ((await openCount(member.account.id)) >= OPEN_SUBMISSIONS_MAX) {
    return refuse(`You have ${OPEN_SUBMISSIONS_MAX} looks waiting to be reviewed. Wait for an answer, or withdraw one, before sharing another.`);
  }
  const taken = await takeSnapshot(member.store.id);
  if (!taken.ok) return taken;
  const id = await insertSubmission(member, "update", presetId, cleaned(full), taken.snapshot, options.pages === true);
  await audit(member.account.id, member.store.id, "store.theme_submitted", { submission: id, kind: "update", preset: presetId, pages: options.pages === true }, {
    area: "website",
    target: { type: "theme_submission", id },
  });
  return { ok: true, id };
}

/** The author takes back a submission not yet decided. A new theme drafted for it in review is archived, unpublished. */
export async function withdrawSubmission(account: Account, id: string): Promise<SubmissionResult> {
  if (!UUID.test(id)) return refuse("Unknown submission.");
  const [row] = await db().execute<Row>(sql`
    update commerce.theme_submissions set status = 'withdrawn', decided_by = ${account.id}::uuid, decided_at = now()
     where id = ${id}::uuid and account_id = ${account.id}::uuid and status in ('waiting', 'reviewing')
    returning store_id, kind, preset_id, content_starter_id
  `);
  if (!row) return refuse("That submission is no longer waiting.");
  if (row.content_starter_id) await archiveSubmittedContent(account.id, String(row.content_starter_id));
  // A new theme drafted for it in review was never published: put away as an admin's Archive would.
  if (row.kind === "theme" && row.preset_id) {
    await archiveWithdrawnDraft(String(row.preset_id), account.id);
  }
  await audit(account.id, String(row.store_id), "store.theme_submission_withdrawn", { submission: id }, { area: "website", target: { type: "theme_submission", id } });
  return { ok: true };
}

/** An account's submissions, newest first. */
export async function mySubmissions(accountId: string): Promise<Submission[]> {
  const rows = await db().execute<Row>(sql`${SELECT} where s.account_id = ${accountId}::uuid order by s.created_at desc limit 100`);
  return rows.map(submissionOf);
}

export type AuthoredTheme = {
  id: string;
  title: string;
  slug: string | null;
  published: boolean;
  archived: boolean;
  /** Its latest version's number; null before it is first published. */
  version: number | null;
  /** How many real stores have it installed, live or not. */
  stores: number;
};

/** The themes an account is the author of, with their version and how many stores use each. */
export async function authoredThemes(accountId: string): Promise<AuthoredTheme[]> {
  const rows = await db().execute<Row>(sql`
    select p.id, p.title, p.slug, p.published, p.archived_at is not null as archived,
           (select max(v.number) from commerce.design_preset_versions v where v.preset_id = p.id) as version,
           ${STORES_USING} as stores
      from commerce.design_presets p
     where p.author_id = ${accountId}::uuid
     order by p.created_at desc
  `);
  return rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    slug: row.slug ? String(row.slug) : null,
    published: row.published === true,
    archived: row.archived === true,
    version: row.version === null || row.version === undefined ? null : Number(row.version),
    stores: Number(row.stores ?? 0),
  }));
}

/** How many real stores (never a template, a demo store or a workspace) have theme `p` installed. */
export const STORES_USING = sql`(
  select count(distinct i.store_id)::int from commerce.store_theme_installs i join commerce.stores s on s.id = i.store_id
   where i.preset_id = p.id and s.status = 'active' and not (s.is_template or s.starter)
)`;

// ---------------------------------------------------------------------------
// The queue (Kaizena Flow's admins)
// ---------------------------------------------------------------------------

export type QueueFilter = "open" | "decided";

/** The submissions to review (`open`: waiting and in review, oldest first) or decided (newest first). */
export async function listSubmissions(admin: Account, filter: QueueFilter = "open"): Promise<Submission[]> {
  if (!admin.platformAdmin) return [];
  const rows =
    filter === "open"
      ? await db().execute<Row>(sql`${SELECT} where s.status in ('waiting', 'reviewing') order by s.created_at limit 200`)
      : await db().execute<Row>(sql`${SELECT} where s.status not in ('waiting', 'reviewing') order by coalesce(s.decided_at, s.created_at) desc limit 200`);
  return rows.map(submissionOf);
}

export async function getSubmission(admin: Account, id: string): Promise<Submission | null> {
  if (!admin.platformAdmin || !UUID.test(id)) return null;
  const [row] = await db().execute<Row>(sql`${SELECT} where s.id = ${id}::uuid`);
  return row ? submissionOf(row) : null;
}

async function pagesOf(id: string): Promise<unknown> {
  const [row] = await db().execute<Row>(sql`select pages from commerce.theme_submissions where id = ${id}::uuid`);
  return row?.pages ?? null;
}

async function snapshotOf(id: string): Promise<DesignSnapshot | null> {
  const [row] = await db().execute<Row>(sql`select snapshot from commerce.theme_submissions where id = ${id}::uuid`);
  return row ? parseDesignSnapshot(row.snapshot) : null;
}

/**
 * Takes a waiting submission into review: a new theme is made from its look as a draft (unpublished, its author set, its pictures copied from
 * the store's library), an update is written into its theme's draft; the reviewer then previews it and reads its checks on the theme's own
 * pages. Audited as `platform.theme_submission_reviewed`.
 */
export async function reviewSubmission(admin: Account, id: string, deps: TemplateDeps = {}): Promise<SubmissionResult<{ presetId: string; notes: string[] }>> {
  const submission = await getSubmission(admin, id);
  if (!submission) return refuse("Unknown submission.");
  if (!canMove(submission.status, "reviewing")) return refuse("Only a waiting submission can be taken into review.");
  const snapshot = await snapshotOf(id);
  if (!snapshot) return refuse("Its look can no longer be read as a theme. Reject it with that reason.");
  let presetId: string;
  let notes: string[] = [];
  if (submission.kind === "theme") {
    const made = await createDesign(admin, {
      origin: { kind: "look", snapshot, storeId: submission.storeId, author: { id: submission.accountId, name: submission.authorName } },
      details: { title: submission.title, summary: submission.summary, description: submission.description, pictureUrl: null },
    });
    if (!made.ok) return made;
    presetId = made.id;
    notes = made.notes;
  } else {
    presetId = submission.presetId!;
    const written = await writeDesignLook(admin, presetId, snapshot);
    if (!written.ok) return written;
    notes = written.notes;
  }
  const [row] = await db().execute<Row>(sql`
    update commerce.theme_submissions set status = 'reviewing', preset_id = ${presetId}::uuid
     where id = ${id}::uuid and status = 'waiting' returning id
  `);
  if (!row) return refuse("Someone else took it into review first.");
  // Its pages (D388): placed in a store template of their own to review the look on, the theme's content once approved.
  const pages = submittedPagesOf(await pagesOf(id));
  let contentStarterId: string | null = null;
  if (pages.length > 0) {
    const content = await makeSubmittedContent(admin, { title: submission.title, sourceStoreId: submission.storeId, pages }, deps);
    if (!content.ok) notes = [...notes, ...content.problems];
    else {
      contentStarterId = content.starterId;
      notes = [...notes, ...content.notes];
      await db().execute(sql`update commerce.theme_submissions set content_starter_id = ${content.starterId}::uuid where id = ${id}::uuid`);
    }
  }
  await audit(admin.id, submission.storeId, "platform.theme_submission_reviewed", { submission: id, preset: presetId, pages: pages.length, content: contentStarterId }, {
    target: { type: "theme_submission", id },
  });
  return { ok: true, presetId, notes };
}

/** A free address in the theme store for a new theme, from its name. */
async function freeSlug(title: string): Promise<string> {
  const base = themeSlugFrom(title);
  const rows = await db().execute<Row>(sql`select slug from commerce.design_presets where slug = ${base} or slug like ${`${base}-%`}`);
  const taken = new Set(rows.map((row) => String(row.slug)));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(nextSlug(base, n))) return nextSlug(base, n);
}

/**
 * Approves a submission in review: its theme is published (a new version with the author's what's new for an update), so the theme checks
 * hold and a refusal keeps it in review with the reason; a new theme gets its address in the theme store from its name. Audited as
 * `platform.theme_submission_approved`.
 */
export async function approveSubmission(admin: Account, id: string): Promise<SubmissionResult<{ presetId: string; notes: string[] }>> {
  const submission = await getSubmission(admin, id);
  if (!submission) return refuse("Unknown submission.");
  if (!canMove(submission.status, "approved") || !submission.presetId) return refuse("Take it into review before approving it.");
  const presetId = submission.presetId;
  const published = await publishDesign(admin, presetId, submission.kind === "update" ? submission.notes : null);
  if (!published.ok) return published;
  if (submission.kind === "theme") {
    const slug = await freeSlug(submission.title);
    await giveThemeAddress(presetId, slug);
  }
  const notes = [...published.notes];
  // Its pages become the theme's content (D388) once its look is published, and are published with it; a refusal is said, never fatal.
  if (submission.contentStarterId) {
    const adopted = await adoptSubmittedContent(admin, presetId, submission.contentStarterId);
    if (!adopted.ok) notes.push(`Its pages did not become the theme's content: ${adopted.problems.join(" ")}`);
    else {
      const shown = await publishStarter(admin, submission.contentStarterId);
      if (!shown.ok) notes.push(`Its pages are the theme's content but were not published: ${shown.problems.join(" ")}`);
    }
  }
  const [row] = await db().execute<Row>(sql`
    update commerce.theme_submissions set status = 'approved', decided_by = ${admin.id}::uuid, decided_at = now()
     where id = ${id}::uuid and status = 'reviewing' returning id
  `);
  if (!row) return refuse("It was decided by someone else meanwhile.");
  await audit(admin.id, submission.storeId, "platform.theme_submission_approved", { submission: id, preset: presetId }, {
    target: { type: "theme_submission", id },
  });
  return { ok: true, presetId, notes };
}

/**
 * Rejects a submission not yet decided, with a reason the author reads. A new theme drafted for it in review is archived (it was never
 * published); an update's draft stays in its theme's workspace until the next review or publish writes over it. Audited as
 * `platform.theme_submission_rejected`, without the reason's words.
 */
export async function rejectSubmission(admin: Account, id: string, reason: string): Promise<SubmissionResult> {
  const submission = await getSubmission(admin, id);
  if (!submission) return refuse("Unknown submission.");
  const why = reason.trim();
  if (why.length === 0 || why.length > SUBMISSION_LIMITS.reason) return refuse(`Say why, in at most ${SUBMISSION_LIMITS.reason.toLocaleString("en")} characters.`);
  if (!canMove(submission.status, "rejected")) return refuse("That submission was already decided.");
  const [row] = await db().execute<Row>(sql`
    update commerce.theme_submissions set status = 'rejected', reason = ${why}, decided_by = ${admin.id}::uuid, decided_at = now()
     where id = ${id}::uuid and status in ('waiting', 'reviewing') returning id
  `);
  if (!row) return refuse("That submission was already decided.");
  if (submission.kind === "theme" && submission.presetId) {
    const [theme] = await db().execute<Row>(sql`select published from commerce.design_presets where id = ${submission.presetId}::uuid`);
    if (theme && theme.published !== true) await archiveDesign(admin, submission.presetId);
  }
  if (submission.contentStarterId) await archiveSubmittedContent(admin.id, submission.contentStarterId);
  await audit(admin.id, submission.storeId, "platform.theme_submission_rejected", { submission: id }, { target: { type: "theme_submission", id } });
  return { ok: true };
}

const PROBLEM_WORDS: Record<SubmissionProblem, string> = {
  title: `Give it a name of at most ${SUBMISSION_LIMITS.title} characters.`,
  summary: `Keep the line to at most ${SUBMISSION_LIMITS.summary} characters.`,
  description: `Keep the description to at most ${SUBMISSION_LIMITS.description.toLocaleString("en")} characters.`,
  authorName: `Say who made it, in at most ${SUBMISSION_LIMITS.authorName} characters.`,
  notes: `Keep what's new to at most ${SUBMISSION_LIMITS.notes.toLocaleString("en")} characters.`,
};

function problemWords(fields: SubmissionProblem[]): string {
  return fields.map((field) => PROBLEM_WORDS[field]).join(" ");
}

/** How many submissions wait for a first look, for the Themes page's card. */
export async function waitingSubmissions(admin: Account): Promise<number> {
  if (!admin.platformAdmin) return 0;
  const [row] = await db().execute<Row>(sql`select count(*)::int as n from commerce.theme_submissions where status = 'waiting'`);
  return Number(row?.n ?? 0);
}
