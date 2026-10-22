import type { FormState } from "@/components/admin/action-form";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ButtonLink, Card, Chip, List, ListRow, RowActions, RowLead } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { chargeButton, chargeLine, chargeToken, type ThemeCharge } from "@/lib/theme-prices";

/**
 * An installed theme as the library shows it (`ThemeInstall` in `src/server/theme-installs.ts`), with what making it live costs the store
 * (D286; none: free).
 */
export type LibraryInstall = { id: string; title: string; version: number | null; live: boolean; installedAt: string; switchedAt: string | null; charge?: ThemeCharge };

/**
 * The store's theme library (D241, `docs/theme-phase-1.md`): the live theme and the others installed, each with *Switch to* and *Remove*.
 * Switching changes the look visitors see at once and nothing else; the theme put away keeps every change made to it. Server-drawn: the
 * removal's confirmation is a disclosure, so it works without JavaScript.
 */
export function ThemeLibrary({
  installs,
  switchTo,
  remove,
  base,
  lang = "en",
}: {
  installs: LibraryInstall[];
  /** The admin's language (D312 A7); English unless given. */
  lang?: AdminLang;
  /** The Design settings page's address, under which each theme's page and preview are (D244); none: no links. */
  base?: string;
  /** Null for someone who may only look. */
  switchTo: ((state: FormState, formData: FormData) => Promise<FormState>) | null;
  remove: ((state: FormState, formData: FormData) => Promise<FormState>) | null;
}) {
  const all = adminText(lang, "design");
  const { common: c, library: w } = all;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  return (
    <Card title={w.title} description={w.description} compact>
      <List label={w.label}>
        {installs.map((install) => (
          <ListRow key={install.id} highlight={install.live}>
            <RowLead
              title={install.title}
              sub={
                <>
                  {install.version !== null && <>{fillWords(c.version, { n: install.version })} · </>}
                  {install.live ? c.live : fillWords(w.installed, { date: install.installedAt.slice(0, 10) })}
                  {!install.live && install.switchedAt && fillWords(w.lastLive, { date: install.switchedAt.slice(0, 10) })}
                </>
              }
            />
            {install.live ? (
              <RowActions>
                <Chip signal="positive" dot>
                  {c.live}
                </Chip>
                {base && (
                  <ButtonLink href={`${base}/themes/${install.id}/preview`} target="_blank">
                    {c.preview}<span className="sr-only"> {install.title}</span>
                  </ButtonLink>
                )}
              </RowActions>
            ) : (
              <RowActions>
                {base && (
                  <ButtonLink href={`${base}/themes/${install.id}`}>
                    {switchTo ? c.customise : c.open}
                    <span className="sr-only"> {install.title}</span>
                  </ButtonLink>
                )}
                {switchTo &&
                  (install.charge && (install.charge.kind === "now" || install.charge.kind === "at_opening") ? (
                    // A premium theme the store does not have (D286): what it costs is said before the button that agrees to it.
                    <details>
                      <summary className="flex min-h-10 cursor-pointer items-center rounded-pill px-3 text-sm underline-offset-2 hover:underline">
                        {w.switchTo}<span className="sr-only"> {install.title}</span>…
                      </summary>
                      <div className="mt-2 flex max-w-xs flex-col gap-2 text-sm">
                        <p>{chargeLine(install.charge, all.charge, locale)}</p>
                        <ActionForm action={switchTo}>
                          <input type="hidden" name="install" value={install.id} />
                          {install.charge.kind === "now" && <input type="hidden" name="charge" value={chargeToken(install.charge.price)} />}
                          <SubmitButton>{chargeButton(install.charge, fillWords(w.switchToName, { name: install.title }), all.charge, locale)}</SubmitButton>
                        </ActionForm>
                      </div>
                    </details>
                  ) : (
                    <ActionForm action={switchTo}>
                      <input type="hidden" name="install" value={install.id} />
                      <SubmitButton variant="secondary">
                        {w.switchTo}<span className="sr-only"> {install.title}</span>
                      </SubmitButton>
                    </ActionForm>
                  ))}
                {remove && (
                  <details>
                    <summary className="flex min-h-10 cursor-pointer items-center rounded-pill px-3 text-sm underline-offset-2 hover:underline">
                      {c.remove}<span className="sr-only"> {install.title}</span>…
                    </summary>
                    <div className="mt-2 flex max-w-xs flex-col gap-2 text-sm">
                      <p>{fillWords(w.removeText, { name: install.title })}</p>
                      <ActionForm action={remove}>
                        <input type="hidden" name="install" value={install.id} />
                        <SubmitButton variant="secondary">{fillWords(w.removeName, { name: install.title })}</SubmitButton>
                      </ActionForm>
                    </div>
                  </details>
                )}
              </RowActions>
            )}
          </ListRow>
        ))}
      </List>
    </Card>
  );
}
