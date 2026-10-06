"use client";

import { useState } from "react";

import type { DraftActionResponse } from "@/app/admin/(gated)/[store]/orders/drafts/actions";

import { DraftEditor, type DraftEditorProps } from "./draft-editor";
import { LinkNotice } from "./draft-send";
import { DraftSentPanel, type DraftSentActions } from "./draft-sent-panel";

type SentProps = Omit<Parameters<typeof DraftSentPanel>[0], "onResult" | "actions">;

/**
 * The draft page's body (wave 3, D173): the editor while the draft is open and the person may change orders, the read-only panel otherwise. It holds the one thing that must outlive a change of status: the link to share,
 * shown once when a send or a new link made one (the page re-renders as the draft becomes `sent`, and this component stays mounted, so the link is still on the screen until it is closed).
 */
export function DraftScreen({
  editable,
  editor,
  sent,
  sentActions,
}: {
  /** The editor is shown only for an open draft and a person who may change orders. */
  editable: boolean;
  editor: Omit<DraftEditorProps, "onResult">;
  sent: SentProps;
  sentActions: DraftSentActions;
}) {
  const [link, setLink] = useState<string | null>(null);
  const onResult = (result: DraftActionResponse) => {
    if (result.link) setLink(result.link);
  };
  return (
    <div className="flex flex-col gap-6">
      {link && <LinkNotice link={link} onClose={() => setLink(null)} />}
      {editable ? <DraftEditor {...editor} onResult={onResult} /> : <DraftSentPanel {...sent} actions={sentActions} onResult={onResult} />}
    </div>
  );
}
