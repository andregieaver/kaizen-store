"use client";

import { useEffect, type ReactNode } from "react";

import { Modal } from "../modal";
import { Button } from "./button";

/**
 * `ConfirmButton`'s question (code review step 1.12, D818), in the admin's dialog: the question's first sentence as the title, the rest
 * under it, then *Cancel* (focused, as the safe choice; Escape and the backdrop do the same) and the confirm word. Loaded only when a
 * confirm button is near being pressed, so no screen's first scripts carry the dialog.
 */
export default function ConfirmDialog({
  title,
  detail,
  more,
  confirm,
  cancel,
  danger,
  onCancel,
  onConfirm,
}: {
  title: string;
  detail: string;
  more?: ReactNode;
  confirm: string;
  cancel: string;
  danger: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // The dialog opens in its layout effect; focus then moves from its title bar to the safe choice.
  useEffect(() => document.querySelector<HTMLButtonElement>("dialog[open] [data-confirm-cancel]")?.focus(), []);
  return (
    <Modal
      open
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button onClick={onCancel} data-confirm-cancel="">
            {cancel}
          </Button>
          <Button kind={danger ? "danger" : "main"} onClick={onConfirm} data-confirm-yes="">
            {confirm}
          </Button>
        </>
      }
    >
      {detail || more ? (
        <div className="flex flex-col gap-2 text-sm text-ink-2">
          {detail && <p>{detail}</p>}
          {more}
        </div>
      ) : null}
    </Modal>
  );
}
