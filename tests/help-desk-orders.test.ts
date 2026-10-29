import { describe, expect, it, vi } from "vitest";
import { fillMacro } from "../app/services/help-desk";
import { buildDashboard } from "../app/services/help-desk-dashboard.server";
import { checkOrderChange, issueItems, lookupTracking, productVariants, orderSearch, orderSnapshot, shapeOrder, subcategoryFromOrder } from "../app/services/help-desk-orders.server";
import { renderRequestPage } from "../app/services/help-desk-request-page";

// An order as Shopify's Admin API returns it (orders query in help-desk-orders.server.ts).
const node = (changes: Record<string, unknown> = {}) => ({
  id: "gid://shopify/Order/1", legacyResourceId: "5501", name: "#100472", email: "Jordan@Example.com", createdAt: "2026-10-10T12:00:00Z", cancelledAt: null,
  displayFinancialStatus: "PAID", displayFulfillmentStatus: "FULFILLED",
  totalPriceSet: { shopMoney: { amount: "189.99", currencyCode: "USD" } },
  shippingAddress: { city: "Austin", provinceCode: "TX", countryCodeV2: "US" },
  lineItems: { nodes: [{ title: "Slab Case X", variantTitle: "Black", sku: "ZC-SLABX-BLK", quantity: 1, image: null }, { title: "Riser", variantTitle: "Default Title", sku: "ZC-RISER", quantity: 2, image: null }] },
  fulfillments: [
    { createdAt: "2026-10-11T09:00:00Z", status: "SUCCESS", displayStatus: "IN_TRANSIT", deliveredAt: null, estimatedDeliveryAt: "2026-10-15T00:00:00Z", inTransitAt: "2026-10-12T00:00:00Z",
      trackingInfo: [{ company: "UPS", number: "1Z999AA10123456784", url: "https://www.ups.com/track?tracknum=1Z999AA10123456784" }] },
  ],
  ...changes,
});
const order = (changes: Record<string, unknown> = {}) => shapeOrder(node(changes) as Parameters<typeof shapeOrder>[0]);
const delivered = [{ createdAt: "2026-10-11T09:00:00Z", status: "SUCCESS", displayStatus: "DELIVERED", deliveredAt: "2026-10-14T15:00:00Z", estimatedDeliveryAt: null, inTransitAt: null, trackingInfo: [{ company: "UPS", number: "1Z1", url: "https://ups.com/1Z1" }] }];

describe("Ticket orders from Shopify", () => {
  it("finds the order from however the customer wrote its number", () => {
    expect(orderSearch("#100472")).toBe("name:#100472");
    expect(orderSearch("order#100472")).toBe("name:#100472");
    expect(orderSearch("#87571 & #94082")).toBe("name:#87571");
    expect(orderSearch("No order id yet")).toBeNull();
    expect(orderSearch("")).toBeNull();
  });

  it("shapes Shopify's order: totals, items with SKUs and each shipment's tracking", () => {
    const result = order();
    expect(result).toMatchObject({ id: "5501", name: "#100472", total: "$189.99", amount: 189.99, country: "US", fulfilled: "full", payment: "Paid" });
    expect(result.items.map((item) => [item.sku, item.variant])).toEqual([["ZC-SLABX-BLK", "Black"], ["ZC-RISER", ""]]);
    expect(result.shipments).toEqual([expect.objectContaining({ label: "In transit", tone: "info", carrier: "UPS", number: "1Z999AA10123456784" })]);
  });

  it("saves a snapshot on the ticket, and only trusts the order for the email it was placed with", () => {
    expect(orderSnapshot(order(), "jordan@example.com")).toMatchObject({
      orderName: "#100472", orderValue: 189.99, carrier: "UPS", trackingNumber: "1Z999AA10123456784", shipmentStatus: "In transit", orderSkus: "ZC-SLABX-BLK, ZC-RISER", orderVerified: true,
    });
    expect(orderSnapshot(order(), "someone@else.com").orderVerified).toBe(false);
    expect(orderSnapshot(order({ fulfillments: [], displayFulfillmentStatus: "UNFULFILLED" }), "jordan@example.com").shipmentStatus).toBe("Order Not Shipped Yet");
  });

  it("corrects the sub-category to what Shopify shows the order's status to be", () => {
    const where = "Track My Order";
    expect(subcategoryFromOrder(where, order({ fulfillments: [], displayFulfillmentStatus: "UNFULFILLED" }))).toBe("Order Not Shipped Yet");
    expect(subcategoryFromOrder(where, order({ fulfillments: [], displayFulfillmentStatus: "ON_HOLD" }))).toBe("Order on Hold");
    expect(subcategoryFromOrder(where, order({ fulfillments: delivered }))).toBe("Delivered but Not Received");
    expect(subcategoryFromOrder(where, order({ fulfillments: [{ ...delivered[0], displayStatus: "ATTEMPTED_DELIVERY", deliveredAt: null }] }))).toBe("Delivery Attempted or Failed");
    expect(subcategoryFromOrder("Order Not Shipped Yet", order())).toBe("Track My Order");
    expect(subcategoryFromOrder(where, order())).toBe(where);
    // What the customer asked for that isn't about the order's status stands.
    expect(subcategoryFromOrder("Cancel Order", order({ fulfillments: delivered }))).toBe("Cancel Order");
  });

  it("lists a product's variants for a wrong colour or size, without Shopify's Default Title", async () => {
    const admin = (nodes: unknown[]) => ({ graphql: vi.fn(async () => new Response(JSON.stringify({ data: { product: { variants: { nodes } } } }))) });
    expect(await productVariants(admin([{ title: "Black", availableForSale: true }, { title: "Blue", availableForSale: false }]), "gid://shopify/Product/1"))
      .toEqual([{ title: "Black", available: true }, { title: "Blue", available: false }]);
    expect(await productVariants(admin([{ title: "Default Title", availableForSale: true }]), "gid://shopify/Product/1")).toEqual([]);
    // Not a product ID: nothing asked of Shopify.
    const unused = admin([]);
    expect(await productVariants(unused, "gid://shopify/Order/1")).toEqual([]);
    expect(unused.graphql).not.toHaveBeenCalled();
    expect(await productVariants({ graphql: async () => { throw new Error("offline"); } }, "gid://shopify/Product/1")).toBeUndefined();
  });

  it("offers a product issue the order's items, only for the email it was placed with", async () => {
    const withProducts = node({ fulfillments: delivered, lineItems: { nodes: [
      { title: "Slab Case X", variantTitle: "Black", sku: "ZC-SLABX-BLK", quantity: 1, product: { id: "gid://shopify/Product/1" }, image: { url: "https://cdn.example/x.jpg" } },
      { title: "Custom engraving", variantTitle: null, sku: null, quantity: 1, product: null, image: null },
    ] } });
    const admin = { graphql: vi.fn(async () => new Response(JSON.stringify({ data: { orders: { nodes: [withProducts] } } }))) };
    // Items that are no longer products (no product) can't be picked.
    expect(await issueItems(admin, "#100472", "jordan@example.com")).toEqual({
      order: "#100472", deliveredAt: "2026-10-14T15:00:00Z", partial: false,
      items: [{ id: "gid://shopify/Product/1", title: "Slab Case X", variant: "Black", quantity: 1, image: "https://cdn.example/x.jpg" }],
    });
    expect(await issueItems(admin, "#100472", "stranger@example.com")).toBeNull();
    const failing = { graphql: vi.fn(async () => { throw new Error("offline"); }) };
    expect(await issueItems(failing, "#100472", "jordan@example.com")).toBeUndefined();
  });

  it("shows self-service tracking only when the order number and email match", async () => {
    const admin = { graphql: vi.fn(async () => new Response(JSON.stringify({ data: { orders: { nodes: [node()] } } }))) };
    const tracking = await lookupTracking(admin, "#100472", " jordan@example.com ");
    expect(tracking).toEqual({
      order: "#100472", placedAt: "2026-10-10T12:00:00Z", cancelled: false, shipped: true, onHold: false,
      shipments: [expect.objectContaining({ status: "IN_TRANSIT", label: "In transit", carrier: "UPS", url: expect.stringMatching(/^https:/), shippedAt: "2026-10-11T09:00:00Z" })],
    });
    // No address, items or prices for the storefront.
    expect(JSON.stringify(tracking)).not.toMatch(/Austin|189|ZC-/);
    expect(await lookupTracking(admin, "#100472", "stranger@example.com")).toBeNull();
    const failing = { graphql: vi.fn(async () => { throw new Error("offline"); }) };
    expect(await lookupTracking(failing, "#100472", "jordan@example.com")).toBeUndefined();
  });

  it("fills tracking into saved replies, and leaves a placeholder that has no value yet", () => {
    const ticket = { name: "Jordan Lee", number: 1001, topic: "Order Inquiry", details: { orderNumber: "100472" } };
    const body = "{{ order.number }} shipped with {{ order.carrier }}: {{ order.tracking_number }} ({{ order.shipment_status }}) {{ order.tracking_url }}";
    expect(fillMacro(body, ticket, "Zion Cases", { name: "#100472", carrier: "UPS", trackingNumber: "1Z1", trackingUrl: "https://ups.com/1Z1", shipmentStatus: "In transit" }))
      .toBe("#100472 shipped with UPS: 1Z1 (In transit) https://ups.com/1Z1");
    expect(fillMacro("Tracking: {{ order.tracking_number }}", ticket, "Zion Cases")).toBe("Tracking: {{ order.tracking_number }}");
  });

  it("shows the shipment on the customer's request page", () => {
    const ticket = { number: 1001, topic: "Order Inquiry", status: "Open", channel: "form", createdAt: new Date("2026-10-20T10:00:00Z"), accessToken: "a".repeat(48), details: "{}", messages: [] };
    const extras = { imageCounts: new Map(), requestImages: 0, products: [], receivedProducts: [], canReply: false, maxImages: 3, maxLength: 1000 };
    const html = renderRequestPage(ticket, { ...extras, shipment: { order: "#100472", status: "In transit", carrier: "UPS", number: "1Z1", url: "https://ups.com/1Z1" } });
    expect(html).toContain("<h2>Shipment</h2>");
    expect(html).toContain('href="https://ups.com/1Z1"');
    expect(renderRequestPage(ticket, extras)).not.toContain("<h2>Shipment</h2>");
    // A link that isn't https is never rendered.
    expect(renderRequestPage(ticket, { ...extras, shipment: { order: "#1", status: "Shipped", carrier: "", number: "", url: "javascript:alert(1)" } })).not.toContain("javascript:");
  });

  it("reports delivery and damage tickets by carrier", () => {
    const now = Date.parse("2026-10-23T12:00:00Z");
    const at = new Date(now - 86400_000);
    const rows = [
      { createdAt: at, resolvedAt: null, firstResponseAt: null, topic: "Order Inquiry", category: "Shipping Damage", carrier: "UPS" },
      { createdAt: at, resolvedAt: null, firstResponseAt: null, topic: "Order Inquiry", category: "Shipping & Delivery", carrier: "UPS" },
      { createdAt: at, resolvedAt: null, firstResponseAt: null, topic: "Order Inquiry", category: "Shipping & Delivery", carrier: "USPS" },
      // Not something a carrier causes.
      { createdAt: at, resolvedAt: null, firstResponseAt: null, topic: "General Inquiry", category: "Product Compatibility", carrier: "UPS" },
    ];
    expect(buildDashboard(rows, [], [], 7, now).carriers).toEqual([{ label: "UPS", value: 2 }, { label: "USPS", value: 1 }]);
  });
});

describe("Can the customer still cancel or re-address their order?", () => {
  const admin = (changes: Record<string, unknown> = {}) => ({ graphql: async () => new Response(JSON.stringify({ data: { orders: { nodes: [node(changes)] } } })) });
  const unshipped = { displayFulfillmentStatus: "UNFULFILLED", fulfillments: [] };
  const toronto = { name: "Jordan Lee", address1: "1 King St W", address2: "", city: "Toronto", province: "ON", zip: "M5H 1A1", country: "CA", phone: "" };
  const answer = (kind: "cancel" | "address", changes: Record<string, unknown>, email = "jordan@example.com", to?: typeof toronto) => checkOrderChange(admin(changes), kind, "#100472", email, to);

  it("allows both while nothing has started, and says which country the order ships to", async () => {
    expect(await answer("cancel", unshipped)).toEqual({ allowed: true, country: "US", orderId: "5501", orderName: "#100472" });
    expect(await answer("address", unshipped)).toEqual({ allowed: true, country: "US", orderId: "5501", orderName: "#100472" });
    expect(await answer("address", { ...unshipped, displayFulfillmentStatus: "ON_HOLD" })).toMatchObject({ allowed: true });
  });

  it.each([
    ["delivered", { fulfillments: delivered }, false, false],
    ["in transit", {}, false, false],
    ["partly shipped", { displayFulfillmentStatus: "PARTIALLY_FULFILLED" }, false, false],
    ["being packed", { displayFulfillmentStatus: "IN_PROGRESS", fulfillments: [] }, true, false],
    ["cancelled", { ...unshipped, cancelledAt: "2026-10-12T00:00:00Z" }, false, false],
    ["a pickup order", { ...unshipped, requiresShipping: false }, true, false],
  ] as const)("an order %s: cancel %s, change address %s", async (_, changes, cancel, address) => {
    expect((await answer("cancel", changes))?.allowed).toBe(cancel);
    expect((await answer("address", changes))?.allowed).toBe(address);
  });

  it("tells the customer why in plain words", async () => {
    expect(await answer("address", { fulfillments: delivered })).toMatchObject({ allowed: false, error: expect.stringContaining("contact the carrier") });
    expect(await answer("cancel", { fulfillments: delivered })).toMatchObject({ allowed: false, error: expect.stringContaining("Returns, Exchanges & Refunds") });
    expect(await answer("address", unshipped, "jordan@example.com", toronto)).toMatchObject({ allowed: false, error: expect.stringContaining("same country") });
    // The address it already ships to (Austin, TX, US in the fixture).
    expect(await answer("address", { ...unshipped, shippingAddress: { address1: "1 Main St", city: "Austin", provinceCode: "TX", zip: "78701", countryCodeV2: "US" } }, "jordan@example.com",
      { ...toronto, address1: "1 MAIN ST.", city: "austin", province: "TX", zip: "78701", country: "US" })).toMatchObject({ allowed: false, error: expect.stringContaining("already going to this address") });
  });

  it("only answers about an order placed with that email", async () => {
    expect(await answer("cancel", unshipped, "someone@example.com")).toMatchObject({ allowed: false, notFound: true });
    expect(await checkOrderChange({ graphql: async () => new Response(JSON.stringify({ data: { orders: { nodes: [] } } })) }, "cancel", "#1", "jordan@example.com")).toMatchObject({ allowed: false, notFound: true });
    expect(await checkOrderChange({ graphql: async () => { throw new Error("offline"); } }, "cancel", "#100472", "jordan@example.com")).toBeUndefined();
  });
});
