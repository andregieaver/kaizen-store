"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { RETENTION_BASES, type RetentionBasis, type RetentionKind } from "@/lib/retention";
import { requirePlatformAdmin } from "@/server/auth";
import { changeRetentionRule, verifyRetentionRule } from "@/server/retention";

/**
 * The platform admin's changes to the retention schedule (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.5). Each asks for a platform admin
 * first. A period is never edited in place: `commerce.set_retention_rule()` closes the old row and starts a new one and writes the audit entry
 * (`retention.rule_set`); a review is `commerce.verify_retention_rule()` (once, `retention.rule_verified`).
 */

const text = (form: FormData, name: string): string => String(form.get(name) ?? "").trim();

/** Starts a new period for a kind of data. */
export async function changeRetentionRuleAction(_previous: FormState, form: FormData): Promise<FormState> {
  const account = await requirePlatformAdmin();
  const country = text(form, "country").toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) return { status: "error", messages: ["A country is two letters, such as NO."] };
  const value = Number(text(form, "periodValue"));
  if (!Number.isInteger(value)) return { status: "error", messages: ["The period is a whole number."] };
  const basis = text(form, "basis");
  if (!(RETENTION_BASES as readonly string[]).includes(basis)) return { status: "error", messages: ["Say how much of the source was read."] };
  const unit = text(form, "periodUnit");
  const countsFrom = text(form, "countsFrom");
  if (unit !== "days" && unit !== "months") return { status: "error", messages: ["Choose days or months."] };
  if (countsFrom !== "event" && countsFrom !== "end_of_year") return { status: "error", messages: ["Choose what the period is counted from."] };
  const sourceUrl = text(form, "sourceUrl");
  if (sourceUrl && !z.url({ protocol: /^https?$/ }).safeParse(sourceUrl).success) return { status: "error", messages: ["The source address must start with https://."] };
  const result = await changeRetentionRule(account.id, {
    kind: text(form, "kind") as RetentionKind,
    country: country || null,
    periodValue: value,
    periodUnit: unit,
    countsFrom,
    source: text(form, "source"),
    sourceUrl: sourceUrl || null,
    basis: basis as RetentionBasis,
    checkedOn: text(form, "checkedOn"),
    validFrom: text(form, "validFrom"),
    note: text(form, "note"),
  });
  if (!result.ok) return { status: "error", messages: [result.problem] };
  refresh();
  return { status: "ok", messages: ["The new period is saved. It starts unreviewed."] };
}

/** Marks a period as reviewed by a person. */
export async function verifyRetentionRuleAction(ruleId: string): Promise<FormState> {
  const account = await requirePlatformAdmin();
  if (!z.uuid().safeParse(ruleId).success) return { status: "error", messages: ["That period no longer exists."] };
  const result = await verifyRetentionRule(account.id, ruleId);
  if (!result.ok) return { status: "error", messages: [result.problem] };
  refresh();
  return { status: "ok", messages: ["Marked as reviewed."] };
}
