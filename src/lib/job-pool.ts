/**
 * Runs tasks a few at a time (bloat review step 0.45). The five-minute dispatcher used to start every job at once on a pool of five
 * database connections that waits five seconds for one, so the first slow job made others fail with "timeout exceeded when trying to
 * connect". Here at most `lanes` tasks that have run for less than `laneMs` hold a lane; a task that passes `laneMs` gives its lane to
 * the next task and goes on running, and its promise stays in the results. Step 3.3 of the bloat review adds cadences and time budgets
 * on top of this.
 *
 * The answers come back in the tasks' order. A task that rejects makes the returned promise reject, as `Promise.all` did (the
 * dispatcher's tasks never reject: `tracked()` catches); a task that never settles means the returned promise never settles, but every
 * other task is still started and finished.
 */
export async function pooled<T>(
  tasks: readonly (() => Promise<T>)[],
  options: { lanes: number; laneMs: number; onLaneGivenUp?: (index: number) => void },
): Promise<T[]> {
  const results: Promise<T>[] = [];
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < tasks.length) {
      const i = next++;
      const run = Promise.resolve().then(tasks[i]);
      results[i] = run;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settled = run.then(
        () => "done" as const,
        () => "done" as const,
      );
      const late = new Promise<"late">((resolve) => {
        timer = setTimeout(() => resolve("late"), options.laneMs);
      });
      const first = await Promise.race([settled, late]);
      clearTimeout(timer);
      if (first === "late") options.onLaneGivenUp?.(i);
    }
  };
  const lanes = Math.max(1, Math.min(options.lanes, tasks.length));
  await Promise.all(Array.from({ length: lanes }, lane));
  return Promise.all(results);
}
