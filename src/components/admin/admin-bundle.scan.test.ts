import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PACKAGES, SRC, chain, directive, files, read, reach, rel, resolve, specifiersOf } from "@/test/import-walk";

/**
 * The admin's browser scripts under the import walk (bloat review step 1.4, `docs/performance.md`, `docs/rules/budgets.md`), as the
 * visitor's are under `src/lib/storefront-bundle.scan.test.ts`. Every `"use client"` module of `src/app/admin` and `src/components/admin`
 * is walked through its static value imports (`src/test/import-walk.ts`). A static walk does not follow `import()`: a part loaded on a
 * press may be large, and `server-only` files and server action files are not walked into (a reference in the browser, not its code).
 *   1. The frame: the client parts the four gated layouts draw reach no zod, no Supabase client and no area's catalogue (only `common`
 *      and `sign-in`). FRAME_EXCEPTIONS starts empty (step 0.9 took them off).
 *   2. zod: the closed list ZOD_ALLOWED names each client module that may reach zod, with the schema it runs and why (bloat review
 *      step 2.46). A module that reaches zod and is not a key fails, and so does a key that no longer reaches it. A schema lives in a
 *      `-schema.ts` file beside its helpers in src/lib, and a helper file imports its schema file only as a type; a screen that runs a
 *      schema is named here with it. The builder's, content's and themes' modules reach zod through the page model (code review 3.1).
 * Steps 2.26, 2.29 and 2.46 add their rules through `clientsReaching()`; step 2.26's is rule 3 below, step 2.29's rule 5, step 2.30's (the dialogs) rule 6.
 * 4. The full Supabase client loads on the press (step 2.31): no client module reaches `@supabase/supabase-js`, `@supabase/ssr` (both
 *    named `@supabase` by the walk) or `lib/supabase/client.ts` by a static import. The session is kept by `lib/supabase/auth-client.ts`
 *    (loaded with `import()` by `session.tsx`), and an upload loads the client inside its handler (`lib/supabase/signed-upload.ts`).
 */
const FRAME_LAYOUTS = [
  "app/admin/(gated)/layout.tsx",
  "app/admin/(gated)/[store]/layout.tsx",
  "app/admin/(gated)/platform/layout.tsx",
  "app/admin/(gated)/(owner)/layout.tsx",
];
/** `first -> last` pairs of frame chains allowed to stay; step 0.9 left none, and none is added without the owner's word. */
const FRAME_EXCEPTIONS: string[] = [];
/** Catalogue files the frame may reach: the shell's common words and the sign-in page's. */
const FRAME_CATALOGUES = ["lib/admin-messages/common.en.ts", "lib/admin-messages/sign-in.en.ts"];
const CATALOGUE = /^lib\/admin-messages\/[\w-]+\.(en|nb)\.ts$/;

function under(dir: string): string[] {
  return files(join(SRC, dir));
}
const CLIENTS = [...under("app/admin"), ...under("components/admin")].filter((file) => directive(read(file), "use client"));
const FORBIDDEN_NAMES = ["zod", "@supabase"];

/** The client modules `entry` draws: its static value imports walked through modules without a directive, each met client module kept and not walked into. */
function clientParts(entry: string, planted?: Map<string, string[]>): string[] {
  const found = new Set<string>();
  const seen = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    for (const specifier of specifiersOf(file, planted)) {
      const target = resolve(file, specifier);
      if (!target || FORBIDDEN_NAMES.includes(target) || target.startsWith("@") || seen.has(target)) continue;
      seen.add(target);
      const text = read(target);
      if (directive(text, "use client")) found.add(target);
      else if (!directive(text, "use server")) queue.push(target);
    }
  }
  return [...found];
}

/** The client modules (as `rel()` names) that reach `target`: a package name, or a file's `rel()` name. */
function clientsReaching(target: string, planted?: Map<string, string[]>): string[] {
  const names: string[] = [];
  for (const client of CLIENTS) {
    for (const name of [...reach(client, { planted }).keys()].map(rel)) {
      if (name === target) {
        names.push(rel(client));
        break;
      }
    }
  }
  return names.sort();
}

/** The chains `first -> ... -> last` by which a client module of the frame reaches zod, the Supabase client or an area's catalogue. */
function frameOffences(planted?: Map<string, string[]>): string[] {
  const found = new Set<string>();
  for (const layout of FRAME_LAYOUTS) {
    for (const client of clientParts(join(SRC, layout), planted)) {
      const seen = reach(client, { planted });
      for (const target of seen.keys()) {
        const name = rel(target);
        const bad = FORBIDDEN_NAMES.includes(name) || (CATALOGUE.test(name) && !FRAME_CATALOGUES.includes(name));
        if (bad) found.add(chain(seen, target).join(" -> "));
      }
    }
  }
  return [...found].sort();
}
const ends = (line: string) => `${line.split(" -> ")[0]} -> ${line.split(" -> ").at(-1)}`;

const zodReach = () => clientsReaching("zod");

/** Every admin client module that may reach zod (`rel()` names), with the schema it runs and why. Closed: a new one is named here or cut. */
const ZOD_ALLOWED: Record<string, string> = {
  "components/admin/affiliate-settings-form.tsx": "readAffiliateForm: runs affiliateSettingsInput on the referral settings form",
  "components/admin/animation-fields.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/app-preview-fields.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/automation/rule-editor.tsx": "orderRuleInput: checks an order rule before the save",
  "components/admin/backdrop-fields.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/block-fields.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/bonus-settings-form.tsx": "readBonusForm: runs bonusSettingsInput on the bonus settings form",
  "components/admin/builder-rails.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/content-type-editor.tsx": "content-types.ts: a content type's and an entry's schemas, on the page model; page-model work, code review 3.1",
  "components/admin/custom-items-editor.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/drafts/draft-editor.tsx": "draftInput: checks the draft order in the editor before the save",
  "components/admin/drafts/draft-screen.tsx": "draws draft-editor.tsx, which runs draftInput on the draft order",
  "components/admin/dual-page-editor.tsx": "saved-parts.ts: checks a saved row, column or part against the page model; page-model work, code review 3.1",
  "components/admin/entry-editor.tsx": "content-types.ts: a content type's and an entry's schemas, on the page model; page-model work, code review 3.1",
  "components/admin/find-replace-dialog.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/forms/form-editor.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/gradient-fields.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/header-stage-fields.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/image-size-fields.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/look-versions-dialog.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/markup-input.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/menu-hover-fields.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/modal-fields.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/modal-preview.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/motion-canvas.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/motion-fields.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/page-builder-fields.tsx": "content-types.ts: a content type's and an entry's schemas, on the page model; page-model work, code review 3.1",
  "components/admin/page-builder-icons.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/page-builder.tsx": "saved-parts.ts: checks a saved row, column or part against the page model; page-model work, code review 3.1",
  "components/admin/page-editor.tsx": "plan-features.ts, through the builder's plan offer; page-model work, code review 3.1",
  "components/admin/page-issues-panel.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/page-studio-view.tsx": "menuLinkSchema (replicate-grid.ts): reads a replicated grid's links; page-model work, code review 3.1",
  "components/admin/page-studio.tsx": "page-ai.ts: reads the model's page against the page model; page-model work, code review 3.1",
  "components/admin/page-versions-dialog.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/product-editor.tsx": "draws terms.tsx, whose term-rules-fields.tsx runs termRulesSchema on a collection's rules",
  "components/admin/product-question-fields.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/replicate-panel.tsx": "menuLinkSchema (replicate-grid.ts): reads a replicated grid's links; page-model work, code review 3.1",
  "components/admin/rich-text-editor.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/row-resize.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/save-template-dialog.tsx": "page-layout.ts: checks a layout against the page model; page-model work, code review 3.1",
  "components/admin/saved-layout-dialog.tsx": "saved-parts.ts: checks a saved row, column or part against the page model; page-model work, code review 3.1",
  "components/admin/store-translator.tsx": "page-translate-ai.ts: reads a translated page against the page model; page-model work, code review 3.1",
  "components/admin/templates-apply.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/templates-lists.ts": "page-layout.ts: checks a layout against the page model; page-model work, code review 3.1",
  "components/admin/templates-modal.tsx": "page-layout.ts: checks a layout against the page model; page-model work, code review 3.1",
  "components/admin/templates-preview.tsx": "page-layout.ts: checks a layout against the page model; page-model work, code review 3.1",
  "components/admin/templates-sharing.tsx": "page-layout.ts: checks a layout against the page model; page-model work, code review 3.1",
  "components/admin/templates-tab.tsx": "page-layout.ts: checks a layout against the page model; page-model work, code review 3.1",
  "components/admin/term-rules-fields.tsx": "termRulesSchema (term-rules-fields.tsx): checks a collection's rules before the save",
  "components/admin/terms.tsx": "draws term-rules-fields.tsx, which runs termRulesSchema on a collection's rules",
  "components/admin/theme-editor.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/typography-fields.tsx": "page-content.ts: the page model's schemas; page-model work, code review 3.1",
  "components/admin/work/assignment-form.tsx": "work-ui-schema.ts: runs a Work form through work-input-schema.ts before the save",
  "components/admin/work/client-actions.tsx": "draws client-form.tsx, which runs clientPayload (work-ui-schema.ts) before the save",
  "components/admin/work/client-form.tsx": "work-ui-schema.ts: runs a Work form through work-input-schema.ts before the save",
  "components/admin/work/invoice-draft-editor.tsx": "readDraft (work-invoice-ui-schema.ts): runs invoiceInput on the draft invoice before the save",
  "components/admin/work/log-time-form.tsx": "work-ui-schema.ts: runs a Work form through work-input-schema.ts before the save",
  "components/admin/work/quick-timer.tsx": "draws log-time-form.tsx, which runs timePayload (work-ui-schema.ts) before the save",
  "components/admin/work/recurring-controls.tsx": "draws recurring-form.tsx, which runs recurringPayload (work-recurring-ui.ts)",
  "components/admin/work/recurring-form.tsx": "recurringPayload (work-recurring-ui.ts): runs recurringInvoiceInput on the recurring form",
  "components/admin/work/tasks-panel.tsx": "work-ui-schema.ts: runs a Work form through work-input-schema.ts before the save",
  "components/admin/work/time-panel.tsx": "draws log-time-form.tsx, which runs timePayload (work-ui-schema.ts) before the save",

};

/**
 * 3. Catalogues (bloat review step 2.26): no admin client module reaches an area's catalogue file (`src/lib/admin-messages/{area}.{en,nb}.ts`)
 *    or an English twin of a helper (`src/lib/*-english.ts`, for the server and the tests) through value imports, a lib module on the way
 *    too. `common.en` and `sign-in.en` are allowed, and `admin-text-later.ts`, whose `import()` per area is the designed late fetch. A part
 *    takes its words as an argument or reads them with `useAdminText()`; English the server writes is said in the account's language on the
 *    server (`docs/platform-admin-i18n.md` 3.3).
 */
const SITE_CATALOGUE = /admin-messages\/([\w-]+\.(?:en|nb))$/;
const ENGLISH_TWIN = /^lib\/[\w-]+-english\.ts$/;
const ALLOWED_CATALOGUES = ["common.en", "sign-in.en"];
const LATE_FETCH = "components/admin/admin-text-later.ts";

function catalogueSites(planted?: Map<string, string[]>): string[] {
  const walked = new Set<string>();
  for (const client of CLIENTS) for (const file of reach(client, { planted }).keys()) walked.add(file);
  const sites = new Set<string>();
  for (const file of walked) {
    // A file the walk met but did not walk into (a server action file, a server-only module) is a reference in the browser, not its code.
    if (PACKAGES.includes(file) || rel(file) === LATE_FETCH) continue;
    const specifiers = specifiersOf(file, planted);
    if (directive(read(file), "use server") || specifiers.includes("server-only")) continue;
    for (const specifier of specifiers) {
      const catalogue = SITE_CATALOGUE.exec(specifier)?.[1];
      if (catalogue && !ALLOWED_CATALOGUES.includes(catalogue)) sites.add(`src/${rel(file)} -> ${catalogue}`);
      const target = resolve(file, specifier);
      if (target && !PACKAGES.includes(target) && ENGLISH_TWIN.test(rel(target))) sites.add(`src/${rel(file)} -> src/${rel(target)}`);
    }
  }
  return [...sites].sort();
}

/**
 * Client modules allowed to import the full Supabase client statically (`rel()` names). Step 0.9 moved every upload to `uploadToSignedUrl()`
 * and step 2.31 moved `SessionKeeper` to `auth-client.ts`, so the list starts empty and only shrinks.
 */
const SUPABASE_STATIC: string[] = [];
const FULL_CLIENT = "lib/supabase/client.ts";
const supabaseStatic = (planted?: Map<string, string[]>) =>
  [...new Set([...clientsReaching("@supabase", planted), ...clientsReaching(FULL_CLIENT, planted)])].sort();

/**
 * 5. No storefront language (bloat review step 2.29): no client module reaches `lib/i18n.ts` or a language's module
 *    (`lib/messages/{en,nb,sv,da}.ts`) through value imports. Until 19 November 2026 40 admin routes carried all four languages (about 318 KB)
 *    for the page builder's previews and the draft editor's unit names. Words of a storefront language come from the server as a prop, or are
 *    read with `useSiteWords()` (`components/admin/site-words.ts`, whose `import()` per language the walk does not follow). A type import is free.
 */
const SITE_LANGUAGES = ["lib/i18n.ts", "lib/messages/en.ts", "lib/messages/nb.ts", "lib/messages/sv.ts", "lib/messages/da.ts"];

/** The chains `client -> ... -> language` by which an admin client module reaches a storefront language. */
function languageOffences(planted?: Map<string, string[]>): string[] {
  const found = new Set<string>();
  for (const client of CLIENTS) {
    const seen = reach(client, { planted });
    for (const target of seen.keys()) if (SITE_LANGUAGES.includes(rel(target))) found.add(chain(seen, target).join(" -> "));
  }
  return [...found].sort();
}

/**
 * 6. The page editor opens its dialogs through `lazy/builder-dialogs.tsx` (bloat review step 2.30): `page-editor.tsx`, `page-builder.tsx` and
 *    `dual-page-editor.tsx` import none of them by a value import, so they stay out of the builder's first scripts and load when first opened.
 *    A type import is free.
 */
const DIALOG_IMPORTERS = ["components/admin/page-editor.tsx", "components/admin/page-builder.tsx", "components/admin/dual-page-editor.tsx"];
const DIALOG_MODULE =
  /from "\.\/(dual-page-dialogs|make-cool-dialog|ai-change-dialog|find-replace-dialog|page-versions-dialog|save-template-dialog|templates-modal|templates-apply|templates-preview|saved-layout-dialog)"/;

/** The value import statements of `text` that bring a dialog in directly. */
function directDialogImports(text: string): string[] {
  return [...text.matchAll(/^import\s[^;]*;/gm)]
    .map((match) => match[0])
    .filter((statement) => !statement.startsWith("import type"))
    .filter(
      (statement) =>
        DIALOG_MODULE.test(statement) || (statement.includes('from "./page-issues-panel"') && /(^|[{,\s])PublishWithIssuesDialog\b/.test(statement.replace(/type PublishWithIssuesDialog/g, ""))),
    );
}

describe("the admin's browser scripts (bloat review step 1.4)", () => {
  it("finds the client modules", () => {
    const names = CLIENTS.map(rel);
    expect(names.length).toBeGreaterThan(300);
    expect(names).toContain("components/admin/admin-rail.tsx");
  });

  it("the frame reaches no zod, no Supabase client and no area's catalogue", () => {
    const offences = frameOffences().filter((line) => !FRAME_EXCEPTIONS.includes(ends(line)));
    expect(offences, "a client part of an admin layout reaches zod, the Supabase client or a catalogue: cut the import chain, do not list it").toEqual([]);
    const live = new Set(frameOffences().map(ends));
    expect(FRAME_EXCEPTIONS.filter((pair) => !live.has(pair)), "take the pair off FRAME_EXCEPTIONS").toEqual([]);
  });

  it("every client module that reaches zod is named in ZOD_ALLOWED with the schema it runs", () => {
    const now = zodReach();
    expect(
      now.filter((name) => !(name in ZOD_ALLOWED)),
      "Move the schema to a -schema.ts file beside the helper (the helper imports it only as a type), or add the module to ZOD_ALLOWED with the schema it runs.",
    ).toEqual([]);
    expect(Object.keys(ZOD_ALLOWED).filter((name) => !now.includes(name)), "These no longer reach zod: take them off ZOD_ALLOWED.").toEqual([]);
  });

  it("no client module reaches an area's catalogue or an English twin", () => {
    expect(catalogueSites(), "pass the words as an argument or read them with useAdminText(); see docs/platform-admin-i18n.md 3.3").toEqual([]);
  });

  it("would notice: a catalogue and an English twin planted on a lib module a client part reads", () => {
    const helper = join(SRC, "lib/admin-fill.ts");
    const planted = new Map([[helper, ["@/lib/admin-messages/home.en", "@/lib/return-admin-english"]]]);
    const sites = catalogueSites(planted);
    expect(sites).toContain("src/lib/admin-fill.ts -> home.en");
    expect(sites).toContain("src/lib/admin-fill.ts -> src/lib/return-admin-english.ts");
  });

  it("the full Supabase client loads on the press, in no client module's static imports", () => {
    const now = supabaseStatic();
    expect(
      now.filter((name) => !SUPABASE_STATIC.includes(name)),
      "load the Supabase client with import() inside the handler that uploads (see src/lib/supabase/signed-upload.ts); the session is kept by src/lib/supabase/auth-client.ts",
    ).toEqual([]);
    expect(SUPABASE_STATIC.filter((name) => !now.includes(name)), "take the module off SUPABASE_STATIC").toEqual([]);
  });

  it("would notice: a client module that imports the full client at its top", () => {
    const first = CLIENTS[0];
    expect(supabaseStatic()).not.toContain(rel(first));
    expect(supabaseStatic(new Map([[first, ["@/lib/supabase/client"]]]))).toContain(rel(first));
    expect(supabaseStatic(new Map([[first, ["@supabase/supabase-js"]]]))).toContain(rel(first));
  });

  it("no client module reaches lib/i18n or a storefront language", () => {
    expect(
      languageOffences(),
      "Give the words from the server as a prop, or read them with useSiteWords() (src/components/admin/site-words.ts).",
    ).toEqual([]);
  });

  it("would notice: lib/i18n planted on an admin part, and a language on a lib module a client part reads", () => {
    const rail = join(SRC, "components/admin/admin-rail.tsx");
    expect(CLIENTS).toContain(rail);
    expect(languageOffences(new Map([[rail, ["@/lib/i18n"]]])).some((line) => line.startsWith(rel(rail)) && line.endsWith("lib/i18n.ts"))).toBe(true);
    const helper = join(SRC, "lib/admin-fill.ts");
    expect(languageOffences(new Map([[helper, ["@/lib/messages/sv"]]])).some((line) => line.endsWith("lib/messages/sv.ts"))).toBe(true);
  });

  it("would notice: zod planted on a part of the frame", () => {
    const first = clientParts(join(SRC, FRAME_LAYOUTS[0]))[0];
    expect(first).toBeDefined();
    const planted = new Map([[first, ["zod"]]]);
    expect(frameOffences(planted).some((line) => line.startsWith(rel(first)) && line.endsWith("-> zod"))).toBe(true);
    expect(zodReach()).not.toContain(rel(first));
    expect(clientsReaching("zod", planted)).toContain(rel(first));
  });

  it("would notice: the Supabase client planted on the same part", () => {
    const first = clientParts(join(SRC, FRAME_LAYOUTS[0]))[0];
    const planted = new Map([[first, ["@supabase/supabase-js"]]]);
    expect(frameOffences(planted).some((line) => line.endsWith("-> @supabase"))).toBe(true);
  });

  it("the page editor opens its dialogs through lazy/builder-dialogs.tsx", () => {
    const found = DIALOG_IMPORTERS.flatMap((file) => directDialogImports(read(join(SRC, file))).map((statement) => `src/${file}: ${statement}`));
    expect(found, "Import the dialog from ./lazy/builder-dialogs: a direct import puts it back in the editor's first scripts (bloat review step 2.30).").toEqual([]);
  });

  it("would notice: a dialog imported directly, and not a type import", () => {
    expect(directDialogImports('import { MakeCoolDialog } from "./make-cool-dialog";')).toHaveLength(1);
    expect(directDialogImports('import { PageIssuesPanel, PublishWithIssuesDialog } from "./page-issues-panel";')).toHaveLength(1);
    expect(directDialogImports('import type { PendingLayout } from "./templates-apply";')).toHaveLength(0);
    expect(directDialogImports('import { PageIssuesPanel } from "./page-issues-panel";')).toHaveLength(0);
  });

  it("would notice: the product editor reaches zod exactly when it is named in ZOD_ALLOWED", () => {
    const editor = "components/admin/product-editor.tsx";
    const reaches = [...reach(join(SRC, editor)).keys()].includes("zod");
    expect(editor in ZOD_ALLOWED).toBe(reaches);
  });
});
