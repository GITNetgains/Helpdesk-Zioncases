import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(), submit: vi.fn(), read: vi.fn(), reply: vi.fn(), queue: vi.fn(), shipping: vi.fn(),
  db: { helpDeskTicket: { findMany: vi.fn(), findFirst: vi.fn() }, helpDeskSettings: { updateMany: vi.fn() } },
}));
vi.mock("../app/shopify.server", () => ({ authenticate: { public: { appProxy: mocks.authenticate } } }));
vi.mock("../app/db.server", () => ({ default: mocks.db }));
vi.mock("../app/services/help-desk.server", () => ({
  readHelpDeskForm: mocks.read, submitTicket: mocks.submit, addCustomerMessage: mocks.reply, MAX_REPLY_IMAGES: 3,
  customerCanReply: (ticket: { channel: string; status: string }) => ticket.channel === "chat" || ticket.status === "Waiting on customer",
}));
vi.mock("../app/services/help-desk-outbox.server", () => ({ queueEmail: mocks.queue, ensureWorker: vi.fn() }));
vi.mock("../app/services/help-desk-shipping.server", () => ({ lookupShipping: mocks.shipping, loadShippingSetup: async () => undefined }));
vi.mock("../app/services/image-scan/scan.server", () => ({ queueTicketScans: vi.fn() }));
import { action, loader } from "../app/routes/help-desk";
import { resetRateLimits } from "../app/services/rate-limit.server";
const args = (method = "POST") => ({ request: new Request("https://app.example/help-desk?shop=forged.myshopify.com", { method }), params: {}, context: {}, url: new URL("https://app.example/help-desk"), pattern: "/help-desk" });
const post = (fields: Record<string, string>, headers: Record<string, string> = {}) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  mocks.read.mockResolvedValue(form);
  return action({ ...args(), request: new Request("https://app.example/help-desk", { method: "POST", headers: { "x-forwarded-for": "203.0.113.7", ...headers } }) });
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.db.helpDeskSettings.updateMany.mockResolvedValue({ count: 1 });
  resetRateLimits();
  mocks.authenticate.mockResolvedValue({ session: { shop: "verified.myshopify.com" } });
  mocks.read.mockResolvedValue(new FormData());
  mocks.submit.mockResolvedValue({ errors: {}, ticketId: "ticket-1" });
});
describe("Storefront help desk endpoint", () => {
  it("uses the authenticated shop, never a customer supplied shop", async () => {
    const response = await action(args());
    expect(await response.json()).toEqual({ errors: {}, ticketId: "ticket-1" });
    expect(mocks.submit).toHaveBeenCalledWith(mocks.db, "verified.myshopify.com", expect.any(FormData), "");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("rejects invalid proxy signatures before reading a body", async () => {
    const failure = new Response(null, { status: 400 });
    mocks.authenticate.mockRejectedValue(failure);
    await expect(action(args())).rejects.toBe(failure);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("rejects stores without an installation", async () => {
    mocks.authenticate.mockResolvedValue({ session: undefined });
    expect((await action(args())).status).toBe(403);
    expect((await loader(args("GET"))).status).toBe(403);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("exposes only form choices to logged-out shoppers, never tickets", async () => {
    const data = await (await loader(args("GET"))).json();
    expect(data.topics).toHaveLength(6);
    expect(Object.keys(data).sort()).toEqual(["addressProvider", "addressSuggestions", "cancelReasons", "countries", "deliveryIssues", "groups", "home", "issueResolutions", "issues", "orderTypes", "orders", "productParts", "provinces", "purchasePlaces", "shippingCountries", "tickets", "topics", "updates"]);
    // Orders and tickets are only looked up for a signed-in shopper (logged_in_customer_id).
    expect(data.orders).toBeNull();
    expect(data.tickets).toBeNull();
    expect(mocks.db.helpDeskTicket.findMany).not.toHaveBeenCalled();
  });
  it("lists only the signed-in shopper's own tickets in the verified shop", async () => {
    mocks.db.helpDeskTicket.findMany.mockResolvedValue([{ number: 1001, topic: "Order Queries", status: "Open", createdAt: new Date(), lastActivityAt: null, accessToken: "a".repeat(48) }]);
    const request = new Request("https://app.example/help-desk?shop=forged.myshopify.com&logged_in_customer_id=42");
    const data = await (await loader({ ...args("GET"), request })).json();
    expect(mocks.db.helpDeskTicket.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { shop: "verified.myshopify.com", customerId: "42" } }));
    expect(data.tickets[0]).toMatchObject({ number: 1001, token: "a".repeat(48) });
  });
  it("renders the request page as Liquid, escaping customer text, and 404s unknown links", async () => {
    const page = (token: string) => loader({ ...args("GET"), request: new Request(`https://app.example/help-desk?ticket=${token}`) });
    const missing = await page("not-a-token");
    expect(missing.status).toBe(404);
    expect(mocks.db.helpDeskTicket.findFirst).not.toHaveBeenCalled();
    mocks.db.helpDeskTicket.findFirst.mockResolvedValue({
      number: 1001, topic: "Order Queries", status: "Waiting on customer", createdAt: new Date(), accessToken: "b".repeat(48),
      details: JSON.stringify({ details: "{{ shop.secret }} <script>x</script>" }),
      messages: [{ id: "m1", kind: "reply", author: "Priya", body: "Hello {% raw %}", createdAt: new Date() }], attachments: [], channel: "form",
    });
    const response = await page("b".repeat(48));
    expect(response.headers.get("Content-Type")).toBe("application/liquid");
    expect(mocks.db.helpDeskTicket.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { shop: "verified.myshopify.com", accessToken: "b".repeat(48) } }));
    const html = await response.text();
    expect(html).toContain("Request #1001");
    expect(html).not.toContain("{{ shop.secret }}");
    expect(html).not.toContain("{% raw %}");
    expect(html).not.toContain("<script>x");
  });
  it("accepts customer replies only through the ticket's secret link", async () => {
    const form = new FormData(); form.set("intent", "reply"); form.set("token", "c".repeat(48)); form.set("body", "Any update?");
    mocks.read.mockResolvedValue(form);
    mocks.reply.mockResolvedValue({ errors: {}, messageId: "m1", ticketId: "t1" });
    const request = new Request("https://app.example/help-desk", { method: "POST", headers: { Accept: "application/json" } });
    const response = await action({ ...args(), request });
    expect(response.status).toBe(200);
    expect(mocks.reply).toHaveBeenCalledWith(mocks.db, "verified.myshopify.com", "c".repeat(48), "Any update?", [], []);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it.each(["intent", "website"])("rejects public %s requests", async key => {
    const form = new FormData(); form.set(key, "status");
    mocks.read.mockResolvedValue(form);
    expect((await action(args())).status).toBe(400);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("returns validation errors without claiming success", async () => {
    mocks.submit.mockResolvedValue({ errors: { images: "Upload an image." } });
    const response = await action(args());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ errors: { images: "Upload an image." } });
  });
  it("handles oversized bodies and storage failures", async () => {
    mocks.read.mockRejectedValueOnce(new Error("Request too large"));
    expect((await action(args())).status).toBe(400);
    mocks.submit.mockRejectedValue(new Error("Database unavailable"));
    expect((await action(args())).status).toBe(500);
  });
});

describe("Storefront request lookup", () => {
  it("rejects the removed chat widget endpoints", async () => {
    expect((await post({ intent: "ask", question: "where is my order" })).status).toBe(400);
    expect((await post({ intent: "chat-start", name: "Rahul", email: "r@example.com", body: "Hi" })).status).toBe(400);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("finds a request by number and email, and locks out guessing", async () => {
    mocks.db.helpDeskTicket.findFirst.mockResolvedValue({ email: "Rahul@Example.com", accessToken: "e".repeat(48) });
    const wrong = await post({ intent: "lookup", number: "1001", email: "someone@else.com" });
    expect(wrong.status).toBe(404);
    expect(await wrong.text()).toContain("couldn&#39;t find");
    mocks.db.helpDeskTicket.findFirst.mockResolvedValueOnce({ email: "Rahul@Example.com", accessToken: "e".repeat(48) })
      .mockResolvedValueOnce({ number: 1001, topic: "Order Queries", status: "Open", channel: "form", createdAt: new Date(), accessToken: "e".repeat(48), details: "{}", messages: [], attachments: [] });
    const found = await post({ intent: "lookup", number: "#1001", email: "rahul@example.com" });
    expect(found.status).toBe(200);
    expect(await found.text()).toContain("Request #1001");
    for (let index = 0; index < 5; index++) await post({ intent: "lookup", number: "1", email: "x@y.co" });
    expect((await post({ intent: "lookup", number: "1001", email: "rahul@example.com" })).status).toBe(429);
  });
});

describe("Live request page", () => {
  const token = "f".repeat(48);
  const get = (query: string) => loader({ ...args("GET"), request: new Request(`https://app.example/help-desk?${query}`, { headers: { "x-forwarded-for": "203.0.113.9" } }) });
  it("answers the live check with a stamp built only from messages the customer can see", async () => {
    mocks.db.helpDeskTicket.findFirst.mockResolvedValue({ status: "Waiting on customer", _count: { messages: 2 }, messages: [{ id: "m2" }] });
    const response = await get(`ticket=${token}&pulse=1`);
    expect(await response.json()).toEqual({ stamp: "Waiting on customer:2:m2:0:" });
    const query = mocks.db.helpDeskTicket.findFirst.mock.calls[0][0];
    expect(query.where).toEqual({ shop: "verified.myshopify.com", accessToken: token });
    expect(query.select.messages.where).toEqual({ kind: { in: ["customer", "reply", "bot"] } });
  });
  it("rejects malformed tokens and unknown tickets", async () => {
    expect((await get("ticket=not-a-token&pulse=1")).status).toBe(404);
    mocks.db.helpDeskTicket.findFirst.mockResolvedValue(null);
    expect((await get(`ticket=${token}&pulse=1`)).status).toBe(404);
  });
  it("marks the page with the same stamp so it knows when to refresh", async () => {
    mocks.db.helpDeskTicket.findFirst.mockResolvedValue({
      number: 1001, topic: "Order Queries", status: "Open", channel: "form", createdAt: new Date(), accessToken: token, details: "{}", products: "[]", receivedProducts: "[]",
      messages: [{ id: "m1", kind: "reply", author: "Priya", body: "Hi", createdAt: new Date() }], attachments: [],
    });
    const html = await (await get(`ticket=${token}`)).text();
    expect(html).toContain(`data-hdt-stamp="Open:1:m1:0:"`);
    expect(html).toContain(`data-hdt-token="${token}"`);
    // The page's own refresh: plain HTML, so Shopify doesn't render the whole theme around it.
    const live = await get(`ticket=${token}&live=1`);
    expect(live.headers.get("Content-Type")).toContain("text/html");
    expect(await live.text()).toContain(`data-hdt-stamp="Open:1:m1:0:"`);
    expect((await get(`ticket=${token}`)).headers.get("Content-Type")).toBe("application/liquid");
  });
  it("offers photo uploads on the reply box only when staff turned them on", async () => {
    const ticket = {
      number: 1001, topic: "Order Queries", status: "Waiting on customer", channel: "form", createdAt: new Date(), accessToken: token, details: "{}", products: "[]", receivedProducts: "[]",
      messages: [{ id: "m1", kind: "reply", author: "Priya", body: "Hi", createdAt: new Date() }], attachments: [],
    };
    mocks.db.helpDeskTicket.findFirst.mockResolvedValue(ticket);
    const off = await (await get(`ticket=${token}`)).text();
    expect(off).toContain("Reply to our team");
    expect(off).not.toContain(`name="images"`);
    mocks.db.helpDeskTicket.findFirst.mockResolvedValue({ ...ticket, allowPhotos: true });
    const on = await (await get(`ticket=${token}`)).text();
    expect(on).toContain(`name="images"`);
    expect(on).toContain(`data-hdt-stamp="Waiting on customer:1:m1:1:"`);
    expect(on).not.toContain(`name="videos"`);
    mocks.db.helpDeskTicket.findFirst.mockResolvedValue({ ...ticket, allowVideos: true });
    const video = await (await get(`ticket=${token}`)).text();
    expect(video).toContain(`name="videos"`);
    expect(video).toContain(`data-hdt-stamp="Waiting on customer:1:m1:0v:"`);
  });
});

describe("Product issue order lookup", () => {
  const ask = (query: string) => loader({ ...args("GET"), request: new Request(`https://app.example/help-desk?check=items&${query}`, { headers: { "x-forwarded-for": "203.0.113.21" } }) });
  it("answers only for an order placed with that email, and locks out guessing", async () => {
    // No Shopify session in these tests, so the order can't be looked up: the form carries on without items.
    expect(await (await ask("order=1002&email=a@b.co")).json()).toMatchObject({ unavailable: true });
  });
});

describe("Shipping times on the form", () => {
  const ask = (query: string) => loader({ ...args("GET"), request: new Request(`https://app.example/help-desk?shipping=1&${query}`, { headers: { "x-forwarded-for": "203.0.113.11" } }) });
  const answer = { country: "US", countryName: "United States", province: "TX", ships: true, processing: [1, 2], shipsBy: ["2026-11-03", "2026-11-04"], rates: [], note: "" };
  it("answers for a destination in the verified shop, without an order", async () => {
    mocks.shipping.mockResolvedValue({ answer });
    expect(await (await ask("country=us&province=tx")).json()).toEqual({ shipping: answer, order: null });
    expect(mocks.shipping).toHaveBeenCalledWith(mocks.db, undefined, "verified.myshopify.com", { country: "US", province: "TX", orderNumber: "", email: "" });
  });
  it("passes the customer's products and address on for Shopify's live checkout rates", async () => {
    mocks.shipping.mockResolvedValue({ answer });
    await ask("country=US&province=TX&city=Austin&zip=78701&products=gid://shopify/Product/1,gid://shopify/Product/2,not-a-product");
    expect(mocks.shipping).toHaveBeenCalledWith(mocks.db, undefined, "verified.myshopify.com", expect.objectContaining({
      products: ["gid://shopify/Product/1", "gid://shopify/Product/2"], city: "Austin", zip: "78701",
    }));
  });
  it("needs a real country", async () => {
    expect((await (await ask("country=XX")).json()).error).toContain("country");
    expect(mocks.shipping).not.toHaveBeenCalled();
  });
  it("still answers for the destination when the order doesn't match, and locks out guessing", async () => {
    mocks.shipping.mockResolvedValue({ answer, orderError: "notFound" });
    expect(await (await ask("country=US&order=1001&email=a@b.co")).json()).toMatchObject({ shipping: answer, orderError: expect.stringContaining("couldn't find") });
    for (let index = 0; index < 4; index++) await ask("country=US&order=1001&email=a@b.co");
    mocks.shipping.mockClear();
    expect((await (await ask("country=US&order=1001&email=a@b.co")).json()).orderError).toContain("Too many attempts");
    expect(mocks.shipping).toHaveBeenCalledWith(mocks.db, undefined, "verified.myshopify.com", expect.objectContaining({ orderNumber: "" }));
  });
  it("says so when Shopify's shipping settings can't be read", async () => {
    mocks.shipping.mockResolvedValue({ error: "unavailable" });
    expect((await (await ask("country=US")).json()).error).toContain("unavailable");
  });
});
