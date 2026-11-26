/**
 * The projects area's words in both languages, for code outside the admin (bloat review step 0.7): the pages of Projects and checklists
 * (D903) read them on the server and hand each client part its words. Never import this from a "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { projectsEn, type ProjectsMessages } from "../admin-messages/projects.en";
import { projectsNb } from "../admin-messages/projects.nb";

export const PROJECTS_WORDS: Record<AdminLang, ProjectsMessages> = { en: projectsEn, nb: projectsNb };
