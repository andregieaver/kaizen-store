"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { DEVICES, GOALS, GOAL_WORDS, type Device, type Goal } from "@/lib/experiments";
import { isTestedPlace, KIND_WORDS, ROLE_NAMES, type TargetKind } from "@/lib/ab-site";
import type { PartInfo } from "@/lib/experiment-parts";

import { RuntimeEstimate } from "./runtime-estimate";

const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const card = "flex flex-col gap-4 rounded-lg border border-border bg-background p-5";
const hint = "text-xs font-normal text-muted";

export type TestablePage = { id: string; slug: string; title: string; kind: TargetKind; role?: string | null; partOnly?: boolean; buttons: { id: string; label: string }[]; forms?: { id: string; label: string }[] };
type Outcome = { ok: true; id: string } | { ok: false; problems: string[] };

const SHARES = [
  { value: 1, label: "All visitors" },
  { value: 0.5, label: "Half of the visitors" },
  { value: 0.25, label: "A quarter of the visitors" },
];

const DEVICE_WORDS: Record<Device, string> = { mobile: "Phones", tablet: "Tablets", desktop: "Computers" };

/**
 * Making an A/B test (D148): which page, what it should improve, and who takes part. The first version is a copy of the
 * page made on saving, to change next. The estimate of how long it takes is the owner's own guess worked out here, with the
 * same function the results use.
 */
export function ExperimentForm({
  pages,
  markets,
  create,
  base,
  part = null,
}: {
  /** A part of the page chosen in the builder (D148): the test is of it, on the one page offered. */
  part?: PartInfo | null;
  pages: TestablePage[];
  markets: { code: string; name: string }[];
  create: (input: unknown) => Promise<Outcome>;
  base: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problems, setProblems] = useState<string[]>([]);
  const [pageId, setPageId] = useState(pages[0]?.id ?? "");
  const [goal, setGoal] = useState<Goal>("orders");
  const page = pages.find((p) => p.id === pageId);
  const [button, setButton] = useState("");
  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [share, setShare] = useState(1);
  const [devices, setDevices] = useState<Device[]>([...DEVICES]);
  const [chosenMarkets, setChosenMarkets] = useState<string[]>([]);

  // A part's buttons and forms are the ones inside it; a page's, all of its own.
  const buttons = part ? part.buttons : (page?.buttons ?? []);
  const forms = part ? (part.forms ?? []) : (page?.forms ?? []);

  const toggle = <T extends string>(list: T[], value: T, set: (next: T[]) => void) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setProblems([]);
    start(async () => {
      const result = await create({
        part: part ? { kind: part.kind, id: part.id } : null,
        name: name.trim() || (part ? `Test of ${part.label}` : `Test of ${page?.title ?? "a page"}`),
        hypothesis: hypothesis.trim(),
        pageId,
        goal,
        goalBlock: GOAL_WORDS[goal].needsBlock ? button || null : null,
        trafficShare: share,
        audience: {
          ...(devices.length > 0 && devices.length < DEVICES.length && { devices }),
          ...(chosenMarkets.length > 0 && { markets: chosenMarkets }),
        },
      });
      if (result.ok) router.push(`${base}/${result.id}`);
      else setProblems(result.problems);
    });
  };

  if (pages.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-background p-5 text-sm text-muted">
        There is no page to test yet. A page can be tested when it is published and is not a page with a place of
        its own, and is not in a running test already. The cart, the checkout and the other working pages are tested by a part of them: open one in the page
        builder and use “A/B test this” on a row around the shop&apos;s own component.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex max-w-3xl flex-col gap-6" aria-busy={pending}>
      <section className={card} aria-labelledby="ab-page">
        <h2 id="ab-page" className="text-lg font-semibold">{part ? "1. What you are testing" : "1. What do you want to test?"}</h2>
        {part ? (
          <p className="text-sm">
            <span className="font-medium">{part.label}</span> in {page && page.kind !== "page" ? `the ${(page.kind === "role" && isTestedPlace(page.role) ? ROLE_NAMES[page.role] : KIND_WORDS[page.kind].name).toLowerCase()} ` : "the page "}
            <span className="font-medium">{page?.title}</span>
            {page?.kind === "page" && ` (/${page.slug})`}.
            <span className={`${hint} block`}>
              A copy of the page is made as your first new version. You change this part in it; the rest of the page must stay as it is, so the test is
              about this part only. The page itself stays as it is until you choose a winner.
            </span>
          </p>
        ) : (
        <label className={label}>
          What to test
          <select value={pageId} onChange={(e) => setPageId(e.target.value)} className={input}>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.kind === "page" ? `${p.title} (/${p.slug})` : `${p.kind === "role" && isTestedPlace(p.role) ? ROLE_NAMES[p.role] : KIND_WORDS[p.kind].name}: ${p.title}`}
              </option>
            ))}
          </select>
          <span className={hint}>
            A copy is made as your first new version, for you to change. The original stays as it is until you choose a winner.
            {page && page.kind !== "page" && ` Visitors in the test see their version ${KIND_WORDS[page.kind].where}.`}
          </span>
        </label>
        )}
      </section>

      <section className={card} aria-labelledby="ab-goal">
        <h2 id="ab-goal" className="text-lg font-semibold">2. What should get better?</h2>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">What the test should improve</legend>
          {GOALS.map((g) => (
            <label key={g} className="flex items-start gap-3 rounded-md border border-border p-3 text-sm has-[:checked]:border-foreground">
              <input type="radio" name="goal" checked={goal === g} onChange={() => {
                  setGoal(g);
                  // A button chosen for one goal is not a form for another.
                  setButton("");
                }} className="mt-1" />
              <span>
                <span className="font-medium">{GOAL_WORDS[g].label}</span>
                <span className="block text-xs text-muted">The winner is the version that helps you {GOAL_WORDS[g].asks}.</span>
              </span>
            </label>
          ))}
        </fieldset>
        {goal === "form" && (
          <label className={label}>
            Which form?
            {forms.length === 0 ? (
              <span className={hint}>{part ? "There is no email form or newsletter sign-up in this part." : "This page has no email form or newsletter sign-up yet."} Add one in the page builder first, or choose another goal.</span>
            ) : (
              <select value={button} onChange={(e) => setButton(e.target.value)} className={input} required>
                <option value="">Choose a form</option>
                {forms.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            )}
            <span className={hint}>A visitor counts once, when the site accepts what they sent: a message, or a sign-up (before they confirm it by email).</span>
          </label>
        )}
        {goal === "click" && (
          <label className={label}>
            Which button?
            {buttons.length === 0 ? (
              <span className={hint}>{part ? "There is no button with a text in this part." : "This page has no button with a text yet."} Add one in the page builder first, or choose another goal.</span>
            ) : (
              <select value={button} onChange={(e) => setButton(e.target.value)} className={input} required>
                <option value="">Choose a button</option>
                {buttons.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            )}
          </label>
        )}
      </section>

      <section className={card} aria-labelledby="ab-name">
        <h2 id="ab-name" className="text-lg font-semibold">3. Name and idea</h2>
        <label className={label}>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={part ? `Test of ${part.label}` : `Test of ${page?.title ?? "the page"}`} className={input} />
        </label>
        <label className={label}>
          What do you think will happen? (optional)
          <textarea
            value={hypothesis}
            onChange={(e) => setHypothesis(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="A shorter heading and a bigger button will make more people add to the cart."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
          />
          <span className={hint}>Writing it down first keeps you honest about what you were testing.</span>
        </label>
      </section>

      <section className={card} aria-labelledby="ab-who">
        <h2 id="ab-who" className="text-lg font-semibold">4. Who takes part?</h2>
        <label className={label}>
          Share of visitors in the test
          <select value={share} onChange={(e) => setShare(Number(e.target.value))} className={input}>
            {SHARES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <span className={hint}>Visitors who have accepted statistics cookies are split evenly between the versions. The rest see the page as it is and are not counted.</span>
        </label>
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="mb-1 font-medium">Devices</legend>
          {DEVICES.map((d) => (
            <label key={d} className="flex items-center gap-2">
              <input type="checkbox" checked={devices.includes(d)} onChange={() => toggle(devices, d, setDevices)} />
              {DEVICE_WORDS[d]}
            </label>
          ))}
        </fieldset>
        {markets.length > 1 && (
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="mb-1 font-medium">Countries (none ticked: all)</legend>
            {markets.map((m) => (
              <label key={m.code} className="flex items-center gap-2">
                <input type="checkbox" checked={chosenMarkets.includes(m.code)} onChange={() => toggle(chosenMarkets, m.code, setChosenMarkets)} />
                {m.name}
              </label>
            ))}
          </fieldset>
        )}
      </section>

      <section className={card} aria-labelledby="ab-time">
        <h2 id="ab-time" className="text-lg font-semibold">How long will it take? (optional)</h2>
        <RuntimeEstimate share={share} versions={2} />
      </section>

      {problems.length > 0 && (
        <ul role="alert" className="list-disc rounded-lg border border-red-700 p-4 pl-8 text-sm text-red-800 dark:text-red-300">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className="min-h-11 rounded-md bg-foreground px-5 text-sm font-medium text-background disabled:opacity-50">
          {pending ? "Making the test …" : "Make the test"}
        </button>
        <span className="self-center text-xs text-muted">Nothing is shown to visitors until you start it.</span>
      </div>
    </form>
  );
}
