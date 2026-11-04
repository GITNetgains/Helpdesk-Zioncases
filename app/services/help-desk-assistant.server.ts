import type { PrismaClient } from "@prisma/client";
import { assistantSources, listArticles, rankedAnswers, type Answer } from "./help-desk-articles.server";
import { aiAssistantEnabled, aiDecide, type AiTurn } from "./help-desk-ai.server";
import { correctQuery, searchWords } from "./help-desk-articles";
import { ASSISTANT_COPY, CHAT_CLEARED, readAssistantCopy, withFirstName, type AssistantCopy } from "./help-desk-assistant";
import { asksHow, stepsText, wantsSteps } from "./help-desk-steps";
import { lookupTracking, type PublicTracking } from "./help-desk-orders.server";

// The order a request is about, from its form values.
function orderOf(details: string) {
  try { return String((JSON.parse(details || "{}") as Record<string, unknown>).orderNumber ?? "").trim(); } catch { return ""; }
}

// Asking where the order is, in any of the usual ways (and Hinglish).
const ORDER_STATUS = /\bwhere('?s| is)?\b[^?.!]*\b(order|package|parcel|stuff|shipment|delivery)\b|\btrack(ing)?\b|\b(order|delivery|shipping) status\b|\bstatus of (my|the) order\b|\b(has|did) (it|my order|the order) (ship|shipped|arrive|left)\b|\bshipped yet\b|\bwhen (will|does|is) (it|my order|the order|my package)\b[^?.!]*\b(arrive|come|ship|deliver)|\b(kab|kb) (aayega|ayega|aaega|milega|aaegi|ayegi)\b|\bkahan (hai|h)\b/i;
export const asksOrderStatus = (text: string) => ORDER_STATUS.test(text);

// The order's live status in a few lines: cancelled, on hold, being prepared,
// or each shipment with its carrier, tracking, and when it arrived or should.
const day = (iso: string | null) => iso ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(iso)) : "";
export function orderStatusText(tracking: PublicTracking) {
  const name = `Order ${tracking.order}`;
  if (tracking.cancelled) return `${name} was cancelled.`;
  if (tracking.onHold) return `${name} is on hold while our team checks it. We'll let you know here as soon as it moves.`;
  if (!tracking.shipped || !tracking.shipments.length) return `${name} hasn't shipped yet: it's being prepared. You'll get an email with tracking as soon as it leaves us.`;
  const lines = tracking.shipments.map((shipment, index) => {
    const which = tracking.shipments.length > 1 ? `Package ${index + 1}: ` : "";
    const how = [shipment.carrier, shipment.number && `tracking ${shipment.number}`].filter(Boolean).join(", ");
    const when = shipment.deliveredAt ? `Delivered ${day(shipment.deliveredAt)}.` : shipment.estimatedAt ? `Expected ${day(shipment.estimatedAt)}.` : "";
    return `${which}${shipment.label || "Shipped"}${how ? ` (${how})` : ""}. ${when}${shipment.url ? `\nTrack it: ${shipment.url}` : ""}`.trim();
  });
  return `Here's the latest on your order ${tracking.order}:\n\n${lines.join("\n\n")}`;
}

// The assistant in the chat on a customer's request page. When the customer
// writes, it answers straight away from the store's help articles, live
// shipping settings, policies, pages and products. With AI on
// (help-desk-ai.server.ts) Claude reads the message; otherwise keyword
// matching does. When it can't answer, it doesn't give up on the customer: it
// asks what they mean and shows the closest answers. Only when the customer
// asks for a person does it hand the chat to the team: the ticket is flagged
// "needs-human", raised to High priority, and the team is emailed. While the
// team has the chat it still answers what it's sure of, and otherwise tells
// the customer the team has their message: every message gets a reply.

type AdminClient = { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };
export const ASSISTANT = "Assistant";
export const HUMAN_TAG = "needs-human";

const ASKS_FOR_PERSON = /\b(human|person|people|agent|representative|rep|someone|somebody|staff|manager|supervisor|operator|live (chat|support)|real (person|human)|talk to|speak (to|with)|call me|phone me|customer (service|care))\b/i;
const GREETING = /^\s*(hi+|hello+|hey+|hiya|yo|howdy|hola|namaste|namaskar|salaam|salam|good (morning|afternoon|evening|day))\b[\s!.,]*(there|team|guys|zion|bhai|sir)?[\s!.,]*$/i;
const THANKS = /^\s*(thanks?|thank you|thank u|thanku|thnx|thanx|thx|ty|cheers|shukriya|dhanyavad|dhanyawad|ok(ay)?|great|perfect|awesome|got it|cool|nice|that helps?|that worked|solved)\b[\s\S]{0,40}$/i;

// Small talk: the whole message is chat, not a question about the store ("hi,
// how are you?"). A message that also asks something ("how are you, where's my
// order?") isn't, and is answered as a question.
export type SmallTalk = "howAreYou" | "whoAreYou" | "whatCanYouDo" | "stillThere" | "goodbye" | "sorry";
const SMALL_TALK: [SmallTalk, RegExp][] = [
  ["howAreYou", /^(how (are|r) (you|u|ya)( doing)?( today)?|how ?(is|s) (it going|your day|everything|life)|how do you do|hows it going|whats up|wassup|wazzup|sup|you good|hope (you are|youre) (well|good|doing well)|kaise ho( aap)?|aap kaise ho|kaisa hai|kya haal( hai)?|kya hal hai|sab (theek|thik|badhiya|badiya)( hai)?)$/],
  ["whoAreYou", /^(who (are|r) (you|u)|who is this|what (are|r) (you|u)|whats your name|what is your name|your name|(are|r) (you|u) (a |an )?(bot|robot|ai|chat ?bot|machine|computer|human|real|real person|real human|person|automated)|is this (a |an )?(bot|robot|ai|chat ?bot|automated|real person|human|person)|am i (talking|chatting|speaking) (to|with) (a |an )?(bot|robot|ai|human|real person|person|machine)|(aap|tum|ap) (kaun|kon) (ho|hai|hain))$/],
  ["whatCanYouDo", /^(what can (you|u) (do|help( me)? with)|how can (you|u) help( me)?|can (you|u) help( me)?|could (you|u) help( me)?|(i )?(need|want) (some )?help|help|help me|help please|please help( me)?|i have (a|some) (question|questions|problem|issue|query)|can i ask (you )?(a question|something)|i want to ask (a question|something)|madad|help chahiye|madad chahiye)$/],
  ["stillThere", /^((are|r) (you|u) (still )?there|(is )?any ?(one|body) (there|here|available)|you there|still there|hello+ (anyone|any one)|koi hai)$/],
  ["goodbye", /^(bye+|bye bye|good ?bye|see (you|ya|u)( later| soon)?|take care|good ?night|gn|thats (all|it)( for now)?|nothing else|no (thats|that is) (all|it)|im (good|done|all set|fine)|all (good|set|done)|have a (good|nice|great) (day|one|night|evening|weekend)|ok bye|chalo bye|alvida)$/],
  ["sorry", /^(sorry|so sorry|my bad|oops|apologies|my apologies|sorry for (the )?(trouble|bother|confusion|delay)|maaf karna|sorry bhai)$/],
];

// The message as small talk is matched: lower case, no punctuation or emoji,
// without a leading "hi"/"ok" or a trailing "there"/"please".
function smallTalkOf(message: string): SmallTalk | null {
  let text = message.toLowerCase().replace(/[’‘`]/g, "'").replace(/'/g, "").replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text || text.length > 80) return null;
  // Matched as written first, then with each filler word taken off ("are you
  // there" is asking, "hi there" isn't).
  const match = (candidate: string) => SMALL_TALK.find(([, pattern]) => pattern.test(candidate))?.[0] ?? null;
  const LEADING = /^(hi+|hey+|hello+|hiya|yo|ok|okay|so|um+|well|bhai|bro|sir|madam|dear|zion|team|guys|and|also|btw|good (morning|afternoon|evening))\s+/;
  const TRAILING = /\s+(there|bro|bhai|sir|madam|buddy|mate|friend|today|please|pls|plz|yaar|ji|zion|team|guys)$/;
  // One word at a time, the leading ones first.
  for (;;) {
    const found = match(text);
    if (found) return found;
    const shorter = LEADING.test(text) ? text.replace(LEADING, "") : text.replace(TRAILING, "");
    if (shorter === text) return null;
    text = shorter;
  }
}
const UNHELPFUL = /^\s*(no+|nope|not (really|helpful|what i (asked|need|meant))|that('s| is)? (didn'?t|does ?n'?t|did not|not) (help|work|answer)|(didn'?t|doesn'?t|does not|did not) (help|work|answer)|wrong answer|useless)\b/i;
// Don't turn a message rejecting an action into instructions to take that
// action: the assistant asks what they do want instead.
const DECLINED_ACTION = /\b(?:i\s+)?(?:do\s+not|don't|dont|never|not)\s+(?:want|need|plan|intend|trying|looking|asking)\b.{0,55}\b(?:cancel|refund|return|exchange|replace|change|buy|purchase)\b/i;

// When the assistant answers on its own: the best match covers most of what
// was asked (most of the customer's own words, not just the ones some article
// knows), and beats the next one. A tie is never guessed. When the next one is
// close and also a good match, the answer mentions it too, so a near miss
// still leads the customer to the right article.
export const SURE_SHARE = 0.55;
const SURE_MARGIN = 1.05;
const CLOSE_MARGIN = 1.25;
const sureCoverage = (words: number) => words <= 3 ? 0.6 : words <= 8 ? 0.5 : 0.45;

export type Decision =
  // reply: the AI's own wording of the answer (help-desk-ai.server.ts).
  | { kind: "answer"; answer: Answer; also?: Answer; reply?: string }
  // Not sure what they mean, or the answer didn't help: ask, and offer the
  // closest answers. reply: the AI's own words for it.
  | { kind: "clarify"; reason: "unsure" | "unhelpful" | "repeat"; suggestions: Answer[]; reply?: string }
  | { kind: "greet" }
  | { kind: "thanks" }
  | { kind: "smalltalk"; topic: SmallTalk }
  // The request's order, live from Shopify (asked where it is).
  | { kind: "orderStatus" }
  | { kind: "handoff"; reason: "asked" }
  | { kind: "silent" };

type Ranked = { answer: Answer; score: number; share: number; coverage: number }[];

// The closest answers to offer when the assistant isn't sure, leaving out the
// ones it already gave.
const suggestionsFrom = (ranked: Ranked, answered: string[]) => [...ranked].sort((a, b) => b.score - a.score)
  .map((entry) => entry.answer)
  .filter((answer, index, list) => !gave(answer, answered) && list.findIndex((other) => other.question === answer.question) === index)
  .slice(0, 3);

// Whether the assistant already gave this answer: its words are in one of its
// messages. (Older messages began with the answer's question instead.)
export const gave = (answer: Answer, answered: string[]) => answered.some((body) =>
  body.split("\n")[0] === answer.question || (answer.answer.trim().length >= 20 && body.includes(answer.answer.trim().slice(0, 160))));

// What to do with the customer's message. answered: the assistant's messages
// on this request so far, newest first, so it doesn't repeat itself.
export function decide(text: string, ranked: Ranked, answered: string[] = []): Decision {
  const message = text.trim();
  const quick = quickDecision(message);
  if (quick?.kind === "clarify") return { ...quick, suggestions: suggestionsFrom(ranked, answered) };
  if (quick) return quick;
  if (DECLINED_ACTION.test(message)) return { kind: "clarify", reason: "unsure", suggestions: [] };
  if (THANKS.test(message)) return { kind: "thanks" };
  const [best, next] = [...ranked].sort((a, b) => b.score - a.score);
  const words = searchWords(message).length;
  // Two close answers that say the same, or open the same request (or a topic
  // and one of its requests), aren't a real tie.
  const alike = (a: Answer, b: Answer) => a.answer === b.answer
    || Boolean(a.action && b.action && (a.action === b.action || a.action.startsWith(`${b.action} › `) || b.action.startsWith(`${a.action} › `)));
  const sure = best && best.share >= SURE_SHARE && best.coverage >= sureCoverage(words)
    && (!next || best.score >= next.score * SURE_MARGIN || alike(best.answer, next.answer));
  if (!sure) return { kind: "clarify", reason: "unsure", suggestions: suggestionsFrom(ranked, answered) };
  // Asked again after the same answer: it didn't help.
  if (gave(best.answer, answered)) return { kind: "clarify", reason: "repeat", suggestions: suggestionsFrom(ranked, answered) };
  const close = next && !alike(best.answer, next.answer) && best.score < next.score * CLOSE_MARGIN
    && next.share >= SURE_SHARE && next.coverage >= sureCoverage(words) && !gave(next.answer, answered);
  return close ? { kind: "answer", answer: best.answer, also: next.answer } : { kind: "answer", answer: best.answer };
}

// What needs no understanding: an empty message, small talk, asking for a
// person, a greeting, or saying the last answer didn't help. Small talk comes
// first: "are you a real person?" asks who they're talking to, not for a person.
function quickDecision(message: string): Decision | null {
  if (!message) return { kind: "silent" };
  const topic = smallTalkOf(message);
  if (topic) return { kind: "smalltalk", topic };
  if (ASKS_FOR_PERSON.test(message)) return { kind: "handoff", reason: "asked" };
  if (GREETING.test(message)) return { kind: "greet" };
  if (UNHELPFUL.test(message)) return { kind: "clarify", reason: "unhelpful", suggestions: [] };
  return null;
}

// With AI on, Claude reads the message (help-desk-ai.server.ts); without it,
// or when it can't be reached, the keyword matching above decides.
async function smartDecide(db: PrismaClient, admin: AdminClient | undefined, shop: string, text: string, answered: string[], history: AiTurn[]): Promise<Decision> {
  const message = text.trim();
  if (aiAssistantEnabled()) {
    const quick = quickDecision(message);
    // "No, that's not it" is for the AI too: it can see what it answered.
    if (quick && quick.kind !== "clarify") return quick;
    const { knowledge, products } = await assistantSources(db, admin, shop, message);
    const ai = await aiDecide({ message, history, knowledge, products });
    if (ai?.kind === "answer") return { kind: "answer", answer: ai.sources[0], reply: ai.reply };
    if (ai?.kind === "clarify") return { kind: "clarify", reason: "unsure", suggestions: [], reply: ai.reply };
    if (ai?.kind === "human") return { kind: "handoff", reason: "asked" };
    if (ai) return { kind: ai.kind };
  }
  return keywordDecide(db, admin, shop, text, answered);
}

// Without the AI: the message as written, or with its misspellings fixed when
// that matches clearly better ("cancle my ordr"). Not sure, and nothing close?
// Still offer what shares a word with it, so the customer has somewhere to go.
async function keywordDecide(db: PrismaClient, admin: AdminClient | undefined, shop: string, text: string, answered: string[]): Promise<Decision> {
  const corrected = correctQuery(text, await listArticles(db, shop));
  const [asWritten, fixed] = await Promise.all([
    rankedAnswers(db, admin, shop, text, 4),
    corrected ? rankedAnswers(db, admin, shop, corrected, 4) : Promise.resolve([]),
  ]);
  const best = (found: Ranked) => Math.max(0, ...found.map((entry) => entry.score));
  const useFixed = fixed.length > 0 && best(fixed) > best(asWritten) * 1.2;
  const decision = decide(useFixed && corrected ? corrected : text, useFixed ? fixed : asWritten, answered);
  if (decision.kind !== "clarify" || decision.reason !== "unsure" || decision.suggestions.length || DECLINED_ACTION.test(text)) return decision;
  const loose = await rankedAnswers(db, admin, shop, corrected ?? text, 4, { loose: true });
  return { ...decision, suggestions: suggestionsFrom(loose, answered) };
}

// The answer, with the form's steps for it when the customer asked how to do
// it or wants to do it (unless the AI's reply already walks them through it).
// It starts with the answer itself: the article's question ("Can I cancel my
// order?") is the customer's to ask, not the assistant's to say.
function answerBody(answer: Answer, asked: string, reply?: string) {
  const more = answer.url ? `\n\nMore details: ${answer.url}` : "";
  const walked = Boolean(reply && /(^|\n)\s*1[.)] /.test(reply));
  const steps = answer.action && wantsSteps(asked) && !walked ? stepsText(answer.action) : "";
  return `${reply ?? answer.answer}${more}${steps ? `\n\n${steps}` : ""}`;
}

// Not sure: a question back in the store's wording, the closest answers to
// ask about, and how to reach a person if they'd rather.
function clarifyBody(decision: Extract<Decision, { kind: "clarify" }>, firstName: string, copy: AssistantCopy) {
  const ask = decision.reply ?? withFirstName(decision.reason === "unsure" ? copy.notSure : copy.notHelped, firstName);
  const list = decision.suggestions.length
    ? `\n\nIt might be one of these. Just ask about it:\n${decision.suggestions.map((answer) => `- ${answer.question}`).join("\n")}` : "";
  return `${ask}${list}\n\n${withFirstName(copy.personHint, firstName)}`;
}

// The assistant's words, in the store's wording (Settings › Help articles).
// asked: the customer's message, for the steps when they asked how.
export function assistantMessage(decision: Decision, firstName = "", copy: AssistantCopy = ASSISTANT_COPY, asked = ""): string {
  switch (decision.kind) {
    case "answer":
      return `${answerBody(decision.answer, asked, decision.reply)}${decision.also ? `\n\nIf you meant something else, this might be it: "${decision.also.question}" Just ask.` : ""}\n\n${withFirstName(copy.followUp, firstName)}`;
    case "clarify":
      return clarifyBody(decision, firstName, copy);
    case "greet":
      return withFirstName(copy.greeting, firstName);
    case "thanks":
      return withFirstName(copy.thanks, firstName);
    case "smalltalk":
      return withFirstName(copy[decision.topic], firstName);
    case "handoff":
      return withFirstName(copy.handoffAsked, firstName);
    default:
      return "";
  }
}

// The help article the assistant answered with last on this request
// (answered: its messages, newest first), if the form has steps for it.
async function lastAnswerWithSteps(db: PrismaClient, shop: string, answered: string[]) {
  const articles: Answer[] = (await listArticles(db, shop)).map((row) => ({ id: row.id, question: row.question, answer: row.answer, collection: row.collection, action: row.action, source: "article", url: "", image: "" }));
  for (const body of answered.slice(0, 3)) {
    const match = articles.find((article) => gave(article, [body]));
    if (match) return match.action && stepsText(match.action) ? match : null;
  }
  return null;
}

export type Turn = { decision: Decision; reply: string; notifyTeam: boolean; handoff: boolean };

// The assistant's turn after a customer's message on their request page.
// notifyTeam: email the team about this message (the customer asked for a
// person, or the team is already handling the chat); otherwise the assistant
// has it.
export async function assistantTurn(db: PrismaClient, admin: AdminClient | undefined, shop: string, ticketId: string, text: string, now = new Date()): Promise<Turn> {
  const ticket = await db.helpDeskTicket.findFirst({
    where: { id: ticketId, shop },
    select: { id: true, name: true, email: true, details: true, priority: true, tags: true, humanRequestedAt: true, messages: { where: { OR: [{ kind: { in: ["customer", "reply", "bot"] } }, { kind: "event", body: CHAT_CLEARED }] }, orderBy: { createdAt: "desc" }, take: 30, select: { kind: true, body: true, createdAt: true } } },
  });
  const quiet: Turn = { decision: { kind: "silent" }, reply: "", notifyTeam: true, handoff: false };
  if (!ticket) return quiet;
  // Turned off in Settings: every message goes to the team, as before.
  const settings = await db.helpDeskSettings.findUnique({ where: { shop }, select: { assistantEnabled: true, assistantCopy: true } });
  if (settings && !settings.assistantEnabled) return quiet;
  if (!text.trim()) return quiet;
  // Once a person from the team is on the request (the customer asked for one,
  // or someone from the team replied), the assistant steps out for good:
  // it says nothing more, and every message goes to the team.
  if (ticket.humanRequestedAt || await db.helpDeskMessage.count({ where: { ticketId: ticket.id, kind: "reply" } })) return quiet;
  const firstName = ticket.name.trim().split(/\s+/)[0];
  const copy = readAssistantCopy(settings?.assistantCopy);
  // The customer always hears back, so a message never seems to vanish.
  const say = async (body: string) => { await db.helpDeskMessage.create({ data: { ticketId: ticket.id, kind: "bot", author: ASSISTANT, body, createdAt: new Date(now.getTime() + 1) } }); };
  // Photos or a video sent without words are for the team: say they arrived.
  if (/^Sent \d+ images?( and a video)?$|^Sent a video$/.test(text.trim())) {
    const reply = withFirstName(copy.photosReceived, firstName);
    await say(reply);
    return { decision: { kind: "silent" }, reply, notifyTeam: true, handoff: false };
  }
  // Since the customer last cleared the chat (newest first): it starts afresh from there.
  const cleared = ticket.messages.findIndex((message) => message.kind === "event");
  const since = cleared >= 0 ? ticket.messages.slice(0, cleared) : ticket.messages;
  const answered = since.filter((message) => message.kind === "bot").map((message) => message.body);
  // The chat so far, oldest first, for the AI. The customer's new message is
  // already saved as the newest one, so it's left out here.
  const earlier = [...since].reverse();
  if (earlier.at(-1)?.kind === "customer") earlier.pop();
  const history: AiTurn[] = earlier.map((message) => ({ role: message.kind === "customer" ? "customer" : message.kind === "bot" ? "assistant" : "team", text: message.body }));
  // A request about an order, asked where it is: the order's live status from
  // Shopify. (The order has to be the customer's: its email must match.)
  const orderNumber = orderOf(ticket.details);
  if (orderNumber && admin && asksOrderStatus(text)) {
    const tracking = await lookupTracking(admin, orderNumber, ticket.email).catch(() => undefined);
    if (tracking) {
      const reply = `${orderStatusText(tracking)}\n\n${withFirstName(copy.followUp, firstName)}`;
      await say(reply);
      return { decision: { kind: "orderStatus" }, reply, notifyTeam: false, handoff: false };
    }
  }
  // If understanding fails (Shopify or the AI down), the customer still hears back.
  let decision = await smartDecide(db, admin, shop, text, answered, history)
    .catch((error): Decision => { console.error(`Help Desk assistant could not read a message on ticket ${ticket.id}:`, error); return { kind: "clarify", reason: "unsure", suggestions: [] }; });
  if (decision.kind === "silent") return quiet;
  // On an order request, what the assistant can't answer is the team's: the
  // customer hears their request is in process, and the team is told.
  if (orderNumber && decision.kind === "clarify" && decision.reason === "unsure" && !asksHow(text)) {
    const reply = withFirstName(copy.orderInProcess, firstName);
    await say(reply);
    return { decision, reply, notifyTeam: true, handoff: false };
  }
  let reply = assistantMessage(decision, firstName, copy, text);
  // "What are the steps?" just after an answer: how to do what it said, on the form.
  if (decision.kind === "clarify" && !decision.reply && asksHow(text)) {
    const previous = await lastAnswerWithSteps(db, shop, answered);
    if (previous) {
      decision = { kind: "answer", answer: previous };
      reply = `${stepsText(previous.action)}\n\n${withFirstName(copy.followUp, firstName)}`;
    }
  }
  // Just after the customer's message, so the chat reads in order.
  await say(reply);
  if (decision.kind !== "handoff") return { decision, reply, notifyTeam: false, handoff: false };
  await handOff(db, shop, ticket, now);
  return { decision, reply, notifyTeam: true, handoff: true };
}

// Flags the request for the team: tagged needs-human, at least High
// priority, unread, with a note on the timeline saying why.
async function handOff(db: PrismaClient, shop: string, ticket: { id: string; priority: string; tags: string }, now: Date) {
  const tags = [...new Set([...ticket.tags.split(",").map((tag) => tag.trim()).filter(Boolean), HUMAN_TAG])].join(",");
  await db.helpDeskTicket.updateMany({
    where: { id: ticket.id, shop },
    data: { humanRequestedAt: now, tags, unread: true, lastActivityAt: now, ...(ticket.priority === "Low" || ticket.priority === "Normal" ? { priority: "High" } : {}) },
  });
  await db.helpDeskMessage.create({ data: { ticketId: ticket.id, kind: "event", author: ASSISTANT, body: "Customer asked to talk to a person. Waiting for a person from the team.", createdAt: new Date(now.getTime() + 2) } });
}

// The first answer on a new question (General Inquiry): only when the
// assistant is sure. The team gets the request either way.
export async function answerNewRequest(db: PrismaClient, admin: AdminClient | undefined, shop: string, ticketId: string, text: string, now = new Date()) {
  if (!text.trim()) return null;
  const settings = await db.helpDeskSettings.findUnique({ where: { shop }, select: { assistantEnabled: true } });
  if (settings && !settings.assistantEnabled) return null;
  const decision = await smartDecide(db, admin, shop, text, [], []);
  if (decision.kind !== "answer") return null;
  const reply = `While our team looks at your request, this might help:\n\n${answerBody(decision.answer, text, decision.reply)}\n\nIf it answers your question, there's nothing else to do. If not, our team will reply here.`;
  await db.helpDeskMessage.create({ data: { ticketId, kind: "bot", author: ASSISTANT, body: reply, createdAt: now } });
  return reply;
}
