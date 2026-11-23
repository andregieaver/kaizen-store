"use server";

import { redirect } from "next/navigation";

import { preferenceWords } from "@/lib/email-preference-words";
import { topicName } from "@/lib/marketing-topics";
import { marketPath } from "@/lib/paths";
import { unsubscribe } from "@/server/cart-reminders";
import { preferencesByToken, savePreferences, setRest } from "@/server/email-preferences";
import { unsubscribeByToken } from "@/server/marketing-subscribers";
import { resolveAfterSaleShop } from "@/server/shop";

/**
 * Every press on the page an email's link opens (D295, D33, email plan M4.2 D882), in one action so the page adds no server reference:
 * `do` says which. *Unsubscribe* stops marketing email or cart reminders to this address from the store; *Save* keeps the reader's topics
 * and how often; *Pause* rests their marketing email for a month, *Resume* starts it again. A plain form post, so a mail scanner that only
 * opens the link changes nothing.
 */
export async function emailChoiceAction(storeSlug: string, marketSlug: string, token: string, form: FormData): Promise<void> {
  const back = (result: string) => redirect(`${marketPath(storeSlug, marketSlug, `/unsubscribe/${token}`)}?${result}=1`);
  if (token.length > 64) back("unknown");
  const choice = String(form.get("do") ?? "unsubscribe");
  if (choice === "unsubscribe") {
    const done = (await unsubscribeByToken(token, "link")) ?? (await unsubscribe(token));
    back(done ? "done" : "unknown");
  }
  const shop = await resolveAfterSaleShop(storeSlug, marketSlug);
  if (!shop) back("unknown");
  const storeId = shop!.store.id;
  if (choice === "pause" || choice === "resume") back((await setRest(storeId, token, choice === "pause")) ? (choice === "pause" ? "paused" : "resumed") : "unknown");
  // Save: the topics ticked, how often, and the words the page showed, kept with each changed choice as the record of what was agreed.
  const prefs = await preferencesByToken(storeId, token);
  if (!prefs) back("unknown");
  const main = shop!.store.localization.locales[0] ?? shop!.market.locale;
  const names = prefs!.topics.map((topic) => topicName(topic.names, shop!.market.locale, main).name);
  const words = [preferenceWords(shop!.market.lang).prefsIntro, ...names].join(" · ");
  const saved = await savePreferences(storeId, token, { topicIds: form.getAll("topic").map(String), frequency: String(form.get("frequency") ?? ""), words });
  back(saved ? "saved" : "unknown");
}
