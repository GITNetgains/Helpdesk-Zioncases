// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTyping, markTyping, typingState } from "../app/services/help-desk-typing.server";
import { renderRequestPage, type RequestPageExtras, type RequestPageTicket } from "../app/services/help-desk-request-page";

describe("Who's typing", () => {
  it("shows each side for a few seconds, and clears on send", () => {
    const now = 1_000_000;
    expect(typingState("t1", now)).toEqual({ customer: false, toCustomer: null });
    markTyping("t1", "customer", now);
    markTyping("t1", { staff: "Priya" }, now);
    expect(typingState("t1", now + 1_000)).toEqual({ customer: true, toCustomer: "Priya" });
    // Stale after a few seconds without a ping.
    expect(typingState("t1", now + 6_000)).toEqual({ customer: false, toCustomer: null });
    markTyping("t1", { staff: "Priya" }, now);
    clearTyping("t1", "staff");
    expect(typingState("t1", now + 1_000).toCustomer).toBeNull();
    // The assistant working on a reply, when no person is typing.
    markTyping("t1", "assistant", now);
    expect(typingState("t1", now + 1_000).toCustomer).toBe("Assistant");
  });
});

describe("Typing on the request page", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("shows the team typing as a bubble, and tells the team the customer is typing", async () => {
    const ticket = {
      number: 1042, topic: "Order Queries", status: "Waiting on customer", channel: "form", createdAt: new Date("2026-10-20T10:00:00Z"), accessToken: "a".repeat(48),
      details: JSON.stringify({ orderNumber: "#5001" }),
      messages: [{ id: "m1", kind: "reply", author: "Priya", body: "Could you send a photo?", createdAt: new Date("2026-10-20T11:00:00Z") }],
    } as unknown as RequestPageTicket;
    const extras = { imageCounts: new Map(), requestImages: 0, products: [], receivedProducts: [], canReply: true, maxImages: 3, maxLength: 5000 } as unknown as RequestPageExtras;
    const html = renderRequestPage(ticket, extras);
    const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).join("\n");
    document.body.innerHTML = html.replace(/<script>[\s\S]*?<\/script>/g, "");
    const root = document.querySelector(".hdt[data-hdt-stamp]")!;
    root.setAttribute("data-hdt-token", "a".repeat(48));
    const stamp = root.getAttribute("data-hdt-stamp");
    const calls: string[] = [];
    let typing: string | null = "Priya";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ stamp, typing }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    vi.useFakeTimers();
    new Function(script)();

    await vi.advanceTimersByTimeAsync(1_100);
    expect(document.querySelector(".hdt-thread .hdt-typing .hdt-typing-name")?.textContent).toBe("Priya is typing");
    // Her initial, as a capital, in place of a picture.
    expect(document.querySelector(".hdt-thread .hdt-typing .hdt-ava")?.textContent).toBe("P");
    typing = null;
    await vi.advanceTimersByTimeAsync(1_100);
    expect(document.querySelector(".hdt-thread .hdt-typing")).toBeNull();

    // Typing pings the team at most every couple of seconds.
    const box = document.querySelector<HTMLTextAreaElement>(".hdt-foot textarea")!;
    box.value = "hello";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.dispatchEvent(new Event("input", { bubbles: true }));
    expect(calls.filter((url) => url.includes("typing=1"))).toHaveLength(1);
  });
});
