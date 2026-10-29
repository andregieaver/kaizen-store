import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { localInstant } from "@/lib/follow-ups";
import type { OwnerToolInput } from "@/lib/owner-tools";
import { blockingIssues, pageIssues, themeSetsOf } from "@/lib/page-a11y";
import { revertInstant, scheduleInstant, SCHEDULED_TYPES, wallClock, type ScheduledType } from "@/lib/page-schedules";

import type { Account } from "./auth";
import { runningTestOf } from "./experiment-admin";
import { OwnerToolError } from "./owner-tool-error";
import { cancelSchedule, scheduleOf, schedulePage, scheduleStates } from "./page-schedules";
import { getPageForEdit } from "./pages";
import type { Store } from "./stores";
import { listInstalls } from "./theme-installs";
import { cancelThemeSchedule, scheduleTheme, themeScheduleOf, themeScheduleProblem } from "./theme-schedules";
import { col, typedRows } from "./typed-rows";

/**
 * The AI manager's changes by the clock (wave 7 unit F, D340, `docs/wave-7-storefront.md` F): `list_scheduled_changes` reads what the lists
 * and the theme's page show; `schedule_site_change` (gate `public`) goes through the same writers as the editor's Schedule and the theme's
 * *Make it live later*, and is refused before a yes by what they refuse. Times are the store's wall clock (`localInstant()`). Preview links
 * have no tool: a link's token opens unpublished work, so it is made by a person's press and shown to them, never put in a model's answer.
 */

type Ctx = { account: Account; store: Store; invalidate?: (tag: string) => void };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const clock = (store: Store, iso: string | null) => {
  if (!iso) return null;
  const w = wallClock(iso, store.timeZone);
  return `${w.day} ${w.time}`;
};

const ADMIN_PATH: Record<ScheduledType, string> = { page: "pages", article: "articles", header: "headers", footer: "footers" };

export async function listScheduledChangesTool({ store }: Ctx) {
  const pages = [];
  for (const type of SCHEDULED_TYPES) {
    const states = await scheduleStates(store.id, type);
    if (states.size === 0) continue;
    const titles = await typedRows(
      z.object({ id: col.uuid, title: col.textOrNull, slug: col.text }),
      sql`select id, draft ->> 'title' as title, slug from commerce.pages where store_id = ${store.id}::uuid and id = any(${`{${[...states.keys()].join(",")}}`}::uuid[])`,
    );
    for (const [id, state] of states) {
      const page = titles.find((t) => t.id === id);
      pages.push({
        kind: type,
        id,
        title: page?.title || page?.slug || id,
        publishes_at: clock(store, state.waiting?.at ?? null),
        goes_back_at: clock(store, state.waiting?.revertAt ?? state.reverting?.at ?? null),
        did_not_happen: state.lastFailure ? { what: state.lastFailure.leg === "publish" ? "publish" : "put back", at: clock(store, state.lastFailure.at), why: state.lastFailure.problem } : null,
        editor: `/admin/${store.slug}/${ADMIN_PATH[type]}/${id}`,
      });
    }
  }
  const [plan, installs] = await Promise.all([themeScheduleOf(store.id), listInstalls(store.id)]);
  const titleOf = (id: string | null) => installs.find((i) => i.id === id)?.title ?? null;
  const theme = plan.waiting
    ? { theme: titleOf(plan.waiting.installId), install: plan.waiting.installId, goes_live_at: clock(store, plan.waiting.at), goes_back_at: clock(store, plan.waiting.revertAt) }
    : plan.reverting
      ? { theme: titleOf(plan.reverting.beforeInstallId), install: plan.reverting.beforeInstallId, comes_back_at: clock(store, plan.reverting.at) }
      : plan.lastFailure
        ? { did_not_happen: { what: plan.lastFailure.leg === "publish" ? "go live" : "put back", at: clock(store, plan.lastFailure.at), why: plan.lastFailure.problem } }
        : null;
  return { time_zone: store.timeZone, pages, theme, design: `/admin/${store.slug}/settings/design` };
}

type Checked = { kind: "theme"; id: string; at: Date | null; back: Date | null } | { kind: ScheduledType; id: string; at: Date | null; back: Date | null };

/** A store's own page of a kind, by its id or address. */
async function findPage(store: Store, kind: ScheduledType, ref: string): Promise<string> {
  const rows = await typedRows(
    z.object({ id: col.uuid }),
    sql`
      select id from commerce.pages where store_id = ${store.id}::uuid and type = ${kind}
        and (id::text = ${ref} or slug = ${ref.replace(/^\/?(blog\/|blogs\/[a-z0-9-]+\/)?/, "").replace(/^\//, "")})
      limit 1
    `,
  );
  return rows[0]?.id ?? fail(`No ${kind} "${ref}" in this store. Use list_pages to find it.`);
}

/** The time a tool gives, as the editor would take it. */
function timeOf(store: Store, at: string): Date {
  if (localInstant(at, store.timeZone) === null) return fail("Give the time as YYYY-MM-DD HH:MM on the store's clock.");
  const [day, time] = at.trim().split(/[ T]/);
  const checked = scheduleInstant(day, time ?? "", store.timeZone, new Date());
  if (!checked.ok) return fail(checked.problem === "too_soon" ? "Choose a time a few minutes from now or later." : checked.problem === "too_late" ? "Choose a time within a year." : "Give the time as YYYY-MM-DD HH:MM.");
  return checked.at;
}

/** The schedule an input asks for, checked as the editor's Schedule and the theme's page do. */
async function checkedSiteSchedule(store: Store, input: OwnerToolInput<"schedule_site_change">): Promise<Checked> {
  const kind = input.kind;
  let id: string;
  if (kind === "theme") {
    const installs = await listInstalls(store.id);
    const ref = input.target.trim().toLowerCase();
    id = (installs.find((i) => i.id === input.target.trim()) ?? installs.find((i) => i.title.toLowerCase() === ref))?.id ?? fail(`No installed theme "${input.target}". Use list_themes to find it.`);
  } else {
    id = await findPage(store, kind, input.target.trim());
  }
  if (input.at === null) return { kind, id, at: null, back: null };
  const at = timeOf(store, input.at);
  let back: Date | null = null;
  if (input.back_at) {
    if (localInstant(input.back_at, store.timeZone) === null) fail("Give the time to put it back as YYYY-MM-DD HH:MM on the store's clock.");
    const [day, time] = input.back_at.trim().split(/[ T]/);
    const r = revertInstant(day, time ?? "", store.timeZone, at);
    if (!r.ok) fail(r.problem === "revert_too_soon" ? "Put it back at least 10 minutes after it goes live." : r.problem === "revert_too_late" ? "Put it back within a year of it going live." : "Give the time to put it back as YYYY-MM-DD HH:MM.");
    back = r.ok ? r.at : null;
  }
  if (kind === "theme") {
    const problem = await themeScheduleProblem(store.id, id);
    if (problem === "costs") fail("This theme costs money the store has not agreed to pay: the owner makes it live by hand once, on Design settings, to agree to its price.");
    if (problem === "live") fail("That theme is live already.");
    if (problem === "ab_test") fail("A running A/B test holds the store's header or footer: stop the test first.");
    if (problem) fail("That theme cannot be scheduled now.");
    return { kind, id, at, back };
  }
  const page = await getPageForEdit(store.id, id, kind);
  if (!page) return fail(`That ${kind} is gone.`);
  if (await runningTestOf(store.id, id)) fail(`This ${kind} is in a running A/B test: stop the test first.`);
  const blocking = blockingIssues(pageIssues(page.draft, { theme: { sets: themeSetsOf(store.theme.settings) }, siteCss: store.customCss }));
  if (blocking.length > 0) {
    fail(`The ${kind} has ${blocking.length === 1 ? "a problem" : `${blocking.length} problems`} to fix before it is published: ${blocking.slice(0, 6).map((i) => `${i.where}: ${i.message}`).join(" ")} Fix them first.`);
  }
  return { kind, id, at, back };
}

export async function preflightSiteScheduleTool({ store }: Ctx, raw: Record<string, unknown>): Promise<void> {
  await checkedSiteSchedule(store, raw as OwnerToolInput<"schedule_site_change">);
}

export async function scheduleSiteChangeTool(ctx: Ctx, input: OwnerToolInput<"schedule_site_change">) {
  const { store } = ctx;
  const checked = await checkedSiteSchedule(store, input);
  if (checked.kind === "theme") {
    if (checked.at === null) {
      const cancelled = await cancelThemeSchedule(ctx.account, store.id);
      return { done: cancelled ? "The theme's schedule is cancelled; the live theme stays live." : "No theme change was scheduled.", design: `/admin/${store.slug}/settings/design` };
    }
    const result = await scheduleTheme(ctx.account, store.id, checked.id, checked.at, checked.back);
    if (!result.ok) return fail("The theme could not be scheduled: look at it on Design settings.");
    return {
      done: "The theme is scheduled: it goes live at that time (within five minutes after it), and not before.",
      goes_live_at: clock(store, checked.at.toISOString()),
      goes_back_at: clock(store, checked.back?.toISOString() ?? null),
      page: `/admin/${store.slug}/settings/design/themes/${checked.id}`,
    };
  }
  const editor = `/admin/${store.slug}/${ADMIN_PATH[checked.kind]}/${checked.id}`;
  if (checked.at === null) {
    const cancelled = await cancelSchedule(ctx.account, store.id, checked.id, checked.kind);
    return { done: cancelled ? "The schedule is cancelled; what is live stays live." : "Nothing was scheduled for it.", editor };
  }
  const result = await schedulePage(ctx.account, store.id, checked.id, checked.kind, checked.at, [], checked.back);
  if (!result.ok) return fail(result.problem === "ab_test" ? "It is in a running A/B test: stop the test first." : "It is gone.");
  const state = await scheduleOf(store.id, checked.id);
  return {
    done: "It is scheduled: its draft as it is then is published at that time (within five minutes after it), and not before.",
    publishes_at: clock(store, state.waiting?.at ?? null),
    goes_back_at: clock(store, state.waiting?.revertAt ?? null),
    editor,
  };
}
