import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/** The store's writer, played: each email it is asked about comes back in "the store's voice". */
const asked: string[] = [];
let writes = true;
vi.mock("./broadcasts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./broadcasts")>()),
  suggestBroadcast: async (_store: unknown, _account: string, words: string) => {
    asked.push(words);
    if (!writes) return { ok: false, problem: "no_ai" };
    return { ok: true, suggestion: { subject: `Vår stemme: ${words.split("\n")[0]}`, preview: "", heading: "Hei fra oss", paragraphs: ["Skrevet som butikken."], button: "", products: [], campaigns: [] } };
  },
}));

const { closeDb } = await import("@/db/client");
const { makeStore } = await import("./trust-fixtures");
const fl = await import("./flows");
const { writeRecipeInVoice } = await import("./flows-voice");

/**
 * A recipe's first words in the store's voice (D897), against the database: a flow just made from a recipe gets its emails rewritten as its
 * next version, still off; one the owner changed meanwhile, or tested, keeps what it has; with no writer the ready-made words stay.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
const asStore = () => ({ id: store.id, localization: { locales: ["nb-NO"], keptLocales: ["nb-NO"] } }) as never;

beforeAll(async () => {
  store = await makeStore("flows-voice");
});
afterAll(async () => {
  await closeDb();
});

describe("a recipe in the store's voice (D897)", () => {
  it("rewrites a flow as Start made it, as its next version, off and untested", async () => {
    const made = await fl.startRecipeFlow(asStore(), store.account.id, "welcome");
    if (!made.ok) throw new Error(made.problem);
    expect(made.readyWords).toBe(true);
    expect(await writeRecipeInVoice(asStore(), store.account.id, made.id)).toBe("written");
    const flow = await fl.getFlow(store.id, made.id);
    expect(flow).toMatchObject({ version: 2, enabled: false, tested: false });
    const subjects = JSON.stringify(flow?.steps);
    expect(subjects).toContain("Vår stemme:");
    expect(asked.length).toBeGreaterThan(0);
  });

  it("keeps the owner's change made while it wrote, and the ready-made words when there is no writer", async () => {
    const made = await fl.startRecipeFlow(asStore(), store.account.id, "win_back");
    if (!made.ok) throw new Error(made.problem);
    const flow = (await fl.getFlow(store.id, made.id))!;
    // The owner changes it first: the background write must not replace that.
    const changed = await fl.saveFlow(store.id, store.account.id, made.id, { name: flow.name, trigger: flow.trigger, triggerDays: flow.triggerDays, steps: flow.steps, goals: flow.goals });
    if (!changed.ok) throw new Error(changed.problem);
    expect(await writeRecipeInVoice(asStore(), store.account.id, made.id)).toBe("kept");
    expect((await fl.getFlow(store.id, made.id))?.version).toBe(2);

    writes = false;
    const other = await fl.startRecipeFlow(asStore(), store.account.id, "cross_sell");
    if (!other.ok) throw new Error(other.problem);
    expect(await writeRecipeInVoice(asStore(), store.account.id, other.id)).toBe("kept");
    expect((await fl.getFlow(store.id, other.id))?.version).toBe(1);
  });
});
