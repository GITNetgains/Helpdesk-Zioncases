import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { articleActions, articleCollections, correctQuery, htmlText, rankArticles, searchArticles, sectionsFromHtml, starterArticles, storeFacts, validAction } from "../app/services/help-desk-articles";
import { answerQuestion, deleteArticle, searchAnswers, ensureArticles, productAnswer, recordSearch, restoreStarterArticles, unansweredSearches, voteArticle } from "../app/services/help-desk-articles.server";
import { assistantMessage, assistantTurn, decide, HUMAN_TAG } from "../app/services/help-desk-assistant.server";
import { ASSISTANT_COPY, CHAT_CLEARED, readAssistantCopy } from "../app/services/help-desk-assistant";
import { requestSteps, wantsSteps } from "../app/services/help-desk-steps";
import { addStaffMessage, asksToClearChat, clearCustomerChat, submitTicket } from "../app/services/help-desk.server";
import { renderRequestPage } from "../app/services/help-desk-request-page";
import { topics } from "../app/services/help-desk";

const articles = starterArticles.map((article, index) => ({ ...article, id: String(index) }));
const top = (question: string) => searchArticles(articles, question, 3)[0]?.question;

describe("Help articles", () => {
  it("files every starter article in a collection, with a button that opens a real request (or none)", () => {
    for (const article of starterArticles) {
      expect(articleCollections).toContain(article.collection);
      if (article.action) expect(validAction(article.action), `${article.question}: ${article.action}`).toBe(true);
    }
    expect(articleActions).toContain("Orders › Track Order");
    expect(articleActions).toContain("Product Issues");
    expect(validAction("Orders › Nothing")).toBe(false);
    expect(new Set(starterArticles.map((article) => article.question)).size).toBe(starterArticles.length);
  });

  it("answers every request customers can send from the form", () => {
    const used = new Set(starterArticles.map((article) => article.action));
    expect(articleActions.filter((action) => action.includes(" › ") && !used.has(action))).toEqual([]);
  });

  // Customers' own words, from the support team's issues sheet.
  it.each([
    ["Dented Slab Case", "My item arrived damaged or broken"],
    ["Horizontal Display Case(with risers) arrived wihout risers", "Something is missing from my order"],
    ["Unable to open case", "The lock won't open or won't take the combination"],
    ["Hawai", "Do you ship to Hawaii, Alaska and U.S. territories?"],
    ["Order on Hold due to safety issues", "Why is my order on hold?"],
    ["Faulty Risers Delivered with broken tabs", "A riser arrived broken or the pins snapped"],
    ["We just unboxed the lids this morning, and we found lines/marks we cannot remove from the lids.", "My case looks scratched, cloudy or not clear"],
    ["I bought one of these ur cases less than a year ago and the wheel fell off", "Is my case covered by warranty?"],
    ["Exchange request horizontal display case for vertical one", "I ordered the wrong model or colour. Can I exchange it?"],
    ["Got a email through yall and ups order was delivered and it didn't. I'm getting worried", "My tracking says delivered, but I don't have my package"],
    ["Can I buy some foam dividers that are in your cases?", "Can I buy replacement parts like wheels, risers, lids or foam?"],
    ["Failed Delivery", "The carrier couldn't deliver my package"],
    ["where is my order", "Where is my order?"],
    ["return policy", "What is your return policy?"],
    ["do you ship to canada", "Do you ship internationally?"],
  ])("answers %j", (question, expected) => {
    expect(top(question)).toBe(expected);
  });

  it("answers nothing when nothing fits, and reads product names as products", () => {
    expect(searchArticles(articles, "zxqv blorp")).toEqual([]);
    expect(searchArticles(articles, "")).toEqual([]);
    // "Scratch Resistant" and "Slab Case" are product names, not a scratch or a fit question.
    expect(top("Paris, France: Scratch Resistant Horizontal Display case")).not.toBe("My case looks scratched, cloudy or not clear");
    expect(top("Crack on slab case")).toBe("My item arrived damaged or broken");
  });

  it("cuts store policies and pages at their headings and bold questions", () => {
    const html = `<p>Intro text about our store and how we work.</p><h2>Returns</h2><p>Returns are accepted within 6 months.</p>`
      + `<p><strong>Do you ship to Canada?</strong></p><p>Yes, we ship to Canada &amp; the UK.</p><ul><li>Fast</li><li>Tracked</li></ul>`;
    expect(sectionsFromHtml("Shipping", html)).toEqual([
      { heading: "Shipping", text: "Intro text about our store and how we work." },
      { heading: "Returns", text: "Returns are accepted within 6 months." },
      { heading: "Do you ship to Canada?", text: "Yes, we ship to Canada & the UK.\n\n- Fast\n- Tracked" },
    ]);
    expect(htmlText("<p>One<br>Two</p><script>bad()</script>")).toBe("One\nTwo");
  });

  it("answers from the store's live shipping settings and contact email, with today's dates", () => {
    const rate = (name: string, price: number | null, minTotal: number | null = null) => ({ name, description: "", price, currency: "USD", minTotal, maxTotal: null, byWeight: false });
    const setup = {
      home: "US", currency: "USD", processingTime: null, zones: [
        { name: "Domestic", general: true, restOfWorld: false, countries: [{ code: "US", provinces: [] }], rates: [rate("Standard", 9.99), rate("Free Standard", 0, 75)] },
        { name: "Canada", general: true, restOfWorld: false, countries: [{ code: "CA", provinces: [] }], rates: [rate("International", 24)] },
      ],
    };
    const times = { processing: "1-2", rates: { Standard: "3-5" }, note: "" };
    // A Friday: business days skip the weekend.
    const facts = storeFacts({ email: "help@zion.test", setup, times }, new Date("2026-11-06T15:00:00Z"));
    const by = Object.fromEntries(facts.map((fact) => [fact.id, fact]));
    expect(by["store:countries"].answer).toContain("We ship to Canada and United States.");
    expect(by["store:processing"].answer).toContain("Orders ship within 1-2 business days (Monday to Friday). Order today and it leaves us by Monday, November 9 to Tuesday, November 10.");
    expect(by["store:rates"].answer).toContain("- Standard: $9.99, 3-5 business days in transit");
    expect(by["store:free-shipping"].answer).toContain("- Free Standard: on orders of $75.00 or more");
    expect(by["store:email"].answer).toContain("help@zion.test");
    expect(searchArticles(facts, "do you have free shipping")[0].id).toBe("store:free-shipping");
    expect(searchArticles(facts, "do you ship to canada")[0].id).toBe("store:countries");
    // Nothing is said that the settings don't say.
    expect(storeFacts({ email: "", setup: null, times: { processing: "", rates: {}, note: "" } })).toEqual([]);
  });

  it("answers a product's price, options and stock from the catalog", () => {
    const answer = productAnswer({
      id: "gid://shopify/Product/9", title: "Slab Case X", description: "Holds 9 slabs.", productType: "Cases", onlineStoreUrl: "https://zion.test/products/x", featuredImage: null,
      priceRangeV2: { minVariantPrice: { amount: "89.0", currencyCode: "USD" }, maxVariantPrice: { amount: "99.0", currencyCode: "USD" } },
      variants: { nodes: [{ title: "Black", availableForSale: true }, { title: "Blue", availableForSale: false }] },
    });
    expect(answer).toMatchObject({ id: "product:9", question: "Slab Case X", collection: "Cases", source: "product" });
    expect(answer.answer).toBe("Price: $89.00 to $99.00\nOptions: Black, Blue (sold out)\nIn stock\n\nHolds 9 slabs.");
  });
});

describe("Search typos", () => {
  it("fixes misspelled and half-typed words to ones the articles use, and leaves real words alone", () => {
    const fix = (text: string) => correctQuery(text, starterArticles);
    expect(fix("cancle my order")).toBe("cancel my order");
    expect(fix("where is my refnd")).toBe("where is my refund");
    expect(fix("trackin")).toBe("tracking");
    expect(fix("warrenty claim")).toBe("warranty claim");
    // Everyday words aren't "fixed" into other words.
    expect(fix("changed my mind")).toBeNull();
    expect(fix("it came smashed")).toBeNull();
    expect(fix("i dont want it anymore")).toBeNull();
    expect(fix("where is my order")).toBeNull();
    expect(fix("hi")).toBeNull();
  });
});

describe("The request page's assistant", () => {
  const sure = (question: string, share = 0.8, score = 6, coverage = 1) => ({ answer: { id: question, question, answer: `About ${question}.`, collection: "", action: "", source: "article" as const, url: "", image: "" }, score, share, coverage });
  it("answers when it's sure, asks back otherwise, and hands over only when asked", () => {
    expect(decide("where is my refund", [sure("Where is my refund?")])).toMatchObject({ kind: "answer", answer: { question: "Where is my refund?" } });
    expect(decide("blorp", [])).toMatchObject({ kind: "clarify", reason: "unsure" });
    expect(decide("refund", [sure("Where is my refund?", 0.3)])).toMatchObject({ kind: "clarify", reason: "unsure" });
    // Most of what the customer wrote isn't about the article: not sure.
    expect(decide("my dog chewed the handle", [sure("Can a wheel be replaced?", 1, 3, 0.33)])).toMatchObject({ kind: "clarify", reason: "unsure" });
    // Two different answers about as good: not sure which.
    expect(decide("return", [sure("A", 0.5, 5), sure("B", 0.48, 4.9)])).toMatchObject({ kind: "clarify", reason: "unsure" });
    expect(decide("Can I talk to a real person please", [sure("Where is my refund?")])).toEqual({ kind: "handoff", reason: "asked" });
    expect(decide("I don't want to cancel my order", [sure("Can I cancel my order?")])).toMatchObject({ kind: "clarify", reason: "unsure" });
    expect(decide("I do not need a refund, I need to change the delivery address", [sure("Where is my refund?")])).toMatchObject({ kind: "clarify", reason: "unsure" });
    expect(decide("that didn't help", [sure("Where is my refund?")])).toMatchObject({ kind: "clarify", reason: "unhelpful" });
    expect(decide("where is my refund", [sure("Where is my refund?")], ["Where is my refund?"])).toMatchObject({ kind: "clarify", reason: "repeat" });
    expect(decide("Hi there!", [])).toEqual({ kind: "greet" });
    expect(decide("thanks so much", [])).toEqual({ kind: "thanks" });
    expect(assistantMessage({ kind: "greet" }, "Sandy")).toMatch(/^Hi Sandy!/);
    expect(assistantMessage({ kind: "answer", answer: { ...sure("Where is my refund?").answer, url: "https://zion.test/policies/refund-policy" } }))
      .toBe("About Where is my refund?.\n\nMore details: https://zion.test/policies/refund-policy\n\nDid that answer your question? If not, reply \"talk to a person\" and someone from our team will take over.");
    // Knows what it already said from the words of its answer, as well as from older messages' first line.
    expect(decide("where is my refund", [sure("Where is my refund?")], ["About Where is my refund?.\n\nDid that answer your question?"])).toMatchObject({ kind: "clarify", reason: "repeat" });
    // The store's own wording, with the customer's name where it asks for it.
    const copy = readAssistantCopy(JSON.stringify({ greeting: "Hey {first_name}, welcome to Zion!", thanks: "  " }));
    expect(assistantMessage({ kind: "greet" }, "Sandy", copy)).toBe("Hey Sandy, welcome to Zion!");
    expect(assistantMessage({ kind: "greet" }, "", copy)).toBe("Hey, welcome to Zion!");
    expect(assistantMessage({ kind: "thanks" }, "Sandy", copy)).toBe(ASSISTANT_COPY.thanks);
    expect(readAssistantCopy("not json")).toEqual(ASSISTANT_COPY);
  });

  it("chats back to small talk, and still answers a question asked with it", () => {
    const talk = (text: string) => { const decision = decide(text, []); return decision.kind === "smalltalk" ? decision.topic : decision.kind; };
    for (const text of ["How are you?", "hi how are you doing today", "Hey, how's it going?", "what's up", "kaise ho bhai", "kya haal hai"]) expect(talk(text), text).toBe("howAreYou");
    for (const text of ["Who are you?", "are you a bot?", "Are you a real person?", "is this a human", "what's your name", "aap kaun ho"]) expect(talk(text), text).toBe("whoAreYou");
    for (const text of ["can you help me?", "I need help", "help", "I have a question", "can I ask something"]) expect(talk(text), text).toBe("whatCanYouDo");
    for (const text of ["are you there?", "anyone there??", "hello anyone there"]) expect(talk(text), text).toBe("stillThere");
    for (const text of ["bye", "ok bye", "that's all", "have a nice day!", "good night"]) expect(talk(text), text).toBe("goodbye");
    for (const text of ["sorry", "my bad"]) expect(talk(text), text).toBe("sorry");
    // Not small talk: a question with it, or asking for a person.
    expect(talk("Can I talk to a human?")).toBe("handoff");
    expect(talk("hi")).toBe("greet");
    expect(talk("thank you so much")).toBe("thanks");
    expect(talk("hi how are you, where is my order")).not.toBe("howAreYou");
    expect(talk("I need help with my refund")).not.toBe("whatCanYouDo");
    expect(assistantMessage({ kind: "smalltalk", topic: "howAreYou" }, "Sandy")).toMatch(/^I'm doing great, thanks for asking Sandy! How can I help/);
    expect(assistantMessage({ kind: "smalltalk", topic: "stillThere" })).toBe("Yes, I'm here! What can I help you with?");
  });

  it("explains how to do it on the form, step by step, when the customer asks how", () => {
    const cancel = { ...sure("Can I cancel my order?").answer, action: "Orders › Cancel Order" };
    const how = assistantMessage({ kind: "answer", answer: cancel }, "", ASSISTANT_COPY, "how do I cancel my order?");
    expect(how).toContain("How to do it:\n\n1. On our Help Desk page, choose \"I have a question about an order\".\n2. Pick your order (or \"My order isn't listed\").\n3. Choose Orders as the category and Cancel Order under \"What would you like to do?\", then press Continue with this order.\n4. Check it's the right order");
    expect(requestSteps("Other Queries › Payment Issue")[2]).toBe("Choose Other order questions as the category and Payment Issue under \"What would you like to do?\", then press Continue with this order.");
    // Not about an order: its own button, or every topic.
    expect(requestSteps("Shipping › International Shipping").slice(0, 2)).toEqual(["On our Help Desk page, choose \"My question isn't about an order\".", "Press International Shipping."]);
    expect(requestSteps("Other Queries › PSA slab fit")[1]).toBe("Press Product Query, choose PSA slab fit and press Continue with this question.");
    expect(requestSteps("Wholesale Queries")[0]).toBe("On our Help Desk page, press \"See all topics\" and choose Wholesale Queries.");
    expect(how).toMatch(/\n\d\. Press Submit Request\./);
    // Not asked how: the answer alone.
    expect(assistantMessage({ kind: "answer", answer: cancel }, "", ASSISTANT_COPY, "my order was cancelled?")).not.toContain("How to do it");
    // Saying they want to do it gets the steps too, in English or Hinglish.
    for (const wants of ["I want to cancel my order", "cancel my order please", "please cancel it", "order cancel karna hai", "mujhe order cancel karwana hai", "I'd like to change my address"]) {
      expect(wantsSteps(wants), wants).toBe(true);
    }
    for (const asking of ["my order was cancelled?", "where is my refund", "the lid arrived broken", "do you ship to canada"]) {
      expect(wantsSteps(asking), asking).toBe(false);
    }
    expect(assistantMessage({ kind: "answer", answer: cancel }, "", ASSISTANT_COPY, "I want to cancel my order")).toContain("How to do it:\n\n1.");
    // The AI's own walk-through isn't repeated underneath.
    const walked = assistantMessage({ kind: "answer", answer: cancel, reply: "Sure:\n1. Choose Orders.\n2. Choose Cancel Order." }, "", ASSISTANT_COPY, "I want to cancel my order");
    expect(walked).not.toContain("How to do it");
    expect(requestSteps("Product Issues › Damaged or Defective")).toContain("Choose what happened: Damaged in shipping, Broken on arrival, Doesn't work properly.");
    expect(requestSteps("Wholesale Queries")[1]).toBe("Choose the option that fits your question, and follow the steps it shows.");
    expect(requestSteps("Nowhere › Nothing")).toEqual([]);
    // Every starter answer's action is on the form, so its steps are right.
    expect(articles.filter((article) => article.action && !requestSteps(article.action).length).map((article) => article.action)).toEqual([]);
  });

  // What customers write in the chat, from the support team's issues sheet and
  // everyday questions, and the article that answers each ("" for a person).
  // The assistant must never give a wrong answer, and should answer all the rest.
  const chat: [string, string][] = [
    ["how long does a refund take to show up", "Where is my refund?"], ["where is my refund", "Where is my refund?"], ["I haven't got my refund yet", "Where is my refund?"],
    ["where is my order", "Where is my order?"], ["has my order shipped", "My order hasn't shipped yet"], ["my order still hasn't shipped", "My order hasn't shipped yet"],
    ["tracking says delivered but I don't have it", "My tracking says delivered, but I don't have my package"], ["it says delivered but nothing arrived", "My tracking says delivered, but I don't have my package"],
    ["only part of my order came", "Only part of my order arrived"], ["can I cancel my order", "Can I cancel my order?"], ["I want to cancel", "Can I cancel my order?"],
    ["can I change the colour on my order", "Can I change an item, colour or quantity on my order?"], ["I need to change my shipping address", "Can I change my shipping address?"],
    ["my package is lost", "My package is lost or the tracking hasn't moved"], ["tracking hasn't moved in a week", "My package is lost or the tracking hasn't moved"],
    ["do you ship to canada", "Do you ship internationally?"], ["do you ship to hawaii", "Do you ship to Hawaii, Alaska and U.S. territories?"], ["will I pay customs fees", "Will I pay customs, duties or taxes?"],
    ["can I get it faster", "Can I get faster or expedited shipping?"], ["what is your return policy", "What is your return policy?"], ["how long do I have to return it", "What is your return policy?"],
    ["I ordered the wrong colour can I exchange it", "I ordered the wrong model or colour. Can I exchange it?"], ["I ordered horizontal instead of vertical", "I ordered the wrong model or colour. Can I exchange it?"],
    ["I ordered 2 but only need 1", "I ordered more than I need. Can I return the extra?"], ["who pays for return shipping", "Who pays for return shipping?"],
    ["my case arrived cracked", "My item arrived damaged or broken"], ["the lid came broken", "My item arrived damaged or broken"], ["one of the lids came with a chip", "My item arrived damaged or broken"],
    ["one of my risers is broken", "A riser arrived broken or the pins snapped"], ["the risers are missing", "Something is missing from my order"], ["the vertical display case came without risers", "Something is missing from my order"],
    ["my free sling bag wasn't in the box", "Is the free gift included with my order? | Something is missing from my order"],
    ["I got the wrong colour", "I received the wrong item, colour or risers"], ["I received a blue backpack instead of black", "I received the wrong item, colour or risers"],
    ["the case looks cloudy", "My case looks scratched, cloudy or not clear"], ["there are scratches on the lid", "My case looks scratched, cloudy or not clear"],
    ["how do I remove the film", "How do I remove the protective film?"], ["the lid won't close", "The lid doesn't close properly or the latches don't line up"],
    ["I can't open the lock", "The lock won't open or won't take the combination"], ["how do I reset the combination", "How do I set or reset the lock combination?"],
    ["the bottom is bowing", "The bottom of my case is bowing or not flat"], ["is my case under warranty", "What does the warranty cover? | Is my case covered by warranty?"],
    ["the wheel fell off after 2 months", "Is my case covered by warranty?"], ["the hinge broke after a few months", "Is my case covered by warranty?"],
    ["can I buy extra foam dividers", "Can I buy replacement parts like wheels, risers, lids or foam?"], ["will psa slabs fit", "Will PSA slabs fit in my case?"],
    ["does it fit graded guards", "Will graded guards fit in my case?"], ["will 35pt magnetic holders fit", "Will One Touch or magnetic holders fit in my case?"],
    ["what are the dimensions", "What are the dimensions of a case?"], ["how do I clean the acrylic", "How do I clean my case?"], ["my discount code doesn't work", "My discount code isn't working"],
    ["why is my order on hold", "Why is my order on hold?"], ["I was charged twice", "My payment didn't go through, or I was charged twice"], ["my card was declined", "My payment didn't go through, or I was charged twice"],
    ["cancel armorship", "How do I cancel shipping protection?"], ["I need an invoice", "Can I get an invoice or receipt?"], ["checkout isn't working", "Checkout isn't working"],
    ["I can't log in", "I can't sign in to my account"], ["do you sell wholesale", "Do you offer wholesale?"], ["is there a minimum order for wholesale", "Is there a minimum order for wholesale?"],
    ["can you put my logo on cases", "Can you make cases with my logo?"], ["how do I become an affiliate", "How do I become an affiliate?"], ["when is my pre-order shipping", "What happens with my pre-order?"],
    ["any update on my warranty claim", "What's the status of my warranty claim or request?"], ["how much is shipping", "How long does shipping take, and what does it cost?"],
    ["what is your email", " | How do I contact customer support?"],
    ["is the vault ventilated for the cards", ""], ["my dog chewed the handle", ""], ["can you call me tomorrow at 5", ""], ["I want to complain about the delivery driver being rude", ""],
    ["what's the weather", ""], ["asdf", ""], ["is the slab case x in stock", ""], ["my order number is 101170", ""],
    // Its answer covers an order already placed: send the date it's needed by.
    ["I need it by saturday", " | Can I get faster or expedited shipping?"],
    // Facts from the store's policies and FAQ.
    ["do you offer free shipping", "Do you offer free shipping?"], ["what is armorship", "What is ARMORSHIP® package protection?"], ["how many slabs fit in the slab case xl", "How many slabs fit in a slab case?"],
    ["is the case waterproof", "Are your cases waterproof?"], ["do gift cards expire", "How do gift cards work?"], ["what is the default lock code", "How do I set or reset the lock combination?"],
    ["can i take the slab case on a plane", "Can I take my case on a plane?"], ["how do i cancel my order", "Can I cancel my order?"], ["how can i return my case", "What is your return policy?"],
  ];
  it.each(chat)("answers %j right, or passes it to a person", (text, expected) => {
    const ranked = rankArticles(articles.map((article) => ({ ...article, source: "article" as const, url: "", image: "" })), text, 4)
      .map(({ article, score, share, coverage }) => ({ answer: article, score, share, coverage }));
    const decision = decide(text, ranked);
    const got = decision.kind === "answer" ? decision.answer.question : "";
    expect(expected.split(" | "), `got "${got || decision.kind}"`).toContain(got);
  });
});

describe("Help articles in the database", () => {
  const temp = mkdtempSync(join(tmpdir(), "help-desk-articles-"));
  const db = new PrismaClient({ datasourceUrl: `file:${join(temp, "test.sqlite").replaceAll("\\", "/")}` });
  const shop = "articles.myshopify.com";
  beforeAll(async () => {
    for (const migration of readdirSync("prisma/migrations").filter(name => name.includes("help_desk")).sort()) {
      const sql = readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8");
      for (const statement of sql.split(";").filter(value => value.trim())) await db.$executeRawUnsafe(statement);
    }
  });
  afterAll(async () => { await db.$disconnect(); rmSync(temp, { recursive: true, force: true }); });

  it("adds starter articles a store doesn't have, and remembers the ones it deleted", async () => {
    await ensureArticles(db, shop);
    expect(await db.helpDeskFaq.count({ where: { shop } })).toBe(starterArticles.length);
    const first = await db.helpDeskFaq.findFirstOrThrow({ where: { shop } });
    expect(first.starterKey).not.toBe("");
    expect(await deleteArticle(db, shop, first.id)).toBe(true);
    expect(await deleteArticle(db, shop, first.id)).toBe(false);
    expect((await db.helpDeskSettings.findUniqueOrThrow({ where: { shop } })).dismissedArticles).toBe(first.starterKey);
    // A store from before the newest articles: they're added on its next visit, deleted ones aren't.
    const later = "older.myshopify.com";
    await db.helpDeskFaq.createMany({ data: starterArticles.slice(0, 5).map((article) => ({ shop: later, ...article })) });
    await db.helpDeskSettings.create({ data: { shop: later, dismissedArticles: "will-you-make-it-in-another-colour" } });
    await ensureArticles(db, later);
    expect(await db.helpDeskFaq.count({ where: { shop: later } })).toBe(starterArticles.length - 1);
    expect(await db.helpDeskFaq.count({ where: { shop: later, starterKey: "" } })).toBe(0);
    // Restore brings every deleted one back.
    expect(await restoreStarterArticles(db, shop)).toBe(1);
    expect(await restoreStarterArticles(db, shop)).toBe(0);
    expect(await db.helpDeskFaq.count({ where: { shop } })).toBe(starterArticles.length);
  });

  it("brings unedited starter articles up to date, and never touches the team's edits", async () => {
    const refreshShop = "refresh.myshopify.com";
    await ensureArticles(db, refreshShop);
    const [old, edited] = await db.helpDeskFaq.findMany({ where: { shop: refreshShop }, take: 2, orderBy: { createdAt: "asc" } });
    // An older copy of a starter, as a store seeded before it was improved.
    await db.$executeRaw`UPDATE "HelpDeskFaq" SET "keywords" = 'old words' WHERE "id" = ${old.id}`;
    // One the team rewrote in Settings.
    await db.helpDeskFaq.update({ where: { id: edited.id }, data: { keywords: "our own words", edited: true } });
    // A vote isn't an edit.
    expect(await voteArticle(db, refreshShop, old.id, true)).toBe(true);
    await restoreStarterArticles(db, refreshShop);
    const latest = (question: string) => starterArticles.find((article) => article.question === question)!;
    expect((await db.helpDeskFaq.findUniqueOrThrow({ where: { id: old.id } })).keywords).toBe(latest(old.question).keywords);
    expect((await db.helpDeskFaq.findUniqueOrThrow({ where: { id: edited.id } })).keywords).toBe("our own words");
    expect((await db.helpDeskFaq.findUniqueOrThrow({ where: { id: old.id } })).helpful).toBe(1);
  });

  it("clears the chat for the customer on \"clear chat\", and keeps every message for the team", async () => {
    for (const text of ["clear chat", "Clear the chat please", "reset conversation", "start over", "chat clear karo", "clear"]) expect(asksToClearChat(text), text).toBe(true);
    for (const text of ["how do I clear the acrylic", "the lid is not clear", "clear chat and also where is my order"]) expect(asksToClearChat(text), text).toBe(false);
    const { ticketId } = await submitTicket(db, shop, (() => {
      const body = new FormData();
      for (const [key, value] of Object.entries({ requestKey: crypto.randomUUID(), name: "Sandy Lee", email: "sandy@example.com", topic: topics[5], query: "General question" })) body.set(key, value);
      return body;
    })());
    const ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId! } });
    await assistantTurn(db, undefined, shop, ticketId!, "where is my refund");
    const before = await db.helpDeskMessage.count({ where: { ticketId } });
    expect(await clearCustomerChat(db, shop, ticket.accessToken)).toMatchObject({ errors: {}, ticketId });
    const all = await db.helpDeskMessage.findMany({ where: { ticketId }, orderBy: { createdAt: "asc" } });
    // Nothing deleted: a note for the team, then the assistant's fresh start.
    expect(all.length).toBe(before + 2);
    expect(all.at(-2)).toMatchObject({ kind: "event", body: CHAT_CLEARED });
    expect(all.at(-1)).toMatchObject({ kind: "bot", body: "Done Sandy, I've cleared the chat. Your request is still saved with our team. What can I help you with?" });
    // The customer sees only what came after it, without their original request.
    const visible = all.filter((message) => ["customer", "reply", "bot"].includes(message.kind) || message.body === CHAT_CLEARED);
    const html = renderRequestPage({ ...ticket, messages: visible }, { imageCounts: new Map(), requestImages: 0, products: [], receivedProducts: [], canReply: true, maxImages: 3, maxLength: 5000 });
    expect(html).toContain("I&#39;ve cleared the chat");
    expect(html).not.toContain("General question");
    expect(html.match(/class="hdt-msg"/g)?.length).toBe(1);
    // The assistant starts afresh too: the refund answer isn't "already given".
    const again = await assistantTurn(db, undefined, shop, ticketId!, "where is my refund");
    expect(again).toMatchObject({ decision: { kind: "answer", answer: { question: "Where is my refund?" } } });
    expect(await clearCustomerChat(db, shop, "0".repeat(48))).toMatchObject({ errors: { form: expect.any(String) } });
  });

  it("answers in the request page chat, asks back when unsure, and hands over when asked", async () => {
    const { ticketId } = await submitTicket(db, shop, (() => {
      const body = new FormData();
      for (const [key, value] of Object.entries({ requestKey: crypto.randomUUID(), name: "Sandy Lee", email: "sandy@example.com", topic: topics[5], query: "General question" })) body.set(key, value);
      return body;
    })());
    const bots = () => db.helpDeskMessage.findMany({ where: { ticketId, kind: "bot" }, orderBy: { createdAt: "asc" } });
    const hi = await assistantTurn(db, undefined, shop, ticketId!, "hello");
    expect(hi).toMatchObject({ decision: { kind: "greet" }, notifyTeam: false, handoff: false });
    const refund = await assistantTurn(db, undefined, shop, ticketId!, "how long does a refund take to show up");
    expect(refund).toMatchObject({ decision: { kind: "answer", answer: { question: "Where is my refund?" } }, notifyTeam: false });
    // The answer itself, not the article's question as if the assistant were asking it.
    expect((await bots()).at(-1)?.body).not.toMatch(/^Where is my refund\?/);
    expect((await bots()).at(-1)?.body).toMatch(/refund/i);
    // Not sure: it asks back and offers a person, but keeps the chat.
    const unsure = await assistantTurn(db, undefined, shop, ticketId!, "my dog chewed the handle");
    expect(unsure).toMatchObject({ decision: { kind: "clarify" }, notifyTeam: false, handoff: false });
    expect((await bots()).at(-1)?.body).toContain("talk to a person");
    expect((await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId } })).humanRequestedAt).toBeNull();
    // Photos alone are for the team, and the customer hears they arrived.
    expect(await assistantTurn(db, undefined, shop, ticketId!, "Sent 2 images")).toMatchObject({ decision: { kind: "silent" }, notifyTeam: true });
    expect((await bots()).at(-1)?.body).toMatch(/^Thanks Sandy, we've got them/);
    const person = await assistantTurn(db, undefined, shop, ticketId!, "can I speak to a human please");
    expect(person).toMatchObject({ decision: { kind: "handoff", reason: "asked" }, notifyTeam: true, handoff: true });
    let ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket.humanRequestedAt).not.toBeNull();
    expect(ticket.priority).toBe("High");
    expect(ticket.tags.split(",")).toContain(HUMAN_TAG);
    expect((await db.helpDeskMessage.findFirstOrThrow({ where: { ticketId, kind: "event" }, orderBy: { createdAt: "desc" } })).body).toBe("Customer asked to talk to a person. Waiting for a person from the team.");
    // Waiting for a person: the assistant steps out. Nothing more from it, and the team hears every message.
    const quietBefore = (await bots()).length;
    expect(await assistantTurn(db, undefined, shop, ticketId!, "where is my order")).toMatchObject({ decision: { kind: "silent" }, reply: "", notifyTeam: true, handoff: false });
    expect(await assistantTurn(db, undefined, shop, ticketId!, "how are you?")).toMatchObject({ decision: { kind: "silent" }, notifyTeam: true });
    // A person replies: the flag comes off...
    await addStaffMessage(db, shop, ticketId!, { kind: "reply", body: "Hi Sandy, Priya here.", author: "Priya" });
    ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket.humanRequestedAt).toBeNull();
    expect(ticket.tags.split(",")).not.toContain(HUMAN_TAG);
    // ...and the assistant still stays out: the chat is Priya's.
    expect(await assistantTurn(db, undefined, shop, ticketId!, "where is my refund")).toMatchObject({ decision: { kind: "silent" }, notifyTeam: true });
    expect(await assistantTurn(db, undefined, shop, ticketId!, "Sent 2 images")).toMatchObject({ decision: { kind: "silent" }, notifyTeam: true });
    expect((await bots()).length).toBe(quietBefore);
  });

  it("always finds something: misspellings fixed, other words for the same thing, else related or popular answers", async () => {
    // "agent" is how to reach the team.
    const agent = await searchAnswers(db, undefined, shop, "agent");
    expect(agent.exact).toBe(true);
    expect(agent.results.map((answer) => answer.question)).toContain("How do I contact customer support?");
    // Misspelled: searched as meant, and says so.
    const typo = await searchAnswers(db, undefined, shop, "cancle my ordr");
    expect(typo).toMatchObject({ exact: false, correctedTo: "cancel my order" });
    expect(typo.results[0].question).toBe("Can I cancel my order?");
    // Nothing like it: still something to read, and it isn't counted as answered.
    const nothing = await searchAnswers(db, undefined, shop, "zxqv blorp");
    expect(nothing).toMatchObject({ exact: false, related: true });
    expect(nothing.results.length).toBeGreaterThan(0);
    // Without the AI, Enter still gets the related or popular answers.
    expect((await searchAnswers(db, undefined, shop, "zxqv blorp", { deep: true })).results.length).toBeGreaterThan(0);
  });

  it("answers from the store's own articles without Shopify, and counts votes", async () => {
    const found = await answerQuestion(db, undefined, shop, "my riser came broken");
    expect(found[0]).toMatchObject({ question: "A riser arrived broken or the pins snapped", source: "article", action: "Product Issues › Damaged or Defective" });
    expect(await voteArticle(db, shop, found[0].id, true)).toBe(true);
    expect(await voteArticle(db, "other.myshopify.com", found[0].id, true)).toBe(false);
    expect((await db.helpDeskFaq.findUniqueOrThrow({ where: { id: found[0].id } })).helpful).toBe(1);
  });

  it("answers from the store's policies and products when Shopify is reachable", async () => {
    const admin = { graphql: async (query: string) => Response.json(
      query.includes("HelpDeskPolicies") ? { data: { shop: { shopPolicies: [{ type: "REFUND_POLICY", title: "Refund policy", url: "https://zion.test/policies/refund-policy", body: "<h3>Restocking fee</h3><p>Opened items carry a 15% restocking fee.</p>" }] } } }
        : query.includes("HelpDeskPages") ? { errors: [{ message: "Access denied for pages field." }] }
          : { data: { products: { nodes: [{ id: "gid://shopify/Product/1", title: "Titanium Slab Vault", description: "Holds 120 PSA slabs.", onlineStoreUrl: "https://zion.test/products/vault", featuredImage: null }], pageInfo: { hasNextPage: false, endCursor: null } } } }) };
    const fee = await answerQuestion(db, admin, "shopify.myshopify.com", "is there a restocking fee");
    expect(fee[0]).toMatchObject({ question: "Refund policy: Restocking fee", source: "policy", url: "https://zion.test/policies/refund-policy" });
    const vault = await answerQuestion(db, admin, "shopify.myshopify.com", "titanium vault");
    expect(vault.some((answer) => answer.source === "product" && answer.url === "https://zion.test/products/vault")).toBe(true);
  });

  it("groups searches nothing answered, most asked first", async () => {
    await recordSearch(db, shop, "Do you sell gift cards?", "none");
    await recordSearch(db, shop, "do you sell gift cards", "none");
    await recordSearch(db, shop, "Bluetooth tracker?", "none");
    await recordSearch(db, shop, "where is my order", "faq");
    await recordSearch(db, shop, "x", "none");
    const unanswered = await unansweredSearches(db, shop);
    expect(unanswered.map(({ question, count }) => [question, count])).toEqual([["do you sell gift cards", 2], ["Bluetooth tracker?", 1]]);
  });
});
