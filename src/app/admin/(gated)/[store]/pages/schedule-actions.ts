"use server";

import { z } from "zod";

import type { ScheduleAnswer, ScheduleView } from "@/components/admin/page-context";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { blockingIssues, pageIssues, themeSetsOf } from "@/lib/page-a11y";
import { isScheduledType, scheduleInstant } from "@/lib/page-schedules";
import type { PageType } from "@/lib/page-content";
import { actionAdminLang } from "@/server/admin-request-lang";
import { cancelSchedule, scheduleOf, schedulePage } from "@/server/page-schedules";
import { getPageForEdit } from "@/server/pages";
import { checkPageTypeAccess } from "@/server/permissions";
import type { Membership } from "@/server/auth";

/**
 * A store's page or article published at a set time (wave 7 unit G, D341): read, set and cancelled from the editor's *Schedule*, by members
 * who may change that kind of page; the time is the store's own clock. A draft with problems the checker blocks on is not scheduled: it is
 * published from the editor, where the person decides on them.
 */

function viewOf(member: Membership, state: Awaited<ReturnType<typeof scheduleOf>>): ScheduleView {
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "blog").editor;
  const when = new Intl.DateTimeFormat(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "long", timeStyle: "short", timeZone: member.store.timeZone });
  return {
    waiting: state.waiting ? { at: state.waiting.at, label: fillWords(w.scheduledShort, { when: when.format(new Date(state.waiting.at)) }) } : null,
    failure: state.lastFailure ? fillWords(w.failed, { when: when.format(new Date(state.lastFailure.at)), problem: state.lastFailure.problem }) : null,
  };
}

const ok = (type: unknown, id: string) => isScheduledType(type) && z.uuid().safeParse(id).success;

export async function readScheduleAction(storeSlug: string, type: PageType, id: string): Promise<ScheduleView | null> {
  const member = await checkPageTypeAccess(storeSlug, type, "read");
  if (!member || !ok(type, id)) return null;
  return viewOf(member, await scheduleOf(member.store.id, id));
}

export async function scheduleAction(storeSlug: string, type: PageType, id: string, day: string, time: string): Promise<ScheduleAnswer> {
  const member = await checkPageTypeAccess(storeSlug, type, "write");
  if (!member) return { ok: false, problem: adminText(await actionAdminLang(), "blog").noChange };
  const w = adminText(adminLangOf(member.account.adminLocale), "blog").editor;
  const noun = type === "article" ? "article" : "page";
  if (!ok(type, id) || !isScheduledType(type)) return { ok: false, problem: w.problems.type };
  const at = scheduleInstant(String(day).slice(0, 10), String(time).slice(0, 5), member.store.timeZone, new Date());
  if (!at.ok) return { ok: false, problem: w.problems[at.problem] };
  const page = await getPageForEdit(member.store.id, id, type);
  if (!page) return { ok: false, problem: fillWords(w.problems.missing, { noun }) };
  // What Publish would ask about is not decided by a clock: the person publishes past it from the editor, or fixes it first.
  if (blockingIssues(pageIssues(page.draft, { theme: { sets: themeSetsOf(member.store.theme.settings) } })).length > 0) {
    return { ok: false, problem: w.problems.blocking };
  }
  const result = await schedulePage(member.account, member.store.id, id, type, at.at);
  if (!result.ok) return { ok: false, problem: fillWords(w.problems[result.problem], { noun }) };
  const view = viewOf(member, await scheduleOf(member.store.id, id));
  const lang = adminLangOf(member.account.adminLocale);
  const when = new Intl.DateTimeFormat(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "long", timeStyle: "short", timeZone: member.store.timeZone });
  return { ok: true, view, message: fillWords(w.scheduled, { when: when.format(at.at) }) };
}

export async function cancelScheduleAction(storeSlug: string, type: PageType, id: string): Promise<ScheduleAnswer> {
  const member = await checkPageTypeAccess(storeSlug, type, "write");
  if (!member) return { ok: false, problem: adminText(await actionAdminLang(), "blog").noChange };
  const w = adminText(adminLangOf(member.account.adminLocale), "blog").editor;
  if (!ok(type, id) || !isScheduledType(type)) return { ok: false, problem: w.problems.type };
  await cancelSchedule(member.account, member.store.id, id, type);
  return { ok: true, view: viewOf(member, await scheduleOf(member.store.id, id)), message: w.cancelled };
}
