"use server";

import { z } from "zod";

import { adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import type { PageType } from "@/lib/page-content";
import { previewDays, previewPath, type PreviewLinkAnswer, type PreviewLinkItem } from "@/lib/preview-links";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkPageTypeAccess } from "@/server/permissions";
import { listPreviewLinks, makePreviewLink, revokePreviewLink } from "@/server/preview-links";

/**
 * Links that open a page's or article's draft without signing in (wave 7 unit F, D340): listed, made and revoked from the builder's *Share*
 * by members who may change that kind of page. A new link's address is in the answer this once and never again.
 */

const shareable = (type: PageType): type is "page" | "article" => type === "page" || type === "article";
const isId = (id: string) => z.uuid().safeParse(id).success;

export async function listPageLinksAction(storeSlug: string, type: PageType, id: string): Promise<PreviewLinkItem[]> {
  const member = await checkPageTypeAccess(storeSlug, type, "write");
  if (!member || !shareable(type) || !isId(id)) return [];
  return listPreviewLinks(member.store.id, { page: id, type });
}

export async function makePageLinkAction(storeSlug: string, type: PageType, id: string, days: number): Promise<PreviewLinkAnswer> {
  const member = await checkPageTypeAccess(storeSlug, type, "write");
  if (!member) return { ok: false, problem: adminText(await actionAdminLang(), "schedules").noChange };
  const all = adminText(adminLangOf(member.account.adminLocale), "schedules");
  if (!shareable(type) || !isId(id)) return { ok: false, problem: fillWords(all.share.missing, { noun: all.nouns.page }) };
  const noun = all.nouns[type];
  const made = await makePreviewLink(member.account, member.store.id, { page: id, type }, previewDays(days));
  if (!made.ok) return { ok: false, problem: fillWords(made.problem === "too_many" ? all.share.tooMany : all.share.missing, { noun }) };
  return { ok: true, url: previewPath(made.token), links: await listPreviewLinks(member.store.id, { page: id, type }), message: all.share.made };
}

export async function revokePageLinkAction(storeSlug: string, type: PageType, id: string, link: string): Promise<PreviewLinkAnswer> {
  const member = await checkPageTypeAccess(storeSlug, type, "write");
  if (!member) return { ok: false, problem: adminText(await actionAdminLang(), "schedules").noChange };
  const all = adminText(adminLangOf(member.account.adminLocale), "schedules");
  if (!shareable(type) || !isId(id)) return { ok: false, problem: all.noChange };
  await revokePreviewLink(member.account, member.store.id, { page: id, type }, String(link));
  return { ok: true, url: null, links: await listPreviewLinks(member.store.id, { page: id, type }), message: all.share.revokedMessage };
}
