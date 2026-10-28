import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { findClaims } from "@/lib/claims";
import { buildPageInput, type BuildPageArgs } from "@/lib/site-tools";
import { UNTRUSTED_TEXT } from "@/lib/prompt-safety";
import { draftStoreInput, readThemeChoice, type DraftStoreArgs, type DraftThemeOption } from "@/lib/store-drafts";

import { AiError, aiFor, completeText } from "./ai";
import { audit, type Account } from "./auth";
import { installDesignPreset, listOfferedDesigns } from "./design-presets";
import { saveStoreMenu } from "./menus";
import { saveNavigation } from "./navigation";
import { studioAbilities } from "./page-ai";
import { getPageForEdit, pagesTag, savePage, setFrontPage } from "./pages";
import { runPageJobs } from "./site-tools";
import { getStore, storeTag, type Store } from "./stores";
import { themeCharges } from "./theme-prices";
import { switchToInstall } from "./theme-installs";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * A store drafted from one description (wave 8 unit G, D351): *Start from a description* in the setup wizard and the AI manager's
 * `draft_store`. The description becomes a front page and up to three more pages, built as `build_page` builds them (the page studio, as
 * drafts, in the background), and a free or owned theme (the one named, else the one the model chooses by id) added to the library without
 * going live. Written here and
 * nowhere else (`commerce.store_drafts`); Home's *Your drafts* card reads it, and one press there publishes the pages, makes the first the
 * front page, puts them in a menu the standard header shows and makes the theme live, each through its screen's own saver. Nothing reaches
 * visitors before that press.
 */

export { DRAFT_PAGES_MAX, draftStoreInput, type DraftStoreArgs } from "@/lib/store-drafts";

export type DraftResult = { ok: true; id: string; pages: number; theme: string | null } | { ok: false; problem: string };

/** The page builds a draft asks for: the front page first, each as `build_page` takes it. */
export function draftBuilds(args: DraftStoreArgs, storeName: string): BuildPageArgs[] {
  return [
    buildPageInput.parse({ title: storeName, purpose: args.front.purpose, key_points: args.front.key_points, facts: args.facts, pictures: true }),
    ...args.pages.map((page) => buildPageInput.parse({ title: page.title, purpose: page.purpose, facts: args.facts, pictures: true })),
  ];
}

/** Starts a draft: refused while another is open, without a text model, with a claim, or a theme that would cost money. */
export async function draftStore(
  who: { account: Account; store: Store },
  raw: unknown,
  deps: { kick?: (run: () => Promise<unknown>) => void; complete?: typeof completeText } = {},
): Promise<DraftResult> {
  const parsed = draftStoreInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: `The description could not be read: ${parsed.error.issues[0]?.message ?? "check it"}.` };
  const args = parsed.data;
  const { account, store } = who;
  if (store.status !== "active" || store.starter) return { ok: false, problem: "Only an open store or one being set up is drafted." };
  if (!(await studioAbilities(store.id)).text) return { ok: false, problem: "Set up an AI text model under Settings, AI, to draft the store with AI." };
  const claims = findClaims([args.description, args.front.purpose, ...args.front.key_points, ...args.facts, ...args.pages.map((p) => p.purpose)].join("\n"));
  if (claims.length > 0) return { ok: false, problem: `Say it without claims the store cannot back: ${claims.map((c) => c.phrase).join(", ")}.` };
  const [open] = await db().execute(sql`select 1 from commerce.store_drafts where store_id = ${store.id}::uuid and status = 'drafting'`);
  if (open) return { ok: false, problem: "A draft of the store is waiting on Home: publish or discard it first." };

  let installId: string | null = null;
  let themeTitle: string | null = null;
  const choice = args.theme ? { theme: args.theme, preset: args.preset ?? null } : await chooseTheme(store.id, account.id, args.description, deps.complete);
  if (choice) {
    const charge = (await themeCharges(store.id, [choice.theme])).get(choice.theme);
    if (charge && charge.kind !== "free" && charge.kind !== "owned") return { ok: false, problem: "A draft takes a free theme or one the store owns: choose a premium theme on Design settings." };
    const installed = await installDesignPreset(store.id, choice.theme, account.id, {}, choice.preset);
    if (!installed.ok) return { ok: false, problem: installed.problems.join(" ") };
    installId = installed.installId;
    themeTitle = installed.title;
  }
  const builds = draftBuilds(args, store.name);
  const id = await db().transaction(async (tx) => {
    const jobIds: string[] = [];
    for (const build of builds) {
      const [job] = await tx.execute<{ id: string }>(sql`
        insert into commerce.page_ai_jobs (store_id, kind, asked_by, input, acted_by)
        values (${store.id}::uuid, 'build', ${account.id}::uuid, ${JSON.stringify(build)}::jsonb, 'person')
        returning id
      `);
      jobIds.push(String(job.id));
    }
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into commerce.store_drafts (store_id, account_id, description, job_ids, install_id)
      values (${store.id}::uuid, ${account.id}::uuid, ${args.description}, ${`{${jobIds.join(",")}}`}::uuid[], ${installId}::uuid)
      returning id
    `);
    return String(row.id);
  });
  await audit(account.id, store.id, "store.draft_started", { draft: id, pages: builds.length, theme: themeTitle });
  (deps.kick ?? kick)(() => runPageJobs(Date.now() + 60_000));
  return { ok: true, id, pages: builds.length, theme: themeTitle };
}

/**
 * A theme for a draft named by no one: the model chooses one of the published themes the store may use without paying (free, or already
 * its own) and a preset from the description, by id only (`readThemeChoice()`); no answer, a failure or no such theme is no theme.
 */
async function chooseTheme(storeId: string, accountId: string, description: string, complete: typeof completeText = completeText) {
  const offered = await listOfferedDesigns();
  const charges = await themeCharges(storeId, offered.map((theme) => theme.id));
  const options: DraftThemeOption[] = offered
    .filter((theme) => ["free", "owned"].includes(charges.get(theme.id)?.kind ?? "free"))
    .slice(0, 40)
    .map((theme) => ({ id: theme.id, title: theme.title, summary: theme.summary ?? null, presets: theme.presets ?? [] }));
  if (options.length === 0) return null;
  const connection = await aiFor(storeId, { feature: "store_draft", accountId });
  if (!connection?.textModel) return null;
  try {
    const { text } = await complete(
      connection,
      [
        {
          role: "system",
          content: [
            'You choose the theme for a new online store from its owner\'s description. Answer with JSON only: {"theme":"<id>","preset":"<key or null>"}.',
            "Choose only among these themes and their presets, by the look that suits the business best:",
            JSON.stringify(options),
            UNTRUSTED_TEXT,
          ].join("\n"),
        },
        { role: "user", content: description },
      ],
      { maxTokens: 200, timeoutMs: 30_000 },
    );
    return readThemeChoice(text, options);
  } catch (error) {
    if (error instanceof AiError) return null;
    throw error;
  }
}

function kick(run: () => Promise<unknown>): void {
  void import("next/server")
    .then(({ after }) => {
      try {
        after(run);
      } catch {
        // Not in a request: the every-minute job takes the builds up.
      }
    })
    .catch(() => undefined);
}

export type DraftView = {
  id: string;
  description: string;
  pages: { job: string; title: string; status: "building" | "built" | "failed"; pageId: string | null; problem: string | null }[];
  theme: { install: string; title: string } | null;
  /** Whether every build has settled, so the drafts can be published. */
  ready: boolean;
};

/** The store's open draft, for Home's card: each build's state and page, and the theme. */
export async function openDraft(storeId: string): Promise<DraftView | null> {
  const draft = await typedRow(
    z.object({ id: col.uuid, description: col.text, job_ids: z.array(z.string()), install_id: col.uuid.nullable(), install_title: col.textOrNull }),
    sql`
      select d.id, d.description, d.job_ids::text[] as job_ids, d.install_id, i.title as install_title
      from commerce.store_drafts d left join commerce.store_theme_installs i on i.id = d.install_id
      where d.store_id = ${storeId}::uuid and d.status = 'drafting'
    `,
  );
  if (!draft) return null;
  const jobs = await typedRows(
    z.object({ id: col.uuid, status: col.text, page_id: col.uuid.nullable(), problem: col.textOrNull, title: col.text }),
    sql`
      select j.id, j.status, j.page_id, j.problem, coalesce(p.draft ->> 'title', j.input ->> 'title', '') as title
      from commerce.page_ai_jobs j left join commerce.pages p on p.id = j.page_id
      where j.store_id = ${storeId}::uuid and j.id = any(${`{${draft.job_ids.join(",")}}`}::uuid[])
    `,
  );
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const pages = draft.job_ids.map((jobId) => {
    const job = byId.get(jobId);
    const status: DraftView["pages"][number]["status"] = !job || job.status === "failed" || job.status === "gone" ? "failed" : job.status === "done" ? "built" : "building";
    return { job: jobId, title: job?.title ?? "", status, pageId: job?.page_id ?? null, problem: status === "failed" ? (job?.problem ?? "It was not built.") : null };
  });
  return {
    id: draft.id,
    description: draft.description,
    pages,
    theme: draft.install_id ? { install: draft.install_id, title: draft.install_title ?? "" } : null,
    ready: pages.every((page) => page.status !== "building"),
  };
}

export type PublishDraftResult = { ok: true; published: number; notes: string[] } | { ok: false; problem: string };

/**
 * The owner's one press (their yes for every part): each built page published by the builder's own save, the first made the front page,
 * the others added to the menu the header shows (or a menu of their own the header then shows), and the theme made live. A page that cannot be published (a blocking problem) is left as
 * a draft and named; the rest go on.
 */
export async function publishDraft(who: { account: Account; store: Store }, draftId: string, invalidate: (tag: string) => void): Promise<PublishDraftResult> {
  const view = await openDraft(who.store.id);
  if (!view || view.id !== draftId) return { ok: false, problem: "That draft is no longer waiting." };
  if (!view.ready) return { ok: false, problem: "Some pages are still being built: publish when they are done." };
  const notes: string[] = [];
  const published: { id: string; slug: string; title: string }[] = [];
  for (const page of view.pages) {
    if (!page.pageId) continue;
    const held = await getPageForEdit(who.store.id, page.pageId, "page");
    if (!held) continue;
    const saved = await savePage(who.account, who.store.id, page.pageId, held.draft, { publish: true, type: "page" });
    if (!saved.ok) {
      notes.push(`"${held.draft.title}" stays a draft: ${saved.problems.join(" ")}`);
      continue;
    }
    published.push({ id: page.pageId, slug: held.draft.slug, title: held.draft.title });
  }
  if (published.length > 0) {
    const front = await setFrontPage(who.account, who.store.id, published[0].id);
    if (!front.ok) notes.push(`The front page is unchanged: ${front.problems.join(" ")}`);
    const member = { account: who.account, store: who.store, role: "owner" as const };
    const locale = who.store.localization.locales[0] ?? "en";
    const added = published.slice(1).map((page) => ({ label: { [locale]: page.title }, link: { kind: "page" as const, slug: page.slug }, depth: 0 }));
    // The pages join the menu the header shows, after its own links; a store whose header shows none gets a menu of its own for them.
    const shown = who.store.headerMenuId ? who.store.menus.find((menu) => menu.id === who.store.headerMenuId) : undefined;
    if (added.length > 0 && shown) {
      const have = new Set(shown.items.map((item) => JSON.stringify(item.link)));
      const menu = await saveStoreMenu(member, shown.id, { name: shown.name, items: [...shown.items, ...added.filter((item) => !have.has(JSON.stringify(item.link)))] });
      if (!menu.ok) notes.push(`The pages were not added to the menu "${shown.name}": ${menu.problems.join(" ")}`);
    } else if (added.length > 0) {
      const names = new Set(who.store.menus.map((menu) => menu.name));
      let name = "Pages";
      for (let n = 2; names.has(name); n++) name = `Pages ${n}`;
      const menu = await saveStoreMenu(member, null, { name, items: added });
      if (menu.ok) {
        const fresh = (await getStore(who.store.slug)) ?? who.store;
        const nav = await saveNavigation({ account: who.account, store: fresh, role: "owner" }, { ...fresh.navigation, headerMenuId: menu.id, footerMenuId: fresh.footerMenuId ?? null });
        if (!nav.ok) notes.push(`The menu "${name}" was made but the header does not show it: ${nav.problems.join(" ")}`);
      } else notes.push(`The menu could not be made: ${menu.problems.join(" ")}`);
    }
  }
  if (view.theme) {
    const live = await switchToInstall(who.store.id, view.theme.install, who.account.id);
    if (!live.ok) notes.push(`The theme was not made live: ${live.problems.join(" ")}`);
  }
  await db().execute(sql`update commerce.store_drafts set status = 'published', settled_at = now(), problem = ${notes.join(" ").slice(0, 1000) || null} where id = ${draftId}::uuid and status = 'drafting'`);
  await audit(who.account.id, who.store.id, "store.draft_published", { draft: draftId, pages: published.length, theme: Boolean(view.theme) });
  invalidate(pagesTag(who.store.id));
  invalidate(storeTag(who.store.slug));
  return { ok: true, published: published.length, notes };
}

/** Lets a draft go: its pages stay as drafts in Pages and its theme in the library, for the owner to use or delete. */
export async function discardDraft(who: { account: Account; store: Store }, draftId: string): Promise<boolean> {
  const rows = await db().execute(sql`
    update commerce.store_drafts set status = 'discarded', settled_at = now() where id = ${draftId}::uuid and store_id = ${who.store.id}::uuid and status = 'drafting' returning id
  `);
  if (rows.length > 0) await audit(who.account.id, who.store.id, "store.draft_discarded", { draft: draftId });
  return rows.length > 0;
}
