/**
 * Skills a person saves for the AI manager (wave 8 unit F, D350), beside the built-in playbooks (`ASSISTANT_SKILLS`). Pure, so the editor
 * shows the same limits and refusals the server keeps.
 */

import { ASSISTANT_SKILLS } from "./assistant-skills";
import { findClaims, type ClaimKind } from "./claims";
import { slugify } from "./slug";

export const SKILL_TITLE_MAX = 120;
export const SKILL_WHEN_MAX = 300;
export const SKILL_STEPS_MAX = 2000;
/** At most this many of a person's own skills in one place, so the prompt that lists them stays short. */
export const SKILLS_PER_PLACE = 30;

/**
 * Never kept in a skill (as `readLearned()` never keeps them in memory): an email address, a long number (a card, an account) or a password.
 * A customer's details belong to the store's records, which the tools read, never to a playbook.
 */
export const PERSONAL_OR_SECRET = /@|\b\d{12,}\b|password|passord|passwort|lösenord|adgangskode/i;

/**
 * Marketing claims a skill may not carry (D76's filter, the kinds a playbook would pass on into customers' words: green claims, urgency,
 * best price). Prices and stock are what a store's work is about, so a step may name them.
 */
const REFUSED_CLAIMS: readonly ClaimKind[] = ["green", "urgency", "bestPrice"];

export type SkillInput = { title: string; when: string; steps: string };

/** A skill as the editor sends it (an `id` to change one, `share` for an owner). */
export type SkillDraft = SkillInput & { id?: string; share?: boolean };
/** The place's save and delete, bound on the server. */
export type SaveSkill = (input: SkillDraft) => Promise<{ ok: true } | { ok: false; problem: string }>;
export type RemoveSkill = (id: string) => Promise<boolean>;

/** A saved skill's key, from its title: `weekly-stock-check`. */
export function skillKey(title: string): string {
  return slugify(title, 60).replace(/^-+|-+$/g, "") || "skill";
}

/** Whether a key is a built-in playbook's, which a saved skill never takes. */
export const isBuiltInKey = (key: string) => ASSISTANT_SKILLS.some((skill) => skill.id === key);

/** The words cleaned as they are kept: one line for the title and when, the steps' lines trimmed and empty ones dropped. */
export function cleanSkill(input: SkillInput): SkillInput {
  return {
    title: input.title.replace(/\s+/g, " ").trim(),
    when: input.when.replace(/\s+/g, " ").trim(),
    steps: input.steps
      .split(/\r?\n/)
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .filter(Boolean)
      .join("\n"),
  };
}

export type SkillProblem = "title" | "when" | "steps" | "builtIn" | "private" | "claim";

/** Why a skill cannot be kept, or null. Run on the cleaned words. */
export function skillProblem(input: SkillInput, key: string): { problem: SkillProblem; phrase?: string; kind?: ClaimKind } | null {
  if (!input.title || input.title.length > SKILL_TITLE_MAX) return { problem: "title" };
  if (input.when.length > SKILL_WHEN_MAX) return { problem: "when" };
  if (!input.steps || input.steps.length > SKILL_STEPS_MAX) return { problem: "steps" };
  if (isBuiltInKey(key)) return { problem: "builtIn" };
  const all = `${input.title}\n${input.when}\n${input.steps}`;
  if (PERSONAL_OR_SECRET.test(all)) return { problem: "private" };
  const claim = findClaims(all).find((found) => REFUSED_CLAIMS.includes(found.kind));
  if (claim) return { problem: "claim", phrase: claim.phrase, kind: claim.kind };
  return null;
}

/** A skill's steps as `use_skill` hands them over, one a line. */
export const stepsOf = (steps: string): string[] => steps.split("\n").filter(Boolean);
