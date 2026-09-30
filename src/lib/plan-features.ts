import { z } from "zod";

/**
 * The plan comparison (D132): the platform's list of features, in rows grouped by category, and which plan includes each.
 * It is what store owners see when they choose a plan and what the platform's admin edits at
 * `/admin/platform/plans/features`. It describes; it does not switch anything on or off.
 * Pure types and the form's parsing, shared by the page, the action and the tests.
 */

export const FEATURE_NAME_MAX = 80;
export const FEATURE_CATEGORY_MAX = 60;
export const FEATURE_DESCRIPTION_MAX = 300;
/** How many blank rows the editor offers for new features. */
export const NEW_FEATURE_ROWS = 3;

export type PlanFeature = {
  id: string;
  category: string;
  name: string;
  description: string;
  position: number;
  /** The ids of the plans that include it. */
  planIds: string[];
};

export type PlanColumn = { id: string; name: string; active: boolean };

export type FeatureMatrix = { plans: PlanColumn[]; features: PlanFeature[] };

/** The features grouped by category, in the order their first feature comes. */
export function featureGroups(features: PlanFeature[]): { category: string; features: PlanFeature[] }[] {
  const sorted = [...features].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const groups = new Map<string, PlanFeature[]>();
  for (const feature of sorted) {
    const list = groups.get(feature.category) ?? [];
    list.push(feature);
    groups.set(feature.category, list);
  }
  return [...groups].map(([category, list]) => ({ category, features: list }));
}

const text = (max: number, what: string) =>
  z.string().trim().min(1, `Give every feature ${what}.`).max(max, `Keep ${what} under ${max} characters.`);

const featureInput = z.object({
  category: text(FEATURE_CATEGORY_MAX, "a category"),
  name: text(FEATURE_NAME_MAX, "a name"),
  description: z.string().trim().max(FEATURE_DESCRIPTION_MAX, `Keep descriptions under ${FEATURE_DESCRIPTION_MAX} characters.`),
  position: z.number().int().min(0).max(100000),
});

export type FeatureEdit = z.infer<typeof featureInput> & { id: string; remove: boolean; planIds: string[] };
export type FeatureNew = z.infer<typeof featureInput> & { planIds: string[] };
export type MatrixInput = { edits: FeatureEdit[]; added: FeatureNew[] };

/** Reads the editor's form: `f:{id}:…` for a feature, `n:{i}:…` for a new one, and `g:{id}:{plan}` / `n:{i}:g:{plan}` ticks. */
export function parseMatrixForm(
  form: { get(name: string): unknown },
  known: { featureIds: string[]; planIds: string[] },
): { ok: true; input: MatrixInput } | { ok: false; problems: string[] } {
  const str = (key: string) => String(form.get(key) ?? "");
  const on = (key: string) => form.get(key) === "on";
  const problems: string[] = [];
  const edits: FeatureEdit[] = [];
  const added: FeatureNew[] = [];
  const read = (prefix: string, tick: (plan: string) => string) => {
    const parsed = featureInput.safeParse({
      category: str(`${prefix}:category`),
      name: str(`${prefix}:name`),
      description: str(`${prefix}:description`),
      position: Number.parseInt(str(`${prefix}:position`) || "0", 10) || 0,
    });
    const planIds = known.planIds.filter((plan) => on(tick(plan)));
    return { parsed, planIds };
  };

  for (const id of known.featureIds) {
    // A feature added since the page was drawn is not in the form: leave it alone.
    if (form.get(`f:${id}:name`) === null) continue;
    const remove = on(`f:${id}:remove`);
    const { parsed, planIds } = read(`f:${id}`, (plan) => `g:${id}:${plan}`);
    if (remove) {
      edits.push({ id, remove, category: "", name: "", description: "", position: 0, planIds: [] });
    } else if (parsed.success) {
      edits.push({ id, remove, ...parsed.data, planIds });
    } else {
      problems.push(...parsed.error.issues.map((issue) => issue.message));
    }
  }
  for (let i = 0; i < NEW_FEATURE_ROWS; i++) {
    // A new row nobody touched is left out; one with only some of its fields is a mistake worth saying.
    const prefix = `n:${i}`;
    if (!str(`${prefix}:name`).trim() && !str(`${prefix}:description`).trim()) continue;
    const { parsed, planIds } = read(prefix, (plan) => `n:${i}:g:${plan}`);
    if (parsed.success) added.push({ ...parsed.data, planIds });
    else problems.push(...parsed.error.issues.map((issue) => issue.message));
  }
  return problems.length > 0 ? { ok: false, problems: [...new Set(problems)] } : { ok: true, input: { edits, added } };
}
