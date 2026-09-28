import Link from "next/link";

import { PageStudio, type StudioActions } from "./page-studio";

/** The AI page studio's page (D92), a store's or Kaizen's: what it does, and the studio. */
export function PageStudioView({
  actions,
  language,
  abilities,
  pagesHref,
  settingsHref,
}: {
  actions: StudioActions;
  language: string;
  abilities: { text: boolean; pictures: boolean; hear: boolean; speak: boolean };
  pagesHref: string;
  settingsHref: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={pagesHref} className="text-sm underline">
          Pages
        </Link>
        <h1 className="text-2xl font-semibold">Create a page with AI</h1>
        <p className="max-w-3xl text-sm text-muted">
          Tell the AI what the page is for. It asks a few questions, plans the page with you, then writes it with the page builder&apos;s
          components, makes its pictures and saves it as a draft for you to look over, change and publish. It writes only what the site and you
          tell it: no prices, stock, reviews or claims it cannot back up.
        </p>
      </div>
      <PageStudio actions={actions} language={language} abilities={abilities} editBase={pagesHref} settingsHref={settingsHref} />
    </div>
  );
}
