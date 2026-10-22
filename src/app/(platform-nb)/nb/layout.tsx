import { notFound } from "next/navigation";

import { offersLang } from "@/server/platform-lang-meta";

/** The Norwegian site exists only while it is offered (`platform_settings.locales`, D312): never half a site. */
export default async function NorwegianPages({ children }: { children: React.ReactNode }) {
  if (!(await offersLang("nb"))) notFound();
  return children;
}
