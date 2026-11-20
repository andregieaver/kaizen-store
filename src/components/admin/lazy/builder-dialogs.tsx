"use client";

import dynamic from "next/dynamic";
import { useState, type ComponentType } from "react";

/**
 * The page editor's dialogs, loaded when first opened (bloat review step 2.30, code review FB8): a route loads every client component its
 * modules import, so the builder carried twelve dialogs in its first scripts that most visits never open. Each is a `next/dynamic` stand-in
 * drawn in the browser only (`ssr: false`), and drawn at all only from its first opening (`drawnOnceOpened()`); from then it stays mounted, as
 * before, so a dialog that keeps a draft while closed (the AI change's description, find and replace's words) keeps it, and `<dialog>` gives
 * the focus back on close. `warmBuilderDialogs()` fetches every chunk when the builder is idle after its first paint, so a press finds it there.
 * The `import()` stays inside `dynamic()`. `page-editor.tsx` and `page-builder.tsx` import the dialogs only from here
 * (`admin-bundle.scan.test.ts`).
 */
function drawnOnceOpened<P extends object>(View: ComponentType<P>, isOpen: (props: P) => boolean) {
  function OnceOpened(props: P) {
    const open = isOpen(props);
    const [opened, setOpened] = useState(open);
    if (open && !opened) setOpened(true);
    return opened || open ? <View {...props} /> : null;
  }
  return OnceOpened;
}

const none = () => null;

export const DualOpenDialog = drawnOnceOpened(
  dynamic(() => import("../dual-page-dialogs").then((m) => m.DualOpenDialog), { ssr: false, loading: none }),
  (props) => props.open,
);
export const DualCreateDialog = drawnOnceOpened(
  dynamic(() => import("../dual-page-dialogs").then((m) => m.DualCreateDialog), { ssr: false, loading: none }),
  (props) => props.open,
);
export const MakeCoolDialog = drawnOnceOpened(
  dynamic(() => import("../make-cool-dialog").then((m) => m.MakeCoolDialog), { ssr: false, loading: none }),
  (props) => props.open,
);
export const AiChangeDialog = drawnOnceOpened(
  dynamic(() => import("../ai-change-dialog").then((m) => m.AiChangeDialog), { ssr: false, loading: none }),
  (props) => props.open,
);
export const FindReplaceDialog = drawnOnceOpened(
  dynamic(() => import("../find-replace-dialog").then((m) => m.FindReplaceDialog), { ssr: false, loading: none }),
  (props) => props.open,
);
export const PageVersionsDialog = drawnOnceOpened(
  dynamic(() => import("../page-versions-dialog").then((m) => m.PageVersionsDialog), { ssr: false, loading: none }),
  (props) => props.open,
);
export const SaveTemplateDialog = drawnOnceOpened(
  dynamic(() => import("../save-template-dialog").then((m) => m.SaveTemplateDialog), { ssr: false, loading: none }),
  (props) => props.open,
);
/** Drawn only while a publish waits on its issues: open whenever it is drawn. */
export const PublishWithIssuesDialog = dynamic(() => import("../page-issues-panel").then((m) => m.PublishWithIssuesDialog), {
  ssr: false,
  loading: none,
});
export const TemplatesModal = drawnOnceOpened(
  dynamic(() => import("../templates-modal").then((m) => m.TemplatesModal), { ssr: false, loading: none }),
  (props) => props.open,
);
export const ApplyLayoutDialog = drawnOnceOpened(
  dynamic(() => import("../templates-apply").then((m) => m.ApplyLayoutDialog), { ssr: false, loading: none }),
  (props) => props.pending !== null,
);
export const TemplatePreviewDialog = drawnOnceOpened(
  dynamic(() => import("../templates-preview").then((m) => m.TemplatePreviewDialog), { ssr: false, loading: none }),
  (props) => props.item !== null,
);
/** Drawn only while a saved page layout is open: open whenever it is drawn. */
export const SavedLayoutDialog = dynamic(() => import("../saved-layout-dialog").then((m) => m.SavedLayoutDialog), {
  ssr: false,
  loading: none,
});

let warmed: Promise<unknown> | null = null;
/** Fetches the dialogs' chunks ahead of a press (once); a failed fetch is forgotten so the press itself asks again. */
export function warmBuilderDialogs(): void {
  warmed ??= Promise.all([
    import("../dual-page-dialogs"),
    import("../make-cool-dialog"),
    import("../ai-change-dialog"),
    import("../find-replace-dialog"),
    import("../page-versions-dialog"),
    import("../save-template-dialog"),
    import("../page-issues-panel"),
    import("../templates-modal"),
    import("../templates-apply"),
    import("../templates-preview"),
    import("../saved-layout-dialog"),
  ]).catch(() => {
    warmed = null;
  });
}
