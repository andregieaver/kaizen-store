"use client";

import { useState, useTransition } from "react";

import { fillWords } from "@/lib/admin-fill";
import { APP_GATES, type AppGate } from "@/lib/custom-apps";

import { useAdminText } from "./admin-text";
import { Button, Chip, List, ListRow, RowLead } from "./ui";

type Answer = { ok: true } | { ok: false; message: string };
type AsyncAnswer = Promise<Answer>;

export type CustomAppView = {
  id: string;
  name: string;
  endpointHint: string;
  tokenHint: string | null;
  tools: { name: string; description: string }[];
  switched: Record<string, AppGate>;
  calls: number;
  failed: number;
  problem: string | null;
};

/** Adds an owner's own app (D363): its MCP endpoint and token; its tools are read at once. */
export function AddCustomApp({ add }: { add: (form: FormData) => AsyncAnswer }) {
  const w = useAdminText("notifications").customApps;
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";
  return (
    <form
      key={key}
      aria-busy={pending}
      className="flex flex-col gap-3"
      action={(form) =>
        start(async () => {
          const answer = await add(form);
          if (answer.ok) {
            setProblem(null);
            setKey((k) => k + 1);
          } else setProblem(answer.message);
        })
      }
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        {w.name}
        <input name="name" required maxLength={60} placeholder={w.namePlaceholder} className={control} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {w.endpoint}
        <input name="endpoint" type="url" required maxLength={500} placeholder={w.endpointPlaceholder} className={control} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {w.token}
        <input name="token" type="password" maxLength={2000} autoComplete="off" className={control} />
      </label>
      <div>
        <Button type="submit" kind="main" disabled={pending}>
          {pending ? w.adding : w.add}
        </Button>
      </div>
      {problem && (
        <p role="alert" className="text-sm text-danger-text">
          {problem}
        </p>
      )}
    </form>
  );
}

/** One app: its tools, each off or on with how it runs, and Read again and Remove. */
export function CustomAppCard({
  app,
  actions,
}: {
  app: CustomAppView;
  actions: { switchTool: (tool: string, gate: string) => AsyncAnswer; relist: () => AsyncAnswer; remove: () => AsyncAnswer };
}) {
  const w = useAdminText("notifications").customApps;
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const run = (work: () => AsyncAnswer) =>
    start(async () => {
      const answer = await work();
      setProblem(answer.ok ? null : answer.message);
    });
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4 first:border-0 first:pt-0" aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <RowLead
          title={app.name}
          sub={[app.endpointHint, app.tokenHint ? fillWords(w.tokenEnds, { hint: app.tokenHint }) : null, fillWords(w.calls, { calls: app.calls, failed: app.failed })].filter(Boolean).join(" · ")}
        />
        <div className="flex gap-1">
          <Button kind="quiet" size="dense" disabled={pending} onClick={() => run(actions.relist)}>
            {w.relist}
          </Button>
          <Button
            kind="quiet"
            size="dense"
            disabled={pending}
            onClick={() => {
              if (window.confirm(fillWords(w.removeQuestion, { name: app.name }))) run(actions.remove);
            }}
          >
            {w.remove}
          </Button>
        </div>
      </div>
      {app.problem && <Chip signal="warning">{app.problem}</Chip>}
      {app.tools.length === 0 ? (
        <p className="text-sm text-muted">{w.noTools}</p>
      ) : (
        <List label={fillWords(w.toolsOf, { name: app.name })}>
          {app.tools.map((tool) => (
            <ListRow key={tool.name}>
              <RowLead title={tool.name} sub={tool.description} />
              <label className="flex items-center gap-2 text-sm">
                <span className="sr-only">{fillWords(w.howRuns, { tool: tool.name })}</span>
                <select
                  value={app.switched[tool.name] ?? "off"}
                  disabled={pending}
                  onChange={(e) => run(() => actions.switchTool(tool.name, e.target.value))}
                  className="min-h-9 rounded-md border border-line bg-card px-2"
                >
                  <option value="off">{w.gates.off}</option>
                  {APP_GATES.map((gate) => (
                    <option key={gate} value={gate}>
                      {w.gates[gate]}
                    </option>
                  ))}
                </select>
              </label>
            </ListRow>
          ))}
        </List>
      )}
      {problem && (
        <p role="alert" className="text-sm text-danger-text">
          {problem}
        </p>
      )}
    </div>
  );
}
