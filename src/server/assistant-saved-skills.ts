import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { CLAIM_LABELS } from "@/lib/claims";
import { SKILLS_PER_PLACE, cleanSkill, skillKey, skillProblem, stepsOf, type SkillInput, type SkillProblem } from "@/lib/saved-skills";

import { audit } from "./auth";
import { col, typedRows } from "./typed-rows";

/**
 * Skills a person saves for the AI manager (wave 8 unit F, D350): written here and nowhere else. A skill is the person's own in a place (a
 * store, or Kaizena Flow's own site with a null store); an owner may share one with the store, so whoever uses the AI manager there can load
 * it too, with their own permissions (a skill names tools, it never grants one: `use_skill` hands over words and the turn offers only the
 * tools the person may use, gated ones still waiting for a yes). Nothing is kept with a customer's details, a secret or a marketing claim.
 */

export type SavedSkill = {
  id: string;
  key: string;
  title: string;
  when: string;
  steps: string;
  shared: boolean;
  /** Whether it is the person's own; a skill shared by someone else is read only. */
  mine: boolean;
  /** Who made it, for a skill shared by someone else. */
  by: string | null;
  updatedAt: string;
};

/** Who saves or reads: the person, the place, and whether they own the store (only an owner shares with it). */
export type SkillPerson = { accountId: string; storeId: string | null; owner: boolean };

const ROW = z.object({
  id: col.uuid,
  key: col.text,
  title: col.text,
  when_to_use: col.text,
  steps: col.text,
  shared: col.bool,
  mine: col.bool,
  by: col.textOrNull,
  updated_at: col.timestamp,
});

const placeIs = (storeId: string | null) => (storeId ? sql`k.store_id = ${storeId}::uuid` : sql`k.store_id is null`);

/** The person's own skills in the place, then those shared with the store by others; by title. */
export async function listSkills(person: Pick<SkillPerson, "accountId" | "storeId">): Promise<SavedSkill[]> {
  const rows = await typedRows(
    ROW,
    sql`
      select k.id, k.key, k.title, k.when_to_use, k.steps, k.shared, k.account_id = ${person.accountId}::uuid as mine,
        case when k.account_id = ${person.accountId}::uuid then null else coalesce(nullif(a.name, ''), 'A colleague') end as by, k.updated_at
      from commerce.assistant_skills k left join commerce.accounts a on a.id = k.account_id
      where ${placeIs(person.storeId)} and (k.account_id = ${person.accountId}::uuid or (k.shared and ${person.storeId}::uuid is not null))
      order by (k.account_id = ${person.accountId}::uuid) desc, lower(k.title), k.id
      limit 100
    `,
  );
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    title: row.title,
    when: row.when_to_use,
    steps: row.steps,
    shared: row.shared,
    mine: row.mine,
    by: row.by,
    updatedAt: row.updated_at,
  }));
}

/** One skill the person may load, by its key: their own first, else one shared with the store. */
export async function findSkill(person: Pick<SkillPerson, "accountId" | "storeId">, key: string): Promise<SavedSkill | null> {
  return (await listSkills(person)).find((skill) => skill.key === key) ?? null;
}

/** The lines the AI manager's prompt lists, as the built-in ones (`skillsText()`): `key: when to use it`. */
export async function savedSkillsText(person: Pick<SkillPerson, "accountId" | "storeId">): Promise<string> {
  const skills = await listSkills(person).catch(() => []);
  return skills.map((skill) => `${skill.key}: ${skill.when || skill.title}${skill.mine ? "" : " (shared)"}`).join("\n");
}

export type SaveSkillResult = { ok: true; skill: SavedSkill } | { ok: false; problem: string; code: SkillProblem | "share" | "full" | "gone" };

const PROBLEM_WORDS: Record<SkillProblem, string> = {
  title: "Give the skill a name of at most 120 characters.",
  when: "Say when to use it in at most 300 characters.",
  steps: "Write its steps, at most 2,000 characters.",
  builtIn: "That name is one of the built-in playbooks'. Choose another.",
  private: "A skill never holds an email address, a long number or a password: the AI manager reads those from the store when it needs them.",
  claim: "A skill never carries a marketing claim",
};

/**
 * Keeps a skill: a new one, or the person's own with that key (or `id`) changed. Sharing is an owner's, and only in a store. Audited in the
 * store's log by its key, never its words.
 */
export async function saveSkill(person: SkillPerson, raw: SkillInput & { id?: string; share?: boolean }): Promise<SaveSkillResult> {
  const input = cleanSkill(raw);
  const existing = raw.id ? (await listSkills(person)).find((skill) => skill.id === raw.id && skill.mine) : null;
  if (raw.id && !existing) return { ok: false, problem: "That skill is not one of yours here.", code: "gone" };
  const key = existing?.key ?? skillKey(input.title);
  const problem = skillProblem(input, key);
  if (problem) {
    const words = PROBLEM_WORDS[problem.problem];
    return {
      ok: false,
      problem: problem.problem === "claim" && problem.kind ? `${words} (${CLAIM_LABELS[problem.kind]}: "${problem.phrase}").` : words,
      code: problem.problem,
    };
  }
  const share = raw.share ?? existing?.shared ?? false;
  if (share && (!person.storeId || !person.owner)) return { ok: false, problem: "Only the store's owner shares a skill with the store.", code: "share" };
  if (!existing) {
    const [count] = await typedRows(
      z.object({ n: col.int }),
      sql`select count(*)::int as n from commerce.assistant_skills k where k.account_id = ${person.accountId}::uuid and ${placeIs(person.storeId)}`,
    );
    if ((count?.n ?? 0) >= SKILLS_PER_PLACE) return { ok: false, problem: `You have ${SKILLS_PER_PLACE} skills here: delete one first.`, code: "full" };
  }
  await db().execute(sql`
    insert into commerce.assistant_skills (account_id, store_id, key, title, when_to_use, steps, shared)
    values (${person.accountId}::uuid, ${person.storeId}::uuid, ${key}, ${input.title}, ${input.when}, ${input.steps}, ${share})
    on conflict on constraint assistant_skills_key do update
      set title = excluded.title, when_to_use = excluded.when_to_use, steps = excluded.steps, shared = excluded.shared, updated_at = now()
  `);
  if (person.storeId) {
    await audit(person.accountId, person.storeId, existing ? "ai.skill_changed" : "ai.skill_saved", { skill: key, shared: share });
  }
  const saved = await findSkill(person, key);
  return saved ? { ok: true, skill: saved } : { ok: false, problem: "The skill could not be kept.", code: "gone" };
}

/** Deletes one of the person's own skills, by key or id; an owner may also take a colleague's shared skill off the store. */
export async function deleteSkill(person: SkillPerson, which: { key?: string; id?: string }): Promise<boolean> {
  const match = which.id ? sql`k.id = ${which.id}::uuid` : sql`k.key = ${which.key ?? ""}`;
  const mayDelete = person.owner && person.storeId ? sql`(k.account_id = ${person.accountId}::uuid or k.shared)` : sql`k.account_id = ${person.accountId}::uuid`;
  const rows = await db().execute<{ key: string }>(sql`
    delete from commerce.assistant_skills k
    where ${placeIs(person.storeId)} and ${match} and ${mayDelete}
    returning k.key
  `);
  if (rows.length > 0 && person.storeId) {
    await audit(person.accountId, person.storeId, "ai.skill_deleted", { skill: String(rows[0].key) });
  }
  return rows.length > 0;
}

/** A saved skill as `use_skill` hands it over, like a built-in one. */
export const skillForUse = (skill: SavedSkill) => ({ skill: skill.key, title: skill.title, steps: stepsOf(skill.steps), saved: true, shared: !skill.mine });
