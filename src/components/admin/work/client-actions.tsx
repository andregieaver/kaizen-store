"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { archiveClientAction, deleteClientAction } from "@/app/admin/(gated)/[store]/work/actions";
import type { WorkClient } from "@/server/work";

import { Modal } from "../modal";
import { AssignmentForm, type AssignmentFormProps } from "./assignment-form";
import { ClientForm, type ClientFormProps } from "./client-form";
import { Problems, dangerLink, primaryButton, secondaryButton } from "./work-parts";

/** A button that opens a form in a dialog; the form is given a way to close it. */
export function FormDialogButton({
  label,
  title,
  primary = false,
  wide = true,
  children,
}: {
  label: string;
  title: string;
  primary?: boolean;
  wide?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={primary ? primaryButton : secondaryButton}>
        {label}
      </button>
      <Modal open={open} onClose={close} title={title} wide={wide}>
        {children(close)}
      </Modal>
    </>
  );
}

type ClientFormShared = Omit<ClientFormProps, "client" | "onDone" | "onCancel">;

/** "New client": the form in a dialog, then the client's own page. */
export function NewClientButton(props: ClientFormShared) {
  const router = useRouter();
  return (
    <FormDialogButton label="New client" title="New client" primary>
      {(close) => (
        <ClientForm
          {...props}
          onCancel={close}
          onDone={(id) => {
            close();
            router.push(`/admin/${props.storeSlug}/work/clients/${id}`);
          }}
        />
      )}
    </FormDialogButton>
  );
}

/** "Edit client": the form in a dialog. Saving refreshes the page behind it. */
export function EditClientButton({ client, ...props }: ClientFormShared & { client: WorkClient }) {
  return (
    <FormDialogButton label="Edit client" title={`Edit ${client.name}`}>
      {(close) => <ClientForm {...props} client={client} onCancel={close} onDone={close} />}
    </FormDialogButton>
  );
}

/** "New assignment": the form in a dialog, then the assignment's page. */
export function NewAssignmentButton(props: Omit<AssignmentFormProps, "assignment" | "onDone" | "onCancel" | "moveTo">) {
  const router = useRouter();
  return (
    <FormDialogButton label="New assignment" title="New assignment" primary>
      {(close) => (
        <AssignmentForm
          {...props}
          onCancel={close}
          onDone={(id) => {
            close();
            router.push(`/admin/${props.storeSlug}/work/assignments/${id}`);
          }}
        />
      )}
    </FormDialogButton>
  );
}

/** "Edit assignment": the form in a dialog. */
export function EditAssignmentButton(
  props: Omit<AssignmentFormProps, "onDone" | "onCancel"> & {
    assignment: NonNullable<AssignmentFormProps["assignment"]>;
  },
) {
  return (
    <FormDialogButton label="Edit assignment" title={`Edit ${props.assignment.name}`}>
      {(close) => <AssignmentForm {...props} onCancel={close} onDone={close} />}
    </FormDialogButton>
  );
}

/** Archives a client, or brings it back. Archived clients leave the lists and take no new assignments; nothing is lost. */
export function ArchiveClientButton({
  storeSlug,
  clientId,
  archived,
}: {
  storeSlug: string;
  clientId: string;
  archived: boolean;
}) {
  const [pending, start] = useTransition();
  const [problems, setProblems] = useState<string[]>([]);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              const result = await archiveClientAction(storeSlug, clientId, !archived);
              setProblems(result.ok ? [] : result.problems);
            } catch {
              setProblems(["That did not work. Check your connection and try again."]);
            }
          })
        }
        className={secondaryButton}
      >
        {pending ? "Working …" : archived ? "Bring back" : "Archive"}
        <span className="sr-only"> this client</span>
      </button>
      <Problems messages={problems} />
    </div>
  );
}

/**
 * Deletes a client that has no history. Anything with assignments or invoices
 * is refused by the server, whose reason is shown; archive it instead.
 */
export function DeleteClientButton({
  storeSlug,
  clientId,
  name,
}: {
  storeSlug: string;
  clientId: string;
  name: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problems, setProblems] = useState<string[]>([]);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (
            !window.confirm(
              `Delete ${name}? This cannot be undone. A client with assignments or invoices cannot be deleted: archive it instead.`,
            )
          )
            return;
          start(async () => {
            try {
              const result = await deleteClientAction(storeSlug, clientId);
              if (result.ok) router.push(`/admin/${storeSlug}/work/clients`);
              else setProblems(result.problems);
            } catch {
              setProblems(["That did not work. Check your connection and try again."]);
            }
          });
        }}
        className={dangerLink}
      >
        {pending ? "Deleting …" : "Delete client"}
      </button>
      <Problems messages={problems} />
    </div>
  );
}
