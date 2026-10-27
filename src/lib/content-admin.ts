import type { ContentMessages } from "./admin-messages/content.en";
import { fillWords } from "./admin-fill";

/**
 * The server's refusals about content types and entries (D326) in the admin's language (D312): each English sentence the writers say,
 * matched to its words in the `content` catalogue; a sentence it does not know (a field's own check) stays as written.
 */
export function contentProblem(problem: string, words: ContentMessages["problems"]): string {
  const exact: Record<string, string> = {
    "That content type no longer exists.": words.noType,
    "That entry no longer exists.": words.noEntry,
    "Another entry of this type has that address. Choose another.": words.slugTaken,
    "The web name is fixed once an entry of the type has been published: its entries' addresses use it.": words.webNameFixed,
    "The site keeps at most 50 content types.": words.typesMax,
    "The site keeps at most 10,000 entries.": words.entriesMax,
    "Give the entry a title before publishing it.": words.needTitle,
  };
  if (exact[problem]) return exact[problem];
  const taken = /^Another content type has the web name (.+)\. Choose another\.$/.exec(problem);
  if (taken) return fillWords(words.typeSlugTaken, { slug: taken[1] });
  const retyped = /^(.+): a field's type cannot change once it is saved\. Add a new field instead\.$/.exec(problem);
  if (retyped) return fillWords(words.retyped, { label: retyped[1] });
  return problem;
}
