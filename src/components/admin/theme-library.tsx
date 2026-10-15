import type { FormState } from "@/components/admin/action-form";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ButtonLink, Card, Chip, List, ListRow, RowActions, RowLead } from "@/components/admin/ui";

/** An installed theme as the library shows it (`ThemeInstall` in `src/server/theme-installs.ts`). */
export type LibraryInstall = { id: string; title: string; version: number | null; live: boolean; installedAt: string; switchedAt: string | null };

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
}: {
  installs: LibraryInstall[];
  /** The Design settings page's address, under which each theme's page and preview are (D244); none: no links. */
  base?: string;
  /** Null for someone who may only look. */
  switchTo: ((state: FormState, formData: FormData) => Promise<FormState>) | null;
  remove: ((state: FormState, formData: FormData) => Promise<FormState>) | null;
}) {
  return (
    <Card
      title="Theme library"
      description={
        <>
          The themes installed in your store. One is live; switching to another changes how your store looks at once and never touches your
          products, pages, words, pictures, videos, menus, logo or business details. The theme you switch away from keeps every change you
          made to it, so you can switch back.
        </>
      }
      compact
    >
      <List label="Installed themes">
        {installs.map((install) => (
          <ListRow key={install.id} highlight={install.live}>
            <RowLead
              title={install.title}
              sub={
                <>
                  {install.version !== null && <>Version {install.version} · </>}
                  {install.live ? "Live" : `Installed ${install.installedAt.slice(0, 10)}`}
                  {!install.live && install.switchedAt && <> · last live {install.switchedAt.slice(0, 10)}</>}
                </>
              }
            />
            {install.live ? (
              <RowActions>
                <Chip signal="positive" dot>
                  Live
                </Chip>
                {base && (
                  <ButtonLink href={`${base}/themes/${install.id}/preview`} target="_blank">
                    Preview<span className="sr-only"> {install.title}</span>
                  </ButtonLink>
                )}
              </RowActions>
            ) : (
              <RowActions>
                {base && (
                  <ButtonLink href={`${base}/themes/${install.id}`}>
                    {switchTo ? "Customise" : "Open"}
                    <span className="sr-only"> {install.title}</span>
                  </ButtonLink>
                )}
                {switchTo && (
                  <ActionForm action={switchTo}>
                    <input type="hidden" name="install" value={install.id} />
                    <SubmitButton variant="secondary">
                      Switch to<span className="sr-only"> {install.title}</span>
                    </SubmitButton>
                  </ActionForm>
                )}
                {remove && (
                  <details>
                    <summary className="flex min-h-10 cursor-pointer items-center rounded-pill px-3 text-sm underline-offset-2 hover:underline">
                      Remove<span className="sr-only"> {install.title}</span>…
                    </summary>
                    <div className="mt-2 flex max-w-xs flex-col gap-2 text-sm">
                      <p>
                        Removing {install.title} takes it out of your library. The header, footer and product layout pages it used stay in
                        your pages.
                      </p>
                      <ActionForm action={remove}>
                        <input type="hidden" name="install" value={install.id} />
                        <SubmitButton variant="secondary">Remove {install.title}</SubmitButton>
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
