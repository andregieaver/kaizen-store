"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { DEVICES, GOALS, GOAL_WORDS, MIN_DAYS, type Device, type Goal } from "@/lib/experiments";
import { estimateRuntime } from "@/lib/experiment-results";

const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const card = "flex flex-col gap-4 rounded-lg border border-border bg-background p-5";
const hint = "text-xs font-normal text-muted";

export type TestablePage = { id: string; slug: string; title: string; buttons: { id: string; label: string }[] };
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
}: {
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
  const [perDay, setPerDay] = useState("");
  const [rate, setRate] = useState("");
  const [change, setChange] = useState("20");

  const buttons = page?.buttons ?? [];
  const versions = 2;
  const estimate = useMemo(() => {
    const visitors = Number(perDay);
    const baseline = Number(rate.replace(",", ".")) / 100;
    if (!(visitors > 0) || !(baseline > 0 && baseline < 1)) return null;
    return estimateRuntime({ baseline, relativeChange: Number(change) / 100, versions, eligiblePerDay: visitors, trafficShare: share, minDays: MIN_DAYS });
  }, [perDay, rate, change, share]);

  const toggle = <T extends string>(list: T[], value: T, set: (next: T[]) => void) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setProblems([]);
    start(async () => {
      const result = await create({
        name: name.trim() || `Test of ${page?.title ?? "a page"}`,
        hypothesis: hypothesis.trim(),
        pageId,
        goal,
        goalBlock: goal === "click" ? button || null : null,
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
        There is no page to test yet. A page can be tested when it is published and is not the front page, the All products page or a page with a place of
        its own (the cart, the blog …), and is not in a running test already.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex max-w-3xl flex-col gap-6" aria-busy={pending}>
      <section className={card} aria-labelledby="ab-page">
        <h2 id="ab-page" className="text-lg font-semibold">1. Which page?</h2>
        <label className={label}>
          Page to test
          <select value={pageId} onChange={(e) => setPageId(e.target.value)} className={input}>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} (/{p.slug})
              </option>
            ))}
          </select>
          <span className={hint}>A copy of the page is made as your first new version, for you to change. The page itself stays as it is until you choose a winner.</span>
        </label>
      </section>

      <section className={card} aria-labelledby="ab-goal">
        <h2 id="ab-goal" className="text-lg font-semibold">2. What should get better?</h2>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">What the test should improve</legend>
          {GOALS.map((g) => (
            <label key={g} className="flex items-start gap-3 rounded-md border border-border p-3 text-sm has-[:checked]:border-foreground">
              <input type="radio" name="goal" checked={goal === g} onChange={() => setGoal(g)} className="mt-1" />
              <span>
                <span className="font-medium">{GOAL_WORDS[g].label}</span>
                <span className="block text-xs text-muted">The winner is the version that helps you {GOAL_WORDS[g].asks}.</span>
              </span>
            </label>
          ))}
        </fieldset>
        {goal === "click" && (
          <label className={label}>
            Which button?
            {buttons.length === 0 ? (
              <span className={hint}>This page has no button with a text yet. Add one in the page builder first, or choose another goal.</span>
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
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={`Test of ${page?.title ?? "the page"}`} className={input} />
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
        <p className={hint}>
          A test needs enough visitors before it can say anything. Tell us roughly how many visitors a day see this page and accept cookies, and how many of
          them do the thing you want today.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={label}>
            Visitors a day
            <input inputMode="numeric" value={perDay} onChange={(e) => setPerDay(e.target.value)} placeholder="200" className={input} />
          </label>
          <label className={label}>
            Who do it today (%)
            <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="3" className={input} />
          </label>
          <label className={label}>
            Change worth finding
            <select value={change} onChange={(e) => setChange(e.target.value)} className={input}>
              <option value="10">10 % more</option>
              <option value="20">20 % more</option>
              <option value="30">30 % more</option>
              <option value="50">50 % more</option>
            </select>
          </label>
        </div>
        {estimate && (
          <p role="status" className={`rounded-md border p-3 text-sm ${estimate.tooLong ? "border-amber-500" : "border-border"}`}>
            {estimate.sentence}
          </p>
        )}
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
