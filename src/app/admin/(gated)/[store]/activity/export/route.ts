import { NextResponse, type NextRequest } from "next/server";

import { activityQuery } from "@/lib/activity-text";
import { isAuditArea } from "@/lib/audit";
import { exportActivity } from "@/server/activity";
import { checkOwnerRole } from "@/server/permissions";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { fillWords } from "@/lib/admin-fill";
import type { StaffMessages } from "@/lib/admin-messages/staff.en";

/** The server's English refusal in the owner's words (D312 A8), as written when it is none of the known ones. */
function problemIn(problem: string, w: StaffMessages["activity"]["problems"], locale: string): string {
  if (problem === "Only an owner can download the activity log.") return w.owner;
  if (problem === "Choose the first and last day to download.") return w.days;
  if (problem === "The first day must not be after the last day.") return w.order;
  const many = /^That period has ([\d,]+) entries and a download holds at most ([\d,]+)\. Choose a shorter period\.$/.exec(problem);
  const number = (text: string) => Number(text.replace(/,/g, "")).toLocaleString(locale);
  return many ? fillWords(w.tooMany, { total: number(many[1]), max: number(many[2]) }) : problem;
}

/**
 * The activity log as a CSV (wave 1, 1f, docs/wave-1-trust.md 2.9): owners only, the period required, at most 50,000 entries. A refusal goes
 * back to the log with the reason; someone who is not an owner of the store gets a 404, as for any page they cannot open. The download is
 * itself an entry in the log (`exportActivity()` writes it). Never cached.
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/admin/[store]/activity/export">) {
  const { store: slug } = await params;
  const member = await checkOwnerRole(slug);
  if (!member) return new NextResponse("Not found", { status: 404 });

  const search = request.nextUrl.searchParams;
  const text = (name: string) => search.get(name) ?? "";
  const area = text("area");
  const result = await exportActivity(member, {
    accountId: text("person") || null,
    area: isAuditArea(area) ? area : null,
    action: text("action") || null,
    from: text("from") || null,
    to: text("to") || null,
  });
  if (!result.ok) {
    const back = new URL(`/admin/${slug}/activity${activityQuery({ person: text("person"), area, action: text("action"), from: text("from"), to: text("to") })}`, request.url);
    const lang = adminLangOf(member.account.adminLocale);
    back.searchParams.set("problem", problemIn(result.problem, adminText(lang, "staff").activity.problems, ADMIN_LANG_FACTS[lang].locale));
    return NextResponse.redirect(back, 303);
  }
  const name = `activity-${slug}-${text("from")}-${text("to")}.csv`.replace(/[^A-Za-z0-9._-]/g, "_");
  return new NextResponse(`﻿${result.csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
