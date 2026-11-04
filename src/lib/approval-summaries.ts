import { toolTitle } from "./tool-title";

/**
 * What a call kept for the person's yes will do, in words made from its input (D439, 4 November 2026), for the tools `approvalSummary()`
 * in `owner-tools.ts` had no words of its own for: an order's note and tags, archiving, draft orders and their prices, a product made or
 * its texts written, a stock transfer, a customer's tag, a segment, support notes, a broadcast drafted, time logged, domains and DNS,
 * pages and drafts, the brand, a target, a report, a draft A/B test, a workflow and research notes. Any other tool is named by its title
 * from the MCP catalogue and its input's fields in plain text (`inputSummary()`), so a card never says only a tool's name.
 *
 * Every value here is the model's or an outside assistant's: each is put on one line with its control and invisible format characters
 * (bidirectional overrides, zero-width marks) taken out, cut to a length, and texts are quoted. The card shows the words as text, never as
 * HTML. Pure.
 */

/** One value's characters at most, a list's items shown, and the fallback's words at most. */
const VALUE_MAX = 200;
const ITEMS_MAX = 6;
const WORDS_MAX = 700;
/** How deep lists and objects in an input are written out; deeper ones are an ellipsis. */
const DEPTH_MAX = 3;
/** Fields the store writes itself when the person is asked (the version or state approved), never the model's to show. */
const STORE_WRITTEN = /^approved_/;

/** Control and invisible format characters and line breaks, which could make a card read other than what it does. */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/**
 * A text as a card shows it: control and format characters and line breaks out, runs of spaces as one (a no-break space, as in an amount,
 * stays), cut at `max` with an ellipsis.
 */
export function plainText(value: string, max = VALUE_MAX): string {
  const flat = value.replace(HIDDEN, " ").replace(/ {2,}/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

const quoted = (value: string, max = VALUE_MAX) => `"${plainText(value, max)}"`;
/** A text field of the input, as `plainText()` leaves it; "" when it is not a text. */
const textOf = (input: Record<string, unknown>, key: string, max = VALUE_MAX) => (typeof input[key] === "string" ? plainText(input[key] as string, max) : "");
const numberOf = (input: Record<string, unknown>, key: string) => (typeof input[key] === "number" && Number.isFinite(input[key]) ? (input[key] as number) : null);
const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => plainText(v, VALUE_MAX)) : [];
const objectsOf = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)) : [];
/** A record's entries whose values are texts, such as prices by country. */
const textEntries = (value: unknown): [string, string][] =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => (typeof v === "string" ? [[plainText(k, 40), plainText(v, 40)] as [string, string]] : []))
    : [];

/** Items as a person lists them: "a", "a and b", "a, b and c", and how many more past `max`. */
export function listWords(items: readonly string[], max = ITEMS_MAX): string {
  if (items.length > max) return `${items.slice(0, max).join(", ")} and ${items.length - max} more`;
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** A sentence's end: a period, unless it already ends with a quote, an ellipsis or a stop. */
const ended = (sentence: string) => (/["….!?]$/.test(sentence) ? sentence : `${sentence}.`);
const or = (value: string, fallback: string) => value || fallback;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Orders by number: "order 1042", "orders 1042 and 1043". */
const ordersWords = (refs: string[]) => (refs.length === 0 ? "the orders named" : refs.length === 1 ? `order ${refs[0]}` : `orders ${listWords(refs, 10)}`);
/** Tags as quoted words: `the tag "vip"`, `the tags "vip" and "gift-wrap"`. */
const tagsWords = (tags: string[]) => `the ${tags.length === 1 ? "tag" : "tags"} ${listWords(tags.map((t) => quoted(t, 40)))}`;
/** Lines by SKU and quantity: "2 × MUG-1, 1 × CAP". */
const linesWords = (lines: unknown, max = 10) =>
  listWords(
    objectsOf(lines).map((l) => `${typeof l.quantity === "number" ? l.quantity : "?"} × ${or(textOf(l, "sku", 64), "?")}`),
    max,
  );
/** Minutes as a person says them: "45 min", "2 h", "1 h 30 min". */
const durationWords = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
};
/** A DNS record as the domain's page lists it: type, name, value. */
const recordWords = (r: Record<string, unknown>) =>
  `${or(textOf(r, "type", 10), "a record")} ${or(textOf(r, "name", 60), "@")} ${quoted(textOf(r, "value", 120), 120)}${typeof r.priority === "number" ? ` (priority ${r.priority})` : ""}`;

/** A word from one of these maps, looked up among its own keys only (a key such as `constructor` finds nothing). */
const wordOf = (map: Record<string, string>, key: unknown): string | undefined => (typeof key === "string" && Object.hasOwn(map, key) ? map[key] : undefined);
const EMAIL_PROVIDER_WORDS: Record<string, string> = {
  google_workspace: "Google Workspace email",
  microsoft_365: "Microsoft 365 email",
  other: "email from another provider",
};
const TEXT_WORDS: Record<string, string> = { description: "description", search: "search title and description", languages: "words in the store's other languages" };
const METRIC_WORDS: Record<string, string> = { net_sales: "net sales", orders: "orders", conversion: "conversion", aov: "average order value" };
const GOAL_WORDS: Record<string, string> = {
  orders: "orders",
  revenue: "revenue per visitor",
  cart: "adding to the cart",
  checkout: "reaching checkout",
  click: "clicks on a button",
  form: "answers to a form",
};

/** One change of `edit_page` in words. */
function pageChangeWords(change: Record<string, unknown>): string {
  switch (change.do) {
    case "set_text":
      return `the text ${or(textOf(change, "key", 80), "named")} to ${quoted(textOf(change, "text", 160), 160)}`;
    case "replace":
      return `${quoted(textOf(change, "find", 80), 80)} replaced with ${quoted(textOf(change, "replace", 80), 80)} everywhere`;
    case "add_section":
      return `a new section ${quoted(textOf(change, "name", 80), 80)}${typeof change.at === "number" ? ` as row ${change.at}` : ""}`;
    case "remove_row":
      return `row ${textOf(change, "row", 60)} taken away`;
    case "move_row":
      return `row ${textOf(change, "row", 60)} moved to place ${typeof change.to === "number" ? change.to : "?"}`;
    default:
      return "a change";
  }
}

/** A segment's rules when the store cannot word them (the server words them with its money, `segmentApprovalSummary()`). */
function segmentRulesCount(rules: unknown): string {
  const r = typeof rules === "object" && rules !== null ? (rules as { match?: unknown; conditions?: unknown }) : {};
  const n = Array.isArray(r.conditions) ? r.conditions.length : 0;
  if (n === 0) return "everyone";
  return n === 1 ? "1 condition" : `${n} conditions, ${r.match === "any" ? "any one" : "all"} of which must hold`;
}

/** A support note or ending kept for a yes: the conversation by its title when the server found it (`supportApprovalSummary()`), else its id. */
export function supportSummary(name: string, input: Record<string, unknown>, title: string | null): string {
  const which = title ? `the support conversation ${quoted(title, 120)}` : `the support conversation ${or(textOf(input, "conversation", 64), "?")}`;
  return name === "end_support_conversation"
    ? `End ${which}; its summary is written after.`
    : `Write a note in ${which}, for the store's staff only: ${quoted(textOf(input, "note", 1000), 1000)}`;
}

/**
 * Words of their own for the tools `approvalSummary()` had none for; null for any other tool. Never throws: a field that is missing is
 * written as missing.
 */
export function ownWordsSummary(name: string, input: Record<string, unknown>): string | null {
  const t = (key: string, max = VALUE_MAX) => textOf(input, key, max);
  switch (name) {
    case "add_order_note":
      return `Add a note to order ${or(t("order"), "?")}, for the store's staff only: ${quoted(t("note", 1000), 1000)}`;
    case "tag_orders": {
      const orders = ordersWords(stringsOf(input.orders));
      const add = stringsOf(input.add);
      const remove = stringsOf(input.remove);
      if (add.length > 0 && remove.length > 0) return `Put ${tagsWords(add)} on ${orders}, and take ${tagsWords(remove)} off them.`;
      if (add.length > 0) return `Put ${tagsWords(add)} on ${orders}.`;
      if (remove.length > 0) return `Take ${tagsWords(remove)} off ${orders}.`;
      return `Change no tags on ${orders}.`;
    }
    case "archive_orders": {
      const refs = stringsOf(input.orders);
      return input.archived === false
        ? `Bring ${ordersWords(refs)} back from the archive.`
        : `Archive ${ordersWords(refs)}: ${refs.length === 1 ? "it leaves" : "they leave"} the default list and the queues, and nothing is deleted.`;
    }
    case "create_draft_order": {
      const percent = t("discount_percent");
      return `Write a draft order for ${or(t("email"), "a customer")}: ${or(linesWords(input.lines), "no lines")}${t("market") ? `, in the market ${t("market")}` : ""}${
        percent ? `, ${percent} % off called ${quoted(t("discount_label"), 60)}` : ""
      }. Nothing is sent yet.`;
    }
    case "set_draft_prices": {
      const lines = objectsOf(input.lines).map((l) => {
        const sku = or(textOf(l, "sku", 64), "?");
        const price = textOf(l, "price", 30);
        return price ? `${sku} at ${price}` : `${sku} without a typed price`;
      });
      return `On draft order ${or(t("draft"), "?")}: ${or(listWords(lines, 10), "no lines")} (for one, VAT included, in the draft's currency). Nothing is sent.`;
    }
    case "create_product": {
      const prices = textEntries(input.prices).map(([country, price]) => `${price} in ${country.toUpperCase()}`);
      const options = objectsOf(input.options).map((o) => `${textOf(o, "name", 40)} (${listWords(stringsOf(o.values).map((v) => plainText(v, 40)), 10)})`);
      const variants = objectsOf(input.variants);
      const stock = numberOf(input, "stock");
      const pictures = Array.isArray(input.pictures) ? input.pictures.length : 0;
      const components = objectsOf((input.bundle as Record<string, unknown> | undefined)?.components);
      const parts = [
        prices.length > 0 ? `price ${listWords(prices)}` : "",
        options.length > 0 ? `options ${options.join(", ")}` : "",
        variants.length > 0 ? plural(variants.length, "variant") : "",
        stock ? `${stock} in stock` : "",
        components.length > 0 ? `a bundle of ${linesWords(components)}` : "",
        stringsOf(input.categories).length > 0 ? `categories ${listWords(stringsOf(input.categories).map((c) => quoted(c, 60)))}` : "",
        stringsOf(input.tags).length > 0 ? `tags ${listWords(stringsOf(input.tags).map((c) => quoted(c, 60)))}` : "",
        pictures > 0 ? plural(pictures, "picture") : "",
        t("description") ? "a description" : "",
      ].filter(Boolean);
      return `Make the product ${quoted(t("title"), 100)} as a draft, not on the site${parts.length > 0 ? `: ${parts.join("; ")}` : ""}.`;
    }
    case "write_product_texts": {
      const texts = stringsOf(input.texts).map((text) => wordOf(TEXT_WORDS, text) ?? text);
      const languages = stringsOf(input.languages);
      return `Have the store's AI writer write the ${listWords(texts.length > 0 ? texts : Object.values(TEXT_WORDS))}${languages.length > 0 ? ` (${listWords(languages)})` : ""} of the product ${quoted(t("product"), 100)}${
        input.rewrite === true ? ", writing again what is there" : ", where there are none yet"
      }.`;
    }
    case "create_transfer":
      return `Make a draft transfer of stock from ${quoted(t("from"), 60)} to ${quoted(t("to"), 60)}: ${or(linesWords(input.lines), "no lines")}${t("note") ? ` (note: ${quoted(t("note"))})` : ""}. Nothing moves until it is sent on its page.`;
    case "tag_customer":
      return input.remove === true
        ? `Take the tag ${quoted(t("tag"), 40)} off the customer ${or(t("email"), "?")}.`
        : `Put the tag ${quoted(t("tag"), 40)} on the customer ${or(t("email"), "?")}.`;
    case "save_segment": {
      const was = t("segment", 120);
      const what = !was ? `Save the segment ${quoted(t("name"), 80)}` : was.toLowerCase() === t("name").toLowerCase() ? `Change the segment ${quoted(was)}` : `Change the segment ${quoted(was)}, renamed ${quoted(t("name"), 80)}`;
      return `${what}: ${segmentRulesCount(input.rules)}. Shoppers see nothing of it.`;
    }
    case "add_support_note":
    case "end_support_conversation":
      return supportSummary(name, input, null);
    case "draft_broadcast":
      return `Have the store's AI write a draft broadcast ${quoted(t("name"), 80)} for ${t("segment") ? `the segment ${quoted(t("segment"), 120)}` : "everyone on the list"}, about: ${quoted(t("brief", 400), 400)}. Nothing is sent.`;
    case "log_time": {
      const minutes = numberOf(input, "minutes");
      return ended(
        `Log ${minutes === null ? "time" : durationWords(minutes)}${input.billable === false ? ", not billable," : ""} on the Work assignment ${quoted(t("assignment"), 200)} ${
          t("date") ? `for ${t("date")}` : "for today"
        }${t("note") ? `: ${quoted(t("note"), 500)}` : ""}`,
      );
    }
    case "connect_domain":
      return `Connect ${or(t("domain"), "a domain")} to the store${input.primary === true ? " and make it the store's address once it works" : ""}.`;
    case "change_dns": {
      const add = objectsOf(input.add).map(recordWords);
      const remove = objectsOf(input.remove).map(recordWords);
      const parts = [add.length > 0 ? `add ${listWords(add, 5)}` : "", remove.length > 0 ? `remove ${listWords(remove, 5)}` : ""].filter(Boolean);
      return parts.length > 0 ? `Change the DNS of ${or(t("domain"), "a domain")}: ${parts.join("; ")}.` : `Change nothing in the DNS of ${or(t("domain"), "a domain")}.`;
    }
    case "set_up_email": {
      const domain = or(t("domain"), "a domain");
      if (input.provider === "dmarc") return `Set up a DMARC policy (${or(t("policy"), "none")}) on ${domain}.`;
      if (input.provider === "other") {
        const lines = typeof input.records === "string" ? input.records.split("\n").filter((l) => l.trim()).length : 0;
        return `Set up email from another provider on ${domain} with ${plural(lines, "record")}${input.replace_email === true ? ", replacing the email records there" : ""}: ${quoted(t("records", 300), 300)}`;
      }
      const extras = [t("verification") ? "its verification value" : "", t("dkim") ? "DKIM" : "", t("mx") ? `the mail server ${t("mx")}` : ""].filter(Boolean);
      return `Set up ${wordOf(EMAIL_PROVIDER_WORDS, input.provider) ?? "email"} on ${domain}: email to the domain then goes there${extras.length > 0 ? ` (with ${listWords(extras)})` : ""}.`;
    }
    case "verify_domain_for":
      return `Add the TXT record ${quoted(t("value"), 300)}${t("name") ? ` at ${quoted(t("name"), 100)}` : ""} to ${or(t("domain"), "a domain")}, so a service can see the domain is yours.`;
    case "undo_dns_change":
      return `Put back the DNS change ${or(t("change"), "?")} on ${or(t("domain"), "a domain")}, while the records are still as it left them.`;
    case "switch_nameservers":
      return `Move the DNS of ${or(t("domain"), "a domain")} away from Kaizena Flow, to the nameservers ${or(listWords(stringsOf(input.nameservers), 13), "?")}${
        input.accept_missing === true ? "; records the new provider does not have go" : ""
      }.`;
    case "build_page":
      return `Build the page ${quoted(t("title"), 200)} as a draft with the page studio, for: ${quoted(t("purpose", 400), 400)}${
        input.pictures === false ? ", without pictures" : ", its pictures made after"
      }. Visitors see nothing until it is published.`;
    case "cancel_page_build":
      return `Stop the page build ${or(t("build"), "?")}: nothing of it is left, unless it is already built.`;
    case "edit_page": {
      const changes = objectsOf(input.changes).map(pageChangeWords);
      return `Change the draft of the ${input.type === "article" ? "article" : "page"} ${quoted(t("page"), 200)}: ${or(listWords(changes, 5), "nothing")}. Visitors see nothing until it is published.`;
    }
    case "draft_header_footer": {
      const kind = input.kind === "footer" ? "footer" : "header";
      return `Draft a ${kind} of the site's own${t("title") ? ` called ${quoted(t("title"), 120)}` : ""}${t("look") ? `, laid out ${t("look")}` : ""}${t("menu") ? `, showing the menu ${quoted(t("menu"), 80)}` : ""}. Visitors see nothing until it is used.`;
    }
    case "set_brand": {
      const parts = [
        t("tagline") ? `tagline ${quoted(t("tagline"), 120)}` : "",
        t("voice") ? `voice ${quoted(t("voice"), 300)}` : "",
        t("audience") ? `audience ${quoted(t("audience"), 300)}` : "",
        stringsOf(input.values).length > 0 ? `values ${listWords(stringsOf(input.values).map((v) => quoted(v, 40)))}` : "",
        stringsOf(input.avoid).length > 0 ? `words to avoid ${listWords(stringsOf(input.avoid).map((v) => quoted(v, 40)), 10)}` : "",
      ].filter(Boolean);
      return parts.length > 0 ? `Keep the brand's words: ${parts.join("; ")}.` : "Keep the brand's words as they are.";
    }
    case "make_brand_marks":
      return `Draw the brand's logo and icon from ${t("text") ? quoted(t("text"), 40) : "the store's name"}${t("font") ? ` in ${quoted(t("font"), 100)}` : ""} and keep them in the media library. Visitors see nothing until they are used.`;
    case "add_theme":
      return `Add the theme ${or(t("theme"), "?")}${t("preset") ? ` with its preset ${quoted(t("preset"), 40)}` : ""} to the store's theme library, not live: visitors see nothing of it.`;
    case "design_look": {
      const fonts = [t("heading_font") ? `headings in ${quoted(t("heading_font"), 100)}` : "", t("body_font") ? `text in ${quoted(t("body_font"), 100)}` : ""].filter(Boolean);
      return `Design the look ${quoted(t("title"), 60)} (main colour ${or(t("accent"), "?")}${fonts.length > 0 ? `, ${fonts.join(", ")}` : ""}) and keep it in the theme library, not live.`;
    }
    case "save_entry": {
      const values = typeof input.values === "object" && input.values !== null && !Array.isArray(input.values) ? fieldsWords(input.values as Record<string, unknown>, 1, ", ") : "";
      return `${t("entry") ? `Change the draft of the entry ${t("entry")}` : `Write a new draft entry of the type ${quoted(t("type"), 60)}`}${values ? `: ${values}` : ""}. Shoppers see nothing until it is published.`;
    }
    case "save_report": {
      const spec = typeof input.spec === "object" && input.spec !== null ? (input.spec as Record<string, unknown>) : {};
      const metrics = stringsOf(spec.metrics).map((m) => m.replace(/_/g, " "));
      return `Save the report ${quoted(t("title"), 80)} in Analytics, Reports${metrics.length > 0 ? `, showing ${listWords(metrics)}` : ""}. Shoppers see nothing of it.`;
    }
    case "set_target": {
      const metric = wordOf(METRIC_WORDS, input.metric) ?? or(t("metric"), "a figure");
      const when = input.period === "custom" ? `from ${or(t("start"), "?")} to ${or(t("end"), "?")}` : `for the ${or(t("period"), "period")} of ${or(t("start"), "?")}`;
      return `Set the target for ${metric} ${when}: ${quoted(t("value"), 20)}. Shoppers see nothing of it.`;
    }
    case "draft_experiment": {
      const changes = objectsOf(input.changes).length;
      const goal = input.goal === "click" && t("button") ? `clicks on ${quoted(t("button"), 100)}` : (wordOf(GOAL_WORDS, input.goal) ?? "its goal");
      const traffic = numberOf(input, "traffic_percent");
      return `Make a draft A/B test${t("name") ? ` ${quoted(t("name"), 120)}` : ""} of ${quoted(t("target"), 200)}: a version B with ${plural(changes, "changed text")}, to improve ${goal}${
        traffic !== null ? `, for ${traffic} % of visitors` : ""
      }. Visitors see nothing until it is started.`;
    }
    case "draft_workflow": {
      const actions = objectsOf(input.actions).map((a) => or(textOf(a, "kind", 40), "an action").replace(/_/g, " "));
      return `Draft the workflow ${quoted(t("name"), 80)}, saved off: when ${or(t("trigger"), "?")}, ${or(listWords(actions), "no action")}. Nothing runs until you switch it on.`;
    }
    case "draft_store": {
      const pages = objectsOf(input.pages).map((p) => quoted(textOf(p, "title", 80), 80));
      return `Draft the store from its description: a front page${pages.length > 0 ? ` and the pages ${listWords(pages)}` : ""} as drafts${t("theme") ? ", and add a free theme to the library" : ""}, from ${quoted(t("description", 300), 300)}. Visitors see nothing until they are published.`;
    }
    case "save_research_note": {
      const sources = stringsOf(input.sources).length;
      return `Keep the research note ${quoted(t("topic"), 200)} (${plural(sources, "source")}): ${quoted(t("finding", 400), 400)}`;
    }
    case "compare_options": {
      const options = objectsOf(input.options).map((o) => quoted(textOf(o, "name", 80), 80));
      const criteria = objectsOf(input.criteria).map((c) => quoted(textOf(c, "name", 80), 80));
      return `Compare ${or(listWords(options), "the options")} on ${or(listWords(criteria), "the criteria")} for ${quoted(t("topic"), 200)}, and keep it as a note.`;
    }
    default:
      return null;
  }
}

/** A field's name as words: `valid_days` → valid days. */
const fieldLabel = (key: string) => plainText(key.replace(/_/g, " "), 40);

/** A value as plain words: texts quoted, yes or no, lists joined, objects in brackets; null when there is nothing to say. */
function valueWords(value: unknown, depth: number): string | null {
  if (value === undefined) return null;
  if (value === null) return "none";
  if (typeof value === "string") return value.trim() === "" ? "none" : quoted(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (depth >= DEPTH_MAX) return "…";
  if (Array.isArray(value)) {
    const items = value.map((v) => valueWords(v, depth + 1)).filter((v): v is string => v !== null);
    return items.length === 0 ? "none" : items.length > ITEMS_MAX ? `${items.slice(0, ITEMS_MAX).join(", ")} and ${items.length - ITEMS_MAX} more` : items.join(", ");
  }
  if (typeof value === "object") {
    const fields = fieldsWords(value as Record<string, unknown>, depth + 1, ", ");
    return fields ? `(${fields})` : null;
  }
  return null;
}

/** An object's fields as "name value", joined. */
function fieldsWords(input: Record<string, unknown>, depth: number, join: string): string {
  return Object.entries(input)
    .filter(([key]) => !STORE_WRITTEN.test(key))
    .flatMap(([key, value]) => {
      const words = valueWords(value, depth);
      return words === null ? [] : [`${fieldLabel(key)} ${words}`];
    })
    .join(join);
}

/** An input's fields in plain words, such as `order "1042"; note "Gift wrap"`: bounded in length, on one line, never a raw JSON dump. */
export function inputWords(input: unknown): string {
  const all = typeof input === "object" && input !== null && !Array.isArray(input) ? fieldsWords(input as Record<string, unknown>, 0, "; ") : "";
  return all.length > WORDS_MAX ? `${all.slice(0, WORDS_MAX - 1).trimEnd()}…` : all;
}

/**
 * Any tool's call in words when it has none of its own: its title from the MCP catalogue and its input's fields (`inputWords()`), such as
 * `Archive supplier: supplier "Fjord Linen"; notify no.`
 */
export function inputSummary(name: string, input: Record<string, unknown>): string {
  const words = inputWords(input);
  return words ? ended(`${toolTitle(name)}: ${words}`) : `${toolTitle(name)}.`;
}

/** A sentence followed by an input's fields: an app's tool kept for a yes (D363) is described so, as the app's own words cannot be checked. */
export function withInputWords(sentence: string, input: unknown): string {
  const words = inputWords(input);
  return ended(words ? `${sentence}: ${words}` : sentence);
}
