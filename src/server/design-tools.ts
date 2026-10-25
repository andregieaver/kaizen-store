import "server-only";

import { chargeCosts, chargeKey, chargeTokenFor, liveSummary, type AddThemeInput, type MakeThemeLiveInput } from "@/lib/design-tools";
import type { GateCategory } from "@/lib/owner-tools";
import type { PermissionHolder } from "@/lib/permissions";
import { chargeLine, CHARGE_WORDS, type ThemeCharge } from "@/lib/theme-prices";

import type { Account } from "./auth";
import { applyDesignPreset, designTags, installDesignPreset, listOfferedDesigns } from "./design-presets";
import { OwnerToolError } from "./owner-tool-error";
import { CHARGE_CHANGED, chargeDueThemePurchases, themeCharge, themeCharges } from "./theme-prices";
import { INSTALLS_FULL, INSTALLS_MAX, listInstalls, lookChangeRefusal, switchToInstall, type ThemeInstall } from "./theme-installs";
import type { Store } from "./stores";

/**
 * The AI manager's design tools (D308, `docs/ai-autopilot.md` 6): the themes and presets on offer with what each would cost the store, adding
 * one to the store's theme library, the address to try it, and making it live. Each goes only through Design settings' own functions
 * (`installDesignPreset()`, `applyDesignPreset()`, `switchToInstall()`), with their checks, and refreshes `designTags()` as the page does. Making a theme live always waits for the owner's yes, with the charge they were shown kept with
 * it (`approved_charge`): a premium theme never goes live at a price nobody agreed to.
 */

export type DesignToolContext = {
  account: Account;
  store: Store;
  invalidate: (tag: string) => void;
  holder?: PermissionHolder;
};

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const designPage = (store: Store) => `/admin/${store.slug}/settings/design`;
const installPage = (store: Store, install: string) => `${designPage(store)}/themes/${install}`;
const previewPage = (store: Store, install: string) => `${installPage(store, install)}/preview`;

function refresh(ctx: DesignToolContext) {
  for (const tag of designTags(ctx.store)) ctx.invalidate(tag);
}

/** After the answer, as Design settings' button does: a premium theme charged at once is invoiced (D286). */
function afterAnswer(run: () => Promise<unknown>): void {
  void import("next/server")
    .then(({ after }) => {
      try {
        after(run);
      } catch {
        // Not in a request: the five-minute job invoices it.
      }
    })
    .catch(() => undefined);
}

const priceWords = (charge: ThemeCharge): string => chargeLine(charge, CHARGE_WORDS) || "Free.";

/** `list_themes` (`website:read`): the published themes and their presets with what making each live would cost, and the store's library. */
export async function listThemesTool(ctx: DesignToolContext) {
  const [offered, installs] = await Promise.all([listOfferedDesigns(), listInstalls(ctx.store.id)]);
  const charges = await themeCharges(
    ctx.store.id,
    offered.map((d) => d.id),
  );
  const installedFrom = new Set(installs.flatMap((i) => (i.presetId ? [i.presetId] : [])));
  return {
    installed: installs.map((i) => ({
      install: i.id,
      title: i.title,
      live: i.live,
      theme: i.presetId,
      ...(i.version !== null && { version: i.version }),
      page: installPage(ctx.store, i.id),
    })),
    themes: offered.map((d) => ({
      theme: d.id,
      title: d.title,
      summary: d.summary,
      presets: (d.presets ?? []).map((p) => ({ preset: p.key, name: p.name })),
      price: priceWords(charges.get(d.id) ?? { kind: "free" }),
      in_library: installedFrom.has(d.id),
    })),
    room: Math.max(0, INSTALLS_MAX - installs.length),
    page: designPage(ctx.store),
  };
}

async function offeredTheme(themeId: string, preset: string | null | undefined) {
  const theme = (await listOfferedDesigns()).find((d) => d.id === themeId) ?? fail("That theme is not on offer. Use a theme's id from list_themes.");
  if (preset && !(theme.presets ?? []).some((p) => p.key === preset)) {
    return fail(`${theme.title} has no preset "${preset}". Its presets are: ${(theme.presets ?? []).map((p) => p.key).join(", ") || "none"}.`);
  }
  return theme;
}

async function changeable(ctx: DesignToolContext) {
  const refusal = await lookChangeRefusal(ctx.store.id, ctx.account.id);
  if (refusal) fail(refusal);
}

/** `add_theme` (`website:write`, at once): adds a theme to the store's library without making it live, as *Add to my themes* does. */
export async function addThemeTool(ctx: DesignToolContext, args: AddThemeInput) {
  await offeredTheme(args.theme, args.preset);
  await changeable(ctx);
  const result = await installDesignPreset(ctx.store.id, args.theme, ctx.account.id, {}, args.preset ?? null);
  if (!result.ok) return fail(result.problems.join(" "));
  refresh(ctx);
  return {
    done: `Added "${result.title}" to the store's theme library. Visitors see nothing of it until it is made live.`,
    install: result.installId,
    try: previewPage(ctx.store, result.installId),
    page: installPage(ctx.store, result.installId),
    ...(result.notes.length > 0 && { notes: result.notes }),
  };
}

/** `try_theme` (`website:read`): where the person sees an installed theme on the store's own pages, and customises it, before it goes live. */
export async function tryThemeTool(ctx: DesignToolContext, args: { install: string }) {
  const install =
    (await listInstalls(ctx.store.id)).find((i) => i.id === args.install) ??
    fail("That theme is not installed in this store. Use an install's id from list_themes.");
  return {
    title: install.title,
    live: install.live,
    preview: previewPage(ctx.store, install.id),
    page: installPage(ctx.store, install.id),
    note: install.live
      ? "This theme is live: the store's own pages show it."
      : "The preview shows the store's own pages in this theme; nobody else sees it. Open it for the person (open_admin_page) rather than describing it.",
  };
}

type LivePlan = {
  title: string;
  charge: ThemeCharge;
  install: ThemeInstall | null;
  theme: string | null;
  preset: string | null;
  current: string | null;
};

/** What `make_theme_live` would do: the theme, what it costs now and the live theme it replaces; refused now for anything Design settings would refuse. */
async function planLive(ctx: DesignToolContext, args: MakeThemeLiveInput): Promise<LivePlan> {
  await changeable(ctx);
  const installs = await listInstalls(ctx.store.id);
  const current = installs.find((i) => i.live)?.title ?? null;
  if (args.install) {
    const install =
      installs.find((i) => i.id === args.install) ?? fail("That theme is not installed in this store. Use an install's id from list_themes.");
    if (install.live) fail(`"${install.title}" is live already.`);
    const charge = install.presetId ? await themeCharge(ctx.store.id, install.presetId) : ({ kind: "free" } as const);
    return {
      title: install.title,
      charge,
      install,
      theme: null,
      preset: null,
      current,
    };
  }
  const theme = await offeredTheme(args.theme ?? "", args.preset);
  if (installs.length >= INSTALLS_MAX) fail(INSTALLS_FULL);
  const preset = args.preset ? ((theme.presets ?? []).find((p) => p.key === args.preset)?.name ?? null) : null;
  return {
    title: preset ? `${theme.title} · ${preset}` : theme.title,
    charge: await themeCharge(ctx.store.id, theme.id),
    install: null,
    theme: theme.id,
    preset: args.preset ?? null,
    current,
  };
}

/**
 * `make_theme_live` (`website:write`, always after the owner's yes): switches to an installed theme or installs one and makes it live, through
 * `switchToInstall()` or `applyDesignPreset()`. A theme that costs money goes live only at the charge kept with the yes; anything else is
 * refused with the words Design settings uses, and nothing changes.
 */
export async function makeThemeLiveTool(ctx: DesignToolContext, args: MakeThemeLiveInput) {
  const plan = await planLive(ctx, args);
  if (chargeCosts(plan.charge) && args.approved_charge !== chargeKey(plan.charge)) fail(CHARGE_CHANGED);
  const token = chargeTokenFor(plan.charge);
  let title = plan.title;
  let notes: string[] = [];
  if (plan.install) {
    const result = await switchToInstall(ctx.store.id, plan.install.id, ctx.account.id, token);
    if (!result.ok) return fail(result.problems.join(" "));
    title = result.title;
    notes = result.notes;
  } else {
    const result = await applyDesignPreset(ctx.store.id, plan.theme ?? "", ctx.account.id, {}, plan.preset, token);
    if (!result.ok) return fail(result.problems.join(" "));
    notes = result.notes;
  }
  if (token) afterAnswer(() => chargeDueThemePurchases({ storeId: ctx.store.id }));
  refresh(ctx);
  return {
    done: `"${title}" is live.${plan.current ? ` "${plan.current}" is kept in the theme library and can be put back from Design settings.` : ""}`,
    page: designPage(ctx.store),
    ...(notes.length > 0 && { notes }),
  };
}

/** The design tools' checks before a call is kept for the owner's yes: what would be refused is refused now. */
export async function preflightDesignTool(ctx: DesignToolContext, name: string, input: unknown): Promise<void> {
  if (name === "make_theme_live") await planLive(ctx, input as MakeThemeLiveInput);
}

/**
 * What the owner is asked before a theme goes live, the charge it describes (kept with the call, a value the model passed replaced) and the
 * gate's category: a `spend` when it costs the store money, else `public`. Null when the call could not be read (the generic words stand).
 */
export async function liveApprovalDetails(
  ctx: DesignToolContext,
  args: MakeThemeLiveInput,
): Promise<{
  summary: string;
  category: GateCategory;
  args: Record<string, unknown>;
} | null> {
  try {
    const plan = await planLive(ctx, { ...args, approved_charge: undefined });
    return {
      summary: liveSummary(plan.title, plan.charge, plan.current),
      category: chargeCosts(plan.charge) ? "spend" : "public",
      args: { ...args, approved_charge: chargeKey(plan.charge) },
    };
  } catch {
    return null;
  }
}

/** Whether making this theme live would cost the store money, read before the autopilot decides (D309): null when it cannot be said. */
export async function liveCostsMoney(store: Store, account: Account, args: MakeThemeLiveInput): Promise<boolean | null> {
  try {
    return chargeCosts((await planLive({ account, store, invalidate: () => undefined }, args)).charge);
  } catch {
    return null;
  }
}
