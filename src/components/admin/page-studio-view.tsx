"use client";


import type { ReplicaJob } from "@/lib/replicate";
import { PageHeader } from "@/components/admin/ui";

import { useAdminText } from "./admin-text";

import { PageStudio, type StudioActions } from "./page-studio";
import { ReplicatePanel } from "./replicate-panel";

/** The AI page studio's page (D92), a store's or Kaizen's: what it does, and the studio. */
export function PageStudioView({
  actions,
  language,
  abilities,
  pagesHref,
  settingsHref,
  replicate,
}: {
  actions: StudioActions;
  language: string;
  abilities: { text: boolean; sees: boolean; pictures: boolean; hear: boolean; speak: boolean };
  pagesHref: string;
  settingsHref: string;
  /** A store's copying of other websites' pages (D150); none on Kaizen's own studio. */
  replicate?: { storeSlug: string; initial: ReplicaJob | null };
}) {
  const w = useAdminText("website").studio;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: pagesHref, label: w.back }} title={w.title} description={w.description} />
      {replicate && <ReplicatePanel storeSlug={replicate.storeSlug} initial={replicate.initial} pagesHref={pagesHref} aiSees={abilities.sees} settingsHref={settingsHref} />}
      <PageStudio actions={actions} language={language} abilities={abilities} editBase={pagesHref} settingsHref={settingsHref} />
    </div>
  );
}
