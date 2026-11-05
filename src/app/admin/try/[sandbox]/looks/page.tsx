import type { Metadata } from "next";

import { SubmitButton } from "@/components/admin/action-form";
import { ButtonLink, Card, Chip, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { sandboxHome } from "@/lib/sandbox";
import { isPremium, pricesText } from "@/lib/theme-prices";
import { cardPicture } from "@/lib/theme-store";
import { requestAdminLang } from "@/server/admin-request-lang";
import { listInstalls } from "@/server/theme-installs";
import { themeStoreCardsNow } from "@/server/theme-store";

import { sandboxUseLookAction } from "../actions";
import { sandboxOf } from "../sandbox";

export const metadata: Metadata = { title: "Try another look" };

const NOTES = ["used", "refused", "busy", "failed"] as const;
type Note = (typeof NOTES)[number];

/**
 * *Try another look* (D457 S4, `docs/builder-sandbox.md` 2): the theme store's themes, the one the sandbox wears marked; a free one is made
 * its look in one press (`sandboxUseLookAction()`), a premium one shown with its price and *Keep this store*, never switched to (D286).
 */
export default async function SandboxLooksPage({ params, searchParams }: PageProps<"/admin/try/[sandbox]/looks">) {
  const [{ sandbox: id }, query] = await Promise.all([params, searchParams]);
  const sandbox = await sandboxOf(id);
  if (!sandbox) return null;
  const [lang, themes, installs] = await Promise.all([requestAdminLang(), themeStoreCardsNow(), listInstalls(sandbox.store.id)]);
  const w = adminText(lang, "sandbox").looks;
  const live = installs.find((install) => install.live)?.presetId ?? null;
  const note = (NOTES as readonly string[]).includes(String(query.look)) ? (query.look as Note) : null;
  const home = sandboxHome(sandbox.id);
  return (
    <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-6 pt-6">
      <PageHeader
        title={w.title}
        description={w.lead}
        actions={
          <ButtonLink kind="secondary" size="header" href={home}>
            {w.back}
          </ButtonLink>
        }
      />
      {note && (
        <p role="status" className={`rounded-lg px-4 py-3 text-body ${note === "used" ? "bg-brand text-brand-ink" : "bg-card text-ink"}`}>
          {w[note]}
        </p>
      )}
      <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {themes.map((theme) => {
          const premium = isPremium(theme.prices ?? []);
          const picture = cardPicture(theme);
          return (
            <li key={theme.id}>
              <Card compact className="flex h-full flex-col gap-3">
                {picture ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a theme's picture from Kaizena Flow's media library
                  <img src={picture} alt="" loading="lazy" className="aspect-video w-full rounded-tile border border-line object-cover" />
                ) : (
                  <span aria-hidden className="flex aspect-video w-full items-end gap-2 rounded-tile border border-line p-5" style={{ background: theme.swatch.background }}>
                    <span className="h-8 w-20 rounded-full" style={{ background: theme.swatch.accent }} />
                    <span className="size-8 rounded-full" style={{ background: theme.swatch.text }} />
                  </span>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-title text-ink">{theme.title}</h2>
                  {theme.id === live && <Chip signal="positive">{w.current}</Chip>}
                </div>
                {theme.summary && <p className="text-body text-muted">{theme.summary}</p>}
                <p className="text-body text-muted">
                  {premium ? fillWords(w.premium, { price: pricesText(theme.prices ?? [], [], ADMIN_LANG_FACTS[lang].locale) }) : w.free}
                </p>
                <div className="mt-auto">
                  {theme.id === live ? null : premium ? (
                    <ButtonLink kind="secondary" href={`${home}/keep`}>
                      {w.keepToUse}
                    </ButtonLink>
                  ) : (
                    <form action={sandboxUseLookAction.bind(null, sandbox.id, theme.id)}>
                      <SubmitButton variant="secondary">{w.use}</SubmitButton>
                    </form>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
