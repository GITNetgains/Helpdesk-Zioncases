import Anthropic from "@anthropic-ai/sdk";
import type { Answer } from "./help-desk-articles.server";
import { requestSteps } from "./help-desk-steps";

// The chat assistant's understanding, with Claude: it reads the customer's
// message the way a person would (any wording, typos, several questions in
// one) and answers only from what the store has written: its help articles,
// live shipping facts, policies, pages and products. When none of them
// answers it, it asks the customer what they mean and gives the steps it can,
// instead of guessing. It hands over to a person only when asked to. Off
// unless ANTHROPIC_API_KEY is set; without it (or when Claude can't be
// reached) the keyword matching in help-desk-assistant.server.ts decides.

const MODEL = "claude-opus-5-5";
// A customer is waiting in the chat: give up quickly and let the keyword
// matching answer instead.
const TIMEOUT_MS = 12_000;

export const aiAssistantEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 1 }));

export type AiTurn = { role: "customer" | "assistant" | "team"; text: string };
export type AiResult =
  | { kind: "answer"; reply: string; sources: Answer[] }
  | { kind: "clarify"; reply: string }
  | { kind: "human" }
  | { kind: "greet" }
  | { kind: "thanks" };

const RULES = `You are the customer support assistant in the chat on a customer's support request page for an online store. Customers write casually: short phrases, typos, slang, other languages, several questions at once. Work out what they actually mean.

Answer ONLY from the store's sources below. They are the only facts you know about this store, its products, prices, shipping, policies and how its request form works.
- "answer" when the sources answer the question, with the ids of the sources you used.
- When the customer asks how to do something, or says they want to do it (cancel, change an address or an item, return, exchange, report damage or a missing item, track an order, get a quote...), and a source has "Steps on the request form", walk them through those steps as a numbered list ("1. ..."), in order, adapted to what they said. Use only those steps: never invent a step, a button or a page.
- "clarify" when the sources don't answer it, or only partly, or you aren't sure what they mean. Don't guess, generalise or fill gaps from general knowledge: a wrong answer is far worse than a question back. Ask one short question that would let you answer, or name the closest things the sources do cover, and give any steps the sources offer for what they're trying to do. Also "clarify" when they say an answer didn't help: ask what's still wrong, and don't repeat the same answer.
- Things only the team can see or change (this customer's own order status, a refund that should have arrived, a replacement for a damaged item): "clarify", telling them the steps the sources give for it, such as which request to send with which details or photos. Don't promise that anything will happen, and don't say a person will reply.
- "human" ONLY when the customer asks to talk to a person, agent, the team or customer service, in any wording or language. Never choose it for any other reason, even when they are upset: then acknowledge it in one sentence and help.
- "greet" for a greeting with no question. "thanks" for thanks or "ok, got it" with no new question.
- Small talk with no question about the store ("how's your day going?", "are you a bot?", "sorry", "bye", "lol"): "clarify", with a warm, natural one or two sentence reply in kind (you're the store's virtual assistant), then offer to help. Never "human" for it: asking whether you're a person isn't asking for one.

Writing the reply (for "answer" and "clarify"):
- Plain text, no Markdown, no headings. Short: 1-4 sentences, a short "- " list for options, or a numbered list for steps.
- Friendly and direct, like a helpful person on the store's team. Use "we" for the store.
- Reply in the customer's language.
- Only facts from the sources. Never invent order details, dates, prices, links or promises.
- Don't greet, don't sign off, don't say you're an AI, don't mention "sources" or "articles". The page adds its own line about reaching a person.`;

const SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["answer", "clarify", "human", "greet", "thanks"] },
    source_ids: { type: "array", items: { type: "string" } },
    reply: { type: "string" },
  },
  required: ["action", "source_ids", "reply"],
  additionalProperties: false,
} as const;

// Each source, with the request form's steps for what it's about, so the AI
// can walk a customer through doing it.
const sourceText = (sources: Answer[]) => sources.map((source) => {
  const steps = source.action ? requestSteps(source.action) : [];
  const how = steps.length ? `\nSteps on the request form:\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}` : "";
  return `<source id="${source.id}" kind="${source.source}">\n${source.question}\n${source.answer}${how}\n</source>`;
}).join("\n");

// What Claude makes of the customer's latest message. null when it couldn't
// be asked (no key, timeout, API error) or said something unusable, so the
// caller falls back to the keyword matching.
export async function aiDecide(input: { message: string; history: AiTurn[]; knowledge: Answer[]; products: Answer[]; storeName?: string }): Promise<AiResult | null> {
  if (!aiAssistantEnabled() || !input.knowledge.length) return null;
  const known = new Map([...input.knowledge, ...input.products].map((source) => [source.id, source]));
  const history = input.history.slice(-8).map((turn) => `${turn.role}: ${turn.text.slice(0, 1200)}`).join("\n\n");
  try {
    const response = await anthropic().beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      // The rules and the store's sources change rarely: cached, so each
      // message only pays for the conversation.
      system: [
        { type: "text", text: RULES },
        { type: "text", text: `${input.storeName ? `Store: ${input.storeName}\n\n` : ""}<sources>\n${sourceText(input.knowledge)}\n</sources>`, cache_control: { type: "ephemeral" } },
      ],
      messages: [{
        role: "user",
        content: `${input.products.length ? `Products that may be relevant:\n<sources>\n${sourceText(input.products)}\n</sources>\n\n` : ""}${history ? `The chat so far:\n<chat>\n${history}\n</chat>\n\n` : ""}The customer's new message:\n<message>\n${input.message.slice(0, 4000)}\n</message>`,
      }],
    });
    if (response.stop_reason !== "end_turn") return null;
    const text = response.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("");
    const parsed = JSON.parse(text) as { action: string; source_ids: string[]; reply: string };
    if (parsed.action === "greet" || parsed.action === "thanks" || parsed.action === "human") return { kind: parsed.action };
    if (parsed.action === "clarify") return parsed.reply.trim() ? { kind: "clarify", reply: parsed.reply.trim() } : null;
    const sources = parsed.source_ids.map((id) => known.get(id)).filter((source): source is Answer => Boolean(source));
    // An answer must rest on something the store wrote; otherwise the keyword matching decides.
    if (parsed.action !== "answer" || !sources.length || !parsed.reply.trim()) return null;
    return { kind: "answer", reply: parsed.reply.trim(), sources };
  } catch (error) {
    if (error instanceof Anthropic.APIError) console.error(`Help Desk AI assistant: API error ${error.status}: ${error.message}`);
    else console.error("Help Desk AI assistant failed:", error);
    return null;
  }
}

const RELATED_RULES = `You help customers search an online store's help center. Given what a customer searched for and the help center's sources, pick the sources most likely to help them: the ones about the same thing, even in other words (a search for "agent" wants how to contact support; "money back" wants refunds).
- Searches are short and messy: typos ("recieved", "cancle"), half-typed words ("refu"), slang, no punctuation, or another language or Hinglish ("order kab aayega" is where is my order, "toota hua aaya" is it arrived broken). Work out what they mean.
- Best first, at most 5. Put the one that answers it first, then ones about closely related problems the customer may also have (a search about a cracked lid: damaged on arrival first, then warranty or replacement parts).
- If none is about what they searched, return an empty list. Never pick a source just because it's popular.`;
const RELATED_SCHEMA = {
  type: "object",
  properties: { ids: { type: "array", items: { type: "string" } } },
  required: ["ids"],
  additionalProperties: false,
} as const;

// A help center search nothing matched by its words: the sources that help,
// by meaning. Empty when the AI is off or can't be reached.
export async function aiRelated(search: string, sources: Answer[]): Promise<string[]> {
  if (!aiAssistantEnabled() || !sources.length || !search.trim()) return [];
  try {
    const response = await anthropic().beta.messages.create({
      model: MODEL,
      max_tokens: 1000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: RELATED_SCHEMA } },
      // Same sources as the chat assistant, so the cached copy serves both.
      system: [
        { type: "text", text: RELATED_RULES },
        { type: "text", text: `<sources>\n${sourceText(sources)}\n</sources>`, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: `The customer searched for:\n<search>\n${search.slice(0, 300)}\n</search>` }],
    });
    if (response.stop_reason !== "end_turn") return [];
    const text = response.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("");
    const known = new Set(sources.map((source) => source.id));
    return (JSON.parse(text) as { ids: string[] }).ids.filter((id) => known.has(id)).slice(0, 5);
  } catch (error) {
    if (error instanceof Anthropic.APIError) console.error(`Help Desk AI search: API error ${error.status}: ${error.message}`);
    else console.error("Help Desk AI search failed:", error);
    return [];
  }
}
