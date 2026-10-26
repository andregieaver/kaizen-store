import { AREAS } from "./permission-keys";

/**
 * How many tools one turn of the AI manager may send (D333). OpenAI-compatible APIs refuse more than 128 tools in a request, and an owner
 * with most features on is offered about 190 store tools and the manager's own 24, so a turn sends at most `TOOLS_PER_TURN`: the
 * manager's own, a few that answer most questions, the tools used earlier in the conversation, the areas the model asked for with
 * `load_tools`, the area of the page the person is on, and then the other areas in a fixed order. The rest stay one `load_tools` call
 * away, named by area in its description. Pure: which tools a role may use is decided before (`offeredTools()`), never here.
 */

/** Under the providers' 128, with room for a tool a caller adds (`ask_kaizen_life`, `load_tools`). */
export const TOOLS_PER_TURN = 120;

export const LOAD_TOOLS = "load_tools";

export type ToolArea = (typeof AREAS)[number];

/** Tools that answer most questions, sent whenever they are offered. */
export const CORE_TOOLS = [
  "store_overview",
  "setup_progress",
  "store_checkup",
  "list_orders",
  "get_order",
  "list_products",
  "get_product",
  "list_customers",
  "get_customer",
  "analytics_overview",
  "support_overview",
] as const;

/** The owner-only tools (`TOOL_PERMISSIONS` `owner`) by the area they belong to; any other is `settings`. */
const OWNER_TOOL_AREAS: Readonly<Record<string, ToolArea>> = {
  list_staff: "staff",
  invite_staff: "staff",
  change_staff_role: "staff",
  remove_staff: "staff",
  billing_overview: "billing",
  change_plan: "billing",
  end_plan: "billing",
  ai_usage: "analytics",
  set_recommendations: "marketing",
  set_bonus_program: "marketing",
  set_affiliate_program: "marketing",
};

/** A store tool's area, from its permission key (`orders:read` → `orders`); the owner's own by `OWNER_TOOL_AREAS`. */
export function toolArea(name: string, key: string | null): ToolArea {
  const prefix = key?.split(":")[0];
  if (prefix && (AREAS as readonly string[]).includes(prefix)) return prefix as ToolArea;
  return OWNER_TOOL_AREAS[name] ?? "settings";
}

export type ToolChoice = {
  /** The names sent this round, in the order given. */
  names: string[];
  /** Per area, how many of its tools are held back (only areas with some). */
  heldBack: Partial<Record<ToolArea, { held: number; of: number }>>;
};

/**
 * Which of the offered store tools a round sends, beside `always` (the manager's own, never cut): everything when it fits, else in order
 * the core tools, the tools used earlier, the areas asked for, the page's area, then the rest by area, cut at the budget.
 */
export function chooseTools(
  offered: readonly { name: string; area: ToolArea }[],
  always: number,
  context: { used?: readonly string[]; wanted?: readonly ToolArea[]; pageArea?: ToolArea | null },
  budget = TOOLS_PER_TURN,
): ToolChoice {
  const room = Math.max(0, budget - always);
  if (offered.length <= room) return { names: offered.map((t) => t.name), heldBack: {} };
  const byName = new Map(offered.map((t) => [t.name, t]));
  const picked = new Set<string>();
  const take = (name: string) => {
    if (picked.size < room && byName.has(name)) picked.add(name);
  };
  const takeArea = (area: ToolArea) => offered.filter((t) => t.area === area).forEach((t) => take(t.name));
  for (const name of CORE_TOOLS) take(name);
  for (const name of context.used ?? []) take(name);
  for (const area of context.wanted ?? []) takeArea(area);
  if (context.pageArea) takeArea(context.pageArea);
  for (const area of AREAS) takeArea(area);
  const heldBack: ToolChoice["heldBack"] = {};
  for (const area of AREAS) {
    const all = offered.filter((t) => t.area === area);
    const held = all.filter((t) => !picked.has(t.name)).length;
    if (held > 0) heldBack[area] = { held, of: all.length };
  }
  return { names: offered.filter((t) => picked.has(t.name)).map((t) => t.name), heldBack };
}

/** The `load_tools` tool, described with what is held back now; null when nothing is. */
export function loadToolsDefinition(heldBack: ToolChoice["heldBack"]) {
  const areas = Object.keys(heldBack) as ToolArea[];
  if (areas.length === 0) return null;
  const held = areas.map((area) => `${area} (${heldBack[area]!.held} of ${heldBack[area]!.of})`).join(", ");
  return {
    name: LOAD_TOOLS,
    description: `Loads more of your tools. To stay within the model's limit, some tools are not loaded now: ${held}. When you need a tool of one of these areas that you do not have, call this first with its area; the tools are yours from the next step on.`,
    parameters: {
      type: "object",
      properties: { areas: { type: "array", items: { type: "string", enum: areas }, minItems: 1, maxItems: 3, description: "The areas whose tools you need." } },
      required: ["areas"],
      additionalProperties: false,
    },
  };
}

/** The areas a `load_tools` call asks for, of those offered; unknown words are dropped. */
export function readLoadTools(raw: string): ToolArea[] {
  try {
    const args = JSON.parse(raw || "{}") as { areas?: unknown };
    const areas = Array.isArray(args.areas) ? args.areas : [];
    return [...new Set(areas.filter((a): a is ToolArea => typeof a === "string" && (AREAS as readonly string[]).includes(a)))].slice(0, 3);
  } catch {
    return [];
  }
}
