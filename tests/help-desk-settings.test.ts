import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, rmSync } from "node:fs";

// Every Help Desk setting saved through the admin's own action, against a
// real (temporary) database: what's kept, what's checked, and that bad input
// is refused without changing anything. Shopify's sign-in and the outside
// services (ShipStation, Google, AI detectors) are stand-ins: no network.
const shop = "settings.myshopify.com";
vi.mock("../app/db.server", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { PrismaClient } = await import("@prisma/client");
  const dir = mkdtempSync(join(tmpdir(), "help-desk-settings-"));
  (globalThis as { settingsDbDir?: string }).settingsDbDir = dir;
  return { default: new PrismaClient({ datasourceUrl: `file:${join(dir, "test.sqlite").replaceAll("\\", "/")}` }) };
});
vi.mock("../app/shopify.server", () => ({ authenticate: { admin: async () => ({ admin: { graphql: async () => new Response("{}") }, session: { shop } }) } }));
vi.mock("../app/services/help-desk-shipstation.server", async (original) => ({
  ...(await original<object>()),
  listShipStationStores: async (key: string) => key === "good" ? [{ id: "s1", name: "Settings", marketplace: "Shopify" }, { id: "s2", name: "Other", marketplace: "Amazon" }] : null,
}));
vi.mock("../app/services/help-desk-places.server", async (original) => ({ ...(await original<object>()), checkPlacesKey: async (key: string) => key === "good" ? "" : "Google didn't accept this key." }));
vi.mock("../app/services/image-scan/detector.server", async (original) => ({
  ...(await original<object>()),
  verifyCredentials: async (_provider: string, credentials: { apiKey?: string; apiSecret?: string }) => ({ valid: credentials.apiKey === "good" || credentials.apiSecret === "good", message: "These credentials don't work." }),
}));

import db from "../app/db.server";
import { adminContext, helpDeskAction, loadSettings } from "../app/services/help-desk-admin.server";
import { ASSISTANT_COPY, readAssistantCopy } from "../app/services/help-desk-assistant";
import { readShippingSettings } from "../app/services/help-desk-shipping";

async function act(fields: Record<string, string>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  const result = await helpDeskAction({ request: new Request("https://app.test/app/help-desk/settings", { method: "POST", body }), params: {}, context: {} } as never) as unknown as { data: { errors: Record<string, string>; notice?: string; updated?: number }; init?: { status?: number } };
  return { ...result.data, status: result.init?.status ?? 200 };
}
const settings = () => db.helpDeskSettings.findUniqueOrThrow({ where: { shop } });

beforeAll(async () => {
  for (const migration of readdirSync("prisma/migrations").filter((name) => !name.endsWith(".toml")).sort()) {
    for (const statement of readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8").split(";").filter((value) => value.trim())) await db.$executeRawUnsafe(statement);
  }
});
afterAll(async () => {
  await db.$disconnect();
  rmSync((globalThis as { settingsDbDir?: string }).settingsDbDir!, { recursive: true, force: true });
});

describe("Help Desk settings", () => {
  it("Emails and Team: saves alerts, customer emails, the signature and extra names; refuses a bad email", async () => {
    expect(await act({ intent: "settings", notify: "true", notifyEmail: "team@zion.test", autoReply: "true", statusEmails: "false", signature: "  Best,\nZion  ", team: "Priya, Sam,, Priya " }))
      .toMatchObject({ errors: {}, status: 200 });
    expect(await settings()).toMatchObject({ notify: true, notifyEmail: "team@zion.test", autoReply: true, statusEmails: false });
    // (A form sends new lines as CRLF, as a browser does.)
    expect((await settings()).signature.replace(/\r\n/g, "\n")).toBe("Best,\nZion");
    expect((await settings()).team.split(", ")).toEqual(expect.arrayContaining(["Priya", "Sam"]));
    expect(await act({ intent: "settings", notify: "true", notifyEmail: "not-an-email", signature: "x" })).toMatchObject({ errors: { notifyEmail: "Enter a valid email address." }, status: 400 });
    expect(await act({ intent: "settings", notifyEmail: "", signature: "x".repeat(2001) })).toMatchObject({ errors: { signature: expect.any(String) }, status: 400 });
    // Refused: nothing changed.
    expect((await settings()).notifyEmail).toBe("team@zion.test");
  });

  it("Test email: refuses until sending is set up on the server", async () => {
    expect(await act({ intent: "test-email", to: "team@zion.test" })).toMatchObject({ status: 400, errors: { form: expect.stringContaining("not set up") } });
  });

  it("Chat assistant: on or off, and only the wording that differs from the default is stored", async () => {
    expect(await act({ intent: "assistant-settings", enabled: "false", ...ASSISTANT_COPY, greeting: "Hey {first_name}, welcome!" })).toMatchObject({ errors: {}, status: 200 });
    const saved = await settings();
    expect(saved.assistantEnabled).toBe(false);
    expect(JSON.parse(saved.assistantCopy)).toEqual({ greeting: "Hey {first_name}, welcome!" });
    // Every message, the new ones included, reads back with defaults filled in.
    expect(readAssistantCopy(saved.assistantCopy)).toMatchObject({ greeting: "Hey {first_name}, welcome!", teamHasIt: ASSISTANT_COPY.teamHasIt, personHint: ASSISTANT_COPY.personHint });
    expect(await act({ intent: "assistant-settings", enabled: "true", greeting: "x".repeat(601) })).toMatchObject({ status: 400, errors: { greeting: expect.any(String) } });
    expect((await settings()).assistantEnabled).toBe(false);
    await act({ intent: "assistant-settings", enabled: "true" });
    expect((await settings()).assistantEnabled).toBe(true);
  });

  it("Help articles: add, edit, delete, restore; a button must be a real request", async () => {
    expect(await act({ intent: "article-save", question: "Do you take PayPal?", answer: "Yes, at checkout.", keywords: "paypal, , pay pal ", collection: "Payments & Discounts", action: "Nowhere › Nothing" })).toMatchObject({ errors: {} });
    const article = await db.helpDeskFaq.findFirstOrThrow({ where: { shop, question: "Do you take PayPal?" } });
    expect(article).toMatchObject({ keywords: "paypal, pay pal", collection: "Payments & Discounts", action: "" });
    await act({ intent: "article-save", id: article.id, question: "Do you take PayPal?", answer: "Yes.", action: "Orders › Cancel Order" });
    expect(await db.helpDeskFaq.findUniqueOrThrow({ where: { id: article.id } })).toMatchObject({ answer: "Yes.", action: "Orders › Cancel Order", edited: true });
    expect(await act({ intent: "article-save", question: "", answer: "" })).toMatchObject({ status: 400, errors: { question: expect.any(String), answer: expect.any(String) } });
    expect(await act({ intent: "article-save", id: "gone", question: "Q", answer: "A" })).toMatchObject({ status: 400 });
    await act({ intent: "article-delete", id: article.id });
    expect(await db.helpDeskFaq.findUnique({ where: { id: article.id } })).toBeNull();
    expect(await act({ intent: "article-restore" })).toMatchObject({ errors: {}, notice: expect.any(String) });
    expect(await act({ intent: "answers-refresh" })).toMatchObject({ errors: {} });
  });

  it("Saved replies: add, edit and delete, filed under a real category only", async () => {
    expect(await act({ intent: "macro-save", title: "Refund sent", body: "Your refund is on its way.", category: "Returns", subcategory: "Refund status" })).toMatchObject({ errors: {} });
    const macro = await db.helpDeskMacro.findFirstOrThrow({ where: { shop, title: "Refund sent" } });
    expect(macro).toMatchObject({ category: "Returns", subcategory: "Refund status" });
    await act({ intent: "macro-save", id: macro.id, title: "Refund sent", body: "Done.", category: "Made up", subcategory: "Nope" });
    expect(await db.helpDeskMacro.findUniqueOrThrow({ where: { id: macro.id } })).toMatchObject({ body: "Done.", category: "", subcategory: "" });
    expect(await act({ intent: "macro-save", title: "x".repeat(81), body: "" })).toMatchObject({ status: 400, errors: { title: expect.any(String), body: expect.any(String) } });
    await act({ intent: "macro-delete", id: macro.id });
    expect(await db.helpDeskMacro.findUnique({ where: { id: macro.id } })).toBeNull();
  });

  it("Shipping times: business days by rate and a note; refuses days it can't read", async () => {
    expect(await act({ intent: "shipping-times", processing: "1-2", rates: JSON.stringify({ Standard: "3-5", Express: "" }), note: " Ships Mon-Fri " })).toMatchObject({ errors: {} });
    expect(readShippingSettings((await settings()).shippingTimes)).toEqual({ processing: "1-2", rates: { Standard: "3-5" }, note: "Ships Mon-Fri" });
    expect(await act({ intent: "shipping-times", processing: "soon" })).toMatchObject({ status: 400, errors: { processing: expect.any(String) } });
    expect(await act({ intent: "shipping-times", processing: "", rates: JSON.stringify({ Standard: "a week" }) })).toMatchObject({ status: 400, errors: { rates: expect.any(String) } });
    expect(readShippingSettings((await settings()).shippingTimes).processing).toBe("1-2");
  });

  it("ShipStation: checks the keys, picks the shop's own store, keeps saved keys when left blank, and disconnects", async () => {
    expect(await act({ intent: "shipstation-settings", key: "", secret: "" })).toMatchObject({ status: 400, errors: { credentials: expect.any(String) } });
    expect(await act({ intent: "shipstation-settings", key: "bad", secret: "x" })).toMatchObject({ status: 400, errors: { credentials: expect.stringContaining("didn't accept") } });
    expect(await act({ intent: "shipstation-settings", key: "good", secret: "s", storeId: "s2" })).toMatchObject({ errors: {}, notice: "ShipStation connected" });
    expect(await settings()).toMatchObject({ shipstationKey: "good", shipstationSecret: "s", shipstationStoreId: "s2" });
    // Blank fields keep the saved keys; a store it doesn't have isn't kept.
    await act({ intent: "shipstation-settings", key: "", secret: "", storeId: "nope" });
    expect(await settings()).toMatchObject({ shipstationKey: "good", shipstationSecret: "s" });
    expect(await act({ intent: "shipstation-settings", disconnect: "true" })).toMatchObject({ notice: "ShipStation disconnected" });
    expect(await settings()).toMatchObject({ shipstationKey: "", shipstationSecret: "", shipstationStoreId: "" });
  });

  it("Address suggestions: a Google key is checked before it's kept, and can be removed", async () => {
    expect(await act({ intent: "places-settings", key: "" })).toMatchObject({ status: 400, errors: { placesKey: expect.any(String) } });
    expect(await act({ intent: "places-settings", key: "bad" })).toMatchObject({ status: 400, errors: { placesKey: "Google didn't accept this key." } });
    expect(await act({ intent: "places-settings", key: "good" })).toMatchObject({ errors: {} });
    expect((await settings()).googlePlacesKey).toBe("good");
    await act({ intent: "places-settings", remove: "true" });
    expect((await settings()).googlePlacesKey).toBe("");
  });

  it("AI photo check: on or off and the mode; detector keys are checked, and blank ones keep the saved key", async () => {
    expect(await act({ intent: "ai-settings", enabled: "false", mode: "always", provider: "sightengine", sightengineUser: "", sightengineSecret: "" })).toMatchObject({ errors: {} });
    expect((await settings()).aiDetectionEnabled).toBe(false);
    expect(await act({ intent: "ai-settings", enabled: "true", mode: "always", provider: "truthscan", truthscanKey: "bad" })).toMatchObject({ status: 400, errors: { credentials: expect.any(String) } });
    expect(await act({ intent: "ai-settings", enabled: "true", mode: "always", provider: "truthscan", truthscanKey: "good" })).toMatchObject({ errors: {} });
    await act({ intent: "ai-settings", enabled: "true", mode: "always", provider: "truthscan", truthscanKey: "" });
    expect(await settings()).toMatchObject({ aiDetectionEnabled: true, aiDetectionProvider: "truthscan", truthscanKey: "good" });
    // An unknown provider or mode falls back to a real one.
    await act({ intent: "ai-settings", enabled: "false", mode: "sometimes", provider: "magic" });
    expect(await settings()).toMatchObject({ aiDetectionProvider: "sightengine", aiDetectorMode: "always" });
  });

  it("loads everything the settings pages show, even when Shopify answers nothing useful", async () => {
    const loaded = await loadSettings(await adminContext(new Request("https://app.test/app/help-desk/settings"))) as unknown;
    const screen = ((loaded as { data?: unknown }).data ?? loaded) as { articles: unknown[]; macros: unknown[]; team: unknown[]; staff: unknown[] };
    expect(screen).toMatchObject({
      settings: expect.objectContaining({ notify: expect.any(Boolean), signature: expect.any(String) }),
      assistant: { enabled: expect.any(Boolean), ai: false, copy: expect.objectContaining({ greeting: expect.any(String), teamHasIt: expect.any(String) }) },
      ai: expect.objectContaining({ enabled: expect.any(Boolean) }),
      shipStation: expect.objectContaining({ hasKeys: expect.any(Boolean) }),
      storefront: expect.objectContaining({ hasPlacesKey: expect.any(Boolean) }),
      shipping: expect.objectContaining({ times: expect.any(Object) }),
    });
    expect(Array.isArray(screen.articles) && Array.isArray(screen.macros) && Array.isArray(screen.team) && Array.isArray(screen.staff)).toBe(true);
    expect(screen.articles.length).toBeGreaterThan(0);
  });

  it("Team: a staff member can be hidden from the list, only in this shop", async () => {
    const member = await db.helpDeskStaff.create({ data: { shop, userId: "u1", name: "Priya", email: "priya@zion.test" } as never });
    expect(await act({ intent: "staff-visibility", id: member.id, hidden: "true" })).toMatchObject({ errors: {} });
    expect((await db.helpDeskStaff.findUniqueOrThrow({ where: { id: member.id } })).hidden).toBe(true);
    expect(await act({ intent: "staff-visibility", id: "someone-else", hidden: "true" })).toMatchObject({ status: 400 });
  });
});
