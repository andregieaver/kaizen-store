import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card, Chip, List, ListRow, PageHeader, RowActions, RowLead } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { presetChoice } from "@/lib/design-variations";
import { themeTryPath } from "@/lib/theme-store";
import { getAccount, listStores } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
import { storesWithTheme } from "@/server/theme-installs";
import { themeStorePage } from "@/server/theme-store";
import { platformText } from "@/lib/platform-text";
import { pricesText } from "@/lib/theme-prices";

import { installThemeAction } from "../../../../../[store]/settings/design/actions";

export const metadata: Metadata = { title: "Try a theme in your store", robots: { index: false } };

/**
 * *Try it in your store* from the theme store (`docs/theme-phase-3.md` step 2): someone not signed in signs in and comes back; then each
 * store where they may change the website offers to add the theme to its theme library without making it live (`installDesignPreset()`
 * through the store's own `installThemeAction`, which asks `website:write` again), and opens it there to preview and customise (D244).
 * Visitors see nothing of it until the store switches.
 */
export default async function TryThemePage({ params, searchParams }: PageProps<"/admin/account/themes/try/[theme]">) {
  await connection();
  const { theme: slug } = await params;
  const asked = presetChoice((await searchParams).preset);
  const account = await getAccount();
  if (!account) redirect(`/admin/sign-in?next=${encodeURIComponent(themeTryPath(slug, asked))}`);
  const theme = await themeStorePage(slug);
  if (!theme) notFound();
  const lang = adminLangOf(account.adminLocale);
  const { common: c, tryTheme: w } = adminText(lang, "design");
  // One of its presets (`docs/theme-showcase-phase-1.md`), chosen on the theme's page or here; one it does not have is its own look.
  const preset = theme.presets.find((p) => p.key === asked) ?? null;
  const name = preset ? fillWords(c.lookName, { theme: theme.title, preset: preset.name }) : theme.title;

  const stores = (await Promise.all((await listStores(account)).map(async (store) => ((await checkPermission(store.slug, "website:write")) ? store : null)))).filter(
    (store) => store !== null,
  );
  const installed = await storesWithTheme(theme.id, stores.map((store) => store.slug));

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader
        back={{ href: `/themes/${theme.slug}`, label: theme.title }}
        title={fillWords(w.title, { name })}
        description={w.description}
      />
      {theme.prices && theme.prices.length > 0 && (
        <p className="rounded-panel border border-line bg-card p-4 text-sm" data-theme-price="">
          {fillWords(w.premium, { name, price: platformText(lang).themeStore.priceLine(pricesText(theme.prices, [], ADMIN_LANG_FACTS[lang].locale)) })}
        </p>
      )}
      {theme.presets.length > 0 && (
        <Card title={w.choosePreset} description={w.presetsHint}>
          <nav aria-label={w.presetsLabel} className="flex flex-wrap gap-2">
            {[null, ...theme.presets].map((choice) => (
              <a
                key={choice?.key ?? ""}
                href={themeTryPath(theme.slug, choice?.key ?? null)}
                aria-current={(choice?.key ?? null) === (preset?.key ?? null) ? "page" : undefined}
                className="flex min-h-10 items-center rounded-pill border border-edge px-4 text-sm hover:bg-sunken aria-[current=page]:border-brand aria-[current=page]:bg-sunken"
              >
                {choice ? choice.name : theme.title}
              </a>
            ))}
          </nav>
        </Card>
      )}
      <Card title={w.chooseStore}>
        {stores.length === 0 ? (
          <p className="text-sm text-muted">{w.noStore}</p>
        ) : (
          <List>
            {stores.map((store) => (
              <ListRow key={store.slug}>
                <RowLead title={store.name} sub={installed.has(store.slug) ? <Chip>{w.already}</Chip> : undefined} />
                <RowActions>
                  <ActionForm action={installThemeAction.bind(null, store.slug)}>
                    <input type="hidden" name="design" value={theme.id} />
                    {preset && <input type="hidden" name="preset" value={preset.key} />}
                    <SubmitButton variant={installed.has(store.slug) ? "secondary" : "primary"}>
                      {installed.has(store.slug) ? w.addAnother : w.addHere}
                      <span className="sr-only"> ({store.name})</span>
                    </SubmitButton>
                  </ActionForm>
                </RowActions>
              </ListRow>
            ))}
          </List>
        )}
      </Card>
    </div>
  );
}
