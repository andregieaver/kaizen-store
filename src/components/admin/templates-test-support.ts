import type { PageRow } from "@/lib/page-content";
import type { SavedPart } from "@/lib/saved-parts";
import type { PartSharing, TemplateActions, TemplateItem } from "@/lib/templates";

/** Fixtures and a fake `TemplateActions` for the Templates tab, its modal and the sharing choice's tests (D125). */

export const item = (over: Partial<TemplateItem> & { id: string }): TemplateItem => ({
  kind: "row",
  name: "Hero",
  summary: "2 columns: heading, text",
  publisher: "Kaffe AS",
  fromKaizen: false,
  sharing: "marketplace",
  active: false,
  updatedAt: "2026-09-01T10:00:00Z",
  ...over,
});

export const row = (id: string): PageRow => ({
  id,
  type: "row",
  layout: "1",
  columns: [{ id: `${id}-c`, blocks: [] }],
});

export const saved = (id: string, sharing: PartSharing = "private", name = "Hero with picture"): SavedPart => ({
  id,
  kind: "row",
  name,
  content: row(`${id}-row`),
  updatedAt: "2026-09-01T10:00:00Z",
  global: false,
  translations: {},
  uses: 0,
  sharing,
});

export type Calls = {
  list: string[];
  setActive: [string, boolean][];
  use: string[];
  setSharing: [string, PartSharing][];
};

/** Actions that answer from the lists given, and note what they were asked. */
export function fakeActions(
  lists: { stores?: TemplateItem[]; marketplace?: TemplateItem[] } = {},
  answers: {
    setActive?: Awaited<ReturnType<TemplateActions["setActive"]>>;
    use?: Awaited<ReturnType<TemplateActions["use"]>>;
  } = {},
): { actions: TemplateActions; calls: Calls } {
  const calls: Calls = { list: [], setActive: [], use: [], setSharing: [] };
  const actions: TemplateActions = {
    list: async (source) => {
      calls.list.push(source);
      return lists[source] ?? [];
    },
    setActive: async (id, active) => {
      calls.setActive.push([id, active]);
      return answers.setActive ?? { ok: true };
    },
    use: async (id) => {
      calls.use.push(id);
      return answers.use ?? { ok: true, part: saved("copy") };
    },
    setSharing: async (id, sharing) => {
      calls.setSharing.push([id, sharing]);
      return { ok: true };
    },
  };
  return { actions, calls };
}
