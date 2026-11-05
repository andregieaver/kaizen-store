import Link from "next/link";

import { ButtonLink, Chip, FocusFrame } from "@/components/admin/ui";
import { countWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import { SANDBOX_PATH, daysLeft, sandboxHome } from "@/lib/sandbox";
import { requestAdminLang } from "@/server/admin-request-lang";

import { startOverAction } from "./actions";
import { sandboxOf } from "./sandbox";
import { StartOver } from "./start-over";

/**
 * One sandbox (D457): its bar on every page (the store's home, that only the visitor sees it, the days left, *Start over*) above the page,
 * which uses the whole width as the store's editors do. A sandbox the pass does not open (ended, started over, another browser's) says so
 * and offers a new one, the same words whatever the reason.
 */
export default async function SandboxLayout({ children, params }: LayoutProps<"/admin/try/[sandbox]">) {
  const { sandbox: id } = await params;
  const [lang, sandbox] = await Promise.all([requestAdminLang(), sandboxOf(id)]);
  const w = adminText(lang, "sandbox");
  if (!sandbox) {
    return (
      <FocusFrame title={w.ended.title} description={w.ended.lead} lang={lang}>
        <ButtonLink kind="main" full href={SANDBOX_PATH}>
          {w.ended.startAgain}
        </ButtonLink>
      </FocusFrame>
    );
  }
  const left = daysLeft(new Date(sandbox.expiresAt), new Date());
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header data-sandbox-bar className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-card px-4 py-2 md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link href={sandboxHome(sandbox.id)} className="flex items-center gap-3 text-body-strong text-ink">
            <span aria-hidden className="flex size-8 items-center justify-center rounded-tile bg-brand text-body-strong text-brand-ink">
              K
            </span>
            {w.bar.home}
          </Link>
          <Chip signal="insight">{w.bar.label}</Chip>
          <span className="text-body text-muted">{w.bar.privateNote}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-body text-muted">{left <= 1 ? w.bar.lastDay : countWords(left, w.bar.daysLeft)}</span>
          <StartOver action={startOverAction.bind(null, sandbox.id)} label={w.bar.startOver} confirm={w.bar.startOverConfirm} />
        </div>
      </header>
      <main id="admin-main" tabIndex={-1} data-admin-layout="workspace" className="flex w-full min-w-0 flex-1 flex-col px-4 pt-2 pb-10 md:px-6">
        {children}
      </main>
    </div>
  );
}
