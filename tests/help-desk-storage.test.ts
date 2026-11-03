import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cancelOrderInShopify, confirmItemsCancelled, decideCancellation } from "../app/services/help-desk-cancel.server";
import { rejectAddressChange, updateAddressInShopify } from "../app/services/help-desk-address.server";
import { applyOrderEdit, cleanOps, previewOrderEdit, rejectOrderEdit } from "../app/services/help-desk-edit.server";
import { approveReplacement, rejectReplacement, shipReplacement } from "../app/services/help-desk-replacement.server";
import { quoteUnavailable, sendQuote } from "../app/services/help-desk-quote.server";
import { markReturnReceived, rejectReturn, returnLabelFile, sendReturnLabel } from "../app/services/help-desk-return.server";
import { PrismaClient } from "@prisma/client";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addCustomerMessage, addStaffMessage, deleteTickets, purgeShop, readHelpDeskForm, redactCustomer, submitTicket, updateTickets, updateTicketStatus } from "../app/services/help-desk.server";
import { deliveryIssues, fillMacro, issues, orderTypes, productParts, topics } from "../app/services/help-desk";
import { conflictingRequest, syncTicketOrder } from "../app/services/help-desk-orders.server";
import { processEmail, retryEmail } from "../app/services/help-desk-outbox.server";

const temp = mkdtempSync(join(tmpdir(), "help-desk-test-"));
const db = new PrismaClient({ datasourceUrl: `file:${join(temp, "test.sqlite").replaceAll("\\", "/")}` });
const shop = "test.myshopify.com";
function form(overrides: Record<string, string> = {}) {
  const body = new FormData();
  for (const [key, value] of Object.entries({ requestKey: crypto.randomUUID(), name: "Customer", email: "customer@example.com", topic: topics[1], existing: "No", query: "Wholesale enquiry", ...overrides })) body.set(key, value);
  return body;
}
beforeAll(async () => {
  for (const migration of readdirSync("prisma/migrations").filter(name => name.includes("help_desk")).sort()) {
    const sql = readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8");
    for (const statement of sql.split(";").filter(value => value.trim())) await db.$executeRawUnsafe(statement);
  }
});
afterAll(async () => { await db.$disconnect(); rmSync(temp, { recursive: true, force: true }); });

describe("Help desk persistence", () => {
  it("persists tickets, removes inactive fields and deduplicates retries", async () => {
    const body = form({ orderNumber: "hidden", registeredEmail: "hidden@example.com" });
    const first = await submitTicket(db, shop, body);
    expect(first.errors).toEqual({});
    expect((await submitTicket(db, shop, body)).ticketId).toBe(first.ticketId);
    const ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: first.ticketId } });
    expect(ticket.status).toBe("Open");
    expect(JSON.parse(ticket.details)).not.toHaveProperty("orderNumber");
    expect(JSON.parse(ticket.details)).not.toHaveProperty("registeredEmail");
    expect((await submitTicket(db, "other.myshopify.com", body)).ticketId).not.toBe(first.ticketId);
  });
  it("restricts status changes to the owning shop and known statuses", async () => {
    const { ticketId } = await submitTicket(db, shop, form());
    expect(await updateTicketStatus(db, "other.myshopify.com", ticketId!, "Resolved")).toBe(false);
    expect(await updateTicketStatus(db, shop, ticketId!, "Invalid")).toBe(false);
    expect(await updateTicketStatus(db, shop, ticketId!, "Resolved")).toBe(true);
    expect((await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe("Resolved");
  });
  it("rejects invalid requests without saving", async () => {
    const count = await db.helpDeskTicket.count();
    expect((await submitTicket(db, shop, form({ email: "invalid" }))).errors.email).toBeTruthy();
    expect((await submitTicket(db, shop, form({ query: "x".repeat(5001) }))).errors.query).toBeTruthy();
    const shipping = form({ topic: topics[0], country: "INVALID", address: "Address" });
    shipping.append("products", "not-a-product");
    const result = await submitTicket(db, shop, shipping);
    expect(result.errors.country).toBeTruthy();
    expect(result.errors.products).toBeTruthy();
    expect(await db.helpDeskTicket.count()).toBe(count);
  });
  it("requires return images, rejects forged images and stores valid bytes", async () => {
    const body = form({ topic: topics[4], orderNumber: "1001", orderDetails: "Order", productDetails: "Case", issue: "Defective product received", details: "Broken", resolution: "Exchange" });
    expect((await submitTicket(db, shop, body)).errors.images).toBeTruthy();
    body.set("images", new Blob(["not an image"], { type: "image/png" }), "fake.png");
    expect((await submitTicket(db, shop, body)).errors.images).toBeTruthy();
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6S8AAAAASUVORK5CYII=", "base64");
    body.set("images", new Blob([bytes], { type: "image/png" }), "photo.png");
    const saved = await submitTicket(db, shop, body);
    expect(saved.errors).toEqual({});
    const image = await db.helpDeskAttachment.findFirstOrThrow({ where: { ticketId: saved.ticketId } });
    expect(Buffer.from(image.data)).toEqual(bytes);
    expect(await db.helpDeskAttachment.findFirst({ where: { id: image.id, ticket: { shop: "other.myshopify.com" } } })).toBeNull();
  });
  it("reads multipart forms and bounds streamed request sizes", async () => {
    const body = form();
    const parsed = await readHelpDeskForm(new Request("https://example.com", { method: "POST", body }));
    expect(parsed.get("query")).toBe("Wholesale enquiry");
    await expect(readHelpDeskForm(new Request("https://example.com", { method: "POST", body: new Uint8Array(101 * 1024 * 1024) }))).rejects.toThrow("Request too large");
  });
  it("stores received and wanted products for a wrong delivery, returned only unused in its packaging", async () => {
    const body = form({ topic: topics[3], orderType: orderTypes[2], orderNumber: "#1001", existing: "", query: "" });
    body.append("products", "gid://shopify/Product/1");
    body.append("receivedProducts", "gid://shopify/Product/2");
    body.append("images", new File([Buffer.from([255, 216, 255, 0])], "wrong.jpg", { type: "image/jpeg" }));
    expect((await submitTicket(db, shop, body)).errors.returnCondition).toMatch(/unused/);
    body.set("returnCondition", "Yes");
    const saved = await submitTicket(db, shop, body);
    expect(saved.errors).toEqual({});
    const ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: saved.ticketId } });
    expect(JSON.parse(ticket.products)).toEqual(["gid://shopify/Product/1"]);
    expect(JSON.parse(ticket.receivedProducts)).toEqual(["gid://shopify/Product/2"]);
  });
  it("files a missing part under its own sub-category, with how many, to be replaced", async () => {
    const id = "gid://shopify/Product/1";
    const body = form({ topic: topics[3], orderType: orderTypes[1], issue: issues[2], orderNumber: "#1001", existing: "", query: "",
      category: "Missing Parts", subcategory: "Item missing from order", resolution: "Replacement" });
    body.append("products", id);
    body.append(`itemTitle:${id}`, "Slab Case X");
    body.append(`itemPart:${id}`, "Lid");
    body.append(`itemQty:${id}`, "3");
    // Without a photo it isn't sent; a refund asked for is still a replacement.
    expect((await submitTicket(db, shop, body)).errors.images).toBeTruthy();
    body.append(`itemResolution:${id}`, "Refund");
    body.append(`images:${id}`, new File([Buffer.from([255, 216, 255, 0])], "box.jpg", { type: "image/jpeg" }));
    const saved = await submitTicket(db, shop, body);
    expect(saved.errors).toEqual({});
    const ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: saved.ticketId } });
    expect(ticket).toMatchObject({ category: "Missing Parts", subcategory: "Lids or panels missing" });
    expect(JSON.parse(ticket.details)).toMatchObject({ part: "Lid", resolution: "Replacement", details: "Slab Case X (Lid) × 3: Lid → Replacement" });
    expect(ticket).toMatchObject({ replacementStatus: "Pending", tags: "missing-part" });
  });
  it("keeps where and when a warranty item was bought, and rejects a made-up place", async () => {
    const id = "gid://shopify/Product/1";
    const claim = (extra: Record<string, string>) => {
      const body = form({ topic: topics[3], orderType: orderTypes[1], issue: issues[0], orderNumber: "#1001", existing: "", query: "",
        category: "Warranty", subcategory: "Replacement request", resolution: "Replacement part", ...extra });
      body.append("products", id);
      body.append(`itemTitle:${id}`, "Slab Case X");
      body.append(`itemNote:${id}`, "The wheel cracked");
      body.append(`images:${id}`, new File([Buffer.from([255, 216, 255, 0])], "wheel.jpg", { type: "image/jpeg" }));
      return body;
    };
    const saved = await submitTicket(db, shop, claim({ purchasedFrom: "Amazon", purchaseDate: "2026-03" }));
    expect(saved.errors).toEqual({});
    const ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: saved.ticketId } });
    expect(JSON.parse(ticket.details)).toMatchObject({ purchasedFrom: "Amazon", purchaseDate: "2026-03", resolution: "Replacement part" });
    expect((await submitTicket(db, shop, claim({ purchasedFrom: "eBay" }))).errors).toHaveProperty("purchasedFrom");
    expect((await submitTicket(db, shop, claim({ purchaseDate: "March" }))).errors).toHaveProperty("purchaseDate");
  });
  it("stores a wrong colour's wanted variant and a wrong quantity's counts in the product's line", async () => {
    const [one, two] = ["gid://shopify/Product/1", "gid://shopify/Product/2"];
    const body = form({ topic: topics[3], orderType: orderTypes[2], orderNumber: "#1001", existing: "", query: "", resolution: "Replacement", returnCondition: "Yes" });
    for (const [id, title] of [[one, "Slab Case X"], [two, "Graded Card Display"]]) {
      body.append("products", id);
      body.append(`itemTitle:${id}`, title);
      body.append(`itemResolution:${id}`, "Exchange");
      body.append(`images:${id}`, new File([Buffer.from([255, 216, 255, 0])], "wrong.jpg", { type: "image/jpeg" }));
    }
    body.append(`itemNote:${one}`, "A black one");
    body.append(`itemVariant:${one}`, "Blue");
    body.append(`itemReceived:${two}`, "1");
    body.append(`itemWanted:${two}`, "2");
    const saved = await submitTicket(db, shop, body);
    expect(saved.errors).toEqual({});
    const ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: saved.ticketId } });
    // A wrong item is returned for a refund or an exchange: a replacement isn't one of them.
    expect(JSON.parse(ticket.details)).toMatchObject({ resolution: "Exchange", returnCondition: "Yes",
      details: "Slab Case X: wants Blue. A black one → Exchange\n\nGraded Card Display: received 1, wants 2 → Exchange" });
    expect(ticket).toMatchObject({ returnStatus: "Pending", tags: "return" });
  });
  it("keeps what each product's customer wants: a refund for one, an exchange for another", async () => {
    const [one, two] = ["gid://shopify/Product/1", "gid://shopify/Product/2"];
    const body = form({ topic: topics[3], orderType: orderTypes[1], issue: issues[0], orderNumber: "#1001", existing: "", query: "",
      category: "Manufacturing Defect", subcategory: "Defective or not working", returnCondition: "Yes" });
    for (const [id, title, resolution] of [[one, "Slab Case X", "Refund"], [two, "Graded Card Display", "Exchange"]]) {
      body.append("products", id);
      body.append(`itemTitle:${id}`, title);
      body.append(`itemNote:${id}`, "Cracked");
      body.append(`itemResolution:${id}`, resolution);
      // A refund has no replacement, even if one was sent.
      body.append(`itemReplacement:${id}`, "Slab Case Y");
      body.append(`images:${id}`, new File([Buffer.from([255, 216, 255, 0])], "crack.jpg", { type: "image/jpeg" }));
    }
    const saved = await submitTicket(db, shop, body);
    expect(saved.errors).toEqual({});
    const ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: saved.ticketId } });
    expect(JSON.parse(ticket.details)).toMatchObject({ resolution: "Refund", replacement: "Graded Card Display → Slab Case Y",
      details: "Slab Case X: Cracked → Refund\n\nGraded Card Display: Cracked → Exchange: Slab Case Y", returnCondition: "Yes" });
    expect(ticket).toMatchObject({ returnStatus: "Pending", tags: "return" });
  });
  it("stores a wrong delivery described per product, with each product's photo", async () => {
    const id = "gid://shopify/Product/1";
    const body = form({ topic: topics[3], orderType: orderTypes[2], orderNumber: "#1001", existing: "", query: "", returnCondition: "Yes" });
    body.append("products", id);
    body.append(`itemTitle:${id}`, "Slab Case X");
    body.append(`itemResolution:${id}`, "Refund");
    body.append(`itemNote:${id}`, "Black instead of Blue");
    body.append(`images:${id}`, new File([Buffer.from([255, 216, 255, 0])], "wrong.jpg", { type: "image/jpeg" }));
    const saved = await submitTicket(db, shop, body);
    expect(saved.errors).toEqual({});
    const ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: saved.ticketId }, include: { attachments: true } });
    expect(JSON.parse(ticket.details).details).toBe("Slab Case X: Black instead of Blue → Refund");
    expect(ticket.attachments.map((file) => file.productId)).toEqual([id]);
  });
});

describe("Help desk conversations", () => {
  const numbered = "numbers.myshopify.com";
  it("numbers tickets per shop, issues unique tracking tokens and keeps retries on the same number", async () => {
    const body = form();
    const first = await submitTicket(db, numbered, body, "42");
    const retry = await submitTicket(db, numbered, body);
    const second = await submitTicket(db, numbered, form());
    const other = await submitTicket(db, "numbers-other.myshopify.com", form());
    expect([first.number, retry.number, second.number, other.number]).toEqual([1001, 1001, 1002, 1001]);
    expect(first.token).toMatch(/^[a-f0-9]{48}$/);
    expect(second.token).not.toBe(first.token);
    expect(retry.created).toBe(false);
    expect((await db.helpDeskTicket.findUniqueOrThrow({ where: { id: first.ticketId } })).customerId).toBe("42");
    expect((await db.helpDeskTicket.findUniqueOrThrow({ where: { id: second.ticketId } })).customerId).toBe("");
  });
  it("logs property changes and only touches the owning shop's tickets", async () => {
    const { ticketId } = await submitTicket(db, shop, form());
    expect(await updateTickets(db, "other.myshopify.com", [ticketId!], { priority: "Urgent" })).toBe(0);
    expect(await updateTickets(db, shop, [ticketId!], { priority: "Critical" })).toBe(-1);
    expect(await updateTickets(db, shop, [ticketId!], { priority: "Urgent", assignee: "Priya", tags: "vip, damaged, vip" }, "Rahul")).toBe(1);
    const ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId }, include: { messages: true } });
    expect(ticket).toMatchObject({ priority: "Urgent", assignee: "Priya", tags: "vip, damaged" });
    expect(ticket.messages.map(message => [message.kind, message.author, message.body])).toEqual([
      ["event", "Rahul", "Priority changed from Normal to Urgent"], ["event", "Rahul", "Assigned to Priya"], ["event", "Rahul", "Tags set to vip, damaged"],
    ]);
  });
  it("classifies new tickets and lets staff correct the classification", async () => {
    const { ticketId } = await submitTicket(db, shop, form());
    expect(await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId } })).toMatchObject({ category: "Wholesale Questions" });
    // What the customer picked on the form is used, and isn't repeated in the request's fields.
    const picked = await submitTicket(db, shop, form({ category: "Wholesale Questions", subcategory: "Dealer pricing" }));
    const pickedTicket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: picked.ticketId } });
    expect(pickedTicket).toMatchObject({ category: "Wholesale Questions", subcategory: "Dealer pricing" });
    expect(JSON.parse(pickedTicket.details)).not.toHaveProperty("category");
    // A sub-category from another category, or an unknown root cause, is refused.
    expect(await updateTickets(db, shop, [ticketId!], { category: "Missing Parts", subcategory: "Box crushed or dented" })).toBe(-1);
    expect(await updateTickets(db, shop, [ticketId!], { rootCause: "Gremlins" })).toBe(-1);
    expect(await updateTickets(db, shop, [ticketId!], { category: "Missing Parts", subcategory: "Risers missing", rootCause: "Item not packed (warehouse)" }, "Priya")).toBe(1);
    // Moving to another category drops the sub-category that no longer fits.
    expect(await updateTickets(db, shop, [ticketId!], { category: "Shipping Damage", resolutionType: "Replacement part" }, "Priya")).toBe(1);
    const ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId }, include: { messages: { orderBy: { createdAt: "asc" } } } });
    expect(ticket).toMatchObject({ category: "Shipping Damage", subcategory: "", rootCause: "Item not packed (warehouse)", resolutionType: "Replacement part" });
    expect(ticket.messages.map((message) => message.body)).toContain("Sub-category cleared");
  });
  it("attaches the Shopify order and moves a tracking question to what the order's status shows", async () => {
    const delivered = { data: { orders: { nodes: [{
      legacyResourceId: "5501", name: "#100472", email: "customer@example.com", createdAt: "2026-10-10T12:00:00Z", cancelledAt: null,
      displayFinancialStatus: "PAID", displayFulfillmentStatus: "FULFILLED", totalPriceSet: { shopMoney: { amount: "189.99", currencyCode: "USD" } },
      shippingAddress: { city: "Austin", provinceCode: "TX", countryCodeV2: "US" }, lineItems: { nodes: [{ title: "Slab Case X", variantTitle: null, sku: "ZC-SLABX", quantity: 1, image: null }] },
      fulfillments: [{ createdAt: "2026-10-11T09:00:00Z", status: "SUCCESS", displayStatus: "DELIVERED", deliveredAt: "2026-10-14T15:00:00Z", estimatedDeliveryAt: null, inTransitAt: null, trackingInfo: [{ company: "UPS", number: "1Z1", url: "https://ups.com/1Z1" }] }],
    }] } } };
    const admin = { graphql: async () => new Response(JSON.stringify(delivered)) };
    const tracking = form({ topic: topics[3], orderType: orderTypes[3], delivery: deliveryIssues[0], orderNumber: "#100472", existing: "", query: "", category: "Shipping & Delivery", subcategory: "Track My Order" });
    const { ticketId } = await submitTicket(db, shop, tracking);
    expect((await syncTicketOrder(db, admin, ticketId!))?.name).toBe("#100472");
    const ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId }, include: { messages: true } });
    expect(ticket).toMatchObject({ orderName: "#100472", orderValue: 189.99, carrier: "UPS", trackingNumber: "1Z1", shipmentStatus: "Delivered", orderSkus: "ZC-SLABX", orderVerified: true, subcategory: "Delivered but Not Received" });
    expect(ticket.messages.map((message) => [message.author, message.body])).toEqual([["Shopify", "Sub-category set to Delivered but Not Received, from the order's status in Shopify"]]);
    // Once staff set the classification, the order's status no longer changes it.
    await updateTickets(db, shop, [ticketId!], { subcategory: "Track My Order" }, "Priya");
    await syncTicketOrder(db, admin, ticketId!);
    expect((await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId } })).subcategory).toBe("Track My Order");
    // Shopify unreachable: the saved snapshot stays.
    expect(await syncTicketOrder(db, { graphql: async () => { throw new Error("offline"); } }, ticketId!)).toBeUndefined();
    expect((await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId } })).trackingNumber).toBe("1Z1");
  });
  describe("order cancellation requests", () => {
    // An unshipped order in Shopify; cancelledAt set once it's cancelled.
    const unshipped = (cancelledAt: string | null = null) => ({ data: { orders: { nodes: [{
      legacyResourceId: "7701", name: "#100900", email: "customer@example.com", createdAt: "2026-10-20T12:00:00Z", cancelledAt,
      displayFinancialStatus: "PAID", displayFulfillmentStatus: "UNFULFILLED", totalPriceSet: { shopMoney: { amount: "59.00", currencyCode: "USD" } },
      shippingAddress: null, lineItems: { nodes: [] }, fulfillments: [],
    }] } } });
    const cancelForm = (reason = "Ordered by mistake") => form({
      topic: topics[3], orderType: orderTypes[0], update: "Cancel Order", cancelReason: reason, orderNumber: "#100900", existing: "", query: "", category: "Orders", subcategory: "Cancel Order",
    });
    const load = (id: string) => db.helpDeskTicket.findUniqueOrThrow({ where: { id }, include: { messages: true, emails: true } });

    it("starts pending with the reason; it's never marked cancelled by hand, and a rejection says why", async () => {
      const { ticketId, errors } = await submitTicket(db, shop, cancelForm());
      expect(errors).toEqual({});
      let ticket = await load(ticketId!);
      expect(ticket).toMatchObject({ cancelStatus: "Pending", tags: "cancel", category: "Orders", subcategory: "Cancel Order" });
      expect(JSON.parse(ticket.details)).toMatchObject({ cancelReason: "Ordered by mistake" });
      // Submitting only asks: nothing is marked cancelled by hand, so the
      // customer is never told it's cancelled while the order still ships.
      for (const decision of ["mark-cancelled", "cancel"]) {
        expect((await decideCancellation(db, shop, ticketId!, { decision, note: "On it!", author: "Priya" })).errors.form).toBeTruthy();
      }
      expect((await load(ticketId!)).cancelStatus).toBe("Pending");
      // Only the owning shop, and a rejection says why.
      expect((await decideCancellation(db, "other.myshopify.com", ticketId!, { decision: "reject", note: "No", author: "Priya" })).errors.form).toBeTruthy();
      expect((await decideCancellation(db, shop, ticketId!, { decision: "reject", note: " ", author: "Priya" })).errors.note).toBeTruthy();
      expect((await decideCancellation(db, shop, ticketId!, { decision: "reject", note: "It already left the warehouse.", author: "Sam" })).cancelStatus).toBe("Rejected");
      ticket = await load(ticketId!);
      expect(ticket).toMatchObject({ cancelStatus: "Rejected", cancelNote: "It already left the warehouse.", cancelDecidedBy: "Sam", status: "Resolved", resolutionType: "Request declined" });
      // Rejecting twice isn't a decision.
      expect((await decideCancellation(db, shop, ticketId!, { decision: "reject", note: "Still no", author: "Sam" })).errors.form).toBeTruthy();
      expect(ticket.messages.filter((message) => message.kind === "event").map((message) => message.body)).toContain("Cancellation request rejected");
      // The customer is emailed the decision.
      await vi.waitFor(async () => expect((await load(ticketId!)).emails.filter((email) => email.kind === "cancellation")).toHaveLength(1));
    });

    // A Shopify that cancels the order when asked (cancelling: false leaves the job running).
    function fakeShopify(state: { fulfillment?: string; cancelling?: boolean } = {}) {
      const calls: { query: string; variables?: Record<string, unknown> }[] = [];
      let cancelled = false;
      const admin = {
        graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
          calls.push({ query, variables: options?.variables });
          if (query.includes("orderCancel")) {
            cancelled = state.cancelling !== false;
            return new Response(JSON.stringify({ data: { orderCancel: { job: { id: "gid://shopify/Job/1", done: false }, orderCancelUserErrors: [] } } }));
          }
          const body = unshipped(cancelled ? "2026-10-21T09:00:00Z" : null);
          body.data.orders.nodes[0].displayFulfillmentStatus = state.fulfillment ?? "UNFULFILLED";
          return new Response(JSON.stringify(body));
        },
      };
      return { admin, calls, cancels: () => calls.filter((call) => call.query.includes("orderCancel")) };
    }
    const options = { note: "", author: "Priya", refund: true, restock: false, notifyCustomer: false };

    it("approving cancels the order in Shopify, but not one that has shipped", async () => {
      const state = { fulfillment: "FULFILLED" };
      const shopify = fakeShopify(state);
      const { ticketId } = await submitTicket(db, shop, cancelForm());
      expect((await cancelOrderInShopify(db, shopify.admin, shop, ticketId!, options, [0])).errors.form).toContain("already shipped");
      expect(shopify.cancels()).toHaveLength(0);
      state.fulfillment = "UNFULFILLED";
      expect(await cancelOrderInShopify(db, shopify.admin, shop, ticketId!, options, [0])).toEqual({ errors: {}, cancelStatus: "Cancelled" });
      expect(shopify.cancels()[0].variables).toMatchObject({
        orderId: "gid://shopify/Order/7701", reason: "CUSTOMER", restock: false, refundMethod: { originalPaymentMethodsRefund: true },
      });
      const ticket = await load(ticketId!);
      expect(ticket).toMatchObject({ cancelStatus: "Cancelled", status: "Resolved", resolutionType: "Order cancelled" });
      expect(ticket.messages.map((message) => message.body)).toContain("Approved: order #100900 cancelled in Shopify (refunded to the original payment method, items not restocked)");
      // Nothing left to cancel.
      expect((await cancelOrderInShopify(db, shopify.admin, shop, ticketId!, options, [0])).errors.form).toContain("already cancelled");
      expect(shopify.cancels()).toHaveLength(1);
    });

    it("shows Approved while Shopify is still cancelling, then Cancelled once the order is", async () => {
      const shopify = fakeShopify({ cancelling: false });
      const { ticketId } = await submitTicket(db, shop, cancelForm());
      expect(await cancelOrderInShopify(db, shopify.admin, shop, ticketId!, options, [0, 0])).toEqual({ errors: {}, cancelStatus: "Approved" });
      expect((await load(ticketId!)).status).toBe("In progress");
      // Shopify finishes: the orders/cancelled webhook (or the next sync) closes the request.
      await syncTicketOrder(db, { graphql: async () => new Response(JSON.stringify(unshipped("2026-10-21T09:00:00Z"))) }, ticketId!);
      expect((await load(ticketId!))).toMatchObject({ cancelStatus: "Cancelled", status: "Resolved" });
    });

    it("cancels in Shopify an order that was only marked cancelled here", async () => {
      const shopify = fakeShopify();
      const { ticketId } = await submitTicket(db, shop, cancelForm());
      await decideCancellation(db, shop, ticketId!, { decision: "mark-cancelled", note: "", author: "Priya" });
      expect(await cancelOrderInShopify(db, shopify.admin, shop, ticketId!, options, [0])).toEqual({ errors: {}, cancelStatus: "Cancelled" });
      expect(shopify.cancels()).toHaveLength(1);
    });

    it("reports Shopify's errors and leaves the request as it was", async () => {
      const admin = {
        graphql: async (query: string) => new Response(JSON.stringify(query.includes("orderCancel")
          ? { data: { orderCancel: { job: null, orderCancelUserErrors: [{ field: ["orderId"], message: "Order can't be cancelled." }] } } } : unshipped())),
      };
      const { ticketId } = await submitTicket(db, shop, cancelForm());
      expect(await cancelOrderInShopify(db, admin, shop, ticketId!, { note: "", author: "Priya", refund: true, restock: true, notifyCustomer: false }))
        .toEqual({ errors: { form: "Order can't be cancelled." } });
      expect((await load(ticketId!)).cancelStatus).toBe("Pending");
    });

    it("marks the request cancelled when the order is cancelled in Shopify directly", async () => {
      const { ticketId } = await submitTicket(db, shop, cancelForm());
      await syncTicketOrder(db, { graphql: async () => new Response(JSON.stringify(unshipped())) }, ticketId!);
      expect((await load(ticketId!)).cancelStatus).toBe("Pending");
      await syncTicketOrder(db, { graphql: async () => new Response(JSON.stringify(unshipped("2026-10-21T09:00:00Z"))) }, ticketId!);
      const ticket = await load(ticketId!);
      expect(ticket).toMatchObject({ cancelStatus: "Cancelled", cancelDecidedBy: "Shopify", status: "Resolved", resolutionType: "Order cancelled" });
    });

    it("leaves other tickets without a cancellation status", async () => {
      const { ticketId } = await submitTicket(db, shop, form());
      expect((await load(ticketId!)).cancelStatus).toBe("");
      expect((await decideCancellation(db, shop, ticketId!, { decision: "approve", note: "", author: "Priya" })).errors.form).toBeTruthy();
    });

    it("approving is a decision only: Shopify isn't asked to cancel until staff choose to", async () => {
      const shopify = fakeShopify();
      const { ticketId } = await submitTicket(db, shop, cancelForm());
      expect(await decideCancellation(db, shop, ticketId!, { decision: "approve", note: "We'll cancel it today.", author: "Priya" }, shopify.admin)).toEqual({ errors: {}, cancelStatus: "Approved" });
      expect(shopify.cancels()).toHaveLength(0);
      const ticket = await load(ticketId!);
      expect(ticket).toMatchObject({ cancelStatus: "Approved", status: "In progress", cancelNote: "We'll cancel it today." });
      expect(ticket.messages.map((message) => message.body)).toContain("Cancellation request approved. The order hasn't been changed in Shopify yet.");
      // Approving twice isn't a decision; cancelling in Shopify then finishes it.
      expect((await decideCancellation(db, shop, ticketId!, { decision: "approve", note: "", author: "Priya" }, shopify.admin)).errors.form).toBeTruthy();
      expect((await cancelOrderInShopify(db, shopify.admin, shop, ticketId!, { ...options, refund: "store-credit" }, [0])).cancelStatus).toBe("Cancelled");
      expect(shopify.cancels()[0].variables).toMatchObject({ refundMethod: { storeCreditRefund: {} } });
    });

    it("won't approve an order that has shipped", async () => {
      const shopify = fakeShopify({ fulfillment: "FULFILLED" });
      const { ticketId } = await submitTicket(db, shop, cancelForm());
      expect((await decideCancellation(db, shop, ticketId!, { decision: "approve", note: "", author: "Priya" }, shopify.admin)).errors.form).toContain("already shipped");
      expect((await load(ticketId!)).cancelStatus).toBe("Pending");
    });

    it("won't cancel an order with an open return", async () => {
      const admin = { graphql: async (query: string) => {
        const body = unshipped() as { data: { orders: { nodes: Record<string, unknown>[] } } };
        body.data.orders.nodes[0].returnStatus = "IN_PROGRESS";
        return new Response(JSON.stringify(query.includes("orderCancel") ? {} : body));
      } };
      const { ticketId } = await submitTicket(db, shop, cancelForm());
      expect((await cancelOrderInShopify(db, admin, shop, ticketId!, options, [0])).errors.form).toContain("return");
      expect((await load(ticketId!)).cancelStatus).toBe("Pending");
    });

    // An order with two lines; removed: how many of the riser were removed with Edit order.
    const twoItems = (riser: { current: number; unfulfilled: number }) => {
      const body = unshipped() as { data: { orders: { nodes: Record<string, unknown>[] } } };
      body.data.orders.nodes[0].lineItems = { nodes: [
        { id: "gid://shopify/LineItem/11", title: "Slab Case X", variantTitle: "Black", sku: "X", quantity: 1, currentQuantity: 1, unfulfilledQuantity: 1, product: { id: "gid://shopify/Product/1" }, image: null },
        { id: "gid://shopify/LineItem/12", title: "Riser", variantTitle: null, sku: "R", quantity: 2, currentQuantity: riser.current, unfulfilledQuantity: riser.unfulfilled, product: null, image: null },
      ] };
      return { graphql: async () => new Response(JSON.stringify(body)) };
    };

    it("cancels selected items once Shopify shows them removed from the order", async () => {
      const body = cancelForm();
      body.set("cancelScope", "Selected items");
      body.append("products", "gid://shopify/LineItem/12");
      const { ticketId, errors } = await submitTicket(db, shop, body);
      expect(errors).toEqual({});
      expect(await load(ticketId!)).toMatchObject({ cancelStatus: "Pending", products: JSON.stringify(["gid://shopify/LineItem/12"]) });
      // Shopify can't cancel single items: staff use Edit order.
      expect((await cancelOrderInShopify(db, twoItems({ current: 2, unfulfilled: 2 }), shop, ticketId!, options, [0])).errors.form).toContain("Edit order");
      // Still on the order: not cancelled yet.
      expect((await confirmItemsCancelled(db, twoItems({ current: 2, unfulfilled: 2 }), shop, ticketId!, { note: "", author: "Priya" })).errors.form).toContain("Riser × 2 to ship");
      expect((await load(ticketId!)).cancelStatus).toBe("Pending");
      // Removed in Shopify: now it is, and the case that stays doesn't matter.
      expect(await confirmItemsCancelled(db, twoItems({ current: 0, unfulfilled: 0 }), shop, ticketId!, { note: "Done!", author: "Priya" })).toEqual({ errors: {}, cancelStatus: "Cancelled" });
      const ticket = await load(ticketId!);
      expect(ticket).toMatchObject({ cancelStatus: "Cancelled", status: "Resolved", resolutionType: "Order cancelled" });
      expect(ticket.messages.map((message) => message.body)).toContain("Approved: Riser × 2 removed from order #100900 in Shopify");
    });

    it("doesn't count shipped items as cancelled", async () => {
      const body = cancelForm();
      body.set("cancelScope", "Selected items");
      body.append("products", "gid://shopify/LineItem/12");
      const { ticketId } = await submitTicket(db, shop, body);
      expect((await confirmItemsCancelled(db, twoItems({ current: 2, unfulfilled: 0 }), shop, ticketId!, { note: "", author: "Priya" })).errors.form).toContain("has shipped");
      expect((await load(ticketId!)).cancelStatus).toBe("Pending");
    });

    it("only takes order lines, and items when asked for some", async () => {
      const some = cancelForm();
      some.set("cancelScope", "Selected items");
      expect((await submitTicket(db, shop, some)).errors.products).toBeTruthy();
      some.append("products", "gid://shopify/Product/1");
      expect((await submitTicket(db, shop, some)).errors.products).toBeTruthy();
    });
  });

  describe("shipping address changes", () => {
    const newAddress = { shipName: "Jordan Lee", shipAddress1: "2 Oak Ave", shipAddress2: "Apt 4", shipCity: "Austin", shipProvince: "TX", shipZip: "78701", shipCountry: "US" };
    const addressForm = (overrides: Record<string, string> = {}) => form({
      topic: topics[3], orderType: orderTypes[0], update: "Update Shipping Details", orderNumber: "#100950", existing: "", query: "", category: "Orders", subcategory: "Change Shipping Address", ...newAddress, ...overrides,
    });
    // An order in Shopify; orderUpdate calls are recorded.
    function fakeShopify(state: { fulfillment?: string; shipped?: boolean; email?: string; userErrors?: string[] } = {}) {
      const updates: Record<string, unknown>[] = [];
      const admin = {
        graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
          if (query.includes("orderUpdate")) {
            updates.push(options!.variables!.input as Record<string, unknown>);
            return new Response(JSON.stringify({ data: { orderUpdate: { order: { id: "gid://shopify/Order/8801" }, userErrors: (state.userErrors ?? []).map((message) => ({ field: ["shippingAddress"], message })) } } }));
          }
          const node = {
            legacyResourceId: "8801", name: "#100950", email: state.email ?? "customer@example.com", createdAt: "2026-10-26T12:00:00Z", cancelledAt: null, requiresShipping: true,
            displayFinancialStatus: "PAID", displayFulfillmentStatus: state.fulfillment ?? "UNFULFILLED", totalPriceSet: { shopMoney: { amount: "59.00", currencyCode: "USD" } },
            shippingAddress: { name: "Jordan Lee", address1: "1 Main St", address2: null, city: "Dallas", provinceCode: "TX", zip: "75201", countryCodeV2: "US", phone: null },
            lineItems: { nodes: [] },
            fulfillments: state.shipped ? [{ createdAt: "2026-10-27T09:00:00Z", status: "SUCCESS", displayStatus: "IN_TRANSIT", deliveredAt: null, estimatedDeliveryAt: null, inTransitAt: null, trackingInfo: [] }] : [],
          };
          return new Response(JSON.stringify(query.includes("order(id:") ? { data: { order: node } } : { data: { orders: { nodes: [node] } } }));
        },
      };
      return { admin, updates };
    }
    const address = { name: "Jordan Lee", address1: "2 Oak Ave", address2: "Apt 4", city: "Austin", province: "tx", zip: "78701", country: "US", phone: "" };
    const load = (id: string) => db.helpDeskTicket.findUniqueOrThrow({ where: { id }, include: { messages: true, emails: true } });

    it("starts pending with the new address and updates it in Shopify when nothing has shipped", async () => {
      const { ticketId, errors } = await submitTicket(db, shop, addressForm());
      expect(errors).toEqual({});
      expect(await load(ticketId!)).toMatchObject({ addressStatus: "Pending", tags: "address-change", subcategory: "Change Shipping Address" });
      const shopify = fakeShopify();
      // A missing part is caught before Shopify is asked.
      expect((await updateAddressInShopify(db, shopify.admin, shop, ticketId!, { address: { ...address, city: "" }, note: "", author: "Priya", confirmed: false })).errors).toHaveProperty("city");
      const result = await updateAddressInShopify(db, shopify.admin, shop, ticketId!, { address, note: "Done!", author: "Priya", confirmed: false });
      expect(result).toEqual({ errors: {}, addressStatus: "Updated" });
      expect(shopify.updates[0]).toEqual({
        id: "gid://shopify/Order/8801",
        shippingAddress: { firstName: "Jordan", lastName: "Lee", address1: "2 Oak Ave", address2: "Apt 4", city: "Austin", provinceCode: "TX", zip: "78701", countryCode: "US", phone: null },
      });
      const ticket = await load(ticketId!);
      expect(ticket).toMatchObject({ addressStatus: "Updated", addressNote: "Done!", status: "Resolved", resolutionType: "Order updated" });
      expect(JSON.parse(ticket.addressApplied)).toMatchObject({ address1: "2 Oak Ave", province: "TX" });
      expect(ticket.messages.map((message) => message.body)).toContain("Shipping address of #100950 updated in Shopify to Jordan Lee, 2 Oak Ave, Apt 4, Austin, TX, 78701, United States (was Jordan Lee, 1 Main St, Dallas, TX, 75201, United States)");
      // Updated is final.
      expect((await updateAddressInShopify(db, shopify.admin, shop, ticketId!, { address, note: "", author: "Priya", confirmed: false })).errors.form).toBeTruthy();
      await vi.waitFor(async () => expect((await load(ticketId!)).emails.filter((email) => email.kind === "address")).toHaveLength(1));
    });

    it.each([
      ["has shipped", { shipped: true, fulfillment: "PARTIALLY_FULFILLED" }, "US", "Not shipped"],
      ["is being packed", { fulfillment: "IN_PROGRESS" }, "US", "Not shipped"],
      ["goes to another country", {}, "CA", "same country"],
    ] as const)("refuses when the order %s", async (_, state, country, message) => {
      const { ticketId } = await submitTicket(db, shop, addressForm());
      const shopify = fakeShopify(state);
      const to = country === "CA" ? { ...address, city: "Toronto", province: "ON", zip: "M5H 1A1", country } : address;
      expect((await updateAddressInShopify(db, shopify.admin, shop, ticketId!, { address: to, note: "", author: "Priya", confirmed: false })).errors.form).toContain(message);
      expect(shopify.updates).toHaveLength(0);
      expect((await load(ticketId!)).addressStatus).toBe("Pending");
    });

    it("needs staff to confirm an order placed with another email, and passes on Shopify's errors", async () => {
      const { ticketId } = await submitTicket(db, shop, addressForm());
      const other = fakeShopify({ email: "someone-else@example.com" });
      expect((await updateAddressInShopify(db, other.admin, shop, ticketId!, { address, note: "", author: "Priya", confirmed: false })).errors.form).toContain("different email");
      expect(other.updates).toHaveLength(0);
      const rejecting = fakeShopify({ email: "someone-else@example.com", userErrors: ["Zip is invalid"] });
      expect((await updateAddressInShopify(db, rejecting.admin, shop, ticketId!, { address, note: "", author: "Priya", confirmed: true })).errors.form).toContain("Zip is invalid");
      expect((await load(ticketId!)).addressStatus).toBe("Pending");
    });

    it("refuses an address that's already the order's", async () => {
      const { ticketId } = await submitTicket(db, shop, addressForm());
      const shopify = fakeShopify();
      const current = { name: "Jordan Lee", address1: "1 Main St.", address2: "", city: "dallas", province: "TX", zip: "75201", country: "US", phone: "" };
      expect((await updateAddressInShopify(db, shopify.admin, shop, ticketId!, { address: current, note: "", author: "Priya", confirmed: false })).errors.form).toContain("already ships to this address");
      expect(shopify.updates).toHaveLength(0);
    });

    it("spots another open request for the same order", async () => {
      const order = { orderId: "9901", orderName: "#100990" };
      expect(await conflictingRequest(db, shop, "address", order)).toBe("");
      const address = await submitTicket(db, shop, addressForm({ orderNumber: "#100990" }));
      await db.helpDeskTicket.update({ where: { id: address.ticketId }, data: { orderId: "9901", orderName: "#100990" } });
      expect(await conflictingRequest(db, shop, "address", order)).toContain(`already asked to change this order's address (request #${address.number})`);
      // Another shop's tickets don't count; a decided request doesn't either.
      expect(await conflictingRequest(db, "other.myshopify.com", "address", order)).toBe("");
      await rejectAddressChange(db, shop, address.ticketId!, { note: "No", author: "Priya" });
      expect(await conflictingRequest(db, shop, "address", order)).toBe("");
      // A cancellation in progress blocks both a second cancellation and an address change.
      const cancel = await submitTicket(db, shop, addressForm({ orderNumber: "#100990", update: "Cancel Order", cancelReason: "Changed my mind", subcategory: "Cancel Order" }));
      await db.helpDeskTicket.update({ where: { id: cancel.ticketId }, data: { orderName: "#100990" } });
      expect(await conflictingRequest(db, shop, "address", order)).toContain(`asked to cancel this order (request #${cancel.number})`);
      expect(await conflictingRequest(db, shop, "cancel", order)).toContain("already asked to cancel");
    });

    it("rejects with a reason, and can still update afterwards", async () => {
      const { ticketId } = await submitTicket(db, shop, addressForm());
      expect((await rejectAddressChange(db, shop, ticketId!, { note: " ", author: "Priya" })).errors.note).toBeTruthy();
      expect(await rejectAddressChange(db, shop, ticketId!, { note: "It already left the warehouse.", author: "Priya" })).toEqual({ errors: {}, addressStatus: "Rejected" });
      expect(await load(ticketId!)).toMatchObject({ addressStatus: "Rejected", status: "Resolved", resolutionType: "Request declined" });
      expect((await updateAddressInShopify(db, fakeShopify().admin, shop, ticketId!, { address, note: "", author: "Priya", confirmed: false })).addressStatus).toBe("Updated");
    });
  });

  it("records replies and notes, the first response time, and reopens when the customer replies", async () => {
    const { ticketId, token } = await submitTicket(db, shop, form());
    expect((await addStaffMessage(db, "other.myshopify.com", ticketId!, { kind: "reply", body: "Hi", author: "Priya" })).errors.form).toBeTruthy();
    expect((await addStaffMessage(db, shop, ticketId!, { kind: "reply", body: "   ", author: "Priya" })).errors.body).toBeTruthy();
    expect((await addStaffMessage(db, shop, ticketId!, { kind: "note", body: "Check stock", author: "Priya" })).messageId).toBeTruthy();
    let ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket.firstResponseAt).toBeNull();
    expect(ticket.status).toBe("Open");
    await addStaffMessage(db, shop, ticketId!, { kind: "reply", body: "We're on it", author: "Priya" });
    ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket.firstResponseAt).not.toBeNull();
    expect(ticket.status).toBe("Waiting on customer");
    await addStaffMessage(db, shop, ticketId!, { kind: "reply", body: "Done", author: "Priya", status: "Resolved" });
    expect((await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId } })).resolvedAt).not.toBeNull();

    expect((await addCustomerMessage(db, "other.myshopify.com", token!, "Still broken")).errors.form).toBeTruthy();
    expect((await addCustomerMessage(db, shop, "f".repeat(48), "Still broken")).errors.form).toBeTruthy();
    // A resolved form ticket takes no more customer messages; the customer opens a new request.
    expect((await addCustomerMessage(db, shop, token!, "Still broken")).errors.form).toMatch(/This request is closed/);
    await addStaffMessage(db, shop, ticketId!, { kind: "reply", body: "Can you send a photo?", author: "Priya", status: "Waiting on customer" });
    expect((await addCustomerMessage(db, shop, token!, "Still broken")).messageId).toBeTruthy();
    ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket).toMatchObject({ status: "Open", unread: true, resolvedAt: null });
  });
  it("stores photos sent with a customer reply against that message", async () => {
    const { token, ticketId } = await submitTicket(db, shop, form());
    const png = new File([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6S8AAAAASUVORK5CYII=", "base64")], "proof.png", { type: "image/png" });
    // An open request takes customer messages any time (the assistant answers what it can).
    await updateTicketStatus(db, shop, ticketId!, "Waiting on customer");
    // Photos only once staff turn uploads on for the ticket.
    expect((await addCustomerMessage(db, shop, token!, "", [png])).errors.images).toMatch(/can't be added/);
    expect(await updateTickets(db, shop, [ticketId!], { allowPhotos: "maybe" })).toBe(-1);
    await updateTickets(db, shop, [ticketId!], { allowPhotos: "true" }, "Priya");
    expect((await db.helpDeskMessage.findFirstOrThrow({ where: { ticketId, kind: "event" }, orderBy: { createdAt: "desc" } })).body).toBe("Photo uploads turned on for the customer");
    const sent = await addCustomerMessage(db, shop, token!, "", [png]);
    expect(sent.errors).toEqual({});
    const files = await db.helpDeskAttachment.findMany({ where: { ticketId } });
    expect(files).toHaveLength(1);
    expect(files[0].messageId).toBe(sent.messageId);
    expect((await db.helpDeskMessage.findUniqueOrThrow({ where: { id: sent.messageId } })).body).toBe("Sent 1 image");
    const fake = new File(["not an image"], "x.png", { type: "image/png" });
    expect((await addCustomerMessage(db, shop, token!, "see photo", [fake])).errors.images).toBeTruthy();
    expect((await addCustomerMessage(db, shop, token!, "too many", [png, png, png, png])).errors.images).toBeTruthy();
  });
  it("stores the item, the resolution asked for and a video with a product issue", async () => {
    const png = new File([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6S8AAAAASUVORK5CYII=", "base64")], "riser.png", { type: "image/png" });
    const mp4 = new File([Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(32)])], "lid.mp4", { type: "video/mp4" });
    const issue = (extra: Record<string, string> = {}) => {
      const body = form({ topic: topics[3], orderType: orderTypes[1], orderNumber: "#1002", issue: issues[0], part: productParts[2], details: "Broken tabs", existing: "", query: "", ...extra });
      body.append("products", "gid://shopify/Product/1");
      body.append("images", png);
      return body;
    };
    expect((await submitTicket(db, shop, issue({ resolution: "A pony" }))).errors).toHaveProperty("resolution");
    const body = issue({ resolution: "Replacement part" });
    body.append("videos", mp4);
    const result = await submitTicket(db, shop, body);
    expect(result.errors).toEqual({});
    const ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: result.ticketId }, include: { attachments: true } });
    expect(JSON.parse(ticket.products)).toEqual(["gid://shopify/Product/1"]);
    expect(JSON.parse(ticket.details)).toMatchObject({ resolution: "Replacement part", part: productParts[2] });
    expect(ticket.attachments.map((file) => file.type).sort()).toEqual(["image/png", "video/mp4"]);
    // One video, and only real ones.
    const two = issue();
    two.append("videos", mp4);
    two.append("videos", mp4);
    expect((await submitTicket(db, shop, two)).errors.videos).toMatch(/one video/);
    const fake = issue();
    fake.append("videos", new File(["not a video"], "x.mp4", { type: "video/mp4" }));
    expect((await submitTicket(db, shop, fake)).errors.videos).toMatch(/isn't a video/);
  });
  it("saves each product's problem, photos and video against that product", async () => {
    const png = (name: string) => new File([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6S8AAAAASUVORK5CYII=", "base64")], name, { type: "image/png" });
    const mp4 = new File([Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(32)])], "lock.mp4", { type: "video/mp4" });
    const [caseId, displayId] = ["gid://shopify/Product/1", "gid://shopify/Product/2"];
    const issue = (fill: (body: FormData) => void) => {
      const body = form({ topic: topics[3], orderType: orderTypes[1], orderNumber: "#1002", issue: issues[0], existing: "", query: "" });
      body.append("products", caseId);
      body.append("products", displayId);
      fill(body);
      return body;
    };
    const both = (body: FormData) => {
      body.set(`itemTitle:${caseId}`, "Slab Case X");
      body.set(`itemNote:${caseId}`, "Only one lock takes the code");
      body.append(`images:${caseId}`, png("case.png"));
      body.append(`videos:${caseId}`, mp4);
      body.set(`itemTitle:${displayId}`, "Graded Card Display");
      body.set(`itemNote:${displayId}`, "Cracked front panel");
      body.append(`images:${displayId}`, png("display-1.png"));
      body.append(`images:${displayId}`, png("display-2.png"));
    };
    const result = await submitTicket(db, shop, issue(both));
    expect(result.errors).toEqual({});
    const ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: result.ticketId }, include: { attachments: true } });
    expect(JSON.parse(ticket.details).details).toBe("Slab Case X: Only one lock takes the code\n\nGraded Card Display: Cracked front panel");
    expect(ticket.attachments.map((file) => [file.name, file.productId]).sort()).toEqual([
      ["case.png", caseId], ["display-1.png", displayId], ["display-2.png", displayId], ["lock.mp4", caseId],
    ]);
    // Each product needs what's wrong with it, and (when broken) a photo of it.
    expect((await submitTicket(db, shop, issue((body) => { both(body); body.set(`itemNote:${displayId}`, ""); }))).errors.details).toMatch(/each product/);
    expect((await submitTicket(db, shop, issue((body) => { both(body); body.delete(`images:${displayId}`); }))).errors.images).toMatch(/photo of each product/);
    expect((await submitTicket(db, shop, issue((body) => { both(body); body.append(`videos:${caseId}`, mp4); }))).errors.videos).toMatch(/one video per product/);
  });

  it("stores a video sent with a customer reply, only when staff allowed videos", async () => {
    const { token, ticketId } = await submitTicket(db, shop, form());
    await updateTicketStatus(db, shop, ticketId!, "Waiting on customer");
    // An MP4 starts with a QuickTime "ftyp" box; a WebM with the EBML header.
    const mp4 = new File([Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(32)])], "lid.mp4", { type: "video/mp4" });
    const webm = new File([Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(32)])], "lid.webm", { type: "video/webm" });
    expect((await addCustomerMessage(db, shop, token!, "", [], [mp4])).errors.videos).toMatch(/can't be added/);
    expect(await updateTickets(db, shop, [ticketId!], { allowVideos: "maybe" })).toBe(-1);
    await updateTickets(db, shop, [ticketId!], { allowVideos: "true" }, "Priya");
    expect((await db.helpDeskMessage.findFirstOrThrow({ where: { ticketId, kind: "event" }, orderBy: { createdAt: "desc" } })).body).toBe("Video uploads turned on for the customer");
    // One video at a time, and it must really be a video.
    expect((await addCustomerMessage(db, shop, token!, "", [], [mp4, webm])).errors.videos).toMatch(/one video/);
    expect((await addCustomerMessage(db, shop, token!, "", [], [new File(["not a video"], "x.mp4", { type: "video/mp4" })])).errors.videos).toMatch(/isn't a video/);
    expect((await addCustomerMessage(db, shop, token!, "", [], [new File(["x"], "x.pdf", { type: "application/pdf" })])).errors.videos).toMatch(/Use a video/);
    const sent = await addCustomerMessage(db, shop, token!, "", [], [mp4]);
    expect(sent.errors).toEqual({});
    expect((await db.helpDeskMessage.findUniqueOrThrow({ where: { id: sent.messageId } })).body).toBe("Sent a video");
    const files = await db.helpDeskAttachment.findMany({ where: { ticketId } });
    expect(files.map((file) => [file.type, file.messageId])).toEqual([["video/mp4", sent.messageId]]);
    // Still one video per reply once it's been sent; WebM works too.
    await updateTicketStatus(db, shop, ticketId!, "Waiting on customer");
    expect((await addCustomerMessage(db, shop, token!, "Here it is again", [], [webm])).errors).toEqual({});
    // Any video format is welcome (an AVI with no type from the browser, here), stored as what its bytes say.
    await updateTicketStatus(db, shop, ticketId!, "Waiting on customer");
    const avi = new File([Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("AVI LIST")])], "clip.avi", { type: "" });
    expect((await addCustomerMessage(db, shop, token!, "", [], [avi])).errors).toEqual({});
    expect((await db.helpDeskAttachment.findFirstOrThrow({ where: { ticketId, name: "clip.avi" } })).type).toBe("video/x-msvideo");
  });
  it("queues emails once, skips them without SMTP, and only retries failed ones", async () => {
    const { ticketId } = await submitTicket(db, shop, form());
    const claimStartedAt = Date.now();
    const row = await db.helpDeskEmail.create({ data: { shop, ticketId: ticketId!, kind: "ack", nextAttemptAt: new Date(claimStartedAt - 60 * 60_000) } });
    const smtp = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    try {
      await Promise.all([processEmail(db, row.id), processEmail(db, row.id)]);
      const done = await db.helpDeskEmail.findUniqueOrThrow({ where: { id: row.id } });
      expect(done).toMatchObject({ status: "skipped", attempts: 1 });
      // An overdue email must get a fresh lease when claimed, so another
      // poller cannot mistake the active send for an abandoned one.
      expect(done.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(claimStartedAt);
      expect(await retryEmail(db, "other.myshopify.com", row.id)).toBe(false);
      expect(await retryEmail(db, shop, row.id)).toBe(true);
      expect((await db.helpDeskEmail.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("skipped");
    } finally {
      if (smtp !== undefined) process.env.SMTP_HOST = smtp;
    }
  });
  it("deletes tickets with everything attached, only for the owning shop", async () => {
    const deleteShop = "delete.myshopify.com";
    const { ticketId, token } = await submitTicket(db, deleteShop, form());
    await addStaffMessage(db, deleteShop, ticketId!, { kind: "reply", body: "Send a photo please", author: "Priya" });
    await updateTickets(db, deleteShop, [ticketId!], { allowPhotos: "true" });
    const png = new File([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6S8AAAAASUVORK5CYII=", "base64")], "p.png", { type: "image/png" });
    const sent = await addCustomerMessage(db, deleteShop, token!, "here", [png]);
    const file = await db.helpDeskAttachment.findFirstOrThrow({ where: { messageId: sent.messageId } });
    await db.helpDeskImageScan.create({ data: { attachmentId: file.id, shop: deleteShop, status: "completed" } });
    await db.helpDeskEmail.create({ data: { shop: deleteShop, ticketId: ticketId!, kind: "ack" } });

    expect(await deleteTickets(db, "other.myshopify.com", [ticketId!])).toBe(0);
    expect(await deleteTickets(db, deleteShop, [ticketId!])).toBe(1);
    expect(await db.helpDeskTicket.findUnique({ where: { id: ticketId } })).toBeNull();
    expect(await db.helpDeskMessage.count({ where: { ticketId } })).toBe(0);
    expect(await db.helpDeskAttachment.count({ where: { ticketId } })).toBe(0);
    expect(await db.helpDeskImageScan.count({ where: { attachmentId: file.id } })).toBe(0);
    expect(await db.helpDeskEmail.count({ where: { ticketId } })).toBe(0);
  });
  it("erases a customer's tickets and a whole shop's data on privacy requests", async () => {
    const privacyShop = "privacy.myshopify.com";
    await submitTicket(db, privacyShop, form({ email: "erase@example.com" }));
    await submitTicket(db, privacyShop, form({ email: "keep@example.com" }), "777");
    await submitTicket(db, privacyShop, form({ email: "other@example.com" }), "777");
    await submitTicket(db, "elsewhere.myshopify.com", form({ email: "erase@example.com" }));
    expect(await redactCustomer(db, privacyShop, { email: "erase@example.com" })).toBe(1);
    expect(await redactCustomer(db, privacyShop, { id: 777 })).toBe(2);
    expect(await redactCustomer(db, privacyShop, {})).toBe(0);
    expect(await db.helpDeskTicket.count({ where: { shop: "elsewhere.myshopify.com" } })).toBe(1);

    await submitTicket(db, privacyShop, form());
    await db.helpDeskFaq.create({ data: { shop: privacyShop, question: "Q", answer: "A" } });
    await db.helpDeskSettings.create({ data: { shop: privacyShop } });
    await purgeShop(db, privacyShop);
    expect(await db.helpDeskTicket.count({ where: { shop: privacyShop } })).toBe(0);
    expect(await db.helpDeskFaq.count({ where: { shop: privacyShop } })).toBe(0);
    expect(await db.helpDeskSettings.count({ where: { shop: privacyShop } })).toBe(0);
    expect(await db.helpDeskTicket.count({ where: { shop: "elsewhere.myshopify.com" } })).toBe(1);
  });
  it("fills saved reply placeholders and leaves unknown ones", () => {
    const text = fillMacro("Hi {{ customer.first_name }}, about {{ticket.number}} / {{ order.number }} from {{ store.name }} {{ unknown }}",
      { name: "Rahul Sharma", number: 1007, topic: "Order Queries", details: { orderNumber: "#1042" } }, "Zion Cases");
    expect(text).toBe("Hi Rahul, about #1007 / #1042 from Zion Cases {{ unknown }}");
  });
});

describe("Damaged or defective returns", () => {
  const id = "gid://shopify/Product/1";
  const pdf = () => new File([Buffer.from("%PDF-1.4\n% label")], "label.pdf", { type: "application/pdf" });
  const claim = (extra: Record<string, string> = {}, resolution = "Refund") => {
    const body = form({ topic: topics[3], orderType: orderTypes[1], issue: issues[0], orderNumber: "#1001", existing: "", query: "",
      category: "Product Damage", subcategory: "Broken lid", returnCondition: "Yes", ...extra });
    body.append("products", id);
    body.append(`itemTitle:${id}`, "Slab Case X");
    body.append(`itemNote:${id}`, "Lid cracked");
    body.append(`itemResolution:${id}`, resolution);
    body.append(`images:${id}`, new File([Buffer.from([255, 216, 255, 0])], "crack.jpg", { type: "image/jpeg" }));
    return body;
  };

  it("needs the product unused in its packaging, and a refund or an exchange", async () => {
    expect((await submitTicket(db, shop, claim({ returnCondition: "No" }))).errors.returnCondition).toMatch(/unused/);
    expect((await submitTicket(db, shop, claim({ returnCondition: "" }))).errors.returnCondition).toMatch(/unused/);
    expect((await submitTicket(db, shop, claim({}, "Replacement"))).errors.resolution).toMatch(/refund or an exchange/);
    // Missing parts and warranty claims aren't returns.
    const warranty = await submitTicket(db, shop, claim({ category: "Warranty", returnCondition: "" }, "Replacement"));
    expect(warranty.errors).toEqual({});
    expect((await db.helpDeskTicket.findUniqueOrThrow({ where: { id: warranty.ticketId } })).returnStatus).toBe("");
  });

  it("goes from Pending to Label sent to Received, with the label kept for the customer", async () => {
    const { ticketId, token } = await submitTicket(db, shop, claim());
    expect((await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId } })).returnStatus).toBe("Pending");
    // Only after the label is sent can it be received.
    expect((await markReturnReceived(db, shop, ticketId!, { note: "", author: "Priya" })).errors.form).toMatch(/moved on/);
    expect((await sendReturnLabel(db, shop, ticketId!, { label: null, note: "", author: "Priya" })).errors.label).toBeTruthy();
    expect((await sendReturnLabel(db, shop, ticketId!, { label: new File(["hello"], "x.pdf", { type: "application/pdf" }), note: "", author: "Priya" })).errors.label).toMatch(/PDF, PNG or JPG/);
    expect(await sendReturnLabel(db, shop, ticketId!, { label: pdf(), note: "Drop it off within 14 days.", author: "Priya" })).toEqual({ errors: {}, returnStatus: "Label sent" });
    const sent = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(sent).toMatchObject({ returnStatus: "Label sent", returnNote: "Drop it off within 14 days.", returnDecidedBy: "Priya", status: "Waiting on customer" });
    expect(await returnLabelFile(db, shop, token!)).toMatchObject({ name: "label.pdf", type: "application/pdf" });
    expect(await returnLabelFile(db, "other.myshopify.com", token!)).toBeNull();
    // The label isn't one of the customer's photos.
    expect((await db.helpDeskAttachment.findUniqueOrThrow({ where: { id: sent.returnLabelId } })).messageId).toBeTruthy();
    // Rejecting is only for a pending return.
    expect((await rejectReturn(db, shop, ticketId!, { note: "No", author: "Priya" })).errors.form).toMatch(/moved on/);
    expect(await markReturnReceived(db, shop, ticketId!, { note: "", author: "Sam" })).toEqual({ errors: {}, returnStatus: "Received" });
    expect(await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId } })).toMatchObject({ returnStatus: "Received", status: "In progress", resolutionType: "Return accepted" });
    const events = (await db.helpDeskMessage.findMany({ where: { ticketId, kind: "event" }, orderBy: { createdAt: "asc" } })).map((message) => message.body);
    expect(events).toEqual(expect.arrayContaining(["Return approved. Return label sent to the customer: label.pdf", "Returned product received and verified"]));
  });

  it("is rejected with a reason for the customer", async () => {
    const { ticketId, token } = await submitTicket(db, shop, claim());
    expect((await rejectReturn(db, shop, ticketId!, { note: " ", author: "Priya" })).errors.note).toBeTruthy();
    expect(await rejectReturn(db, shop, ticketId!, { note: "The case has been used.", author: "Priya" })).toEqual({ errors: {}, returnStatus: "Rejected" });
    expect(await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId } })).toMatchObject({ returnStatus: "Rejected", status: "Resolved", resolutionType: "Request declined" });
    expect(await returnLabelFile(db, shop, token!)).toBeNull();
  });
});

describe("Order edit requests", () => {
  const [slab, riser] = ["gid://shopify/LineItem/11", "gid://shopify/LineItem/12"];
  const order = (fulfillment = "UNFULFILLED") => ({ data: { orders: { nodes: [{
    legacyResourceId: "7801", name: "#100950", email: "customer@example.com", createdAt: "2026-10-20T12:00:00Z", cancelledAt: null,
    displayFinancialStatus: "PAID", displayFulfillmentStatus: fulfillment, totalPriceSet: { shopMoney: { amount: "100.00", currencyCode: "USD" } },
    shippingAddress: null, fulfillments: [], lineItems: { nodes: [
      { id: slab, title: "Slab Case X", variantTitle: "Black", sku: "SLAB-BLK", quantity: 1, currentQuantity: 1, unfulfilledQuantity: 1, product: { id: "gid://shopify/Product/1" }, image: null },
      { id: riser, title: "Riser", variantTitle: null, sku: "RISER", quantity: 2, currentQuantity: 2, unfulfilledQuantity: 2, product: { id: "gid://shopify/Product/2" }, image: null },
    ] },
  }] } } });
  const editForm = (extra: Record<string, string> = {}) => {
    const body = form({ topic: topics[3], orderType: orderTypes[0], update: "Change Product or Quantity", orderNumber: "#100950", existing: "", query: "",
      category: "Orders", subcategory: "Edit Items, Color or Quantity", chargesAccepted: "Yes", details: "Please hurry", ...extra });
    body.append("products", slab);
    body.set(`itemTitle:${slab}`, "Slab Case X");
    body.set(`itemAction:${slab}`, "Change color or size");
    body.set(`itemVariant:${slab}`, "Blue");
    body.append("products", riser);
    body.set(`itemTitle:${riser}`, "Riser");
    body.set(`itemAction:${riser}`, "Remove");
    body.set("addedItems", JSON.stringify([{ id: "gid://shopify/Product/3", title: "Card Stand", quantity: 2 }, { id: "javascript:alert(1)", title: "x", quantity: 1 }]));
    return body;
  };
  // A Shopify that edits orders: begin, quantities, added variants, totals and commit.
  function fakeShopify(state: { fulfillment?: string } = {}) {
    const calls: { query: string; variables?: Record<string, unknown> }[] = [];
    const admin = {
      graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
        calls.push({ query, variables: options?.variables });
        const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });
        if (query.includes("orderEditBegin")) return new Response(JSON.stringify({ data: { orderEditBegin: { calculatedOrder: { id: "gid://shopify/CalculatedOrder/9", lineItems: { nodes: [
          { id: "gid://shopify/CalculatedLineItem/11", quantity: 1 }, { id: "gid://shopify/CalculatedLineItem/12", quantity: 2 }] } }, userErrors: [] } } }));
        if (query.includes("orderEditSetQuantity")) return new Response(JSON.stringify({ data: { orderEditSetQuantity: { calculatedOrder: { id: "x" }, userErrors: [] } } }));
        if (query.includes("orderEditAddVariant")) return new Response(JSON.stringify({ data: { orderEditAddVariant: { calculatedOrder: { id: "x" }, userErrors: [] } } }));
        if (query.includes("HelpDeskEditTotals")) return new Response(JSON.stringify({ data: { node: { originalOrder: { totalPriceSet: money("100.00") }, totalPriceSet: money("115.00"), totalOutstandingSet: money("15.00") } } }));
        if (query.includes("orderEditCommit")) return new Response(JSON.stringify({ data: { orderEditCommit: { order: { id: "gid://shopify/Order/7801" }, userErrors: [] } } }));
        return new Response(JSON.stringify(order(state.fulfillment)));
      },
    };
    return { admin, calls, named: (name: string) => calls.filter((call) => call.query.includes(name)) };
  }
  const ops = { lines: [{ lineItemId: riser, quantity: 0 }, { lineItemId: slab, quantity: 0 }], adds: [{ variantId: "gid://shopify/ProductVariant/31", quantity: 1 }] };

  it("keeps what to do with each item and the products to add, and needs the charges accepted", async () => {
    expect((await submitTicket(db, shop, editForm({ chargesAccepted: "" }))).errors.chargesAccepted).toBeTruthy();
    const unanswered = editForm();
    unanswered.delete(`itemAction:${riser}`);
    expect((await submitTicket(db, shop, unanswered)).errors.products).toMatch(/each item/);
    const { ticketId, errors } = await submitTicket(db, shop, editForm());
    expect(errors).toEqual({});
    const ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket).toMatchObject({ editStatus: "Pending", tags: "order-edit" });
    const details = JSON.parse(ticket.details);
    expect(details).toMatchObject({ addedProducts: "Card Stand × 2", chargesAccepted: "Yes", details: "Slab Case X: change to Blue\nRiser: Remove\nAdd: Card Stand × 2\nPlease hurry" });
    expect(JSON.parse(details.editRequest)).toEqual({
      lines: [{ id: slab, title: "Slab Case X", action: "Change color or size", quantity: null, variant: "Blue" }, { id: riser, title: "Riser", action: "Remove", quantity: 0, variant: "" }],
      adds: [{ id: "gid://shopify/Product/3", title: "Card Stand", quantity: 2 }],
    });
  });

  it("previews the new total without saving, then updates the order in Shopify while it's at the warehouse", async () => {
    const { ticketId } = await submitTicket(db, shop, editForm());
    const packing = fakeShopify({ fulfillment: "IN_PROGRESS" });
    expect((await applyOrderEdit(db, packing.admin, shop, ticketId!, { ops, note: "", author: "Priya", notifyCustomer: true, summary: "removed Riser" })).errors.form).toMatch(/Not shipped or being packed/);
    expect(packing.named("orderEditBegin")).toHaveLength(0);
    const ready = fakeShopify();
    expect(await previewOrderEdit(db, ready.admin, shop, ticketId!, ops)).toEqual({ errors: {}, totals: {
      before: { amount: "100.00", currencyCode: "USD" }, after: { amount: "115.00", currencyCode: "USD" }, outstanding: { amount: "15.00", currencyCode: "USD" } } });
    expect(ready.named("orderEditCommit")).toHaveLength(0);
    expect(await applyOrderEdit(db, ready.admin, shop, ticketId!, { ops, note: "Swapped it.", author: "Priya", notifyCustomer: true, summary: "removed Riser; removed Slab Case X; added Slab Case X - Blue × 1" }))
      .toEqual({ errors: {}, editStatus: "Updated" });
    expect(ready.named("orderEditSetQuantity").map((call) => call.variables)).toEqual([
      { id: "gid://shopify/CalculatedOrder/9", lineItemId: "gid://shopify/CalculatedLineItem/12", quantity: 0, restock: true },
      { id: "gid://shopify/CalculatedOrder/9", lineItemId: "gid://shopify/CalculatedLineItem/11", quantity: 0, restock: true },
      { id: "gid://shopify/CalculatedOrder/9", lineItemId: "gid://shopify/CalculatedLineItem/12", quantity: 0, restock: true },
      { id: "gid://shopify/CalculatedOrder/9", lineItemId: "gid://shopify/CalculatedLineItem/11", quantity: 0, restock: true },
    ]);
    expect(ready.named("orderEditAddVariant")[0].variables).toMatchObject({ variantId: "gid://shopify/ProductVariant/31", quantity: 1 });
    expect(ready.named("orderEditCommit")).toHaveLength(1);
    expect(ready.named("orderEditCommit")[0].variables).toMatchObject({ id: "gid://shopify/CalculatedOrder/9", notifyCustomer: true });
    expect(await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId } })).toMatchObject({ editStatus: "Updated", editNote: "Swapped it.", status: "Resolved", resolutionType: "Order updated" });
    // Decided once.
    expect((await rejectOrderEdit(db, shop, ticketId!, { note: "No", author: "Priya" })).errors.form).toMatch(/already been decided/);
  });

  it("is rejected with a reason, and staff changes are cleaned", async () => {
    const { ticketId } = await submitTicket(db, shop, editForm());
    expect((await rejectOrderEdit(db, shop, ticketId!, { note: " ", author: "Priya" })).errors.note).toBeTruthy();
    expect(await rejectOrderEdit(db, shop, ticketId!, { note: "It has already left our warehouse.", author: "Priya" })).toEqual({ errors: {}, editStatus: "Rejected" });
    expect(cleanOps({ lines: [{ lineItemId: "nope", quantity: 1 }], adds: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 500 }] })).toEqual({ lines: [], adds: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 99 }] });
  });
});

describe("Missing part replacements", () => {
  const id = "gid://shopify/Product/1";
  const claim = () => {
    const body = form({ topic: topics[3], orderType: orderTypes[1], issue: issues[2], orderNumber: "#1001", existing: "", query: "", category: "Missing Parts", subcategory: "Item missing from order" });
    body.append("products", id);
    body.append(`itemTitle:${id}`, "Slab Case X");
    body.append(`itemNote:${id}`, "The risers weren't in the box");
    body.append(`images:${id}`, new File([Buffer.from([255, 216, 255, 0])], "box.jpg", { type: "image/jpeg" }));
    return body;
  };

  it("goes from Pending to Approved to Shipped, with the tracking for the customer", async () => {
    const { ticketId, errors } = await submitTicket(db, shop, claim());
    expect(errors).toEqual({});
    // Only an approved replacement can ship.
    expect((await shipReplacement(db, shop, ticketId!, { note: "", author: "Priya", carrier: "USPS", number: "9400", url: "" })).errors.form).toMatch(/moved on/);
    expect(await approveReplacement(db, shop, ticketId!, { note: "We'll send new risers.", author: "Priya" })).toEqual({ errors: {}, replacementStatus: "Approved" });
    expect(await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId } })).toMatchObject({ replacementStatus: "Approved", status: "In progress" });
    expect((await shipReplacement(db, shop, ticketId!, { note: "", author: "Priya", carrier: "USPS", number: " ", url: "" })).errors.number).toBeTruthy();
    expect((await shipReplacement(db, shop, ticketId!, { note: "", author: "Priya", carrier: "USPS", number: "9400", url: "javascript:alert(1)" })).errors.url).toBeTruthy();
    expect(await shipReplacement(db, shop, ticketId!, { note: "On its way!", author: "Sam", carrier: "USPS", number: "9400111", url: "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111" }))
      .toEqual({ errors: {}, replacementStatus: "Shipped" });
    const ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId }, include: { messages: true } });
    expect(ticket).toMatchObject({ replacementStatus: "Shipped", replacementCarrier: "USPS", replacementTracking: "9400111", status: "Resolved", resolutionType: "Replacement part", replacementDecidedBy: "Sam" });
    expect(ticket.messages.map((message) => message.body)).toEqual(expect.arrayContaining(["Replacement approved", "Replacement part shipped with USPS: 9400111"]));
  });

  it("is rejected with a reason, for example when the part is still in transit", async () => {
    const { ticketId } = await submitTicket(db, shop, claim());
    expect((await rejectReplacement(db, shop, ticketId!, { note: " ", author: "Priya" })).errors.note).toBeTruthy();
    expect(await rejectReplacement(db, shop, ticketId!, { note: "The risers ship separately and are still in transit.", author: "Priya" })).toEqual({ errors: {}, replacementStatus: "Rejected" });
    expect(await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId } })).toMatchObject({ replacementStatus: "Rejected", status: "Resolved", resolutionType: "Request declined" });
    // It can still be approved later.
    expect((await approveReplacement(db, shop, ticketId!, { note: "", author: "Priya" })).replacementStatus).toBe("Approved");
  });
});

describe("Warranty claims", () => {
  const id = "gid://shopify/Product/1";
  const claim = () => {
    const body = form({ topic: topics[3], orderType: orderTypes[1], issue: issues[0], orderNumber: "#1001", existing: "", query: "",
      category: "Warranty", subcategory: "Replacement request", purchasedFrom: "Amazon", purchaseDate: "2026-03" });
    body.append("products", id);
    body.append(`itemTitle:${id}`, "Slab Case X");
    body.append(`itemNote:${id}`, "The lock stopped working");
    body.append(`itemResolution:${id}`, "Refund");
    return body;
  };

  it("needs photos, asks for no solution, and starts pending as a warranty", async () => {
    expect((await submitTicket(db, shop, claim())).errors.images).toBeTruthy();
    const body = claim();
    body.append(`images:${id}`, new File([Buffer.from([255, 216, 255, 0])], "lock.jpg", { type: "image/jpeg" }));
    const { ticketId, errors } = await submitTicket(db, shop, body);
    expect(errors).toEqual({});
    const ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket).toMatchObject({ replacementStatus: "Pending", replacementKind: "warranty", tags: "warranty" });
    expect(JSON.parse(ticket.details)).not.toHaveProperty("resolution");
  });

  it("is approved with a solution, then the next steps are sent, with or without tracking", async () => {
    const body = claim();
    body.append(`images:${id}`, new File([Buffer.from([255, 216, 255, 0])], "lock.jpg", { type: "image/jpeg" }));
    const { ticketId } = await submitTicket(db, shop, body);
    expect((await approveReplacement(db, shop, ticketId!, { note: "", author: "Priya" })).errors.solution).toBeTruthy();
    expect((await approveReplacement(db, shop, ticketId!, { note: "", author: "Priya", solution: "Refund" })).errors.solution).toBeTruthy();
    expect(await approveReplacement(db, shop, ticketId!, { note: "", author: "Priya", solution: "Repair" })).toEqual({ errors: {}, replacementStatus: "Approved" });
    // A repair ships nothing yet: the instructions are the next steps.
    expect((await shipReplacement(db, shop, ticketId!, { note: " ", author: "Priya", carrier: "", number: "", url: "" })).errors.note).toBeTruthy();
    expect(await shipReplacement(db, shop, ticketId!, { note: "Send the case to our warehouse with the label we've emailed.", author: "Priya", carrier: "", number: "", url: "" }))
      .toEqual({ errors: {}, replacementStatus: "Shipped" });
    const ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId }, include: { messages: true } });
    expect(ticket).toMatchObject({ replacementSolution: "Repair", replacementStatus: "Shipped", status: "Resolved", replacementTracking: "" });
    expect(ticket.messages.map((message) => message.body)).toEqual(expect.arrayContaining(["Warranty claim approved: Repair", "Warranty claim: next steps sent to the customer"]));
  });
});

describe("Lost packages", () => {
  const claim = (extra: Record<string, string> = {}) => {
    const body = form({ topic: topics[3], orderType: orderTypes[3], delivery: deliveryIssues[8], orderNumber: "#1001", existing: "", query: "",
      category: "Shipping & Delivery", subcategory: "Lost Package", details: "Tracking stopped a week ago", lostPreference: "Send the missing product", ...extra });
    body.append("products", "gid://shopify/Product/2");
    return body;
  };

  it("needs the missing product, details and a preference, and starts pending with it", async () => {
    expect((await submitTicket(db, shop, claim({ lostPreference: "A pony" }))).errors.lostPreference).toBeTruthy();
    expect((await submitTicket(db, shop, claim({ details: "" }))).errors.details).toBeTruthy();
    const none = claim();
    none.delete("products");
    expect((await submitTicket(db, shop, none)).errors.products).toMatch(/missing products/);
    const { ticketId, errors } = await submitTicket(db, shop, claim());
    expect(errors).toEqual({});
    const ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket).toMatchObject({ replacementStatus: "Pending", replacementKind: "lost", replacementSolution: "Send the missing product", tags: "lost-package" });
    expect(JSON.parse(ticket.products)).toEqual(["gid://shopify/Product/2"]);
  });

  it("is approved with the customer's choice, and a refund's next steps need no tracking", async () => {
    const { ticketId } = await submitTicket(db, shop, claim({ lostPreference: "Refund" }));
    expect(await approveReplacement(db, shop, ticketId!, { note: "", author: "Priya" })).toEqual({ errors: {}, replacementStatus: "Approved" });
    expect(await shipReplacement(db, shop, ticketId!, { note: "We've refunded the riser to your card.", author: "Priya", carrier: "", number: "", url: "" }))
      .toEqual({ errors: {}, replacementStatus: "Shipped" });
    const ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId }, include: { messages: true } });
    expect(ticket).toMatchObject({ replacementSolution: "Refund", status: "Resolved", resolutionType: "Refund" });
    expect(ticket.messages.map((message) => message.body)).toEqual(expect.arrayContaining(["Lost package approved: Refund", "Lost package: next steps sent to the customer"]));
  });

  it("can be sent again instead, with tracking", async () => {
    const { ticketId } = await submitTicket(db, shop, claim({ lostPreference: "Refund" }));
    expect(await approveReplacement(db, shop, ticketId!, { note: "", author: "Priya", solution: "Send the missing product" })).toEqual({ errors: {}, replacementStatus: "Approved" });
    expect(await shipReplacement(db, shop, ticketId!, { note: "", author: "Priya", carrier: "UPS", number: "1Z1", url: "" })).toEqual({ errors: {}, replacementStatus: "Shipped" });
    expect(await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId } })).toMatchObject({ replacementSolution: "Send the missing product", replacementTracking: "1Z1", resolutionType: "Replacement" });
  });
});

describe("International shipping quotes", () => {
  const request = (extra: Record<string, string> = {}) => {
    const body = form({ topic: topics[0], country: "DE", address: "Hauptstrasse 12, Berlin, 10115", category: "Shipping & Delivery", subcategory: "International Shipping", shippingMethod: "Expedited", ...extra });
    body.append("products", "gid://shopify/Product/1");
    body.set("itemQty:gid://shopify/Product/1", "2");
    body.set("itemTitle:gid://shopify/Product/1", "Slab Case X");
    return body;
  };

  it("needs Regular or Expedited shipping, and starts pending", async () => {
    expect((await submitTicket(db, shop, request({ shippingMethod: "Teleport" }))).errors.shippingMethod).toBeTruthy();
    const { ticketId, errors } = await submitTicket(db, shop, request());
    expect(errors).toEqual({});
    const ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket).toMatchObject({ quoteStatus: "Pending", tags: "shipping-quote" });
    expect(JSON.parse(ticket.details)).toMatchObject({ shippingMethod: "Expedited", quantities: "Slab Case X × 2" });
    // Domestic shipping isn't quoted this way.
    const domestic = await submitTicket(db, shop, request({ subcategory: "Domestic Shipping", country: "US", shippingMethod: "" }));
    expect(domestic.errors).toEqual({});
    expect((await db.helpDeskTicket.findUniqueOrThrow({ where: { id: domestic.ticketId } })).quoteStatus).toBe("");
  });

  it("sends the delivery date, shipping cost and taxes, once", async () => {
    const { ticketId } = await submitTicket(db, shop, request());
    expect(Object.keys((await sendQuote(db, shop, ticketId!, { carrier: "", delivery: "", shipping: "", taxes: "", note: "", author: "Priya" })).errors).sort()).toEqual(["delivery", "shipping", "taxes"]);
    expect(await sendQuote(db, shop, ticketId!, { carrier: "DHL Express", delivery: "Nov 18-22", shipping: "$45.00", taxes: "About $12 VAT", note: "In stock!", author: "Priya" }))
      .toEqual({ errors: {}, quoteStatus: "Quoted" });
    expect(await db.helpDeskTicket.findUniqueOrThrow({ where: { id: ticketId } })).toMatchObject({
      quoteStatus: "Quoted", quoteCarrier: "DHL Express", quoteDelivery: "Nov 18-22", quoteShipping: "$45.00", quoteTaxes: "About $12 VAT", status: "Resolved" });
    expect((await quoteUnavailable(db, shop, ticketId!, { note: "No", author: "Priya" })).errors.form).toMatch(/already been sent/);
  });

  it("tells the customer when it isn't available, with a reason", async () => {
    const { ticketId } = await submitTicket(db, shop, request());
    expect((await quoteUnavailable(db, shop, ticketId!, { note: " ", author: "Priya" })).errors.note).toBeTruthy();
    expect(await quoteUnavailable(db, shop, ticketId!, { note: "We can't ship batteries there.", author: "Priya" })).toEqual({ errors: {}, quoteStatus: "Unavailable" });
  });
});
