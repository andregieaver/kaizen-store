---
paths:
 - "src/lib/prompt-safety.ts"
 - "src/lib/agent-eval.ts"
 - "src/server/agent-eval.ts"
 - "src/server/prompt-versions.ts"
 - "src/server/owner-assistant.ts"
 - "src/server/chat-agent.ts"
 - "src/lib/chat.ts"
---

# Prompts and the agents' eval: how-to

The agents' safety eval (`src/lib/agent-eval.ts`, run by `src/server/agent-eval.ts` from Platform → AI, kept per model in
`commerce.ai_eval_runs`) plays the shopper chat and the AI manager with their real prompts and tools on scripted tool answers that
hide instructions; run it after changing a prompt, a tool's description or the platform's model, and add a case with any new way
outside text reaches a prompt (`agent-eval.test.ts` checks every tool a case names exists). Prompts are versioned (D391,
`src/server/prompt-versions.ts`: each drawn with fixed inputs and hashed; a new agent's prompt gets a fixed drawing there and a
version in `promptVersions()`), kept with every answer and eval run; CI replays the recording of a real run kept as
`src/data/agent-eval-recording.json` (`agent-eval-replay.int.test.ts`), so a changed prompt or a new case needs a new run on
Platform → AI and its recording committed. The AI manager's conversations go after the retention rule's period or the owner's own
(`stores.assistant_keep_months`, `pruneAssistantConversations()`); the chat's notice says when an AI reads tone or summarises
(`ChatWidgetProfile.aiUse`), so a new AI use of a customer's messages is said there too.
