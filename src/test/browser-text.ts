import { registerHandText } from "@/lib/browser-text";
import { da } from "@/lib/messages/da";
import { en } from "@/lib/messages/en";
import { nb } from "@/lib/messages/nb";
import { sv } from "@/lib/messages/sv";

// What `LanguageTexts` gives a page (D212), for every language at once: unit tests draw client components without a layout.
for (const [lang, messages] of Object.entries({ nb, sv, da, en })) registerHandText(lang, messages);
