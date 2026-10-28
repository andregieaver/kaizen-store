import Link from "next/link";

import { deleteAllMemoriesAction, deleteMemoryAction, setLearningAction, updateMemoryAction } from "@/app/admin/(gated)/memory-actions";
import { learningOn, listMemories } from "@/server/assistant-memory";
import { listSkills } from "@/server/assistant-saved-skills";
import { skillsFor } from "@/lib/assistant-skills";
import type { Conversation, ConversationSummary } from "@/server/owner-assistant";
import { PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";

import { AdminTextScope } from "./admin-text";

import { AiManagerChat, type Abilities, type AiManagerActions } from "./ai-manager";
import { AiMemory } from "./ai-memory";
import { AiSkills } from "./ai-skills";
import type { RemoveSkill, SaveSkill } from "@/lib/saved-skills";

/**
 * The AI manager's own page (D103), for a store or the platform: the
 * conversations, and what it knows about the person (Memory).
 */
export async function AiManagerPage({
  area,
  base,
  siteName,
  settingsHref,
  accountId,
  tab,
  abilities,
  conversations,
  conversation,
  actions,
  skillActions,
  storeId = null,
  lang = "en",
}: {
  area: "store" | "platform";
  base: string;
  siteName: string;
  settingsHref: string;
  accountId: string;
  tab: string | undefined;
  abilities: Abilities;
  conversations: ConversationSummary[];
  conversation: Conversation | null;
  actions: AiManagerActions;
  /** The Skills tab's saving and deleting (D350), bound to the place. */
  skillActions?: { save: SaveSkill; remove: RemoveSkill };
  /** The store the AI manager works in, or null for Kaizena Flow's own. */
  storeId?: string | null;
  /** The account's admin language (D312 A10); English until the route passes it. */
  lang?: AdminLang;
}) {
  const w = adminText(lang, "assistant");
  const memory = tab === "memory";
  const skills = tab === "skills" && skillActions !== undefined;
  const [memories, learning] = memory ? await Promise.all([listMemories(accountId), learningOn(accountId)]) : [[], true];
  const saved = skills ? await listSkills({ accountId, storeId }) : [];
  const tabClass = (on: boolean) => `rounded-md px-3 py-1.5 text-sm ${on ? "bg-sunken font-medium" : "text-muted hover:bg-sunken"}`;
  return (
    <AdminTextScope texts={adminTexts(lang, ["assistant"])}>
    <div className="flex flex-col gap-4">
      <PageHeader
        title={w.name}
        description={fillWords(w.page.description, { site: area === "store" ? siteName : w.page.kaizen })}
      />
      <nav aria-label={w.name} className="flex gap-1">
        <Link href={base} className={tabClass(!memory && !skills)} aria-current={!memory && !skills ? "page" : undefined}>
          {w.page.conversations}
        </Link>
        <Link href={`${base}?tab=memory`} className={tabClass(memory)} aria-current={memory ? "page" : undefined}>
          {w.page.memory}
        </Link>
        {skillActions && (
          <Link href={`${base}?tab=skills`} className={tabClass(skills)} aria-current={skills ? "page" : undefined}>
            {w.page.skills}
          </Link>
        )}
        <Link href={`${base}/autopilot`} className={tabClass(false)}>
          {w.autopilot.tab}
        </Link>
      </nav>
      {skills && skillActions ? (
        <AiSkills
          skills={saved.map((skill) => ({ id: skill.id, key: skill.key, title: skill.title, when: skill.when, steps: skill.steps, shared: skill.shared, mine: skill.mine, by: skill.by }))}
          builtIn={skillsFor(area).map(({ id, title, when }) => ({ id, title, when }))}
          canShare={area === "store"}
          actions={skillActions}
        />
      ) : memory ? (
        <AiMemory
          memories={memories}
          learning={learning}
          actions={{ update: updateMemoryAction, remove: deleteMemoryAction, removeAll: deleteAllMemoriesAction, setLearning: setLearningAction }}
        />
      ) : (
        <AiManagerChat
          key={conversation?.id ?? "new"}
          area={area}
          base={base}
          siteName={siteName}
          settingsHref={settingsHref}
          abilities={abilities}
          conversations={conversations}
          conversation={conversation}
          actions={actions}
          variant="page"
        />
      )}
    </div>
    </AdminTextScope>
  );
}
