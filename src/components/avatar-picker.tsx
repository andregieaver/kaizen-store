"use client";

import { useState, useTransition } from "react";

import { Avatar } from "@/components/avatar";
import type { AvatarView } from "@/lib/avatar";
import { squarePicture } from "@/lib/image-resize";

export type AvatarPickerState = { ok: boolean; message: string | null };

/** Sends `picture` (a small square) to set it, or `remove=1` to take it away. */
export type AvatarAction = (form: FormData) => Promise<AvatarPickerState>;

/**
 * Chooses, crops and uploads a profile picture (D97), or takes it away;
 * shared by Your account in the admin and My account in stores. The action
 * refreshes the page, which then shows the new picture.
 */
export function AvatarPicker({
  avatar,
  ownPicture,
  action,
  labels,
  avatarClassName,
  buttonClassName = "min-h-10 rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-surface",
}: {
  avatar: AvatarView;
  /** Whether they have uploaded one (rather than showing Gravatar or initials). */
  ownPicture: boolean;
  action: AvatarAction;
  labels: { choose: string; change: string; remove: string; working: string; hint: string; unreadable: string };
  avatarClassName?: string;
  buttonClassName?: string;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<AvatarPickerState>({ ok: false, message: null });

  const send = (form: FormData) =>
    start(async () => {
      setState(await action(form));
    });

  const choose = (file: File | undefined) => {
    if (!file) return;
    start(async () => {
      let picture: Blob;
      try {
        picture = await squarePicture(file, 256);
      } catch {
        setState({ ok: false, message: labels.unreadable });
        return;
      }
      const form = new FormData();
      form.set("picture", new File([picture], picture.type === "image/webp" ? "avatar.webp" : "avatar.jpg", { type: picture.type }));
      setState(await action(form));
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar avatar={avatar} size={72} className={avatarClassName} />
        <div className="flex flex-wrap gap-2">
          <label className={`inline-flex cursor-pointer items-center focus-within:outline-2 ${buttonClassName} ${pending ? "opacity-60" : ""}`}>
            {pending ? labels.working : ownPicture ? labels.change : labels.choose}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/avif"
              className="sr-only"
              disabled={pending}
              onChange={(event) => {
                choose(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          {ownPicture && (
            <button
              type="button"
              disabled={pending}
              className={buttonClassName}
              onClick={() => {
                const form = new FormData();
                form.set("remove", "1");
                send(form);
              }}
            >
              {labels.remove}
            </button>
          )}
        </div>
      </div>
      <p className="text-sm text-muted">{labels.hint}</p>
      <p role="status" aria-live="polite" className={`text-sm empty:hidden ${state.ok ? "" : "text-red-700 dark:text-red-400"}`}>
        {state.message}
      </p>
    </div>
  );
}
