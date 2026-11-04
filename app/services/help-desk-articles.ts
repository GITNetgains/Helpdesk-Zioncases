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
  + "last week weeks ago time came come just now able know let tell help issue problem question thing "
  // Every question is about a case: the word says nothing about which one.
  + "case cases under "
  // How people talk in a chat, around what they're asking: "honestly", "is that
  // normal", "this is ridiculous, again". (Not feelings that are the question:
  // "frustrated" and "disappointed" stay.)
  + "honestly seriously literally actually basically totally absolutely ridiculous unbelievable again already normal "
  + "all over took take taking out wondering hoping guess check checking "
  + "monday tuesday wednesday thursday friday saturday sunday "
  // Hinglish fillers: "address galat daal diya, change kar do".
  + "daal dala daala diya diye kar kardo de dena do lo raha rahe "
  // Hinglish: "mera order kab aayega", "return kaise kare".
  + "mera meri mere mujhe muje hai hain tha thi karna karni karo kare karu kaise kaisa kya kyu kyun ka ki ke ko se mein aur bhi kab abhi tak hua hui ho gaya gayi raha rahi bhai yaar ji").split(/\s+/));

// Common misspellings in customer emails.
const TYPOS: Record<string, string> = {
  brok: "broken", gaurd: "guard", gaurds: "guards", hawai: "hawaii", recieved: "received", recieve: "receive", recived: "received", exhange: "exchange", exhcange: "exchange", exchnage: "exchange",
  delievered: "delivered", deliverd: "delivered", shippement: "shipment", shipement: "shipment", shiping: "shipping", shippng: "shipping", defected: "defective", defetced: "defective",
  warrnaty: "warranty", warrenty: "warranty", waranty: "warranty", repalcement: "replacement", replacment: "replacement", uodates: "updates", colur: "colour",
  adress: "address", addres: "address", adres: "address", intl: "international", retrun: "return", retun: "return", rfund: "refund", damged: "damaged", damaeged: "damaged",
  wholsale: "wholesale", contct: "contact", mising: "missing", packge: "package", pakage: "package", ordr: "order", oder: "order", trackng: "tracking", cancell: "cancel",
};

// Everyday words that look like a misspelling of an article's word ("mind"
// and "find"): left as typed.
const COMMON = new Set(("mind kind mine fine line item items nice glad sure okay well good great soon late many much more less same other else ever never "
  + "once twice hand home house work works worked room told said says sent bought paid gave give make made took take used open opened free full part shown showing "
  + "wife husband son daughter friend kid kids birthday christmas show shows event store shop online box boxes card cards case cases").split(/\s+/));

// Words customers use for the same thing, folded to one.
// Hinglish words customers write ("toota hua aaya", "refund kab milega") are
// folded with the English ones.
const SAME: [RegExp, string][] = [
  [/^(broke|broken|snap|snapped|crack|cracked|cracking|chip|chipped|shatter|shattered|damag|damaged|dent|dented|gouge|gouged|bent|smash|smashed|crush|crushed|destroy|destroyed|bust|busted|ruin|ruined|toota|tuta|tooti|tuti|toot|kharab)$/, "damage"],
  // A missed delivery isn't a missing item.
  [/^(missed)$/, "missed"],
  [/^(miss|missing|without|wihout|absent|lacking|gayab|ghayab)$/, "missing"],
  [/^(track|tracking|where|status|update|updates|whereabouts|eta|kahan|kaha|kidhar)$/, "track"],
  [/^(refund|refunds|refunded|money|reimburse|reimbursed|reimbursement|paisa|paise|paisay)$/, "refund"],
  [/^(return|returns|returning|returned|wapas|wapis|vapas|vapis)$/, "return"],
  [/^(exchange|exchanges|exchanged|swap|swapped|switch|replace|badal|badalna|badlo|badli)$/, "exchange"],
  [/^(scratch|scratches|scratched|scuff|scuffs|scuffed|marks|lines)$/, "scratch"],
  [/^(cloudy|hazy|foggy|milky|clear|transparent)$/, "cloudy"],
  [/^(film|wrapper|wrappers|peel|peeling)$/, "film"],
  [/^(colour|color|colours|colors|colorway|colourway|variant|variants|black|white|blue|red|green|grey|gray|pink|purple|orange|yellow|navy|silver|gold|gunmetal|carbon)$/, "colour"],
  // Not "cover" (a warranty covers it) or "top" (top loaders).
  [/^(lid|lids)$/, "lid"],
  [/^(riser|risers|stand|stands)$/, "riser"],
  // Not "code": a discount code or a sign in code isn't a lock. Nor a lid's latches.
  [/^(lock|locks|locked|unlock|unlocked|combination|combo)$/, "lock"],
  [/^(latch|latches|clasp|clasps|buckle|buckles)$/, "latch"],
  [/^(package|packages|parcel|parcels|pkg)$/, "package"],
  [/^(door|doorstep|porch|mailbox|doorbell|lobby)$/, "door"],
  [/^(wholesale|wholesaler|dealer|dealers|dealership|reseller|resellers|resell|retailer|retailers|distributor|distributors|stockist)$/, "wholesale"],
  [/^(change|changes|changed|changing|modify|modified|modification|edit|edits|edited|alter|amend|amended)$/, "change"],
  // Shipping (sending it) and delivery (getting it) are kept apart: "shipping
  // cost" isn't about a package that says delivered.
  [/^(ship|ships|shipping|shipped|shipment|shipments|dispatch|dispatched|send|sent|sending|post|posted|mail|mailed)$/, "ship"],
  [/^(deliver|delivers|delivery|deliveries|delivered|arrive|arrives|arrived|arriving|arrival|coming|aaya|aya|aayi|ayi|aayega|ayega|aaega|mila|mili|milega|milegi)$/, "deliver"],
  // "How much", "shipping charges"; but "charged twice" is a payment.
  [/^(cost|costs|price|prices|priced|pricing|fee|fees|rate|rates|charge|charges|much|expensive)$/, "cost"],
  [/^(customs|duty|duties|tariff|tariffs|vat|gst|import)$/, "customs"],
  [/^(fast|faster|fastest|expedite|expedited|rush|express|overnight|asap|urgent|urgently|quick|quicker|quickly|sooner|jaldi)$/, "expedite"],
  [/^(cancel|cancelled|canceled|cancellation|cancelation|stop)$/, "cancel"],
  [/^(delay|delays|delayed|late|slow|slowly|behind)$/, "delay"],
  // A date it's needed by ("by friday", "for christmas": see DEADLINES below).
  [/^(deadline|christmas|xmas|birthday)$/, "deadline"],
  [/^(transit|intransit)$/, "transit"],
  [/^(fit|fits|fitting|accommodate)$/, "fit"],
  [/^(wheel|wheels|handle|handles)$/, "wheel"],
  [/^(wrong|incorrect|instead|galat|glt|galt)$/, "wrong"],
  [/^(weight|weigh|weighs|heavy|heaviness|lbs|pounds|kg|kgs)$/, "weight"],
  [/^(dimension|dimensions|dimentions|measurement|measurements|measure|measures)$/, "dimension"],
  [/^(quality|cheap|cheaply|flimsy|poorly)$/, "quality"],
  [/^(described|description|picture|pictures|photo|photos|advertised|listing|listed)$/, "described"],
  [/^(military|apo|fpo|dpo)$/, "apo"],
  // Places outside the U.S. customers name instead of saying "international".
  [/^(international|overseas|worldwide|abroad|uk|england|london|ireland|canada|toronto|vancouver|australia|sydney|zealand|europe|france|paris|spain|espana|germany|italy|netherlands|belgium|sweden|norway|denmark|switzerland|austria|portugal|poland|japan|singapore|india|dubai|uae|mexico|brazil|philippines|korea|hong|kong|malaysia|israel)$/, "international"],
  [/^(discount|promo|coupon)$/, "discount"],
  [/^(defect|defective|faulty|malfunction)$/, "defect"],
  [/^(guard|guards|acrylic|glass|plastic|panel|panels)$/, "acrylic"],
  [/^(warranty|guarantee)$/, "warranty"],
  [/^(lost|stuck|moving|moved|frozen|froze|stalled|stagnant)$/, "lost"],
  [/^(bowing|bow|warp|warped|uneven|flat)$/, "bowing"],
  // Reaching a person: "agent", "talk to someone", "phone number".
  [/^(agent|agents|human|person|representative|rep|operator|support|contact|contacting|reach|talk|speak|call|calling|phone|helpline|hotline|whatsapp|chat)$/, "contact"],
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
  // One word however it's written: "pre-order", "pre order", "preorder".
  [/\bpre[\s-]+orders?\b/g, "preorder"], [/\bpre[\s-]+ordered\b/g, "preordered"],
  // Bought "in person" isn't asking for a person.
  [/\bin[\s-]+person\b/g, "inperson"],
  // A day it's needed by is a deadline ("can it arrive by friday", "it's a
  // birthday gift"); a day on its own isn't ("I ordered on monday").
  [/\b(by|before|until|till|for)\s+(this\s+|next\s+|the\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|weekend|the weekend|christmas|xmas|my birthday|a birthday)\b/g, "deadline"],
  [/\b(it'?s|its|it is)\s+a\s+(birthday\s+|christmas\s+)?(gift|present)\b/g, "deadline"],
  // "Custom fees" are customs, not a custom order.
  [/\bcustom\s+(fees?|dut(y|ies)|charges?|tax|taxes|clearance)\b/g, "customs $1"],
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

// How many letters to add, drop, change or swap to turn one word into the other.
function editDistance(a: string, b: string, most: number) {
  if (Math.abs(a.length - b.length) > most) return most + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let before: number[] = [];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      // A swapped pair ("teh") counts as one.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], before[j - 2] + 1);
    }
    before = previous;
    previous = row;
    if (Math.min(...row) > most) return most + 1;
  }
  return previous[b.length];
}

// Whether every letter of part is in word, in order ("noify" in "notify").
function within(part: string, word: string) {
  let at = 0;
  for (const char of word) if (char === part[at]) at++;
  return at === part.length;
}

// What the customer meant, when a word isn't one any article uses: "cancle"
// is "cancel", "refnd" is "refund", "trackin" is "tracking". Words the
// articles already know, and short or stop words, are left alone. corrected
// is null when nothing changed.
export function correctQuery(query: string, articles: { question: string; keywords: string }[]) {
  const vocabulary = new Set<string>();
  for (const article of articles) for (const word of `${article.question} ${article.keywords}`.toLowerCase().match(/[a-z]+/g) ?? []) if (word.length >= 3) vocabulary.add(word);
  const known = new Set([...vocabulary].map(stem));
  const words = [...vocabulary];
  let changed = false;
  const corrected = query.toLowerCase().replace(/[a-z]+/g, (word) => {
    // A misspelling the search already knows, written as meant.
    if (TYPOS[word]) { changed = true; return TYPOS[word]; }
    if (word.length < 4 || STOP.has(word) || COMMON.has(word) || vocabulary.has(word) || known.has(stem(word))) return word;
    // A word the search already understands ("smashed" is damage) isn't a misspelling.
    if (SAME.some(([pattern]) => pattern.test(word) || pattern.test(stem(word)))) return word;
    const most = word.length <= 5 ? 1 : 2;
    let best = "";
    let bestDistance = most + 1;
    for (const candidate of words) {
      // A misspelling nearly always starts right: "parcel" isn't "cancel", nor "door" "poor".
      if (candidate[0] !== word[0]) continue;
      // A word typed partly ("trackin"): the article's word it starts. A letter
      // left out is the commonest slip, so "noify" is "notify" before "noisy",
      // and "cary" "carry" before "card".
      const distance = candidate.startsWith(word) && candidate.length - word.length <= 3 ? 0.5
        : editDistance(word, candidate, most) - (candidate.length > word.length && within(word, candidate) ? 0.25 : 0);
      // Between two as close, the word that says something: "witdh" is "width", not "with".
      if (distance < bestDistance || (distance === bestDistance && STOP.has(best) && !STOP.has(candidate))) { best = candidate; bestDistance = distance; }
    }
    if (!best) return word;
    changed = true;
    return best;
  });
  return changed ? corrected : null;
}

// bodyWeight: how much the answer's words count (0.2 by default). A store
// policy or page has no keywords, so its text counts for more.
type Searchable = { id: string; question: string; keywords: string; answer: string; bodyWeight?: number };

const phrasesOf = (keywords: string) => keywords.split(",").map((phrase) => phrase.trim().toLowerCase()).filter(Boolean);
// For matching keyword phrases: "havent recieved" is "haven't received".
const plain = (text: string) => ` ${text.toLowerCase().replace(/[’‘']/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/[a-z]+/g, (word) => TYPOS[word] ?? word).replace(/\s+/g, " ").trim()} `;

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
// loose: for a search nothing matched closely, anything that shares a telling
// word, so the customer still sees what's related.
export function rankArticles<T extends Searchable>(articles: T[], query: string, limit = 6, { loose = false } = {}): { article: T; score: number; share: number; coverage: number }[] {
  const asked = [...new Set(searchWords(query))];
  if (!articles.length) return [];
  // Only everyday words ("when will i get it", "don't want it"): the articles
  // with that very phrase as a keyword. Too little for the assistant to be
  // sure (share and coverage 0), so it asks back with them as suggestions.
  if (!asked.length) {
    const whole = plain(query);
    if (whole.trim().length < 4) return [];
    return articles.filter((article) => phrasesOf(article.keywords).some((phrase) => plain(phrase) === whole)).slice(0, limit)
      .map((article) => ({ article, score: 1, share: 0, coverage: 0 }));
  }
  // The words of what was asked, in any order: "handle broken" is the keyword "broken handle".
  const wordsKey = (words: string[]) => [...new Set(words)].sort().join(" ");
  const askedKey = wordsKey(asked);
  const indexed = articles.map((article) => {
    const phrases = phrasesOf(article.keywords);
    const question = new Set(searchWords(article.question));
    const whole = new Set([wordsKey([...question]), ...phrases.map((phrase) => wordsKey(searchWords(phrase)))]);
    const spans = phrases.filter((phrase) => phrase.includes(" ")).map(plain);
    // A keyword on its own ("refund") says more than a word that's only part
    // of a phrase ("down" in "site down").
    const single = new Set(phrases.filter((phrase) => !phrase.includes(" ")).flatMap(searchWords));
    const keywords = new Set(phrases.flatMap(searchWords));
    return { article, spans, question, whole, single, keywords, answer: new Set(searchWords(article.answer)) };
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
  const scored = indexed.map(({ article, spans, question, whole, single, keywords, answer }) => {
    let score = 0;
    let matched = 0;
    let inQuestion = 0;
    for (const word of known) {
      const weight = question.has(word) ? 1 : single.has(word) ? 0.85 : keywords.has(word) ? 0.65 : answer.has(word) ? article.bodyWeight ?? 0.2 : 0;
      score += rarity(word) * weight;
      // An answer-only word barely says the article is about it.
      if (weight >= 0.5) matched++;
      if (question.has(word)) inQuestion++;
    }
    for (const span of spans) if (lower.includes(span)) score += 1.5;
    // Everything asked is one of its keywords (or its question), word for word.
    if (score > 0 && whole.has(askedKey)) score += 1;
    // Between equal matches, the article whose question is most about what was asked.
    const tie = question.size ? inQuestion / question.size / 4 : 0;
    return { article, score, tie, share: score / total, coverage: matched / asked.length };
  });
  const best = Math.max(...scored.map((entry) => entry.score));
  // A short question must be mostly answered; a long email only in its key words.
  const needed = loose ? 0.12 : known.length <= 3 ? 0.4 : known.length <= 8 ? 0.22 : 0.12;
  const floor = loose ? Math.min(0.5, total * 0.25) : Math.min(1.2, total * 0.5);
  return scored
    // (With only a few articles every word is "common", so the floor scales down.)
    .filter((entry) => entry.score > 0 && entry.score >= floor && entry.share >= needed && entry.score >= best * (loose ? 0.4 : 0.55))
    .sort((x, y) => y.score + y.tie - (x.score + x.tie))
    .slice(0, limit)
    .map(({ article, score, share, coverage }) => ({ article, score, share, coverage }));
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
