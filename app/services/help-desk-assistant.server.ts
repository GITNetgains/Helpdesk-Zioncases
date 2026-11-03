import type { PrismaClient } from "@prisma/client";
import { rankedAnswers, type Answer } from "./help-desk-articles.server";
import { searchWords } from "./help-desk-articles";
import { ASSISTANT_COPY, readAssistantCopy, withFirstName, type AssistantCopy } from "./help-desk-assistant";
import { asksHow, stepsText } from "./help-desk-steps";

// The assistant in the chat on a customer's request page. When the customer
// writes, it answers straight away from the store's help articles, live
// shipping settings, policies, pages and products, if it's sure of the answer.
// When it isn't, or the customer asks for a person, or an answer didn't help,
// it hands the chat to the team: the ticket is flagged "needs-human", raised to
// High priority, and the team is emailed. From then on it stays out of the way.

type AdminClient = { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };
const MINUTE = 60_000;
export const ASSISTANT = "Assistant";
export const HUMAN_TAG = "needs-human";

const ASKS_FOR_PERSON = /\b(human|person|people|agent|representative|rep|someone|somebody|staff|manager|supervisor|operator|live (chat|support)|real (person|human)|talk to|speak (to|with)|call me|phone me|customer (service|care))\b/i;
const GREETING = /^\s*(hi+|hello+|hey+|hiya|yo|good (morning|afternoon|evening)|greetings)\b[\s!.,]*(there|team|guys|zion)?[\s!.,]*$/i;
const THANKS = /^\s*(thanks?|thank you|thx|ty|cheers|ok(ay)?|great|perfect|awesome|got it|cool|that helps?|that worked|solved)\b[\s\S]{0,40}$/i;
const UNHELPFUL = /^\s*(no+|nope|not (really|helpful|what i (asked|need|meant))|that('s| is)? (didn'?t|does ?n'?t|did not|not) (help|work|answer)|(didn'?t|doesn'?t|does not|did not) (help|work|answer)|wrong answer|useless)\b/i;

// When the assistant answers on its own: the best match covers most of what
// was asked (most of the customer's own words, not just the ones some article
// knows), and clearly beats the next one. A tie is never guessed.
export const SURE_SHARE = 0.45;
const SURE_MARGIN = 1.05;
const sureCoverage = (words: number) => words <= 3 ? 0.6 : words <= 8 ? 0.5 : 0.35;

export type Decision =
  | { kind: "answer"; answer: Answer }
  | { kind: "greet" }
  | { kind: "thanks" }
  | { kind: "handoff"; reason: "asked" | "unsure" | "unhelpful" | "repeat" }
  | { kind: "silent" };

type Ranked = { answer: Answer; score: number; share: number; coverage: number }[];

// What to do with the customer's message. answered: what the assistant
// already answered on this request, so it doesn't repeat itself.
export function decide(text: string, ranked: Ranked, answered: string[] = []): Decision {
  const message = text.trim();
  if (!message) return { kind: "silent" };
  if (ASKS_FOR_PERSON.test(message)) return { kind: "handoff", reason: "asked" };
  if (GREETING.test(message)) return { kind: "greet" };
  if (UNHELPFUL.test(message)) return { kind: "handoff", reason: "unhelpful" };
  if (THANKS.test(message)) return { kind: "thanks" };
  const [best, next] = [...ranked].sort((a, b) => b.score - a.score);
  const words = searchWords(message).length;
  // Two close answers that say the same, or open the same request (or a topic
  // and one of its requests), aren't a real tie.
  const alike = (a: Answer, b: Answer) => a.answer === b.answer
    || Boolean(a.action && b.action && (a.action === b.action || a.action.startsWith(`${b.action} › `) || b.action.startsWith(`${a.action} › `)));
  const sure = best && best.share >= SURE_SHARE && best.coverage >= sureCoverage(words)
    && (!next || best.score >= next.score * SURE_MARGIN || alike(best.answer, next.answer));
  if (!sure) return { kind: "handoff", reason: "unsure" };
  // Asked again after the same answer: it didn't help.
  if (answered.includes(best.answer.question)) return { kind: "handoff", reason: "repeat" };
  return { kind: "answer", answer: best.answer };
}

// The answer, with the form's steps for it when the customer asked how to do it.
function answerBody(answer: Answer, asked: string) {
  const more = answer.url ? `\n\nMore details: ${answer.url}` : "";
  const steps = answer.action && asksHow(asked) ? stepsText(answer.action) : "";
  return `${answer.question}\n\n${answer.answer}${more}${steps ? `\n\n${steps}` : ""}`;
}

// The assistant's words, in the store's wording (Settings › Help articles).
// asked: the customer's message, for the steps when they asked how.
export function assistantMessage(decision: Decision, firstName = "", copy: AssistantCopy = ASSISTANT_COPY, asked = ""): string {
  switch (decision.kind) {
    case "answer":
      return `${answerBody(decision.answer, asked)}\n\n${withFirstName(copy.followUp, firstName)}`;
    case "greet":
      return withFirstName(copy.greeting, firstName);
    case "thanks":
      return withFirstName(copy.thanks, firstName);
    case "handoff":
      return withFirstName(decision.reason === "asked" ? copy.handoffAsked : decision.reason === "unsure" ? copy.handoffUnsure : copy.handoffUnhelpful, firstName);
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
// notifyTeam: email the team about this message (a handoff, or the team is
// already handling the chat); otherwise the assistant has answered it.
export async function assistantTurn(db: PrismaClient, admin: AdminClient | undefined, shop: string, ticketId: string, text: string, now = new Date()): Promise<Turn> {
  const ticket = await db.helpDeskTicket.findFirst({
    where: { id: ticketId, shop },
    select: { id: true, name: true, priority: true, tags: true, humanRequestedAt: true, messages: { where: { kind: { in: ["reply", "bot"] } }, orderBy: { createdAt: "desc" }, take: 20, select: { kind: true, body: true, createdAt: true } } },
  });
  const quiet: Turn = { decision: { kind: "silent" }, reply: "", notifyTeam: true, handoff: false };
  if (!ticket) return quiet;
  // Turned off in Settings: every message goes to the team, as before.
  const settings = await db.helpDeskSettings.findUnique({ where: { shop }, select: { assistantEnabled: true, assistantCopy: true } });
  if (settings && !settings.assistantEnabled) return quiet;
  // The team has the chat: after a handoff, or a reply from them in the last two hours.
  const lastReply = ticket.messages.find((message) => message.kind === "reply");
  if (ticket.humanRequestedAt || (lastReply && now.getTime() - lastReply.createdAt.getTime() < 120 * MINUTE)) return quiet;
  // Photos or a video sent without words are for the team.
  if (!text.trim() || /^Sent \d+ images?( and a video)?$|^Sent a video$/.test(text.trim())) return quiet;
  const ranked = await rankedAnswers(db, admin, shop, text, 4);
  const answered = ticket.messages.filter((message) => message.kind === "bot").map((message) => answeredTitle(message.body));
  let decision = decide(text, ranked, answered);
  if (decision.kind === "silent") return quiet;
  const firstName = ticket.name.trim().split(/\s+/)[0];
  const copy = readAssistantCopy(settings?.assistantCopy);
  let reply = assistantMessage(decision, firstName, copy, text);
  // "What are the steps?" just after an answer: how to do what it said, on the form.
  if (decision.kind === "handoff" && decision.reason === "unsure" && asksHow(text)) {
    const previous = await lastAnswerWithSteps(db, admin, shop, answered);
    if (previous) {
      decision = { kind: "answer", answer: previous };
      reply = `${stepsText(previous.action)}\n\n${withFirstName(copy.followUp, firstName)}`;
    }
  }
  // Just after the customer's message, so the chat reads in order.
  await db.helpDeskMessage.create({ data: { ticketId: ticket.id, kind: "bot", author: ASSISTANT, body: reply, createdAt: new Date(now.getTime() + 1) } });
  if (decision.kind !== "handoff") return { decision, reply, notifyTeam: false, handoff: false };
  await handOff(db, shop, ticket, decision.reason, now);
  return { decision, reply, notifyTeam: true, handoff: true };
}

const HANDOFF_NOTE = {
  asked: "Customer asked to talk to a person.",
  unsure: "The assistant couldn't answer the customer's question.",
  unhelpful: "The customer said the assistant's answer didn't help.",
  repeat: "The customer asked again after the assistant's answer.",
} as const;

// Flags the request for the team: tagged needs-human, at least High
// priority, unread, with a note on the timeline saying why.
async function handOff(db: PrismaClient, shop: string, ticket: { id: string; priority: string; tags: string }, reason: keyof typeof HANDOFF_NOTE, now: Date) {
  const tags = [...new Set([...ticket.tags.split(",").map((tag) => tag.trim()).filter(Boolean), HUMAN_TAG])].join(",");
  await db.helpDeskTicket.updateMany({
    where: { id: ticket.id, shop },
    data: { humanRequestedAt: now, tags, unread: true, lastActivityAt: now, ...(ticket.priority === "Low" || ticket.priority === "Normal" ? { priority: "High" } : {}) },
  });
  await db.helpDeskMessage.create({ data: { ticketId: ticket.id, kind: "event", author: ASSISTANT, body: `${HANDOFF_NOTE[reason]} Waiting for a person from the team.`, createdAt: new Date(now.getTime() + 2) } });
}

// The first answer on a new question (General Inquiry): only when the
// assistant is sure. The team gets the request either way.
export async function answerNewRequest(db: PrismaClient, admin: AdminClient | undefined, shop: string, ticketId: string, text: string, now = new Date()) {
  if (!text.trim()) return null;
  const settings = await db.helpDeskSettings.findUnique({ where: { shop }, select: { assistantEnabled: true } });
  if (settings && !settings.assistantEnabled) return null;
  const ranked = await rankedAnswers(db, admin, shop, text, 4);
  const decision = decide(text, ranked);
  if (decision.kind !== "answer") return null;
  const reply = `While our team looks at your request, this might help:\n\n${answerBody(decision.answer, text)}\n\nIf it answers your question, there's nothing else to do. If not, our team will reply here.`;
  await db.helpDeskMessage.create({ data: { ticketId, kind: "bot", author: ASSISTANT, body: reply, createdAt: now } });
  return reply;
}
