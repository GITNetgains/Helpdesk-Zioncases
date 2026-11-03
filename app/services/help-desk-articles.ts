import { formGroups } from "./help-desk-form";
import starterData from "../data/help-articles.json";
import { countryName } from "./help-desk";
import { addBusinessDays, processingDays, shippingAnswer, type ShippingSetup, type ShippingTimesSettings } from "./help-desk-shipping";

// Help articles: answers customers find by searching at the top of the
// storefront form, before they send a request. Each one can end with a button
// that opens the form's flow for it ("Report a missing item"), so an answer
// that isn't enough leads straight to the right request.
//
// The starter set is written from Zion Cases' own customer emails (the support
// team's issues sheet): the questions customers actually ask, in their words,
// as keywords. Stores edit them in Settings › Help articles.

export const articleCollections = [
  "Orders & Delivery", "Shipping", "Returns & Exchanges", "Damaged, Missing or Wrong Items",
  "Warranty & Parts", "Products & Care", "Payments & Discounts", "Website & Account", "Wholesale & Partners", "Feedback & Ideas",
] as const;

// What an article's button opens: "Topic › Option" on the storefront form, or
// just "Topic" to show that topic's options.
export const ACTION_SEPARATOR = " › ";
export const articleActions = formGroups.flatMap((group) => [group.label, ...group.options.map((option) => `${group.label}${ACTION_SEPARATOR}${option.label}`)]);
export const validAction = (action: string) => articleActions.includes(action);

export type Article = { question: string; answer: string; keywords: string; collection: string; action: string };

// The starter set: data, not code (app/data/help-articles.json). It's only
// copied into a store's database (help-desk-articles.server.ts); from then on
// the store's own copy is what customers search, and the team edits it in
// Settings › Help articles.
export const starterArticles: Article[] = starterData;

// ---------- Search ----------

// Words that say nothing about the question.
const STOP = new Set(("a an the i im i'm me my mine we our you your it its is are was were be been am do does did doing have has had having "
  + "to of in on at for from with by as and or but if so this that these those there here what which who whom how when why can could would "
  + "should will just about any some please thanks thank hi hello hey get got one also very really still yet want wanted need needed "
  + "like would'nt dont don't didnt didn't im ive i've isnt isn't wasnt wasn't zion guys y'all yall recently today yesterday "
  + "last week weeks ago time came come just now able know let tell help issue problem question thing").split(/\s+/));

// Common misspellings in customer emails.
const TYPOS: Record<string, string> = {
  brok: "broken", gaurd: "guard", gaurds: "guards", hawai: "hawaii", recieved: "received", recieve: "receive", exhange: "exchange", exhcange: "exchange",
  delievered: "delivered", deliverd: "delivered", shippement: "shipment", shipement: "shipment", defected: "defective", defetced: "defective",
  warrnaty: "warranty", warrenty: "warranty", repalcement: "replacement", replacment: "replacement", uodates: "updates", colur: "colour",
};

// Words customers use for the same thing, folded to one.
const SAME: [RegExp, string][] = [
  [/^(broke|broken|snap|snapped|crack|cracked|cracking|chip|chipped|shatter|shattered|damag|damaged|dent|dented|gouge|gouged|bent)$/, "damage"],
  [/^(miss|missing|without|wihout|absent|lacking)$/, "missing"],
  [/^(track|tracking|where|status|update|updates)$/, "track"],
  [/^(refund|refunds|refunded|money|reimburse)$/, "refund"],
  [/^(return|returns|returning|returned|send)$/, "return"],
  [/^(exchange|swap|switch|replace)$/, "exchange"],
  [/^(scratch|scratches|scratched|scuff|scuffs|marks|lines)$/, "scratch"],
  [/^(cloudy|hazy|foggy|clear|transparent|film|wrapper|wrappers|peel)$/, "film"],
  [/^(colour|color|colours|colors|variant|variants|black|white|blue|red|green|grey|gray|pink|purple|orange|yellow|navy|silver|gold|gunmetal|carbon)$/, "colour"],
  [/^(lid|lids|top|tops|cover|covers)$/, "lid"],
  [/^(riser|risers|stand|stands)$/, "riser"],
  [/^(lock|locks|combination|code|latch|latches)$/, "lock"],
  [/^(ship|shipping|shipped|shipment|deliver|delivery|delivered|arrive|arrived)$/, "ship"],
  [/^(fast|faster|expedite|expedited|rush|express|overnight)$/, "expedite"],
  [/^(cancel|cancelled|canceled|cancellation|stop)$/, "cancel"],
  [/^(fit|fits|fitting|accommodate)$/, "fit"],
  [/^(wheel|wheels|handle|handles)$/, "wheel"],
  [/^(wrong|incorrect|instead)$/, "wrong"],
  // Places outside the U.S. customers name instead of saying "international".
  [/^(international|overseas|worldwide|abroad|uk|england|london|ireland|canada|toronto|vancouver|australia|sydney|zealand|europe|france|paris|spain|espana|germany|italy|netherlands|belgium|sweden|norway|denmark|switzerland|austria|portugal|poland|japan|singapore|india|dubai|uae|mexico|brazil|philippines|korea|hong|kong|malaysia|israel)$/, "international"],
  [/^(discount|promo|coupon)$/, "discount"],
  [/^(defect|defective|faulty|malfunction)$/, "defect"],
  [/^(guard|guards|acrylic|glass|plastic|panel|panels)$/, "acrylic"],
  [/^(warranty|guarantee)$/, "warranty"],
  [/^(lost|stuck|moving|moved)$/, "lost"],
  [/^(bowing|bow|warp|warped|uneven|flat)$/, "bowing"],
];

const stem = (typed: string) => {
  const word = TYPOS[typed] ?? typed;
  for (const [pattern, same] of SAME) if (pattern.test(word)) return same;
  const base = word.replace(/'s$/, "").replace(/ies$/, "y").replace(/(ss|x|z|ch|sh)es$/, "$1").replace(/(ing|ed)$/, "").replace(/([^s])s$/, "$1");
  for (const [pattern, same] of SAME) if (pattern.test(base)) return same;
  return base.length >= 3 ? base : word;
};

// Product names that would read as a topic: "Slab Case X" is a case, not a
// question about slabs; "scratch-resistant" and "scratch-less" lids aren't scratched.
const PRODUCT_NAMES: [RegExp, string][] = [
  [/\bslab\s+cases?\b/g, "case"], [/\b(horizontal\s+|vertical\s+)?display\s+cases?\b/g, "case"], [/\bscratch[\s-]*(resistant|less|proof)\b/g, ""], [/\bsr\b/g, ""], [/\bsling\s+bags?\b/g, "sling"],
];

export function searchWords(text: string) {
  let lower = text.toLowerCase();
  for (const [pattern, replacement] of PRODUCT_NAMES) lower = lower.replace(pattern, replacement);
  return (lower.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’‘]/g, "'").match(/[a-z0-9']+/g) ?? [])
    // "what's", "it's": the word, for the stop list.
    .map((word) => word.replace(/^'+|'+$/g, "").replace(/'s$/, ""))
    .filter((word) => word && !STOP.has(word))
    .map(stem);
}

// bodyWeight: how much the answer's words count (0.2 by default). A store
// policy or page has no keywords, so its text counts for more.
type Searchable = { id: string; question: string; keywords: string; answer: string; bodyWeight?: number };

const phrasesOf = (keywords: string) => keywords.split(",").map((phrase) => phrase.trim().toLowerCase()).filter(Boolean);
const plain = (text: string) => ` ${text.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim()} `;

// The articles that best answer a question, best first. A word counts for more
// the fewer articles use it ("riser" says more than "case"), and for more in
// an article's question than in its keywords, and least in its answer. A
// keyword phrase the customer used word for word ("says delivered") counts
// extra. Words no article uses (names, order numbers) are ignored.
export function searchArticles<T extends Searchable>(articles: T[], query: string, limit = 6): T[] {
  return rankArticles(articles, query, limit).map((entry) => entry.article);
}

// The same, with how well each matched, for the chat assistant to decide
// whether it's sure enough to answer on its own. share: the part of what was
// asked that the article answers, by the weight of the words any article knows
// (0-1). coverage: the part of all the customer's words it matches, unknown
// ones included, so "my dog chewed the handle" isn't taken for a handle question.
export function rankArticles<T extends Searchable>(articles: T[], query: string, limit = 6): { article: T; score: number; share: number; coverage: number }[] {
  const asked = [...new Set(searchWords(query))];
  if (!asked.length || !articles.length) return [];
  const indexed = articles.map((article) => {
    const phrases = phrasesOf(article.keywords);
    return { article, phrases, question: new Set(searchWords(article.question)), keywords: new Set(phrases.flatMap(searchWords)), answer: new Set(searchWords(article.answer)) };
  });
  const uses = new Map<string, number>();
  for (const entry of indexed) {
    const counted = (entry.article.bodyWeight ?? 0.2) >= 0.5 ? [...entry.question, ...entry.keywords, ...entry.answer] : [...entry.question, ...entry.keywords];
    for (const word of new Set(counted)) uses.set(word, (uses.get(word) ?? 0) + 1);
  }
  const known = asked.filter((word) => uses.has(word) || indexed.some((entry) => entry.answer.has(word)));
  if (!known.length) return [];
  const rarity = (word: string) => Math.log(1 + articles.length / (1 + (uses.get(word) ?? articles.length)));
  const total = known.reduce((sum, word) => sum + rarity(word), 0);
  const lower = plain(query);
  const scored = indexed.map(({ article, phrases, question, keywords, answer }) => {
    let score = 0;
    let matched = 0;
    for (const word of known) {
      const weight = question.has(word) ? 1 : keywords.has(word) ? 0.85 : answer.has(word) ? article.bodyWeight ?? 0.2 : 0;
      score += rarity(word) * weight;
      // An answer-only word barely says the article is about it.
      if (weight >= 0.5) matched++;
    }
    for (const phrase of phrases) if (phrase.includes(" ") && lower.includes(` ${phrase} `)) score += 1.5;
    return { article, score, share: score / total, coverage: matched / asked.length };
  });
  const best = Math.max(...scored.map((entry) => entry.score));
  // A short question must be mostly answered; a long email only in its key words.
  const needed = known.length <= 3 ? 0.4 : known.length <= 8 ? 0.22 : 0.12;
  return scored
    // (With only a few articles every word is "common", so the floor scales down.)
    .filter((entry) => entry.score >= Math.min(1.2, total * 0.5) && entry.share >= needed && entry.score >= best * 0.55)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}

// ---------- The store's own policies and pages ----------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: "-", mdash: "-", hellip: "...", bull: "-" };
const decode = (text: string) => text
  .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);

// HTML as plain text, keeping paragraphs and list items on their own lines.
export function htmlText(html: string) {
  return decode(html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "")
    .replace(/<\/(p|div|ul|ol|h[1-6]|tr|table|section|blockquote)>/gi, "\n\n")
    .replace(/<[^>]+>/g, ""))
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const MAX_SECTION_LENGTH = 1500;
const clip = (text: string) => text.length <= MAX_SECTION_LENGTH ? text : `${text.slice(0, MAX_SECTION_LENGTH).replace(/\s+\S*$/, "")}...`;

// A policy or page, cut at its headings (or paragraphs that are only bold
// text, as FAQ pages often use for questions), so a search finds the part that
// answers it. Without headings it's one section, named after the page.
export function sectionsFromHtml(title: string, html: string) {
  const heading = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>|<p[^>]*>\s*<(strong|b)[^>]*>([\s\S]*?)<\/\3>\s*(?:<br\s*\/?>\s*)?<\/p>/gi;
  const sections: { heading: string; text: string }[] = [];
  let current = title;
  let last = 0;
  const push = (body: string) => {
    const text = htmlText(body);
    if (text.length >= 20) sections.push({ heading: current, text: clip(text) });
  };
  for (const match of html.matchAll(heading)) {
    push(html.slice(last, match.index));
    const name = htmlText(match[2] ?? match[4] ?? "").replace(/\s+/g, " ").trim();
    if (name) current = name.length > 140 ? `${name.slice(0, 140)}...` : name;
    last = (match.index ?? 0) + match[0].length;
  }
  push(html.slice(last));
  return sections;
}

// ---------- Answers from the store's live settings ----------

// What the store's Shopify settings answer on their own: where it ships, how
// soon an order ships, what shipping costs at home (and when it's free), and
// how to reach it. Built at search time, so dates are today's and changes in
// Shopify show up without anyone editing an article. Nothing is said that the
// settings don't say: no processing time set, no "ships by" answer.
export type StoreFacts = { email: string; setup: ShippingSetup | null | undefined; times: ShippingTimesSettings };
type Fact = Article & { id: string };

const shortDate = (iso: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
const dayText = ([min, max]: [number, number]) => min === max ? `${min} business day${min === 1 ? "" : "s"}` : `${min}-${max} business days`;
const listNames = (names: string[]) => names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

export function storeFacts({ email, setup, times }: StoreFacts, today = new Date()): Fact[] {
  const facts: Fact[] = [];
  const fact = (id: string, collection: (typeof articleCollections)[number], question: string, keywords: string, action: string, answer: string) =>
    facts.push({ id: `store:${id}`, collection, question, keywords, action, answer: answer.trim() });
  if (setup) {
    // Where it ships: every country in a zone, or worldwide with a "Rest of world" zone.
    const worldwide = setup.zones.some((zone) => zone.restOfWorld && zone.rates.length);
    const countries = [...new Set(setup.zones.filter((zone) => zone.rates.length).flatMap((zone) => zone.countries.map((country) => country.code)))]
      .map(countryName).sort((x, y) => x.localeCompare(y));
    if (worldwide || countries.length) {
      const shown = countries.length > 30 ? `${countries.slice(0, 30).join(", ")} and ${countries.length - 30} more` : listNames(countries);
      fact("countries", "Shipping", "Which countries do you ship to?", "ship to, countries, country, deliver to, worldwide, international, do you ship, ship outside, overseas, abroad",
        countries.length > 1 || worldwide ? "Shipping › International Shipping" : "Shipping › Domestic Shipping",
        worldwide ? `We ship worldwide.${countries.length ? ` Our shipping options are set up for ${shown}, and for everywhere else too.` : ""}\n\nChoose International Shipping below for the options, cost and delivery time to your address.`
          : `We ship to ${shown}.\n\nChoose Domestic Shipping or International Shipping below for the options, cost and delivery time to your address.`);
    }
    // How soon an order ships, with today's dates.
    const processing = processingDays(times, setup.processingTime).days;
    if (processing) {
      const by = processing[0] === processing[1] ? shortDate(addBusinessDays(today, processing[1]))
        : `${shortDate(addBusinessDays(today, processing[0]))} to ${shortDate(addBusinessDays(today, processing[1]))}`;
      fact("processing", "Shipping", "How soon will my order ship?", "ship, processing time, when will it ship, how long to ship, dispatch, leave the warehouse, handling time, ship today, ship out",
        "Shipping › Domestic Shipping",
        `Orders ship within ${dayText(processing)} (Monday to Friday). Order today and it leaves us by ${by}.\n\nThen it's in transit with the carrier: choose Domestic Shipping below for delivery dates to your address.${times.note.trim() ? `\n\n${times.note.trim()}` : ""}`);
    }
    // Shipping at home: each rate, its price, when it applies and how long it takes.
    const home = shippingAnswer(setup, times, setup.home, "", today);
    if (home.ships && home.rates.length) {
      const lines = home.rates.map((rate) => `- ${rate.name}: ${rate.price}${rate.condition ? ` (${rate.condition.charAt(0).toLowerCase()}${rate.condition.slice(1)})` : ""}${rate.days ? `, ${dayText(rate.days)} in transit` : ""}`);
      fact("rates", "Shipping", `How much is shipping to ${home.countryName}?`, "shipping cost, how much is shipping, shipping price, shipping fee, delivery cost, shipping rates, flat rate, standard shipping, express shipping, expedited",
        "Shipping › Domestic Shipping",
        `Our shipping options in ${home.countryName}:\n\n${lines.join("\n")}\n\nYou'll see the exact price for your order at checkout.`);
      const free = home.rates.filter((rate) => rate.price === "Free");
      if (free.length) {
        fact("free-shipping", "Shipping", "Do you offer free shipping?", "free shipping, free delivery, shipping free, free ship, minimum for free shipping, threshold",
          "Shipping › Domestic Shipping",
          `Yes, in ${home.countryName}:\n\n${free.map((rate) => `- ${rate.name}${rate.condition ? `: ${rate.condition.charAt(0).toLowerCase()}${rate.condition.slice(1)}` : ""}`).join("\n")}\n\nIt's applied at checkout when your order qualifies.`);
      }
    }
  }
  if (email) {
    fact("email", "Orders & Delivery", "What's your email address?", "email, email address, contact email, write to you, contact, reach you, phone number, call",
      "", `You can email us at ${email}.\n\nFor anything about an order, sending a request below is quickest: it reaches the right person, and you can follow it on your request page.`);
  }
  return facts;
}
