// Recent orders for the signed-in storefront customer, for the Help Desk order
// picker. The customer ID comes from the signed app proxy request
// (logged_in_customer_id), so a shopper only ever sees their own orders.
// Uses the orders search (customer_id filter), which needs only the read_orders
// scope, not read_customers; without it (or on any error) the form falls back
// to the orders the theme can see, or a typed order number.
import type { PrismaClient } from "@prisma/client";
import { addressBlockers, addressChangeChecks, addressCheckOrder, cancelChecks, CUSTOMER_BLOCKED, sameAddress, type ShippingAddress } from "./help-desk";
import { updateTickets } from "./help-desk.server";
import { queueEmail } from "./help-desk-outbox.server";

type AdminClient = { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };
export type CustomerOrder = {
  name: string; date: string; fulfillment: "fulfilled" | "partial" | null; cancelled: boolean;
  items: { id: string; title: string; variant: string; quantity: number; image: string }[];
};

const ORDERS_QUERY = `#graphql
  query HelpDeskCustomerOrders($query: String!) {
    orders(first: 20, sortKey: CREATED_AT, reverse: true, query: $query) {
      nodes {
        name createdAt displayFulfillmentStatus cancelledAt
        lineItems(first: 30) {
          nodes { title variantTitle quantity product { id title } image { url(transform: { maxWidth: 120 }) } }
        }
      }
    }
  }
`;

type OrderNode = {
  name: string; createdAt: string; displayFulfillmentStatus: string; cancelledAt: string | null;
  lineItems: { nodes: { title: string; variantTitle: string | null; quantity: number; product: { id: string; title: string } | null; image: { url: string } | null }[] };
};

export async function customerOrders(admin: AdminClient | undefined, customerId: string | null): Promise<CustomerOrder[] | null> {
  if (!admin || !customerId || !/^\d+$/.test(customerId)) return null;
  try {
    const json = await (await admin.graphql(ORDERS_QUERY, { variables: { query: `customer_id:${customerId}` } })).json();
    const nodes = json.data?.orders?.nodes as OrderNode[] | undefined;
    if (!Array.isArray(nodes)) return null;
    const date = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });
    return nodes.map(order => ({
      name: order.name,
      date: date.format(new Date(order.createdAt)),
      fulfillment: order.displayFulfillmentStatus === "FULFILLED" ? "fulfilled" : order.displayFulfillmentStatus === "PARTIALLY_FULFILLED" ? "partial" : null,
      cancelled: Boolean(order.cancelledAt),
      items: order.lineItems.nodes.map(item => ({
        id: item.product?.id || "",
        title: item.product?.title || item.title,
        variant: item.variantTitle && item.variantTitle !== "Default Title" ? item.variantTitle : "",
        quantity: item.quantity,
        image: item.image?.url || "",
      })),
    }));
  } catch (error) {
    console.error("Help Desk could not load customer orders:", error);
    return null;
  }
}

// ---------- A ticket's order and its tracking ----------

// One shipment (a Shopify fulfillment): the carrier's latest status and tracking.
export type Shipment = {
  status: string; label: string; tone: "success" | "info" | "warning" | "critical" | "neutral";
  carrier: string; number: string; url: string; shippedAt: string | null; deliveredAt: string | null; estimatedAt: string | null;
};
export type OrderDetails = {
  id: string; name: string; email: string; createdAt: string; cancelled: boolean;
  // fulfillmentStatus: Shopify's OrderDisplayFulfillmentStatus, e.g. UNFULFILLED or ON_HOLD.
  payment: string; fulfillment: string; fulfillmentStatus: string; fulfilled: "none" | "partial" | "full";
  total: string; amount: number; currency: string; city: string; province: string; country: string;
  // The full shipping address (null: pickup, digital, or none given) and whether anything ships.
  shippingAddress: ShippingAddress | null; requiresShipping: boolean;
  // The shipping rate chosen at checkout, e.g. "Standard".
  shippingMethod: string;
  // productId: the Shopify product (a gid), when the item is still a product.
  items: { productId: string; title: string; variant: string; sku: string; quantity: number; image: string }[];
  shipments: Shipment[];
};

const ORDER_FIELDS = `
  id legacyResourceId name email createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus requiresShipping
  totalPriceSet { shopMoney { amount currencyCode } }
  shippingAddress { name address1 address2 city provinceCode zip countryCodeV2 phone }
  shippingLine { title }
  lineItems(first: 30) { nodes { title variantTitle sku quantity product { id } image { url(transform: { maxWidth: 120 }) } } }
  fulfillments(first: 10) {
    createdAt status displayStatus deliveredAt estimatedDeliveryAt inTransitAt
    trackingInfo(first: 5) { company number url }
  }
`;
const ORDER_QUERY = `#graphql
  query HelpDeskOrder($query: String!) {
    orders(first: 1, sortKey: CREATED_AT, reverse: true, query: $query) { nodes { ${ORDER_FIELDS} } }
  }
`;
// By the ID saved on the ticket: exact and immediate. Shopify's order search
// can take a while to include a new order, which is when customers cancel.
const ORDER_BY_ID_QUERY = `#graphql
  query HelpDeskOrderById($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }
`;

type OrderNodeFull = {
  legacyResourceId: string; name: string; email: string | null; createdAt: string; cancelledAt: string | null;
  displayFinancialStatus: string | null; displayFulfillmentStatus: string; requiresShipping?: boolean;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  shippingAddress: {
    name?: string | null; address1?: string | null; address2?: string | null; city: string | null; provinceCode: string | null; zip?: string | null; countryCodeV2: string | null; phone?: string | null;
  } | null;
  shippingLine?: { title: string | null } | null;
  lineItems: { nodes: { title: string; variantTitle: string | null; sku: string | null; quantity: number; product?: { id: string } | null; image: { url: string } | null }[] };
  fulfillments: {
    createdAt: string; status: string; displayStatus: string | null; deliveredAt: string | null; estimatedDeliveryAt: string | null; inTransitAt: string | null;
    trackingInfo: { company: string | null; number: string | null; url: string | null }[];
  }[];
};

// What each carrier status means to the team and to the customer.
const SHIPMENT_STATUS: Record<string, [string, Shipment["tone"]]> = {
  DELIVERED: ["Delivered", "success"], PICKED_UP: ["Picked up", "success"], OUT_FOR_DELIVERY: ["Out for delivery", "info"],
  IN_TRANSIT: ["In transit", "info"], CONFIRMED: ["Shipped", "info"], FULFILLED: ["Shipped", "info"], MARKED_AS_FULFILLED: ["Shipped", "info"],
  READY_FOR_PICKUP: ["Ready for pickup", "info"], LABEL_PRINTED: ["Label created", "neutral"], LABEL_PURCHASED: ["Label created", "neutral"],
  SUBMITTED: ["Processing", "neutral"], LABEL_VOIDED: ["Label voided", "neutral"], ATTEMPTED_DELIVERY: ["Delivery attempted", "warning"],
  NOT_DELIVERED: ["Not delivered", "critical"], FAILURE: ["Delivery problem", "critical"], CANCELED: ["Cancelled", "critical"],
};

// The order number a customer typed ("#100472", "100472", "order#100472 and #94082"), as an orders search.
export function orderSearch(orderNumber: string | undefined) {
  const digits = (orderNumber || "").match(/\d{3,12}/)?.[0];
  return digits ? `name:#${digits}` : null;
}

export function shapeOrder(node: OrderNodeFull): OrderDetails {
  const money = node.totalPriceSet.shopMoney;
  const amount = Number(money.amount);
  return {
    id: node.legacyResourceId, name: node.name, email: node.email || "", createdAt: node.createdAt, cancelled: Boolean(node.cancelledAt),
    payment: readable(node.displayFinancialStatus), fulfillment: readable(node.displayFulfillmentStatus), fulfillmentStatus: node.displayFulfillmentStatus,
    fulfilled: node.displayFulfillmentStatus === "FULFILLED" ? "full" : node.displayFulfillmentStatus === "PARTIALLY_FULFILLED" ? "partial" : "none",
    total: new Intl.NumberFormat("en", { style: "currency", currency: money.currencyCode }).format(amount), amount, currency: money.currencyCode,
    city: node.shippingAddress?.city || "", province: node.shippingAddress?.provinceCode || "", country: node.shippingAddress?.countryCodeV2 || "",
    shippingAddress: node.shippingAddress ? {
      name: node.shippingAddress.name || "", address1: node.shippingAddress.address1 || "", address2: node.shippingAddress.address2 || "", city: node.shippingAddress.city || "",
      province: node.shippingAddress.provinceCode || "", zip: node.shippingAddress.zip || "", country: node.shippingAddress.countryCodeV2 || "", phone: node.shippingAddress.phone || "",
    } : null,
    requiresShipping: node.requiresShipping !== false, shippingMethod: node.shippingLine?.title || "",
    items: node.lineItems.nodes.map((item) => ({
      productId: item.product?.id ?? "", title: item.title, variant: item.variantTitle && item.variantTitle !== "Default Title" ? item.variantTitle : "",
      sku: item.sku || "", quantity: item.quantity, image: item.image?.url || "",
    })),
    // Newest shipment first, the one customers usually ask about.
    shipments: [...node.fulfillments].filter((fulfillment) => fulfillment.status !== "CANCELLED")
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((fulfillment) => {
        const [label, tone] = SHIPMENT_STATUS[fulfillment.displayStatus || ""] ?? [readable(fulfillment.displayStatus) || "Shipped", "neutral" as const];
        const tracking = fulfillment.trackingInfo.find((info) => info.number) ?? fulfillment.trackingInfo[0];
        return {
          status: fulfillment.displayStatus || "", label, tone, carrier: tracking?.company || "", number: tracking?.number || "", url: tracking?.url || "",
          shippedAt: fulfillment.createdAt, deliveredAt: fulfillment.deliveredAt, estimatedAt: fulfillment.estimatedDeliveryAt,
        };
      }),
  };
}

// The order a ticket is about: by its saved ID when the ticket has one, else
// by the number the customer typed. null: no such order (or none given);
// undefined: Shopify couldn't be asked (an error), so a saved snapshot should be kept.
export async function findOrder(admin: AdminClient | undefined, orderNumber: string | undefined, orderId = ""): Promise<OrderDetails | null | undefined> {
  const query = orderSearch(orderNumber);
  if (!query && !/^\d+$/.test(orderId)) return null;
  if (!admin) return undefined;
  try {
    if (/^\d+$/.test(orderId)) {
      const json = await (await admin.graphql(ORDER_BY_ID_QUERY, { variables: { id: `gid://shopify/Order/${orderId}` } })).json();
      if (!json.data) { logOrderError(json.errors); return undefined; }
      if (json.data.order) return shapeOrder(json.data.order as OrderNodeFull);
      if (!query) return null;
    }
    const json = await (await admin.graphql(ORDER_QUERY, { variables: { query } })).json();
    const node = json.data?.orders?.nodes?.[0] as OrderNodeFull | undefined;
    if (!json.data?.orders) { logOrderError(json.errors); return undefined; }
    return node ? shapeOrder(node) : null;
  } catch (error) {
    logOrderError(error);
    return undefined;
  }
}

// findOrder for a decision staff are about to make. A just-placed order may not
// be in Shopify's search yet (when the ticket has no saved ID), so it's asked
// again after each delay before giving up.
export async function findOrderPatiently(admin: AdminClient, orderNumber: string | undefined, orderId: string, delays: number[]) {
  let order = await findOrder(admin, orderNumber, orderId);
  for (const delay of order === null && !orderId ? delays : []) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    order = await findOrder(admin, orderNumber);
    if (order !== null) break;
  }
  return order;
}

// Shopify's errors, with what to do about the usual one: orders are protected
// customer data, which the app must be granted, even on a development store.
function logOrderError(error: unknown) {
  const body = (error as { body?: { errors?: unknown } } | undefined)?.body?.errors ?? error;
  const text = typeof body === "string" ? body : JSON.stringify(body) ?? String(error);
  console.error("Help Desk could not load an order from Shopify:", error instanceof Error && error.message !== text ? `${error.message} ${text}` : text);
  if (/not approved|protected customer data|access denied|ACCESS_DENIED/i.test(`${text} ${error instanceof Error ? error.message : ""}`)) {
    console.error("Help Desk: grant the app protected customer data access (Partner Dashboard › Apps › this app › API access › Protected customer data: Order and Email), then reinstall or reload the app.");
  }
}

// What's saved on the ticket, so the inbox, reports and the customer's page
// have the order without asking Shopify each time. orderVerified: the order was
// placed with the ticket's email, so its tracking can be shown to the customer.
export function orderSnapshot(order: OrderDetails | null, ticketEmail: string) {
  const shipment = order?.shipments.find((entry) => entry.number) ?? order?.shipments[0];
  return {
    orderId: order?.id ?? "", orderName: order?.name ?? "", orderValue: order ? order.amount : null, orderCurrency: order?.currency ?? "",
    orderCountry: order?.country ?? "", carrier: shipment?.carrier ?? "", trackingNumber: shipment?.number ?? "", trackingUrl: shipment?.url ?? "",
    shipmentStatus: order ? shipment?.label ?? (order.cancelled ? "Cancelled" : "Order Not Shipped Yet") : "",
    orderSkus: [...new Set(order?.items.map((item) => item.sku).filter(Boolean) ?? [])].join(", "),
    orderVerified: Boolean(order?.email) && order!.email.trim().toLowerCase() === ticketEmail.trim().toLowerCase(),
    orderSyncedAt: new Date(),
  };
}

// ---------- Self-service tracking on the storefront form ----------

// What the customer sees when they check their order without opening a ticket.
// Only the status and tracking: no address, items or prices. status is the
// carrier's raw status (e.g. OUT_FOR_DELIVERY), which places the progress bar.
export type PublicTracking = {
  order: string; placedAt: string; cancelled: boolean; shipped: boolean; onHold: boolean;
  shipments: { status: string; label: string; carrier: string; number: string; url: string; shippedAt: string | null; deliveredAt: string | null; estimatedAt: string | null }[];
};

// The order's tracking, if the order exists and was placed with this email.
// null: no such order for that email (deliberately the same answer either way).
export async function lookupTracking(admin: AdminClient | undefined, orderNumber: string, email: string): Promise<PublicTracking | null | undefined> {
  const order = await findOrder(admin, orderNumber);
  if (order === undefined) return undefined;
  if (!order || !email.trim() || order.email.trim().toLowerCase() !== email.trim().toLowerCase()) return null;
  return {
    order: order.name, placedAt: order.createdAt, cancelled: order.cancelled, shipped: order.shipments.length > 0, onHold: order.fulfillmentStatus === "ON_HOLD",
    shipments: order.shipments.map(({ status, label, carrier, number, url, shippedAt, deliveredAt, estimatedAt }) => ({
      status, label, carrier, number, url: /^https:\/\//i.test(url) ? url : "", shippedAt, deliveredAt, estimatedAt,
    })),
  };
}

// ---------- Can the customer still cancel or re-address their order? ----------

// Checked on the storefront before the request's fields open, and again when
// the request is sent. Like tracking, it only answers about an order placed
// with the given email, so order numbers can't be probed for other people's orders.
// allowed: true, or false with what to tell the customer; undefined: Shopify couldn't be asked.
export type OrderChangeAnswer = { allowed: true; country: string; orderId: string; orderName: string } | { allowed: false; error: string; notFound?: boolean };
export async function checkOrderChange(
  admin: AdminClient | undefined, kind: "cancel" | "address", orderNumber: string, email: string, newAddress?: ShippingAddress,
): Promise<OrderChangeAnswer | undefined> {
  const order = await findOrder(admin, orderNumber);
  if (order === undefined) return undefined;
  if (!order || !email.trim() || order.email.trim().toLowerCase() !== email.trim().toLowerCase()) {
    return { allowed: false, notFound: true, error: "We couldn't find an order with that number and email. Please check both. If you placed the order in the last few minutes, wait a moment and try again." };
  }
  const view = addressCheckOrder(order, email);
  const checks = kind === "cancel" ? cancelChecks(view) : addressChangeChecks(view, newAddress?.country ?? "");
  const blocked = addressBlockers(checks)[0];
  if (blocked) return { allowed: false, error: CUSTOMER_BLOCKED[kind][blocked.id] ?? blocked.detail };
  if (newAddress && order.shippingAddress && sameAddress(newAddress, order.shippingAddress)) {
    return { allowed: false, error: "Your order is already going to this address, so there's nothing to change." };
  }
  return { allowed: true, country: order.country, orderId: order.id, orderName: order.name };
}

// Another open request that makes this one pointless: the same change already
// asked for, or (for an address) a cancellation in progress. Returns what to
// tell the customer, or "".
export async function conflictingRequest(db: PrismaClient, shop: string, kind: "cancel" | "address", order: { orderId: string; orderName: string }) {
  const sameOrder = { shop, OR: [{ orderId: order.orderId }, { orderName: order.orderName }] };
  const cancel = await db.helpDeskTicket.findFirst({ where: { ...sameOrder, cancelStatus: { in: ["Pending", "Approved"] } }, select: { number: true } });
  if (cancel) {
    return kind === "cancel"
      ? `You've already asked to cancel this order (request #${cancel.number}). We'll update you there.`
      : `You've asked to cancel this order (request #${cancel.number}), so its address can't be changed while that's open.`;
  }
  if (kind === "address") {
    const address = await db.helpDeskTicket.findFirst({ where: { ...sameOrder, addressStatus: "Pending" }, select: { number: true } });
    if (address) return `You've already asked to change this order's address (request #${address.number}). We'll update you there. To give a different address, reply on that request.`;
  }
  return "";
}

// ---------- Product issues: which item in the order has the problem ----------

// The order's items, for the customer to pick the one with the problem. Like
// tracking, only for an order placed with the given email. null: no such order
// for that email; undefined: Shopify couldn't be asked.
// partial: only part of the order has shipped, so a "missing" item may still be on its way.
export type IssueItems = { order: string; deliveredAt: string | null; partial: boolean; items: { id: string; title: string; variant: string; quantity: number; image: string }[] };
export async function issueItems(admin: AdminClient | undefined, orderNumber: string, email: string): Promise<IssueItems | null | undefined> {
  const order = await findOrder(admin, orderNumber);
  if (order === undefined) return undefined;
  if (!order || !email.trim() || order.email.trim().toLowerCase() !== email.trim().toLowerCase()) return null;
  return {
    order: order.name,
    deliveredAt: order.shipments.map((shipment) => shipment.deliveredAt).filter(Boolean).sort().at(-1) ?? null,
    partial: order.fulfilled === "partial",
    items: order.items.filter((item) => item.productId).map(({ productId, title, variant, quantity, image }) => ({ id: productId, title, variant, quantity, image })),
  };
}

const VARIANTS_QUERY = `#graphql
  query HelpDeskVariants($id: ID!) {
    product(id: $id) {
      variants(first: 100) {
        nodes { title availableForSale selectedOptions { name value } }
      }
    }
  }`;

// A product's variants (colour, size...), for "Wrong colour or size": the
// customer picks the one they wanted, option by option (options: each
// variant's value for each option, like { Color: "Blue" }). A product with one
// variant has none to pick. undefined when Shopify couldn't be reached.
export type ProductVariant = { title: string; available: boolean; options: Record<string, string> };
export async function productVariants(admin: AdminClient | undefined, id: string): Promise<ProductVariant[] | undefined> {
  if (!/^gid:\/\/shopify\/Product\/\d+$/.test(id)) return [];
  if (!admin) return undefined;
  try {
    const json = await (await admin.graphql(VARIANTS_QUERY, { variables: { id } })).json();
    const nodes: { title: string; availableForSale: boolean; selectedOptions?: { name: string; value: string }[] }[] = json.data?.product?.variants?.nodes ?? [];
    return nodes.filter((node) => node.title && node.title !== "Default Title").map((node) => ({
      title: node.title, available: node.availableForSale,
      options: Object.fromEntries((node.selectedOptions ?? []).map((option) => [option.name, option.value])),
    }));
  } catch { return undefined; }
}

// Shopify's fulfillment statuses for an order that hasn't shipped yet.
const NOT_SHIPPED = ["UNFULFILLED", "IN_PROGRESS", "SCHEDULED", "PENDING_FULFILLMENT", "OPEN", "REQUEST_DECLINED"];
// Questions the order's own status answers better than the customer's guess.
const STATUS_QUESTIONS = ["Track My Order", "Shipment Delayed", "Order Not Shipped Yet"];

// The Shipping & Delivery issue Shopify's data supports (or Orders › Order on Hold). A customer asking
// "where is my order?" about an order Shopify shows as delivered has a
// "delivered, not received" problem; one that hasn't shipped is "not shipped
// yet". Anything else the customer chose stands.
export function subcategoryFromOrder(subcategory: string, order: OrderDetails) {
  if (!STATUS_QUESTIONS.includes(subcategory) || order.cancelled) return subcategory;
  if (order.fulfillmentStatus === "ON_HOLD") return "Order on Hold";
  const shipment = order.shipments[0];
  if (!shipment) return NOT_SHIPPED.includes(order.fulfillmentStatus) ? "Order Not Shipped Yet" : subcategory;
  if (shipment.status === "DELIVERED" || shipment.status === "PICKED_UP") return order.fulfilled === "partial" ? "Partial Delivery" : "Delivered but Not Received";
  if (["ATTEMPTED_DELIVERY", "NOT_DELIVERED", "FAILURE"].includes(shipment.status)) return "Delivery Attempted or Failed";
  return subcategory === "Order Not Shipped Yet" ? "Track My Order" : subcategory;
}

// Who changes a ticket's classification from its order, on the timeline.
export const SHOPIFY_AUTHOR = "Shopify";
const STAFF_CLASSIFIED = /^(Category|Sub-category) (set to|cleared)/;

// Finds a ticket's order in Shopify and saves its snapshot, and corrects an
// Shipping & Delivery issue to what the order's status shows (unless staff
// already classified the ticket). Returns the order (null when there's none),
// or undefined when Shopify couldn't be reached.
export async function syncTicketOrder(db: PrismaClient, admin: AdminClient | undefined, ticketId: string) {
  const ticket = await db.helpDeskTicket.findUnique({
    where: { id: ticketId },
    select: { shop: true, email: true, details: true, orderId: true, category: true, subcategory: true, cancelStatus: true, resolutionType: true, messages: { where: { kind: "event", author: { not: SHOPIFY_AUTHOR } }, select: { body: true } } },
  });
  if (!ticket) return null;
  let details: Record<string, string> = {};
  try { details = JSON.parse(ticket.details) as Record<string, string>; } catch { /* no details */ }
  const order = await findOrder(admin, details.orderNumber, ticket.orderId);
  if (order === undefined) return order;
  const staffClassified = ticket.messages.some((message) => STAFF_CLASSIFIED.test(message.body));
  const subcategory = order && ticket.category === "Shipping & Delivery" && !staffClassified ? subcategoryFromOrder(ticket.subcategory, order) : ticket.subcategory;
  await db.helpDeskTicket.update({
    where: { id: ticketId },
    data: {
      ...orderSnapshot(order, ticket.email),
      ...(subcategory !== ticket.subcategory ? {
        subcategory, messages: { create: { kind: "event", author: SHOPIFY_AUTHOR, body: `Sub-category set to ${subcategory}, from the order's status in Shopify` } },
      } : {}),
    },
  });
  // A cancellation request whose order was cancelled in Shopify (say, from the
  // Shopify admin) is done: mark it cancelled and let the customer know.
  if (order?.cancelled && ["Pending", "Approved"].includes(ticket.cancelStatus)) {
    const now = new Date();
    const { count } = await db.helpDeskTicket.updateMany({
      where: { id: ticketId, cancelStatus: { in: ["Pending", "Approved"] } },
      data: { cancelStatus: "Cancelled", cancelDecidedBy: SHOPIFY_AUTHOR, cancelDecidedAt: now, lastActivityAt: now },
    });
    if (count) {
      await db.helpDeskMessage.create({ data: { ticketId, kind: "event", author: SHOPIFY_AUTHOR, body: `Order ${order.name} was cancelled in Shopify` } });
      await updateTickets(db, ticket.shop, [ticketId], { status: "Resolved", ...(ticket.resolutionType ? {} : { resolutionType: "Order cancelled" }) }, SHOPIFY_AUTHOR);
      queueEmail(db, { shop: ticket.shop, ticketId, kind: "cancellation" }, admin);
    }
  }
  return order;
}

// Recent orders placed with a ticket's email, for the agent's sidebar.
export type AgentOrder = { id: string; name: string; date: string; total: string; payment: string; fulfillment: string; cancelled: boolean };

const EMAIL_ORDERS_QUERY = `#graphql
  query HelpDeskEmailOrders($query: String!) {
    orders(first: 5, sortKey: CREATED_AT, reverse: true, query: $query) {
      nodes {
        legacyResourceId name createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus
        totalPriceSet { shopMoney { amount currencyCode } }
      }
    }
  }
`;

const readable = (value: string | null) => (value || "").toLowerCase().replace(/_/g, " ").replace(/^./, char => char.toUpperCase());

export async function ordersByEmail(admin: AdminClient, email: string): Promise<AgentOrder[] | null> {
  if (!/^[^\s@"\\]+@[^\s@"\\]+$/.test(email)) return [];
  try {
    const json = await (await admin.graphql(EMAIL_ORDERS_QUERY, { variables: { query: `email:"${email}"` } })).json();
    const nodes = json.data?.orders?.nodes as {
      legacyResourceId: string; name: string; createdAt: string; cancelledAt: string | null; displayFinancialStatus: string | null;
      displayFulfillmentStatus: string; totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
    }[] | undefined;
    if (!Array.isArray(nodes)) return null;
    const date = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });
    return nodes.map(order => ({
      id: order.legacyResourceId,
      name: order.name,
      date: date.format(new Date(order.createdAt)),
      total: new Intl.NumberFormat("en", { style: "currency", currency: order.totalPriceSet.shopMoney.currencyCode }).format(Number(order.totalPriceSet.shopMoney.amount)),
      payment: readable(order.displayFinancialStatus),
      fulfillment: readable(order.displayFulfillmentStatus),
      cancelled: Boolean(order.cancelledAt),
    }));
  } catch (error) {
    console.error("Help Desk could not load orders for a ticket:", error);
    return null;
  }
}
