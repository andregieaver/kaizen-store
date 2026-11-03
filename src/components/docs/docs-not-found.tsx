import { docsPath } from "@/lib/docs-host";
import type { PlatformLang } from "@/lib/platform-lang";
import { platformText } from "@/lib/platform-text";

import { DocsShell, DocsTopBar } from "./docs-frame";

/** An address under the docs that is not a page (D442), in the docs' own frame and language. */
export function DocsNotFound({ lang }: { lang: PlatformLang }) {
  const words = platformText(lang).docs;
  return (
    <DocsShell words={words} top={<DocsTopBar lang={lang} track={null} words={words} languages={[]} />}>
      <h1 className="text-3xl font-semibold tracking-tight">{words.notFound.title}</h1>
      <p className="mt-3 text-lg text-muted">{words.notFound.lead}</p>
      <p className="mt-6">
        <a href={docsPath("", lang)} className="inline-flex min-h-11 items-center underline underline-offset-2 hover:no-underline">
          {words.notFound.home}
        </a>
      </p>
    </DocsShell>
  );
}
