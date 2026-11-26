"use client";

import { useId, useState } from "react";

import { Button } from "@/components/admin/ui/button";
import { Field, TextInput } from "@/components/admin/ui/field";
import { fillWords } from "@/lib/admin-fill";
import type { ProjectsMessages } from "@/lib/admin-messages/projects.en";
import type { ProjectsOpInput, ProjectsAnswer } from "@/lib/projects-ops";
import { formatDuration, parseDuration } from "@/lib/work-time";

/** What a list on a Work assignment gives its task's editor (D904 P8.3d). */
export type TaskTimeFacts = { minutes: number; canLog: boolean; today: string };

/**
 * The time on a task of a list whose time goes to a Work assignment (D904 P8.3d): how much is logged on it, and, for someone who may log
 * time in Work, *Log time* with the time spent (typed as Work's own form reads it: 1:30, 1h 30m, 90) and the day, today unless changed.
 * The entry is Work's, on the list's assignment and noted with the task's title.
 */
export function TaskTime({
  itemId,
  facts,
  words,
  fieldWords,
  run,
  pending,
}: {
  itemId: string;
  facts: TaskTimeFacts;
  words: ProjectsMessages["work"];
  fieldWords: Pick<ProjectsMessages["fieldProblems"], "minutes">;
  run: (op: ProjectsOpInput, then?: (answer: ProjectsAnswer) => void) => void;
  pending: boolean;
}) {
  const [spent, setSpent] = useState("");
  const [day, setDay] = useState(facts.today);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const hintId = useId();

  return (
    <section aria-labelledby={`time-${itemId}`} className="flex flex-col gap-2" data-task-time>
      <h3 id={`time-${itemId}`} className="text-body-strong text-ink">
        {words.time}
      </h3>
      <p className="text-sm text-ink-2 tabular-nums">{facts.minutes > 0 ? fillWords(words.logged, { time: formatDuration(facts.minutes) }) : words.noTime}</p>
      {facts.canLog && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const read = parseDuration(spent);
            if (!read.ok) {
              setProblem(fieldWords.minutes);
              return;
            }
            setProblem(null);
            run({ op: "item.logTime", itemId, minutes: read.minutes, workDate: day && day !== facts.today ? day : null }, (answer) => {
              if (!answer.ok) return;
              setSpent("");
              setSaid(words.done);
            });
          }}
        >
          <Field label={words.spent} problem={problem} className="w-40">
            {(control) => (
              <TextInput
                {...control}
                aria-describedby={[control["aria-describedby"], hintId].filter(Boolean).join(" ")}
                value={spent}
                onChange={(e) => setSpent(e.target.value)}
                autoComplete="off"
                full
              />
            )}
          </Field>
          <Field label={words.on} className="w-44">
            {(control) => <TextInput {...control} type="date" value={day} max={facts.today} onChange={(e) => setDay(e.target.value)} full />}
          </Field>
          <Button type="submit" disabled={pending || !spent.trim()}>
            {words.log}
          </Button>
          {/* Below the row, so the fields and the button stay on one line. */}
          <p id={hintId} className="w-full text-caption text-muted">
            {words.spentHint}
          </p>
        </form>
      )}
      <p role="status" aria-live="polite" className="text-sm text-positive-text">
        {said}
      </p>
    </section>
  );
}
