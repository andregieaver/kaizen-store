import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getMembership = vi.fn();
const requirePlatformAdmin = vi.fn();
vi.mock("@/server/auth", () => ({ getMembership, requireMember: vi.fn(), holderOf: (member: { role: string }) => ({ role: member.role }), requirePlatformAdmin }));
const aiFor = vi.fn();
vi.mock("@/server/ai", () => ({ aiFor, AiError: class extends Error {}, completeText: vi.fn() }));
const planPageMotion = vi.fn();
vi.mock("@/server/motion-ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/motion-ai")>()),
  planPageMotion,
}));

const { planMotionAction: storeAction } = await import("./motion-action");
const { planMotionAction: platformAction } = await import("../../platform/pages/motion-action");

const rows = [
  {
    id: "r1",
    type: "row",
    layout: "1",
    columns: [{ id: "c1", blocks: [{ id: "b1", type: "heading", text: "Hi", level: 1 }] }],
  },
];
const plan = { ok: true, plan: { style: "elegant", summary: "s", items: [], aiUsed: false } };

beforeEach(() => {
  getMembership.mockReset().mockResolvedValue({ store: { id: "store-1" }, account: { id: "acct-1" }, role: "owner" });
  requirePlatformAdmin.mockReset().mockResolvedValue({ id: "admin-1" });
  aiFor.mockReset().mockResolvedValue({ textModel: "m" });
  planPageMotion.mockReset().mockResolvedValue(plan);
});

describe("a store's planMotionAction", () => {
  it("checks the member, asks for the store's AI for this feature, and plans the rows", async () => {
    const result = await storeAction("shop", "page", JSON.stringify(rows));
    expect(getMembership).toHaveBeenCalledWith("shop");
    expect(aiFor).toHaveBeenCalledWith("store-1", { feature: "page_motion", accountId: "acct-1" });
    expect(planPageMotion).toHaveBeenCalledWith({ textModel: "m" }, rows);
    expect(result).toBe(plan);
  });

  it("plans with the rules when the store has no AI", async () => {
    aiFor.mockResolvedValue(null);
    await storeAction("shop", "page", JSON.stringify(rows));
    expect(planPageMotion).toHaveBeenCalledWith(null, rows);
  });

  it("does not answer for a store the person does not belong to", async () => {
    getMembership.mockResolvedValue(null);
    expect(await storeAction("other", "page", JSON.stringify(rows))).toEqual({ ok: false, problem: "You do not have access to this." });
    expect(aiFor).not.toHaveBeenCalled();
    expect(planPageMotion).not.toHaveBeenCalled();
  });

  it("answers in plain words for a page that cannot be read, is too large, or is a kind that takes none", async () => {
    const problems = [
      await storeAction("shop", "page", "{not json"),
      await storeAction("shop", "page", JSON.stringify({ rows: [] })),
      await storeAction("shop", "page", JSON.stringify([{ id: "r1", type: "row", layout: "nope", columns: [] }])),
      await storeAction("shop", "page", "x".repeat(1_600_000)),
      await storeAction("shop", "header", JSON.stringify(rows)),
      await storeAction("shop", "nonsense" as never, JSON.stringify(rows)),
      await storeAction(
        "shop",
        "page",
        JSON.stringify(Array.from({ length: 51 }, (_, i) => ({ ...rows[0], id: `r${i}` }))),
      ),
    ];
    for (const result of problems) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.problem.length).toBeGreaterThan(10);
    }
    expect(planPageMotion).not.toHaveBeenCalled();
    expect(aiFor).not.toHaveBeenCalled();
  });

  it("takes an empty page: there is simply nothing to add", async () => {
    await storeAction("shop", "page", "[]");
    expect(planPageMotion).toHaveBeenCalledWith({ textModel: "m" }, []);
  });
});

describe("Kaizen's planMotionAction", () => {
  it("is for platform admins and uses Kaizen's AI", async () => {
    const result = await platformAction("article", JSON.stringify(rows));
    expect(requirePlatformAdmin).toHaveBeenCalled();
    expect(aiFor).toHaveBeenCalledWith(null, { feature: "page_motion", accountId: "admin-1" });
    expect(planPageMotion).toHaveBeenCalledWith({ textModel: "m" }, rows);
    expect(result).toBe(plan);
  });

  it("refuses others before reading anything", async () => {
    requirePlatformAdmin.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(platformAction("page", JSON.stringify(rows))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(planPageMotion).not.toHaveBeenCalled();
  });

  it("reads the page as strictly as the store's", async () => {
    expect(await platformAction("page", "nope")).toMatchObject({ ok: false });
    expect(await platformAction("header", "[]")).toMatchObject({ ok: false });
    expect(planPageMotion).not.toHaveBeenCalled();
  });
});
