import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every cached read says how long it lives and under which tags (bloat review step 1.11, SD-13, CA-16).
 *
 * Part 1 lists each function whose body starts with the directive "use cache" with its `cacheLife()` and `cacheTag()` arguments and
 * compares the table to CACHED_READS below, so a changed life or tag shows in review as a changed line. Part 2 asks that every one
 * calls both, but the functions named in NO_LIFE and NO_TAG (each with its reason; the lists only shrink). Part 3 holds that a
 * store's admin refreshes no tag that names no store, but the files in PLATFORM_TAG_FROM_STORE (the list only shrinks).
 * Part 4 shows the parser notices what it is there for.
 */

const ROOT = process.cwd();

export type CachedRead = { life: string | null; tags: string[] };

/** A line that is exactly the directive: "use cache", or one with a suffix such as "use cache: remote". */
const DIRECTIVE = /^\s*["']use cache(: [a-z]+)?["'];?\s*$/;
const FUNCTION_HEAD = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/;

/** The arguments of every call `name(`...`)` in `body`, each with its white space collapsed. */
function callArgs(body: string, name: string): string[] {
  const found: string[] = [];
  const call = new RegExp(`\\b${name}\\(`, "g");
  for (let m = call.exec(body); m; m = call.exec(body)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < body.length && depth > 0; i++) {
      if (body[i] === "(") depth++;
      else if (body[i] === ")") depth--;
    }
    found.push(body.slice(start, i - 1).replace(/\s+/g, " ").trim());
  }
  return found;
}

/** The cached reads of one source file: functions at the top level whose first statement is the directive. */
export function parseCachedReads(file: string, source: string): Record<string, CachedRead> {
  const lines = source.split("\n");
  const reads: Record<string, CachedRead> = {};
  lines.forEach((line, at) => {
    if (!DIRECTIVE.test(line)) return;
    let head = at;
    while (head >= 0 && !FUNCTION_HEAD.test(lines[head])) head--;
    if (head < 0) throw new Error(`${file}:${at + 1}: a "use cache" directive outside a top-level function`);
    let end = at + 1;
    while (end < lines.length && !/^\}/.test(lines[end])) end++;
    const name = FUNCTION_HEAD.exec(lines[head])![1];
    const body = lines.slice(at + 1, end).join("\n");
    const lives = callArgs(body, "cacheLife");
    reads[`${file}#${name}`] = { life: lives.length ? lives.join(" | ") : null, tags: callArgs(body, "cacheTag") };
  });
  return reads;
}

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** Each cached read's life and tags as written today. A change shows here as a changed line: say why in the commit. */
const CACHED_READS: Record<string, CachedRead> = {
  "src/app/s/[store]/[market]/legacy-redirect.ts#legacyLocation": { life: "{ stale: 300, revalidate: 1, expire: 3600 }", tags: ["redirectsTag(store.id), catalogTag(store.id)"] },
  "src/app/s/[store]/[market]/term-listing.tsx#pictureAlt": { life: "\"hours\"", tags: ["CATALOG_TAG, catalogTag(storeId)"] },
  "src/server/affiliates.ts#affiliateSite": { life: "\"hours\"", tags: ["affiliateTag(storeId)"] },
  "src/server/after-sale.ts#afterSaleOpenCached": { life: "{ stale: 300, revalidate: 3600, expire: 86400 }", tags: ["afterSaleTag(storeId)"] },
  "src/server/blog-comments.ts#approvedComments": { life: "\"hours\"", tags: ["commentsTag(storeId)"] },
  "src/server/blogs.ts#blogFeed": { life: "\"hours\"", tags: ["pagesTag(store.id)"] },
  "src/server/blogs.ts#storeAuthors": { life: "\"hours\"", tags: ["pagesTag(storeId)"] },
  "src/server/blogs.ts#storeBlogs": { life: "\"hours\"", tags: ["pagesTag(storeId)"] },
  "src/server/brreg.ts#fetchUnit": { life: "\"days\"", tags: [] },
  "src/server/campaign-notices.ts#campaignNotices": { life: "{ stale: 300, revalidate: seconds, expire: 86400 }", tags: ["campaignsTag(storeId)"] },
  "src/server/campaign-notices.ts#campaignNoticesAt": { life: null, tags: ["campaignsTag(owner)"] },
  "src/server/catalog.ts#getProduct": { life: "\"hours\"", tags: ["CATALOG_TAG, catalogTag(storeId), fieldsTag(storeId)"] },
  "src/server/catalog.ts#listGridProducts": { life: "\"hours\"", tags: ["CATALOG_TAG, catalogTag(storeId)"] },
  "src/server/catalog.ts#listProducts": { life: "\"hours\"", tags: ["CATALOG_TAG, catalogTag(storeId)"] },
  "src/server/chat-agent.ts#chatWidgetFor": { life: "\"hours\"", tags: ["chatTag(storeId), aiTag(storeId), aiTag(null)"] },
  "src/server/chat-agent.ts#getChatAgent": { life: "\"hours\"", tags: ["chatTag(storeId)"] },
  "src/server/content-grid.ts#customWhere": { life: "\"hours\"", tags: ["storeTag(slug)"] },
  "src/server/content-grid.ts#gridPages": { life: "\"hours\"", tags: ["pagesTag(owner), termsTag({ storeId: owner, contentType: \"page\" })", "fieldsTag(owner)"] },
  "src/server/content-grid.ts#gridProducts": { life: "\"hours\"", tags: ["termsTag({ storeId, contentType: \"product\" })", "fieldsTag(storeId)"] },
  "src/server/content-grid.ts#ownerSells": { life: null, tags: ["catalogTag(owner)"] },
  "src/server/content-site.ts#findEntryPage": { life: "\"hours\"", tags: ["contentTag(owner), pagesTag(owner)"] },
  "src/server/content-site.ts#gridEntries": { life: "\"hours\"", tags: ["contentTag(owner)"] },
  "src/server/content-site.ts#listIndexedEntries": { life: "\"hours\"", tags: ["contentTag(owner)"] },
  "src/server/custom-fields.ts#activeFieldGroups": { life: "\"hours\"", tags: ["fieldsTag(storeId)"] },
  "src/server/custom-fields.ts#allActiveFieldGroups": { life: "\"hours\"", tags: ["fieldsTag(storeId)"] },
  "src/server/custom-fields.ts#shownEntryFields": { life: "\"hours\"", tags: ["fieldsTag(storeId), contentTag(storeId)", "storeTag(store.slug)"] },
  "src/server/custom-fields.ts#shownFieldsFor": { life: "\"hours\"", tags: ["fieldsTag(storeId), contentTag(storeId)", "storeTag(store.slug)"] },
  "src/server/custom-fields.ts#shownFieldsForVariants": { life: "\"hours\"", tags: ["fieldsTag(storeId), contentTag(storeId)", "storeTag(store.slug)"] },
  "src/server/custom-fields.ts#shownPlatformEntryFields": { life: "\"hours\"", tags: ["contentTag(null), pagesTag(null)"] },
  "src/server/demo-stores.ts#liveDemosOf": { life: "\"minutes\"", tags: ["STARTERS_TAG"] },
  "src/server/design-presets.ts#designChoices": { life: "\"hours\"", tags: ["DESIGNS_TAG, STARTERS_TAG"] },
  "src/server/design-presets.ts#publicDesignPreview": { life: "\"hours\"", tags: ["DESIGNS_TAG, STARTERS_TAG"] },
  "src/server/docs-guide-settings.ts#docsGuideProfile": { life: "\"hours\"", tags: ["DOCS_GUIDE_TAG, AI_TAG"] },
  "src/server/docs-guide-settings.ts#getDocsGuide": { life: "\"hours\"", tags: ["DOCS_GUIDE_TAG"] },
  "src/server/experiments.ts#experimentOfPage": { life: "\"hours\"", tags: ["experimentsTag(storeId)"] },
  "src/server/experiments.ts#pageGoalTests": { life: "\"hours\"", tags: ["experimentsTag(storeId)"] },
  "src/server/experiments.ts#runningExperimentIds": { life: "\"hours\"", tags: ["experimentsTag(storeId)"] },
  "src/server/experiments.ts#siteTests": { life: "\"hours\"", tags: ["experimentsTag(storeId)"] },
  "src/server/experiments.ts#siteVersionContent": { life: "\"hours\"", tags: ["experimentsTag(storeId), `pages:${storeId}`"] },
  "src/server/experiments.ts#storeHasExperiments": { life: "\"hours\"", tags: ["experimentsTag(storeId)"] },
  "src/server/field-tiles.ts#shownFieldsForItems": { life: "\"hours\"", tags: ["fieldsTag(storeId)"] },
  "src/server/fonts.ts#fontCss": { life: "\"seconds\" | \"days\"", tags: ["fontTag(slug)"] },
  "src/server/fonts.ts#fontPreloadFile": { life: "\"hours\"", tags: ["fontTag(slug)"] },
  "src/server/form-site.ts#siteForm": { life: "\"hours\"", tags: ["formsTag(owner)"] },
  "src/server/house-customers.ts#houseStoreIdCached": { life: "\"days\"", tags: ["\"house-store\""] },
  "src/server/instagram.ts#instagramPosts": { life: "\"hours\"", tags: ["instagramTag(storeId)"] },
  "src/server/languages.ts#enabledLanguages": { life: "\"hours\"", tags: ["LANGUAGES_TAG"] },
  "src/server/listing.ts#listingFacets": { life: "\"hours\"", tags: ["CATALOG_TAG, catalogTag(storeId), termsTag({ storeId, contentType: \"product\" }), fieldsTag(storeId)"] },
  "src/server/listing.ts#relatedProducts": { life: "\"hours\"", tags: ["CATALOG_TAG, catalogTag(storeId)"] },
  "src/server/page-modals.ts#usesRememberedModals": { life: "\"hours\"", tags: ["pagesTag(storeId)"] },
  "src/server/pages.ts#findPublishedPage": { life: "\"hours\"", tags: ["pagesTag(owner)"] },
  "src/server/pages.ts#listPublishedPages": { life: "\"hours\"", tags: ["pagesTag(owner)"] },
  "src/server/pages.ts#publishedPageById": { life: "\"hours\"", tags: ["pagesTag(owner)"] },
  "src/server/pages.ts#publishedPageIndex": { life: "\"hours\"", tags: ["pagesTag(owner)"] },
  "src/server/pages.ts#publishedPageNames": { life: "\"hours\"", tags: ["pagesTag(owner)"] },
  "src/server/platform-navigation.ts#loadSettings": { life: "\"hours\"", tags: ["PLATFORM_NAVIGATION_TAG"] },
  "src/server/platform-roles.ts#getPlatformPageRoles": { life: "\"hours\"", tags: ["pagesTag(null)"] },
  "src/server/product-layouts.ts#productLayoutFor": { life: "\"hours\"", tags: ["CATALOG_TAG, catalogTag(storeId), pagesTag(storeId), termsTag({ storeId, contentType: \"product\" })"] },
  "src/server/product-passports.ts#cachedPassport": { life: "\"hours\"", tags: ["passportTag(id)", "catalogTag(found.storeId)"] },
  "src/server/product-settings.ts#productSettingsCached": { life: "\"hours\"", tags: ["productSettingsTag(storeId)"] },
  "src/server/public-plans.ts#getPublicPlans": { life: "{ revalidate: Math.max(60, Math.ceil(nextChange)) } | \"hours\"", tags: ["PLANS_TAG"] },
  "src/server/recommend-grid.ts#recommendingGrid": { life: "\"hours\"", tags: ["recommendTag(owner), catalogTag(owner), termsTag({ storeId: owner, contentType: \"product\" }), fieldsTag(owner), pagesTag(owner)"] },
  "src/server/recommend-settings.ts#getRecommendSettings": { life: "\"hours\"", tags: ["recommendTag(storeId)"] },
  "src/server/recommend.ts#standInFor": { life: "\"hours\"", tags: ["CATALOG_TAG, catalogTag(storeId), recommendTag(storeId), termsTag({ storeId, contentType: \"product\" }), fieldsTag(storeId), pagesTag(storeId)"] },
  "src/server/redirect-resolve.ts#lookupCached": { life: "{ stale: 300, revalidate: 1, expire: 3600 }", tags: ["redirectsTag(storeId), catalogTag(storeId)"] },
  "src/server/referrals.ts#referralPublicSettings": { life: "\"hours\"", tags: ["REFERRALS_TAG"] },
  "src/server/review-facts.ts#reviewFacts": { life: "\"hours\"", tags: ["reviewsTag(storeId)"] },
  "src/server/sandbox.ts#sandboxOpen": { life: "\"minutes\"", tags: ["SANDBOX_TAG"] },
  "src/server/self-signup.ts#selfServeShown": { life: "\"hours\"", tags: ["SIGNUP_TAG"] },
  "src/server/seo.ts#getPlatformSeo": { life: "\"hours\"", tags: ["PLATFORM_SEO_TAG"] },
  "src/server/seo.ts#getShippingFacts": { life: "\"hours\"", tags: ["CATALOG_TAG, catalogTag(storeId)"] },
  "src/server/seo.ts#listIndexedProducts": { life: "\"hours\"", tags: ["CATALOG_TAG, catalogTag(storeId)"] },
  "src/server/seo.ts#listIndexedTerms": { life: "\"hours\"", tags: ["CATALOG_TAG, catalogTag(storeId), termsTag({ storeId, contentType: \"product\" })"] },
  "src/server/seo.ts#listPublicStores": { life: "\"hours\"", tags: ["STORES_TAG"] },
  "src/server/seo.ts#storeClosedToAi": { life: "\"hours\"", tags: ["pagesTag(storeId)"] },
  "src/server/site-cookies.ts#siteFindings": { life: "\"hours\"", tags: ["cookiesTag(storeId)"] },
  "src/server/site-cookies.ts#storeFeatures": { life: "\"hours\"", tags: ["cookiesTag(storeId)"] },
  "src/server/site-layouts.ts#siteLayoutFor": { life: "\"hours\"", tags: ["pagesTag(storeId)"] },
  "src/server/site-store.ts#siteStoreCached": { life: "\"hours\"", tags: ["SITE_STORE_TAG"] },
  "src/server/status.ts#statusOverview": { life: "\"minutes\"", tags: ["STATUS_TAG"] },
  "src/server/store-starters.ts#starterCards": { life: "\"hours\"", tags: ["STARTERS_TAG"] },
  "src/server/stores.ts#listCountries": { life: "\"days\"", tags: [] },
  "src/server/stores.ts#loadStore": { life: "\"hours\"", tags: ["storeTag(slug)"] },
  "src/server/stores.ts#storeSlugOf": { life: "\"days\"", tags: ["storeIdTag(storeId)"] },
  "src/server/stores.ts#templateStoreSlug": { life: "\"hours\"", tags: ["TEMPLATE_TAG"] },
  "src/server/taxonomy.ts#siteTerms": { life: "\"hours\"", tags: ["termsTag({ storeId, contentType })"] },
  "src/server/text-styles.ts#textStylesFor": { life: "\"hours\"", tags: ["textStylesTag(owner)"] },
  "src/server/theme-store.ts#themePreviewNeighbours": { life: "\"hours\"", tags: ["DESIGNS_TAG, STARTERS_TAG"] },
  "src/server/theme-store.ts#themeStoreCards": { life: "\"hours\"", tags: ["DESIGNS_TAG, STARTERS_TAG"] },
  "src/server/theme-store.ts#themeStorePage": { life: "\"hours\"", tags: ["DESIGNS_TAG, STARTERS_TAG"] },
};

/** Cached reads with no cacheLife, each following the life of the cached read it calls. Only shrinks. */
const NO_LIFE: Record<string, string> = {
  "src/server/content-grid.ts#ownerSells": "follows the life of the cached read it calls",
  "src/server/campaign-notices.ts#campaignNoticesAt": "follows the life of the cached read it calls",
};

/** Cached reads with no cacheTag. Only shrinks (step 2.15 changes them). */
const NO_TAG: Record<string, string> = {
  "src/server/stores.ts#listCountries": "reference data that changes only with a migration",
  "src/server/brreg.ts#fetchUnit": "another site's data, kept by time",
};

/** The constants from src/server that hold a tag naming no store. */
const PLATFORM_TAGS =
  "STORES_TAG|CATALOG_TAG|AI_TAG|PAGES_TAG|LANGUAGES_TAG|PLANS_TAG|DESIGNS_TAG|STARTERS_TAG|TEMPLATE_TAG|PLATFORM_NAVIGATION_TAG|PLATFORM_SEO_TAG|DOCS_GUIDE_TAG|STATUS_TAG|SIGNUP_TAG|SANDBOX_TAG|SITE_STORE_TAG|REFERRALS_TAG";
const PLATFORM_REFRESH = new RegExp(`\\b(updateTag|revalidateTag|refreshTag|refreshTagNow|staleTag)\\(\\s*(${PLATFORM_TAGS})\\b`);

/** Files of a store's admin that refresh a platform-wide tag today, with the tag. Only shrinks. */
const PLATFORM_TAG_FROM_STORE: Record<string, string> = {
  "src/app/admin/(gated)/[store]/setup/actions.ts": "STORES_TAG",
  "src/app/admin/(gated)/[store]/settings/countries/actions.ts": "STORES_TAG",
  "src/app/admin/(gated)/[store]/settings/localization/actions.ts": "STORES_TAG",
  "src/app/admin/(gated)/[store]/settings/company/actions.ts": "STORES_TAG",
  "src/app/admin/(gated)/[store]/translate/actions.ts": "STORES_TAG",
};

/** The files under a store's admin that refresh a platform-wide tag, with the tag's name. */
export function platformRefreshes(file: string, source: string): Record<string, string> {
  const m = PLATFORM_REFRESH.exec(source);
  return m ? { [file]: m[2] } : {};
}

const files = ["src/server", "src/app", "src/lib", "src/components"].flatMap(sources).map((p) => relative(ROOT, join(ROOT, p))).sort();
const actual: Record<string, CachedRead> = {};
for (const file of files) Object.assign(actual, parseCachedReads(file, read(file)));
const names = Object.keys(actual).sort();

describe("every cached read says its life and its tags", () => {
  it("finds the cached reads", () => {
    console.log(`cached reads: ${names.length} in ${new Set(names.map((n) => n.split("#")[0])).size} files`);
    expect(names.length).toBeGreaterThan(50);
  });

  it("matches CACHED_READS", () => {
    expect(
      actual,
      "a cached read changed its life or tags: update CACHED_READS in src/server/use-cache.scan.test.ts and say why in the commit",
    ).toEqual(CACHED_READS);
  });

  it.each(names)("%s calls cacheLife and cacheTag or is listed", (name) => {
    const { life, tags } = actual[name];
    if (!NO_LIFE[name]) expect(life, `${name} has no cacheLife(): call it, or list it in NO_LIFE with the reason`).not.toBeNull();
    if (!NO_TAG[name]) expect(tags.length, `${name} has no cacheTag(): call it, or list it in NO_TAG with the reason`).toBeGreaterThan(0);
  });

  it("lists only reads that still lack a life or a tag", () => {
    for (const name of Object.keys(NO_LIFE)) {
      expect(names, `${name} is gone: take it off NO_LIFE`).toContain(name);
      expect(actual[name].life, `${name} has a cacheLife() now: take it off NO_LIFE`).toBeNull();
    }
    for (const name of Object.keys(NO_TAG)) {
      expect(names, `${name} is gone: take it off NO_TAG`).toContain(name);
      expect(actual[name].tags, `${name} has a cacheTag() now: take it off NO_TAG`).toEqual([]);
    }
  });
});

describe("a store's admin refreshes no tag that names no store", () => {
  const admin = sources("src/app/admin/(gated)/[store]").map((p) => relative(ROOT, join(ROOT, p))).sort();
  const refreshing = Object.assign({}, ...admin.map((file) => platformRefreshes(file, read(file)))) as Record<string, string>;

  it.each(admin)("%s", (file) => {
    if (PLATFORM_TAG_FROM_STORE[file]) return;
    expect(refreshing[file], `${file} refreshes ${refreshing[file]}, which names no store: refresh a tag with the store in it`).toBeUndefined();
  });

  it("lists only files that still do", () => {
    for (const [file, tag] of Object.entries(PLATFORM_TAG_FROM_STORE)) {
      expect(refreshing[file], `${file} no longer refreshes ${tag}: take it off PLATFORM_TAG_FROM_STORE`).toBe(tag);
    }
  });
});

describe("the parser would notice", () => {
  it("a cached read with a life and no tag", () => {
    const source = [
      "export async function trial(id: string) {",
      '  "use cache";',
      '  cacheLife("hours");',
      "  return id;",
      "}",
      "",
    ].join("\n");
    const reads = parseCachedReads("trial.ts", source);
    expect(reads["trial.ts#trial"]).toEqual({ life: '"hours"', tags: [] });
  });

  it("a cached read with a tag spread over two lines", () => {
    const source = ["async function two() {", '  "use cache: remote";', "  cacheTag(a(1),", "    b);", "  cacheLife({ stale: 3 });", "}", ""].join("\n");
    expect(parseCachedReads("t.ts", source)["t.ts#two"]).toEqual({ life: "{ stale: 3 }", tags: ["a(1), b"] });
  });

  it("a platform-wide refresh in a store admin file", () => {
    expect(platformRefreshes("a.ts", "export async function save() {\n  updateTag(CATALOG_TAG);\n}")).toEqual({ "a.ts": "CATALOG_TAG" });
    expect(platformRefreshes("a.ts", "updateTag(storeTag(slug));")).toEqual({});
  });
});
