import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { FeatureMatrix, MatrixInput } from "@/lib/plan-features";

import { audit, type Account } from "./auth";

type Row = Record<string, unknown>;

/** Every feature with the plans that include it, and the plans as columns (active ones first, in their order). */
export async function getFeatureMatrix(): Promise<FeatureMatrix> {
  const [plans, features, grants] = await Promise.all([
    db().execute<Row>(sql`select id, name, active from commerce.plans order by active desc, position, lower(name)`),
    db().execute<Row>(sql`
      select id, category, name, description, position from commerce.plan_features order by position, lower(name)
    `),
    db().execute<Row>(sql`select feature_id, plan_id from commerce.plan_feature_grants`),
  ]);
  const byFeature = new Map<string, string[]>();
  for (const grant of grants) {
    const list = byFeature.get(String(grant.feature_id)) ?? [];
    list.push(String(grant.plan_id));
    byFeature.set(String(grant.feature_id), list);
  }
  return {
    plans: plans.map((p) => ({ id: String(p.id), name: String(p.name), active: Boolean(p.active) })),
    features: features.map((f) => ({
      id: String(f.id),
      category: String(f.category),
      name: String(f.name),
      description: String(f.description),
      position: Number(f.position),
      planIds: byFeature.get(String(f.id)) ?? [],
    })),
  };
}

/**
 * Saves the whole matrix in one transaction: edited features, removed ones, new ones, and the ticks of every plan
 * shown (a plan that is not shown keeps what it had). Plans are the platform's: only ids that exist are kept.
 */
export async function saveFeatureMatrix(actor: Account, input: MatrixInput, shownPlanIds: string[]): Promise<void> {
  await db().transaction(async (tx) => {
    const plans = new Set(shownPlanIds);
    for (const edit of input.edits) {
      if (edit.remove) {
        await tx.execute(sql`delete from commerce.plan_features where id = ${edit.id}::uuid`);
        continue;
      }
      await tx.execute(sql`
        update commerce.plan_features set category = ${edit.category}, name = ${edit.name},
          description = ${edit.description}, position = ${edit.position}, updated_at = now(), updated_by = ${actor.id}::uuid
        where id = ${edit.id}::uuid
      `);
      await setGrants(tx, edit.id, edit.planIds, plans);
    }
    for (const feature of input.added) {
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.plan_features (category, name, description, position, updated_by)
        values (${feature.category}, ${feature.name}, ${feature.description}, ${feature.position}, ${actor.id}::uuid)
        returning id
      `);
      await setGrants(tx, String(row.id), feature.planIds, plans);
    }
  });
  await audit(actor.id, null, "platform.plan_features_saved", {
    edited: input.edits.filter((e) => !e.remove).length,
    removed: input.edits.filter((e) => e.remove).length,
    added: input.added.length,
  });
}

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

async function setGrants(tx: Tx, featureId: string, planIds: string[], shown: Set<string>) {
  for (const planId of shown) {
    if (planIds.includes(planId)) {
      await tx.execute(sql`
        insert into commerce.plan_feature_grants (feature_id, plan_id) values (${featureId}::uuid, ${planId}::uuid)
        on conflict do nothing
      `);
    } else {
      await tx.execute(sql`
        delete from commerce.plan_feature_grants where feature_id = ${featureId}::uuid and plan_id = ${planId}::uuid
      `);
    }
  }
}
