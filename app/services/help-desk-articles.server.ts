import type { PrismaClient } from "@prisma/client";
import { correctQuery, MAX_SECTION_LENGTH, rankArticles, sectionsFromHtml, starterArticles, storeFacts, validAction } from "./help-desk-articles";
import { aiRelated } from "./help-desk-ai.server";
import { loadShippingSetup, shippingSettings } from "./help-desk-shipping.server";
import { forget, memo } from "./memo.server";

type AdminClient = { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };
const MINUTE = 60_000;

// An answer as the storefront shows it. source: article (written by the
// store), store (its live shipping settings and contact details), or policy,
// page or product (read from Shopify, with a link to it).
export type Answer = {
  id: string; question: string; answer: string; collection: string; action: string;
  source: "article" | "store" | "policy" | "page" | "product"; url: string; image: string;
};

// ---------- The store's articles ----------

// A starter article's lasting name, so it's added to a store once and a store
// that deleted it isn't given it again. (Rewording a starter question makes it
// a new article.)
export const starterKey = (question: string) => question.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const dismissedOf = (value: string | null | undefined) => new Set((value || "").split(",").map((key) => key.trim()).filter(Boolean));

// Starter articles the store doesn't have yet and hasn't deleted, so a store
// gets new ones as they're written. Checked at most every 10 minutes.
const seededKey = (shop: string) => `articles-seeded|${shop}`;
export const ensureArticles = (db: PrismaClient, shop: string) => memo(seededKey(shop), 10 * MINUTE, () => addMissingStarters(db, shop));

async function addMissingStarters(db: PrismaClient, shop: string) {
  const [settings, rows] = await Promise.all([
    db.helpDeskSettings.findUnique({ where: { shop }, select: { dismissedArticles: true } }),
    db.helpDeskFaq.findMany({ where: { shop }, select: { id: true, question: true, starterKey: true, keywords: true, answer: true, collection: true, action: true, edited: true } }),
  ]);
  const dismissed = dismissedOf(settings?.dismissedArticles);
  // Articles added before starter keys existed are matched by their question.
  const byQuestion = new Map(starterArticles.map((article) => [article.question.trim().toLowerCase(), starterKey(article.question)]));
  const byKey = new Map(starterArticles.map((article) => [starterKey(article.question), article]));
  const have = new Set<string>();
  for (const row of rows) {
    const key = row.starterKey || byQuestion.get(row.question.trim().toLowerCase()) || "";
    if (!key) continue;
    have.add(key);
    if (!row.starterKey) await db.$executeRaw`UPDATE "HelpDeskFaq" SET "starterKey" = ${key} WHERE "id" = ${row.id}`;
    // A better worded starter (new keywords, a clearer answer) replaces the
    // store's copy, unless the team has edited it: their words always stay.
    const latest = byKey.get(key);
    if (latest && !row.edited && (row.keywords !== latest.keywords || row.answer !== latest.answer || row.collection !== latest.collection || row.action !== latest.action)) {
      await db.$executeRaw`UPDATE "HelpDeskFaq" SET "keywords" = ${latest.keywords}, "answer" = ${latest.answer}, "collection" = ${latest.collection}, "action" = ${latest.action} WHERE "id" = ${row.id}`;
    }
  }
  const missing = starterArticles.filter((article) => !have.has(starterKey(article.question)) && !dismissed.has(starterKey(article.question)));
  if (missing.length) await db.helpDeskFaq.createMany({ data: missing.map((article) => ({ shop, ...article, starterKey: starterKey(article.question) })) });
  return missing.length;
}

// Deleting a starter article remembers it, so it isn't added back.
export async function deleteArticle(db: PrismaClient, shop: string, id: string) {
  const row = await db.helpDeskFaq.findFirst({ where: { id, shop }, select: { starterKey: true } });
  if (!row) return false;
  await db.helpDeskFaq.delete({ where: { id } });
  if (row.starterKey) {
    const settings = await db.helpDeskSettings.findUnique({ where: { shop }, select: { dismissedArticles: true } });
    const dismissed = [...dismissedOf(settings?.dismissedArticles), row.starterKey].join(",");
    await db.helpDeskSettings.upsert({ where: { shop }, update: { dismissedArticles: dismissed }, create: { shop, dismissedArticles: dismissed } });
  }
  return true;
}

// Every deleted starter article, added back (the store's own edits stay).
export async function restoreStarterArticles(db: PrismaClient, shop: string) {
  await db.helpDeskSettings.upsert({ where: { shop }, update: { dismissedArticles: "" }, create: { shop } });
  forget(seededKey(shop));
  return addMissingStarters(db, shop);
}

export const listArticles = (db: PrismaClient, shop: string) =>
  db.helpDeskFaq.findMany({ where: { shop }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

const articleAnswer = (row: { id: string; question: string; answer: string; collection: string; action: string }): Answer =>
  ({ id: row.id, question: row.question, answer: row.answer, collection: row.collection, action: validAction(row.action) ? row.action : "", source: "article", url: "", image: "" });

// ---------- From Shopify ----------

const POLICIES_QUERY = `#graphql
  query HelpDeskPolicies { shop { shopPolicies { type title body url } } }
`;
const PAGES_QUERY = `#graphql
  query HelpDeskPages($after: String) {
    pages(first: 100, after: $after, query: "published_status:published") { nodes { id title handle body } pageInfo { hasNextPage endCursor } }
    shop { primaryDomain { url } }
  }
`;
const CATALOG_QUERY = `#graphql
  query HelpDeskCatalog($after: String) {
    products(first: 100, after: $after, query: "status:active") {
      nodes {
        id title description productType onlineStoreUrl featuredImage { url(transform: { maxWidth: 160 }) }
        priceRangeV2 { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
        variants(first: 30) { nodes { title availableForSale } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
const STORE_QUERY = `#graphql
  query HelpDeskStoreInfo { shop { email contactEmail } }
`;

// Each kind is read on its own, so one Shopify hasn't granted (the policies
// and pages scopes are newer) doesn't stop the others.
type Source = { answers: Answer[]; error: string | null };
type Fetched = { policies: Source; pages: Source; products: Source };

async function query<T>(admin: AdminClient, text: string, variables?: Record<string, unknown>): Promise<T> {
  const json = await (await admin.graphql(text, variables ? { variables } : undefined)).json();
  if (json.errors?.length) throw new Error(json.errors.map((error: { message: string }) => error.message).join("; "));
  return json.data as T;
}
const failure = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);
const POLICY_COLLECTION = "Store Policies";
const PAGE_COLLECTION = "From Our Website";
const PRODUCT_COLLECTION = "Products";
const PAGE_LIMIT = 3;
const clip = (text: string) => text.length > MAX_SECTION_LENGTH ? `${text.slice(0, MAX_SECTION_LENGTH).replace(/\s+\S*$/, "")}...` : text;

async function readPolicies(admin: AdminClient): Promise<Source> {
  try {
    const data = await query<{ shop: { shopPolicies: { type: string; title: string; body: string; url: string }[] } }>(admin, POLICIES_QUERY);
    const answers = data.shop.shopPolicies.filter((policy) => policy.body.trim()).flatMap((policy) =>
      sectionsFromHtml(policy.title, policy.body).map((section, index) => ({
        id: `policy:${policy.type}:${index}`, question: section.heading === policy.title ? policy.title : `${policy.title}: ${section.heading}`,
        answer: section.text, collection: POLICY_COLLECTION, action: "", source: "policy" as const, url: policy.url, image: "",
      })));
    return { answers, error: null };
  } catch (error) {
    return { answers: [], error: failure(error) };
  }
}

async function readPages(admin: AdminClient): Promise<Source> {
  try {
    const answers: Answer[] = [];
    let after: string | null = null;
    for (let page = 0; page < PAGE_LIMIT; page++) {
      const data: { pages: { nodes: { id: string; title: string; handle: string; body: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }; shop: { primaryDomain: { url: string } } } =
        await query(admin, PAGES_QUERY, { after });
      const home = data.shop.primaryDomain.url.replace(/\/$/, "");
      for (const node of data.pages.nodes) {
        sectionsFromHtml(node.title, node.body).forEach((section, index) => answers.push({
          id: `page:${node.id.split("/").pop()}:${index}`, question: section.heading, answer: section.text,
          collection: PAGE_COLLECTION, action: "", source: "page", url: `${home}/pages/${node.handle}`, image: "",
        }));
      }
      if (!data.pages.pageInfo.hasNextPage) break;
      after = data.pages.pageInfo.endCursor;
    }
    return { answers, error: null };
  } catch (error) {
    return { answers: [], error: failure(error) };
  }
}

type Money = { amount: string; currencyCode: string };
const money = ({ amount, currencyCode }: Money) => new Intl.NumberFormat("en", { style: "currency", currency: currencyCode || "USD" }).format(Number(amount));
type ProductNode = {
  id: string; title: string; description: string; productType: string; onlineStoreUrl: string | null; featuredImage: { url: string } | null;
  priceRangeV2?: { minVariantPrice: Money; maxVariantPrice: Money } | null; variants?: { nodes: { title: string; availableForSale: boolean }[] } | null;
};

// A product as an answer: its price, its options and whether they're in stock,
// then its description, so "how much is the Slab Case X" or "is it in black"
// is answered from the live catalog.
export function productAnswer(node: ProductNode): Answer {
  const lines: string[] = [];
  const range = node.priceRangeV2;
  if (range) lines.push(`Price: ${range.minVariantPrice.amount === range.maxVariantPrice.amount ? money(range.minVariantPrice) : `${money(range.minVariantPrice)} to ${money(range.maxVariantPrice)}`}`);
  const all = node.variants?.nodes ?? [];
  const variants = all.filter((variant) => variant.title && variant.title !== "Default Title");
  if (variants.length) {
    lines.push(`Options: ${variants.map((variant) => `${variant.title}${variant.availableForSale ? "" : " (sold out)"}`).join(", ")}`);
  }
  if (all.length) lines.push(all.some((variant) => variant.availableForSale) ? "In stock" : "Sold out right now");
  const text = node.description.replace(/\s+\n/g, "\n").trim();
  return {
    id: `product:${node.id.split("/").pop()}`, question: node.title, answer: clip([lines.join("\n"), text].filter(Boolean).join("\n\n")),
    collection: node.productType || PRODUCT_COLLECTION, action: "", source: "product", url: node.onlineStoreUrl || "", image: node.featuredImage?.url || "",
  };
}

async function readProducts(admin: AdminClient): Promise<Source> {
  try {
    const answers: Answer[] = [];
    let after: string | null = null;
    for (let page = 0; page < PAGE_LIMIT; page++) {
      const data: { products: { nodes: ProductNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } = await query(admin, CATALOG_QUERY, { after });
      // Only products customers can open on the store.
      for (const node of data.products.nodes) if (node.onlineStoreUrl) answers.push(productAnswer(node));
      if (!data.products.pageInfo.hasNextPage) break;
      after = data.products.pageInfo.endCursor;
    }
    return { answers, error: null };
  } catch (error) {
    return { answers: [], error: failure(error) };
  }
}

// The store's policies, pages and products, read again every 30 minutes (5
// when Shopify couldn't be read), so edits in Shopify show up on their own.
const shopifyKey = (shop: string) => `help-answers|${shop}`;
const retrying = new Set<string>();
export function shopifyAnswers(admin: AdminClient, shop: string): Promise<Fetched> {
  return memo(shopifyKey(shop), 30 * MINUTE, async () => {
    const [policies, pages, products] = await Promise.all([readPolicies(admin), readPages(admin), readProducts(admin)]);
    // Something couldn't be read: try again in 5 minutes rather than 30.
    if ((policies.error || pages.error || products.error) && !retrying.has(shop)) {
      retrying.add(shop);
      setTimeout(() => { retrying.delete(shop); forgetShopifyAnswers(shop); }, 5 * MINUTE).unref?.();
    }
    return { policies, pages, products };
  });
}
export const forgetShopifyAnswers = (shop: string) => { forget(shopifyKey(shop)); forget(contactKey(shop)); };

// The store's live facts: its shipping settings (from Shopify and the Help
// Desk's Shipping times) and the email customers can write to.
const contactKey = (shop: string) => `help-contact|${shop}`;
export async function liveFacts(db: PrismaClient, admin: AdminClient | undefined, shop: string, today = new Date()) {
  if (!admin) return [];
  const [setup, times, email] = await Promise.all([
    loadShippingSetup(admin, shop).catch(() => undefined),
    shippingSettings(db, shop),
    memo(contactKey(shop), 30 * MINUTE, () => query<{ shop: { email: string; contactEmail: string } }>(admin, STORE_QUERY)
      .then((data) => data.shop.contactEmail || data.shop.email || "").catch(() => "")),
  ]);
  return storeFacts({ email, setup, times }, today).map((fact) => ({ ...fact, source: "store" as const, url: "", image: "" }));
}

// Answers for a customer's question: the store's own articles and live facts
// first in a tie, then its policies and pages, then products, best match first.
export async function answerQuestion(db: PrismaClient, admin: AdminClient | undefined, shop: string, question: string, limit = 6): Promise<Answer[]> {
  return (await rankedAnswers(db, admin, shop, question, limit)).map((entry) => entry.answer);
}

// The same, with how sure each match is (see rankArticles), for the request page's assistant.
export async function rankedAnswers(db: PrismaClient, admin: AdminClient | undefined, shop: string, question: string, limit = 6, { loose = false } = {}) {
  const [rows, fetched, facts] = await Promise.all([
    listArticles(db, shop),
    admin ? shopifyAnswers(admin, shop).catch(() => null) : Promise.resolve(null),
    liveFacts(db, admin, shop).catch(() => []),
  ]);
  const articles = rows.map((row) => ({ ...articleAnswer(row), keywords: row.keywords }));
  const store = fetched ? [...fetched.policies.answers, ...fetched.pages.answers].map((answer) => ({ ...answer, keywords: "", bodyWeight: 0.6 })) : [];
  // Products by name and description, separately: a policy shouldn't lose to a product page.
  const products = fetched ? fetched.products.answers.map((answer) => ({ ...answer, keywords: "", bodyWeight: 0.4 })) : [];
  const found = [...rankArticles([...articles, ...facts, ...store], question, limit, { loose }), ...rankArticles(products, question, 3, { loose })];
  return found.slice(0, limit + 2).map(({ article: { id, question: title, answer, collection, action, source, url, image }, score, share, coverage }) =>
    ({ answer: { id, question: title, answer, collection, action, source, url, image } as Answer, score, share, coverage }));
}

// A help center search that always finds something. Best first:
// - what matches the words as typed (exact);
// - with misspellings fixed ("cancle" is "cancel"): correctedTo says what was searched;
// - anything sharing a telling word (related);
// - deep (they pressed Enter): what the AI finds by meaning, when it's on;
// - else the most helpful articles, so the customer is never left with nothing.
// Only an exact match counts as answered: the rest still goes on the team's
// "searches nothing answered" list.
export type SearchResult = { results: Answer[]; exact: boolean; correctedTo?: string; related?: boolean };
export async function searchAnswers(db: PrismaClient, admin: AdminClient | undefined, shop: string, question: string, { deep = false } = {}): Promise<SearchResult> {
  const exact = await answerQuestion(db, admin, shop, question);
  if (exact.length) return { results: exact, exact: true };
  const rows = await listArticles(db, shop);
  const corrected = correctQuery(question, rows);
  if (corrected) {
    const fixed = await answerQuestion(db, admin, shop, corrected);
    if (fixed.length) return { results: fixed, exact: false, correctedTo: corrected };
  }
  const loose = (await rankedAnswers(db, admin, shop, corrected ?? question, 6, { loose: true })).map((entry) => entry.answer);
  if (loose.length) return { results: loose, exact: false, related: true };
  if (deep) {
    const { knowledge } = await assistantSources(db, admin, shop, question);
    const ids = await memo(`help-related|${shop}|${question.toLowerCase()}`, 60 * MINUTE, () => aiRelated(question, knowledge));
    const byId = new Map(knowledge.map((answer) => [answer.id, answer]));
    const picked = ids.map((id) => byId.get(id)).filter((answer): answer is Answer => Boolean(answer));
    if (picked.length) return { results: picked, exact: false, related: true };
  }
  const popular = [...rows].sort((a, b) => (b.helpful ?? 0) - (a.helpful ?? 0)).slice(0, 5).map(articleAnswer);
  return { results: popular, exact: false, related: true };
}

// Everything the AI assistant may answer from: every article and live fact,
// the store's policies and pages, and the products that best match this
// question (the whole catalogue would be too much to read each time).
// knowledge is the same from one question to the next, so it can be cached.
export async function assistantSources(db: PrismaClient, admin: AdminClient | undefined, shop: string, question: string) {
  const [rows, fetched, facts] = await Promise.all([
    listArticles(db, shop),
    admin ? shopifyAnswers(admin, shop).catch(() => null) : Promise.resolve(null),
    liveFacts(db, admin, shop).catch(() => []),
  ]);
  const knowledge: Answer[] = [...rows.map(articleAnswer), ...facts, ...(fetched ? [...fetched.policies.answers, ...fetched.pages.answers.slice(0, 80)] : [])];
  const products = fetched ? rankArticles(fetched.products.answers.map((answer) => ({ ...answer, keywords: "", bodyWeight: 0.4 })), question, 5)
    .map(({ article: { id, question: title, answer, collection, action, source, url, image } }) => ({ id, question: title, answer, collection, action, source, url, image } as Answer)) : [];
  return { knowledge, products };
}

// One answer for its own page, by id (an article's own id, or "store:",
// "policy:", "page:" or "product:" ones), with others to read next: the rest
// of its collection (or answers like it) and the most helpful articles.
export async function answerPage(db: PrismaClient, admin: AdminClient | undefined, shop: string, id: string) {
  const rows = await listArticles(db, shop);
  const popular = [...rows].sort((a, b) => b.helpful - a.helpful).slice(0, 5).map(({ id: key, question }) => ({ id: key, question }));
  const row = rows.find((entry) => entry.id === id);
  if (row) {
    const related = rows.filter((entry) => entry.id !== row.id && entry.collection && entry.collection === row.collection).slice(0, 6).map(({ id: key, question }) => ({ id: key, question }));
    return { answer: { ...articleAnswer(row), updatedAt: row.updatedAt }, related, popular: popular.filter((entry) => entry.id !== row.id) };
  }
  if (!/^(store|policy|page|product):[\w:-]{1,120}$/.test(id) || !admin) return null;
  const [fetched, facts] = await Promise.all([shopifyAnswers(admin, shop).catch(() => null), liveFacts(db, admin, shop).catch(() => [])]);
  const all: Answer[] = [...facts, ...(fetched ? [...fetched.policies.answers, ...fetched.pages.answers, ...fetched.products.answers] : [])];
  const found = all.find((entry) => entry.id === id);
  if (!found) return null;
  // Answers like this one: the rest of the same policy or page, or the store's other live facts.
  const prefix = id.split(":").slice(0, 2).join(":");
  const related = all.filter((entry) => entry.id !== id && (found.source === "store" ? entry.source === "store" : entry.id.startsWith(`${prefix}:`))).slice(0, 6)
    .map(({ id: key, question }) => ({ id: key, question }));
  return { answer: { ...found, updatedAt: null }, related, popular };
}

// Customers' searches, kept for the team: what they asked and whether anything answered it.
export async function recordSearch(db: PrismaClient, shop: string, question: string, result: "faq" | "shopify" | "none", faqId?: string) {
  const text = question.replace(/\s+/g, " ").trim().slice(0, 300);
  if (text.length < 3) return;
  await db.helpDeskBotQuestion.create({ data: { shop, question: text, result, faqId: faqId || null } });
}

// A vote isn't an edit: raw SQL, so the article's last edit time stays.
export async function voteArticle(db: PrismaClient, shop: string, id: string, helpful: boolean) {
  const count = helpful
    ? await db.$executeRaw`UPDATE "HelpDeskFaq" SET "helpful" = "helpful" + 1 WHERE "id" = ${id} AND "shop" = ${shop}`
    : await db.$executeRaw`UPDATE "HelpDeskFaq" SET "notHelpful" = "notHelpful" + 1 WHERE "id" = ${id} AND "shop" = ${shop}`;
  return count > 0;
}

// What customers searched for that nothing answered, most asked first, for
// the team to write articles about. Similar wording is grouped by its words.
export async function unansweredSearches(db: PrismaClient, shop: string, days = 30) {
  const rows = await db.helpDeskBotQuestion.findMany({
    where: { shop, result: "none", createdAt: { gte: new Date(Date.now() - days * 24 * 60 * MINUTE) } },
    orderBy: { createdAt: "desc" }, take: 1000, select: { question: true, createdAt: true },
  });
  const groups = new Map<string, { question: string; count: number; lastAt: Date }>();
  for (const row of rows) {
    const key = row.question.toLowerCase().replace(/[^a-z0-9 ]+/g, "").split(/\s+/).filter(Boolean).sort().join(" ");
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { question: row.question, count: 1, lastAt: row.createdAt });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.lastAt.getTime() - a.lastAt.getTime()).slice(0, 25);
}

// How the store's Shopify content is feeding the search, for Settings.
export async function shopifySourcesStatus(db: PrismaClient, admin: AdminClient, shop: string) {
  const [fetched, facts] = await Promise.all([shopifyAnswers(admin, shop).catch(() => null), liveFacts(db, admin, shop).catch(() => [])]);
  const describe = (source: Source | undefined) => ({ count: source?.answers.length ?? 0, error: source ? source.error : "unavailable" });
  return {
    policies: describe(fetched?.policies), pages: describe(fetched?.pages), products: describe(fetched?.products),
    facts: facts.map((fact) => fact.question),
  };
}
