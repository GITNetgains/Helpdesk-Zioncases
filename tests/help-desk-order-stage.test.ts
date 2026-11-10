import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { orderStage } from "../app/services/help-desk-orders.server";
import { asksOrderStatus, asksRequestStatus, assistantTurn, orderStatusText } from "../app/services/help-desk-assistant.server";
import { submitTicket } from "../app/services/help-desk.server";
import { ensureArticles } from "../app/services/help-desk-articles.server";
import { topics, validateHelpDesk } from "../app/services/help-desk";
import { classifyTicket } from "../app/services/help-desk-taxonomy";

// Where an order is decides what the form offers with it, and what the chat
// says when the customer asks where it is.

describe("An order's stage", () => {
  it("reads it from Shopify's fulfillment and carrier statuses", () => {
    expect(orderStage("UNFULFILLED", false, [])).toBe("processing");
    expect(orderStage("ON_HOLD", false, [])).toBe("processing");
    expect(orderStage("FULFILLED", true, ["DELIVERED"])).toBe("cancelled");
    expect(orderStage("PARTIALLY_FULFILLED", false, ["IN_TRANSIT"])).toBe("partial");
    expect(orderStage("FULFILLED", false, ["IN_TRANSIT"])).toBe("transit");
    expect(orderStage("FULFILLED", false, ["OUT_FOR_DELIVERY", "LABEL_PRINTED"])).toBe("transit");
    expect(orderStage("FULFILLED", false, ["DELIVERED"])).toBe("delivered");
    expect(orderStage("FULFILLED", false, ["DELIVERED", "IN_TRANSIT"])).toBe("shipped");
    expect(orderStage("FULFILLED", false, ["ATTEMPTED_DELIVERY"])).toBe("failed");
    expect(orderStage("FULFILLED", false, ["DELIVERED", "FAILURE"])).toBe("failed");
    // Shipped, but no word from the carrier (often all Shopify knows): nothing is ruled out but changing it.
    expect(orderStage("FULFILLED", false, [])).toBe("shipped");
    expect(orderStage("FULFILLED", false, ["FULFILLED"])).toBe("shipped");
    expect(orderStage("FULFILLED", false, [""])).toBe("shipped");
    // A voided label isn't a shipment.
    expect(orderStage("UNFULFILLED", false, ["LABEL_VOIDED"])).toBe("processing");
  });
});

describe("Where is my order, in the chat", () => {
  it("knows when the customer asks where their order is", () => {
    for (const text of ["Where is my order?", "where's my package", "can I get the tracking", "what's the order status", "has it shipped?", "when will my order arrive", "mera order kab aayega", "order kahan hai"]) expect(asksOrderStatus(text), text).toBe(true);
    for (const text of ["Where can I return it?", "how do I clean the case", "I want to cancel", "the lid is cracked"]) expect(asksOrderStatus(text), text).toBe(false);
  });

  it("tells them the live status: cancelled, on hold, being prepared, or each package", () => {
    const base = { order: "#1001", placedAt: "2026-10-01T00:00:00Z", cancelled: false, shipped: false, onHold: false, shipments: [] };
    expect(orderStatusText({ ...base, cancelled: true })).toBe("Order #1001 was cancelled.");
    expect(orderStatusText({ ...base, onHold: true })).toContain("on hold");
    expect(orderStatusText(base)).toBe("Order #1001 hasn't shipped yet: it's being prepared. You'll get an email with tracking as soon as it leaves us.");
    const shipment = { status: "IN_TRANSIT", label: "In transit", carrier: "UPS", number: "1Z999", url: "https://ups.example/1Z999", shippedAt: "2026-10-02T00:00:00Z", deliveredAt: null, estimatedAt: "2026-10-06T12:00:00Z" };
    expect(orderStatusText({ ...base, shipped: true, shipments: [shipment] }))
      .toBe("Here's the latest on your order #1001:\n\nIn transit (UPS, tracking 1Z999). Expected Tuesday, October 6.\nTrack it: https://ups.example/1Z999");
    const two = orderStatusText({ ...base, shipped: true, shipments: [{ ...shipment, label: "Delivered", deliveredAt: "2026-10-04T12:00:00Z" }, shipment] });
    expect(two).toContain("Package 1: Delivered (UPS, tracking 1Z999). Delivered Sunday, October 4.");
    expect(two).toContain("Package 2: In transit");
  });
});

describe("An order that isn't listed", () => {
  const values = { name: "Sandy", email: "sandy@example.com", topic: topics[5], query: "Where is it?" };
  it("takes when it was placed (a real date, never in the future) and what it's about", () => {
    expect(validateHelpDesk({ ...values, orderDate: "2026-10-05", orderNote: "Two slab cases" }, [], [])).toEqual({});
    expect(validateHelpDesk({ ...values, orderDate: "2999-01-01" }, [], [])).toMatchObject({ orderDate: "The order date can't be in the future." });
    expect(validateHelpDesk({ ...values, orderDate: "2026-02-30" }, [], [])).toMatchObject({ orderDate: "Enter the date you placed the order." });
    expect(validateHelpDesk({ ...values, orderDate: "next week" }, [], [])).toMatchObject({ orderDate: "Enter the date you placed the order." });
    expect(validateHelpDesk({ ...values, orderNote: "x".repeat(2001) }, [], [])).toMatchObject({ orderNote: expect.any(String) });
  });

  it("files a rejected application and damage inside the product under their own sub-categories", () => {
    expect(classifyTicket(topics[1], { query: "Why was my application rejected?" }).subcategory).toBe("Wholesale application rejected");
    expect(classifyTicket(topics[2], { query: "my affiliate application got declined" }).subcategory).toBe("Affiliate application rejected");
  });
});

describe("The chat on an order request", () => {
  const temp = mkdtempSync(join(tmpdir(), "help-desk-stage-"));
  const db = new PrismaClient({ datasourceUrl: `file:${join(temp, "test.sqlite").replaceAll("\\", "/")}` });
  const shop = "order-stage.myshopify.com";
  beforeAll(async () => {
    for (const migration of readdirSync("prisma/migrations").filter((name) => name.includes("help_desk")).sort()) {
      const sql = readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8");
      for (const statement of sql.split(";").filter((value) => value.trim())) await db.$executeRawUnsafe(statement);
    }
    await ensureArticles(db, shop);
  });
  afterAll(async () => { await db.$disconnect(); rmSync(temp, { recursive: true, force: true }); });

  it("answers what it can, and otherwise says the request is in process and tells the team", async () => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ requestKey: crypto.randomUUID(), name: "Sandy Lee", email: "sandy@example.com", topic: topics[5], query: "A question about my order", orderNumber: "#1001", orderDate: "2026-10-05", orderNote: "Bought as a guest" })) form.set(key, value);
    const { ticketId, errors } = await submitTicket(db, shop, form);
    expect(errors).toEqual({});
    const ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId } });
    // The unlisted order's date and description are kept with the request.
    expect(JSON.parse(ticket.details)).toMatchObject({ orderNumber: "#1001", orderDate: "2026-10-05", orderNote: "Bought as a guest" });
    // A question its articles answer: answered.
    expect(await assistantTurn(db, undefined, shop, ticketId!, "what is your return policy")).toMatchObject({ decision: { kind: "answer" }, notifyTeam: false });
    // Something it can't answer: in process, and the team hears about it.
    const unsure = await assistantTurn(db, undefined, shop, ticketId!, "my dog chewed the handle");
    expect(unsure).toMatchObject({ notifyTeam: true, handoff: false });
    expect(unsure.reply).toBe("Thanks Sandy! Your request is submitted and in process. We'll let you know here as soon as there's any update on it. Thanks for your patience.");
  });

  it("knows the request it's on: asked how it's going, it says where it stands without asking again", async () => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ requestKey: crypto.randomUUID(), name: "Sandy Lee", email: "sandy@example.com", topic: topics[3], orderType: "Where is my order?", delivery: "Package lost", orderNumber: "#1003", details: "It never came", lostPreference: "Refund", category: "Shipping & Delivery", subcategory: "Lost Package" })) form.set(key, value);
    form.append("products", "gid://shopify/Product/1");
    const { ticketId, number, errors } = await submitTicket(db, shop, form);
    expect(errors).toEqual({});
    for (const text of ["any update on my request?", "what's the status of my claim", "is my refund approved"]) expect(asksRequestStatus(text), text).toBe(true);
    for (const text of ["where is my order", "how do I clean the case"]) expect(asksRequestStatus(text), text).toBe(false);
    const turn = await assistantTurn(db, undefined, shop, ticketId!, "any update on my request?");
    expect(turn).toMatchObject({ notifyTeam: false, handoff: false });
    expect(turn.reply).toContain(`Your request #${number} (Lost Package): our team has it and will reply here soon.`);
    expect(turn.reply).toContain("- Lost package: pending review");
  });
});
