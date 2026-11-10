import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Claude's answer for the next call, or an error to throw. No real API calls.
const reply = vi.hoisted(() => ({ next: null as unknown, calls: [] as Record<string, unknown>[] }));
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error { status = 500; }
  class Anthropic {
    static APIError = APIError;
    beta = { messages: { create: async (params: Record<string, unknown>) => {
      reply.calls.push(params);
      if (reply.next instanceof Error) throw reply.next;
      return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(reply.next) }] };
    } } };
  }
  return { default: Anthropic };
});

import { aiDecide, aiRelated } from "../app/services/help-desk-ai.server";
import type { Answer } from "../app/services/help-desk-articles.server";

const source = (id: string, question: string): Answer => ({ id, question, answer: `About ${question}.`, collection: "", action: "", source: "article", url: "", image: "" });
const knowledge = [source("a1", "Can I cancel my order?"), source("a2", "Where is my refund?")];

describe("The AI assistant", () => {
  beforeEach(() => { vi.stubEnv("ANTHROPIC_API_KEY", "test-key"); reply.calls = []; vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("answers from the store's sources, citing them", async () => {
    reply.next = { action: "answer", source_ids: ["a1"], reply: "Yes, as long as it hasn't shipped." };
    expect(await aiDecide({ message: "cancel plz", history: [], knowledge, products: [] }))
      .toEqual({ kind: "answer", reply: "Yes, as long as it hasn't shipped.", sources: [knowledge[0]] });
    // The rules and sources are cached; the customer's message isn't in them.
    const call = reply.calls[0] as { system: { text: string; cache_control?: unknown }[]; messages: { content: string }[]; model: string };
    expect(call.model).toBe("claude-opus-5-5");
    expect(call.system.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
    expect(call.system.map((block) => block.text).join("")).not.toContain("cancel plz");
    expect(call.messages[0].content).toContain("cancel plz");
  });

  it("knows the request form's steps for each source, to walk customers through them", async () => {
    reply.next = { action: "answer", source_ids: ["c1"], reply: "Sure:\n1. Choose Orders.\n2. Choose Cancel Order." };
    const cancel = { ...source("c1", "Can I cancel my order?"), action: "Orders › Cancel Order" };
    await aiDecide({ message: "order cancel karna hai", history: [], knowledge: [cancel], products: [] });
    const call = reply.calls[0] as { system: { text: string }[] };
    expect(call.system.map((block) => block.text).join("")).toContain("Steps on the request form:\n1. On our Help Desk page, choose \"I have a question about an order\".\n2. Pick your order");
  });

  it("never answers without a real source: the keyword matching decides instead", async () => {
    reply.next = { action: "answer", source_ids: ["made-up"], reply: "Sure!" };
    expect(await aiDecide({ message: "x", history: [], knowledge, products: [] })).toBeNull();
  });

  it("asks back, hands over only when asked, and greets", async () => {
    reply.next = { action: "clarify", source_ids: [], reply: "Which order is it about?" };
    expect(await aiDecide({ message: "it broke", history: [], knowledge, products: [] })).toEqual({ kind: "clarify", reply: "Which order is it about?" });
    reply.next = { action: "human", source_ids: [], reply: "" };
    expect(await aiDecide({ message: "agent se baat karao", history: [], knowledge, products: [] })).toEqual({ kind: "human" });
    reply.next = { action: "greet", source_ids: [], reply: "Hello! How can I help you today?" };
    expect(await aiDecide({ message: "namaste", history: [], knowledge, products: [] })).toEqual({ kind: "greet", reply: "Hello! How can I help you today?" });
    reply.next = { action: "thanks", source_ids: [], reply: "" };
    expect(await aiDecide({ message: "ok thanks", history: [], knowledge, products: [] })).toEqual({ kind: "thanks", reply: "" });
  });

  it("is given the customer's request, so it never asks for it again", async () => {
    reply.next = { action: "clarify", source_ids: [], reply: "Your lost package request is with our team." };
    await aiDecide({ message: "any news?", history: [{ role: "assistant", text: "Hi!" }], knowledge, products: [], request: "Request #1007\nIssue: Shipping & Delivery › Lost Package" });
    const call = reply.calls[0] as { system: { text: string }[]; messages: { content: string }[] };
    expect(call.messages[0].content).toContain("<request>\nRequest #1007\nIssue: Shipping & Delivery › Lost Package\n</request>");
    expect(call.messages[0].content).toContain("<chat>\nassistant: Hi!\n</chat>");
    expect(call.system.map((block) => block.text).join("")).toContain("Never ask them again for anything in it");
    // Never in Hindi or Hinglish: the app is in English.
    expect(call.system.map((block) => block.text).join("")).toContain("Always reply in English");
  });

  it("finds help center answers by meaning, only ones that exist", async () => {
    reply.next = { ids: ["a2", "made-up", "a1"] };
    expect(await aiRelated("money back", knowledge)).toEqual(["a2", "a1"]);
    reply.next = new Error("down");
    expect(await aiRelated("money back", knowledge)).toEqual([]);
  });

  it("falls back when Claude can't be reached, or there's no key", async () => {
    reply.next = new Error("timeout");
    expect(await aiDecide({ message: "x", history: [], knowledge, products: [] })).toBeNull();
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    reply.next = { action: "answer", source_ids: ["a1"], reply: "Yes." };
    expect(await aiDecide({ message: "x", history: [], knowledge, products: [] })).toBeNull();
    expect(reply.calls).toHaveLength(1);
  });
});
