"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import type { StoreTheme } from "@/lib/theme";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkPermission } from "@/server/permissions";
import { saveInstallLook } from "@/server/theme-installs";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { revertInstant, scheduleInstant } from "@/lib/page-schedules";
import { previewDays, previewPath, type PreviewLinkAnswer, type PreviewLinkItem } from "@/lib/preview-links";
import { listPreviewLinks, makePreviewLink, revokePreviewLink } from "@/server/preview-links";
import { cancelThemeSchedule, scheduleTheme } from "@/server/theme-schedules";

/**
 * An installed theme made live at a set time, and the theme live then put back at another (wave 7 unit F, D340), from the theme's page by
 * those who may change the look. The time is the store's own clock.
 */
export async function scheduleThemeAction(storeSlug: string, installId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { status: "error", messages: [await noAccess()] };
  const lang = adminLangOf(member.account.adminLocale);
  const all = adminText(lang, "schedules");
  const zone = member.store.timeZone;
  const at = scheduleInstant(String(formData.get("day") ?? "").slice(0, 10), String(formData.get("time") ?? "").slice(0, 5), zone, new Date());
  if (!at.ok) return { status: "error", messages: [all.dialog.problems[at.problem]] };
  let revertAt: Date | null = null;
  if (formData.get("back") === "on") {
    const r = revertInstant(String(formData.get("backDay") ?? "").slice(0, 10), String(formData.get("backTime") ?? "").slice(0, 5), zone, at.at);
    if (!r.ok) return { status: "error", messages: [all.dialog.problems[r.problem]] };
    revertAt = r.at;
  }
  const result = await scheduleTheme(member.account, member.store.id, String(installId), at.at, revertAt);
  if (!result.ok) return { status: "error", messages: [all.theme.problems[result.problem]] };
  refresh();
  const when = new Intl.DateTimeFormat(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "long", timeStyle: "short", timeZone: zone });
  const said = fillWords(all.theme.scheduled, { when: when.format(at.at) });
  return { status: "ok", messages: [revertAt ? `${said} ${fillWords(all.theme.goesBack, { when: when.format(revertAt) })}` : said] };
}

/** Takes the store's planned theme change and its way back away (D340). */
export async function cancelThemeScheduleAction(storeSlug: string): Promise<FormState> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { status: "error", messages: [await noAccess()] };
  await cancelThemeSchedule(member.account, member.store.id);
  refresh();
  return { status: "ok", messages: [adminText(adminLangOf(member.account.adminLocale), "schedules").theme.cancelled] };
}

/** An installed theme's preview links (D340): listed, made and revoked by those who may change the look. */
export async function listInstallLinksAction(storeSlug: string, installId: string): Promise<PreviewLinkItem[]> {
  const member = await checkPermission(storeSlug, "website:write");
  return member ? listPreviewLinks(member.store.id, { install: String(installId) }) : [];
}

export async function makeInstallLinkAction(storeSlug: string, installId: string, days: number): Promise<PreviewLinkAnswer> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problem: await noAccess() };
  const all = adminText(adminLangOf(member.account.adminLocale), "schedules");
  const made = await makePreviewLink(member.account, member.store.id, { install: String(installId) }, previewDays(days));
  if (!made.ok) return { ok: false, problem: fillWords(made.problem === "too_many" ? all.share.tooMany : all.theme.problems.missing, { noun: all.nouns.theme }) };
  return { ok: true, url: previewPath(made.token), links: await listPreviewLinks(member.store.id, { install: String(installId) }), message: all.share.made };
}

export async function revokeInstallLinkAction(storeSlug: string, installId: string, link: string): Promise<PreviewLinkAnswer> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problem: await noAccess() };
  const all = adminText(adminLangOf(member.account.adminLocale), "schedules");
  await revokePreviewLink(member.account, member.store.id, { install: String(installId) }, String(link));
  return { ok: true, url: null, links: await listPreviewLinks(member.store.id, { install: String(installId) }), message: all.share.revokedMessage };
}

/** The refusal for a person without access, in their language (D312 A7). */
const noAccess = async () => adminText(await actionAdminLang(), "design").actions.noAccess;

const read = (payload: string): unknown => {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
};

/**
 * Keeps theme settings in an installed theme that is not live (D244). Nothing visitors see changes, so no store tag is refreshed; the page
 * itself is refreshed so its preview link and What changes read the new settings.
 */
export async function saveInstallThemeAction(storeSlug: string, installId: string, payload: string): Promise<{ ok: true; theme: StoreTheme } | { ok: false; problems: string[] }> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problems: [await noAccess()] };
  const result = await saveInstallLook(member.store.id, String(installId), member.account.id, { theme: read(payload) });
  if (!result.ok) return result;
  refresh();
  return { ok: true, theme: result.theme as StoreTheme };
}

/** Keeps its own CSS in an installed theme that is not live (D244). */
export async function saveInstallCssAction(storeSlug: string, installId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { status: "error", messages: [await noAccess()] };
  const result = await saveInstallLook(member.store.id, String(installId), member.account.id, { css: String(formData.get("css") ?? "") });
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [adminText(adminLangOf(member.account.adminLocale), "design").install.cssSaved] };
}
