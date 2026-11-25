import type { Metadata } from "next";
import { Suspense } from "react";

import { CanvaBackSignal } from "@/components/admin/canva-back";
import { FocusFrame } from "@/components/admin/ui/focus-frame";
import { CANVA_WORDS } from "@/lib/admin-words/canva";
import { requestAdminLang } from "@/server/admin-request-lang";

// Never in a search engine; its title stays fixed (in English), as a title read from the request would stream out of `<head>`.
export const metadata: Metadata = { title: CANVA_WORDS.en.back.title, robots: { index: false, follow: false }, referrer: "no-referrer" };

const EDIT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Where Canva's *Return* lands for an edit a picture field started (D898 C2, `CANVA_BACK`), and where a connect started from a field comes
 * back to. It shows nothing of the edit: it tells the field's tab, which asks its own signed-in route for the picture, and closes.
 */
export default function CanvaBackPage({ searchParams }: PageProps<"/admin/account/canva-back">) {
  return (
    <Suspense fallback={<FocusFrame />}>
      <CanvaBack searchParams={searchParams} />
    </Suspense>
  );
}

async function CanvaBack({ searchParams }: Pick<PageProps<"/admin/account/canva-back">, "searchParams">) {
  const query = await searchParams;
  const lang = await requestAdminLang();
  const w = CANVA_WORDS[lang];
  const edit = typeof query.edit === "string" && EDIT_ID.test(query.edit) ? query.edit : null;
  const outcome = query.canva === "connected" || query.canva === "declined" || query.canva === "failed" ? query.canva : null;
  return (
    <FocusFrame
      lang={lang}
      title={w.back.title}
      description={edit ? w.back.edit : outcome === "connected" ? w.back.connected : outcome ? w.outcome[outcome] : w.back.edit}
    >
      <CanvaBackSignal edit={edit} connected={edit ? null : outcome === null ? null : outcome === "connected"} />
    </FocusFrame>
  );
}
