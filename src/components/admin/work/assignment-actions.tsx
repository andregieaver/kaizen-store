"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteAssignmentAction, setAssignmentStatusAction } from "@/app/admin/(gated)/(owner)/account/work/s/[store]/actions";
import { ASSIGNMENT_STATUS_LABELS } from "@/lib/work-ui";

import { Field, Problems, dangerLink, smallControl } from "./work-parts";
import { workBase } from "@/lib/work-paths";
import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";

type Status = keyof typeof ASSIGNMENT_STATUS_LABELS;

/**
 * Moves an assignment between active, paused and done. Any way round: a
 * finished assignment can be reopened. A timer running on it is left running
 * for its owner to stop.
 */
export function AssignmentStatusControl({
  storeSlug,
  assignmentId,
  status,
}: {
  storeSlug: string;
  assignmentId: string;
  status: Status;
}) {
  const tw = useAdminText("work").assignmentActions;
  const tl = useAdminText("work").labels;
  const [pending, start] = useTransition();
  const [shown, setShown] = useState(status);
  const [seen, setSeen] = useState(status);
  const [problems, setProblems] = useState<string[]>([]);
  if (status !== seen) {
    setSeen(status);
    setShown(status);
  }
  return (
    <div className="flex flex-col gap-1">
      <Field label={tw.status}>
        {(props) => (
          <select
            {...props}
            value={shown}
            disabled={pending}
            onChange={(event) => {
              const next = event.target.value as Status;
              setShown(next);
              start(async () => {
                try {
                  const result = await setAssignmentStatusAction(storeSlug, assignmentId, next);
                  if (result.ok) setProblems([]);
                  else {
                    setProblems(result.problems);
                    setShown(status);
                  }
                } catch {
                  setProblems([tw.theStatusCouldNot]);
                  setShown(status);
                }
              });
            }}
            className={`${smallControl} min-h-10`}
          >
            {(Object.keys(ASSIGNMENT_STATUS_LABELS) as Status[]).map((value) => (
              <option key={value} value={value}>
                {tl.assignmentStatus[value]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Problems messages={problems} />
    </div>
  );
}

/**
 * Deletes an assignment nobody has worked on or invoiced. One with time,
 * invoices or a running timer is refused by the server, whose reason is shown:
 * mark it done instead.
 */
export function DeleteAssignmentButton({
  storeSlug,
  assignmentId,
  clientId,
  name,
}: {
  storeSlug: string;
  assignmentId: string;
  clientId: string;
  name: string;
}) {
  const tw = useAdminText("work").assignmentActions;
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
              fillWords(tw.deleteConfirm, { name }),
            )
          )
            return;
          start(async () => {
            try {
              const result = await deleteAssignmentAction(storeSlug, assignmentId);
              if (result.ok) router.push(`${workBase(storeSlug)}/clients/${clientId}`);
              else setProblems(result.problems);
            } catch {
              setProblems([tw.thatDidNotWork]);
            }
          });
        }}
        className={dangerLink}
      >
        {pending ? tw.deleting : tw.deleteAssignment}
      </button>
      <Problems messages={problems} />
    </div>
  );
}
