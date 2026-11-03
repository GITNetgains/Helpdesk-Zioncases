import type { PrismaClient } from "@prisma/client";
import { assistantSources, rankedAnswers, type Answer } from "./help-desk-articles.server";
import { aiAssistantEnabled, aiDecide, type AiTurn } from "./help-desk-ai.server";
import { searchWords } from "./help-desk-articles";
import { ASSISTANT_COPY, readAssistantCopy, withFirstName, type AssistantCopy } from "./help-desk-assistant";
import { asksHow, stepsText, wantsSteps } from "./help-desk-steps";

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
const MINUTE = 60_000;
export const ASSISTANT = "Assistant";
export const HUMAN_TAG = "needs-human";

const ASKS_FOR_PERSON = /\b(human|person|people|agent|representative|rep|someone|somebody|staff|manager|supervisor|operator|live (chat|support)|real (person|human)|talk to|speak (to|with)|call me|phone me|customer (service|care))\b/i;
const GREETING = /^\s*(hi+|hello+|hey+|hiya|yo|good (morning|afternoon|evening)|greetings)\b[\s!.,]*(there|team|guys|zion)?[\s!.,]*$/i;
const THANKS = /^\s*(thanks?|thank you|thx|ty|cheers|ok(ay)?|great|perfect|awesome|got it|cool|that helps?|that worked|solved)\b[\s\S]{0,40}$/i;
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
  | { kind: "handoff"; reason: "asked" }
  | { kind: "silent" };

type Ranked = { answer: Answer; score: number; share: number; coverage: number }[];

// The closest answers to offer when the assistant isn't sure, leaving out the
// ones it already gave.
const suggestionsFrom = (ranked: Ranked, answered: string[]) => [...ranked].sort((a, b) => b.score - a.score)
  .map((entry) => entry.answer)
  .filter((answer, index, list) => !answered.includes(answer.question) && list.findIndex((other) => other.question === answer.question) === index)
  .slice(0, 3);

// What to do with the customer's message. answered: what the assistant
// already answered on this request, so it doesn't repeat itself.
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
  if (answered.includes(best.answer.question)) return { kind: "clarify", reason: "repeat", suggestions: suggestionsFrom(ranked, answered) };
  const close = next && !alike(best.answer, next.answer) && best.score < next.score * CLOSE_MARGIN
    && next.share >= SURE_SHARE && next.coverage >= sureCoverage(words) && !answered.includes(next.answer.question);
  return close ? { kind: "answer", answer: best.answer, also: next.answer } : { kind: "answer", answer: best.answer };
}

// What needs no understanding: an empty message, asking for a person, a
// greeting, or saying the last answer didn't help.
function quickDecision(message: string): Decision | null {
  if (!message) return { kind: "silent" };
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
  return decide(text, await rankedAnswers(db, admin, shop, text, 4), answered);
}

// The answer, with the form's steps for it when the customer asked how to do
// it or wants to do it (unless the AI's reply already walks them through it).
function answerBody(answer: Answer, asked: string, reply?: string) {
  const more = answer.url ? `\n\nMore details: ${answer.url}` : "";
  const walked = Boolean(reply && /(^|\n)\s*1[.)] /.test(reply));
  const steps = answer.action && wantsSteps(asked) && !walked ? stepsText(answer.action) : "";
  return `${answer.question}\n\n${reply ?? answer.answer}${more}${steps ? `\n\n${steps}` : ""}`;
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
    case "handoff":
      return withFirstName(copy.handoffAsked, firstName);
    default:
      return "";
  }
}

// The answer's title, as the first line of the assistant's message.
const answeredTitle = (body: string) => body.split("\n")[0];

// The assistant's latest answer on this request (titles, newest first), if
// the form has steps for it.
async function lastAnswerWithSteps(db: PrismaClient, admin: AdminClient | undefined, shop: string, answered: string[]) {
  for (const title of answered.slice(0, 3)) {
    const match = (await rankedAnswers(db, admin, shop, title, 3)).find(({ answer }) => answer.question === title)?.answer;
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
    select: { id: true, name: true, priority: true, tags: true, humanRequestedAt: true, messages: { where: { kind: { in: ["customer", "reply", "bot"] } }, orderBy: { createdAt: "desc" }, take: 30, select: { kind: true, body: true, createdAt: true } } },
  });
  const quiet: Turn = { decision: { kind: "silent" }, reply: "", notifyTeam: true, handoff: false };
  if (!ticket) return quiet;
  // Turned off in Settings: every message goes to the team, as before.
  const settings = await db.helpDeskSettings.findUnique({ where: { shop }, select: { assistantEnabled: true, assistantCopy: true } });
  if (settings && !settings.assistantEnabled) return quiet;
  if (!text.trim()) return quiet;
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
  // The team has the chat: after a handoff, or a reply from them in the last two hours.
  const lastReply = ticket.messages.find((message) => message.kind === "reply");
  const teamHasChat = Boolean(ticket.humanRequestedAt || (lastReply && now.getTime() - lastReply.createdAt.getTime() < 120 * MINUTE));
  const answered = ticket.messages.filter((message) => message.kind === "bot").map((message) => answeredTitle(message.body));
  // The chat so far, oldest first, for the AI. The customer's new message is
  // already saved as the newest one, so it's left out here.
  const earlier = [...ticket.messages].reverse();
  if (earlier.at(-1)?.kind === "customer") earlier.pop();
  const history: AiTurn[] = earlier.map((message) => ({ role: message.kind === "customer" ? "customer" : message.kind === "bot" ? "assistant" : "team", text: message.body }));
  // If understanding fails (Shopify or the AI down), the customer still hears back.
  let decision = await smartDecide(db, admin, shop, text, answered, history)
    .catch((error): Decision => { console.error(`Help Desk assistant could not read a message on ticket ${ticket.id}:`, error); return { kind: "clarify", reason: "unsure", suggestions: [] }; });
  if (decision.kind === "silent") return quiet;
  // While the team has the chat, the assistant still answers what it's sure
  // of (the team sees it too), and otherwise lets the customer know the team
  // has their message. Asking for a person again flags it again.
  if (teamHasChat && decision.kind !== "handoff") {
    const reply = decision.kind === "answer" ? assistantMessage(decision, firstName, copy, text) : withFirstName(copy.teamHasIt, firstName);
    await say(reply);
    return { decision: decision.kind === "answer" ? decision : { kind: "silent" }, reply, notifyTeam: true, handoff: false };
  }
  if (teamHasChat && ticket.humanRequestedAt) {
    // Already waiting for a person: say so again rather than flag twice.
    const reply = withFirstName(copy.teamHasIt, firstName);
    await say(reply);
    return { decision, reply, notifyTeam: true, handoff: false };
  }
  let reply = assistantMessage(decision, firstName, copy, text);
  // "What are the steps?" just after an answer: how to do what it said, on the form.
  if (decision.kind === "clarify" && !decision.reply && asksHow(text)) {
    const previous = await lastAnswerWithSteps(db, admin, shop, answered);
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
