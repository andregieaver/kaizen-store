/**
 * A store's own email topics (email plan M4.2, D882, `docs/email-topics.md`): their limits, their input and how a topic is named in a
 * language. Pure.
 */

export const TOPICS_MAX = 20;
export const TOPIC_NAME_MAX = 60;
export const TOPIC_LINE_MAX = 200;

export type TopicNames = Record<string, { name: string; line: string }>;

export type Topic = { id: string; names: TopicNames; defaultOn: boolean; archived: boolean };

/** The topic's name in a language: that language's, else the same language's in another country, else the main language's, else any. */
export function topicName(names: TopicNames, wanted: string, main: string): { name: string; line: string } {
  const pick =
    names[wanted] ?? Object.entries(names).find(([l]) => l.slice(0, 2) === wanted.slice(0, 2))?.[1] ?? names[main] ?? Object.values(names)[0];
  return pick ?? { name: "", line: "" };
}
