import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { notifyReply, pushKeys, readSubscription, savePushSubscription, SERVICE_WORKER } from "../app/services/help-desk-push.server";
import { renderRequestPage } from "../app/services/help-desk-request-page";

// Browser notifications of team replies, for customers who turned them on
// from their request page.

const temp = mkdtempSync(join(tmpdir(), "help-desk-push-"));
const db = new PrismaClient({ datasourceUrl: `file:${join(temp, "test.sqlite").replaceAll("\\", "/")}` });
const shop = "push.myshopify.com";
const token = "a".repeat(48);
let ticketId = "";

beforeAll(async () => {
  for (const migration of readdirSync("prisma/migrations").filter((name) => name.includes("help_desk")).sort()) {
    const sql = readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8");
    for (const statement of sql.split(";").filter((value) => value.trim())) await db.$executeRawUnsafe(statement);
  }
  const ticket = await db.helpDeskTicket.create({ data: { shop, requestKey: "push-1", number: 1077, name: "Customer", email: "c@example.com", topic: "Order Queries", details: "{}", products: "[]", accessToken: token } });
  ticketId = ticket.id;
});
afterAll(async () => { await db.$disconnect(); rmSync(temp, { recursive: true, force: true }); });

const browser = (n: number) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/browser-${n}`, p256dh: "B".repeat(87), auth: "c".repeat(22) });

describe("Browser notification keys and subscriptions", () => {
  it("makes the store's VAPID keys once and keeps them", async () => {
    const first = await pushKeys(db, shop);
    expect(first.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(await pushKeys(db, shop)).toEqual(first);
  });

  it("accepts only an HTTPS push service with the browser's keys", () => {
    expect(readSubscription(browser(1))).toEqual(browser(1));
    expect(readSubscription({ ...browser(1), endpoint: "http://fcm.googleapis.com/x" })).toBeNull();
    expect(readSubscription({ ...browser(1), endpoint: "not a url" })).toBeNull();
    expect(readSubscription({ ...browser(1), auth: "bad key!" })).toBeNull();
  });

  it("saves a browser for the request once, and forgets it when turned off", async () => {
    expect(await savePushSubscription(db, shop, "b".repeat(48), browser(1))).toBe(false);
    expect(await savePushSubscription(db, "other.myshopify.com", token, browser(1))).toBe(false);
    expect(await savePushSubscription(db, shop, token, browser(1))).toBe(true);
    expect(await savePushSubscription(db, shop, token, browser(1))).toBe(true);
    expect(await db.helpDeskPushSubscription.count({ where: { ticketId } })).toBe(1);
    expect(await savePushSubscription(db, shop, token, browser(1), false)).toBe(true);
    expect(await db.helpDeskPushSubscription.count({ where: { ticketId } })).toBe(0);
  });
});

describe("Notifying a team reply", () => {
  it("sends each browser the reply, and forgets one the push service says is gone", async () => {
    await savePushSubscription(db, shop, token, browser(2));
    await savePushSubscription(db, shop, token, browser(3));
    const reply = await db.helpDeskMessage.create({ data: { ticketId, kind: "reply", author: "Priya", body: "Your  order\nships today." } });
    const send = vi.fn(async (subscription: { endpoint: string }) => {
      if (subscription.endpoint.endsWith("browser-3")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      return { statusCode: 201, body: "", headers: {} };
    });
    expect(await notifyReply(db, shop, reply.id, send as never)).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
    const [subscription, payload, options] = send.mock.calls[0] as unknown as [{ endpoint: string; keys: unknown }, string, { vapidDetails: { publicKey: string } }];
    expect(subscription.keys).toEqual({ p256dh: browser(2).p256dh, auth: browser(2).auth });
    expect(JSON.parse(payload)).toEqual({ title: "Priya replied to request #1077", body: "Your order ships today.", ticket: token, tag: `help-desk-${ticketId}` });
    expect(options.vapidDetails.publicKey).toBe((await pushKeys(db, shop)).publicKey);
    expect((await db.helpDeskPushSubscription.findMany({ where: { ticketId } })).map((row) => row.endpoint)).toEqual([browser(2).endpoint]);
  });

  it("never notifies an internal note, or another store's message", async () => {
    const note = await db.helpDeskMessage.create({ data: { ticketId, kind: "note", author: "Priya", body: "Internal" } });
    const reply = await db.helpDeskMessage.create({ data: { ticketId, kind: "reply", author: "Priya", body: "Hi" } });
    const send = vi.fn();
    expect(await notifyReply(db, shop, note.id, send)).toBe(0);
    expect(await notifyReply(db, "other.myshopify.com", reply.id, send)).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("has a service worker that stays quiet while the request is on screen, and opens it when clicked", () => {
    expect(SERVICE_WORKER).toContain("addEventListener('push'");
    expect(SERVICE_WORKER).toContain("client.visibilityState === 'visible' && client.focused");
    expect(SERVICE_WORKER).toContain("openWindow");
    expect(() => new Function(SERVICE_WORKER)).not.toThrow();
  });
});

describe("The request page's bell", () => {
  const ticket = {
    number: 1077, topic: "Order Queries", status: "In progress", channel: "form", createdAt: new Date("2026-11-01T10:00:00Z"), accessToken: token,
    details: "{}", messages: [],
  };
  const extras = { imageCounts: new Map(), requestImages: 0, products: [], receivedProducts: [], canReply: true, maxImages: 3, maxLength: 5000 };
  it("offers notifications on an open request, with the store's key", () => {
    const html = renderRequestPage(ticket, { ...extras, pushKey: "KEY_123" });
    expect(html).toContain('class="hdt-bell"');
    expect(html).toContain('data-hdt-push="KEY_123"');
    // The page script, bell and all, is valid JavaScript.
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) expect(() => new Function(script)).not.toThrow();
  });
  it("leaves them out without a key, or once the request is resolved", () => {
    expect(renderRequestPage(ticket, extras)).not.toContain('class="hdt-bell"');
    const resolved = renderRequestPage({ ...ticket, status: "Resolved" }, { ...extras, pushKey: "KEY_123" });
    expect(resolved).not.toContain('class="hdt-bell"');
    expect(resolved).not.toContain("data-hdt-push=");
  });
});
