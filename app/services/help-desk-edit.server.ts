import type { PrismaClient } from "@prisma/client";
import { addressChangeChecks, addressCheckOrder, CUSTOMER_BLOCKED, MAX_MESSAGE_LENGTH, shipStationCheck, type AddressCheck, type EditStatus } from "./help-desk";
import { updateTickets } from "./help-desk.server";
import { findOrderPatiently, type OrderDetails } from "./help-desk-orders.server";
import { queueEmail } from "./help-desk-outbox.server";
import { shipStationAccount, shipStationStatus } from "./help-desk-shipstation.server";

// Order edit requests (Edit Existing Order on the form). The customer picks the
// items to remove or change and the products to add, and accepts that any
// price difference is confirmed first; the ticket starts Pending. An order can
// only change while it's still at the warehouse: not packed or shipped in
// Shopify, and without a label (or shipped status) in ShipStation. Staff set
// each line's new quantity (0 removes it) and add variants by SKU, preview the
// new total with Shopify's order editing, and update the order in Shopify
// (orderEditBegin, orderEditSetQuantity, orderEditAddVariant, orderEditCommit),
// or reject the request. Each decision is logged and emailed to the customer.
// Staff can also open an edit on any ticket with an order (startModification
// in help-desk.server.ts), and change its shipping: e.g. upgrade it to
// expedited shipping (orderEditRemoveShippingLine, orderEditAddShippingLine).

type AdminClient = { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };
export type EditResult = { errors: Record<string, string>; editStatus?: EditStatus };
// The changes staff apply: order lines' new quantities, and variants to add.
// shipping: a new shipping line (e.g. "Expedited shipping"), replacing the order's current ones or added to them.
export type EditShipping = { title: string; amount: number; replace: boolean };
export type EditOps = { lines: { lineItemId: string; quantity: number }[]; adds: { variantId: string; quantity: number }[]; shipping?: EditShipping | null };
type Money = { amount: string; currencyCode: string };
export type EditTotals = { before: Money | null; after: Money; outstanding: Money };
export type SkuVariant = { id: string; sku: string; title: string; product: string; price: string; available: number | null };

const NO_ACCESS = "The app isn't allowed to edit orders yet. Open the app again and approve the updated permissions (Edit orders).";
const DECIDED = "This request has already been decided. Reload the page to see where it stands.";

const BEGIN = `#graphql
  mutation HelpDeskEditBegin($id: ID!) {
    orderEditBegin(id: $id) {
      calculatedOrder {
        id
        lineItems(first: 100) { nodes { id quantity title variantTitle sku } }
        shippingLines { id title stagedStatus }
        originalOrder { presentmentCurrencyCode }
      }
      userErrors { field message }
    }
  }`;
const SET_QUANTITY = `#graphql
  mutation HelpDeskEditSetQuantity($id: ID!, $lineItemId: ID!, $quantity: Int!, $restock: Boolean) {
    orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: $quantity, restock: $restock) {
      calculatedOrder { id }
      userErrors { field message }
    }
  }`;
const ADD_VARIANT = `#graphql
  mutation HelpDeskEditAddVariant($id: ID!, $variantId: ID!, $quantity: Int!) {
    orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity, allowDuplicates: false) {
      calculatedOrder { id }
      userErrors { field message }
    }
  }`;
const ADD_SHIPPING = `#graphql
  mutation HelpDeskEditAddShipping($id: ID!, $shippingLine: OrderEditAddShippingLineInput!) {
    orderEditAddShippingLine(id: $id, shippingLine: $shippingLine) {
      calculatedOrder { id }
      userErrors { field message }
    }
  }`;
const REMOVE_SHIPPING = `#graphql
  mutation HelpDeskEditRemoveShipping($id: ID!, $shippingLineId: ID!) {
    orderEditRemoveShippingLine(id: $id, shippingLineId: $shippingLineId) {
      calculatedOrder { id }
      userErrors { field message }
    }
  }`;
const TOTALS = `#graphql
  query HelpDeskEditTotals($id: ID!) {
    node(id: $id) {
      ... on CalculatedOrder {
        id
        originalOrder { totalPriceSet { shopMoney { amount currencyCode } } }
        totalPriceSet { shopMoney { amount currencyCode } }
        totalOutstandingSet { shopMoney { amount currencyCode } }
      }
    }
  }`;
const COMMIT = `#graphql
  mutation HelpDeskEditCommit($id: ID!, $notifyCustomer: Boolean, $staffNote: String) {
    orderEditCommit(id: $id, notifyCustomer: $notifyCustomer, staffNote: $staffNote) {
      order { id }
      userErrors { field message }
    }
  }`;
const BY_SKU = `#graphql
  query HelpDeskVariantBySku($query: String!) {
    productVariants(first: 10, query: $query) {
      nodes { id sku title displayName price inventoryQuantity product { title } }
    }
  }`;

class EditError extends Error {}

async function run<T>(admin: AdminClient, query: string, variables: Record<string, unknown>, key: string): Promise<T> {
  let json: { data?: Record<string, unknown>; errors?: unknown };
  try {
    json = await (await admin.graphql(query, { variables })).json();
  } catch (error) {
    const text = `${error instanceof Error ? error.message : ""} ${JSON.stringify((error as { body?: unknown })?.body ?? "")}`;
    console.error("Help Desk order edit failed:", text);
    throw new EditError(/access|denied|scope|order_edits/i.test(text) ? NO_ACCESS : "Shopify couldn't edit the order. Please try again.");
  }
  const result = json.data?.[key] as (T & { userErrors?: { message: string }[] }) | undefined;
  if (!result) {
    console.error("Help Desk order edit failed:", JSON.stringify(json.errors ?? json));
    throw new EditError(/access|denied|scope|order_edits/i.test(JSON.stringify(json.errors ?? "")) ? NO_ACCESS : "Shopify couldn't edit the order. Please try again.");
  }
  if (result.userErrors?.length) throw new EditError(`Shopify didn't accept this change: ${result.userErrors.map((error) => error.message).join(" ")}`);
  return result;
}

// Is the order still at the warehouse? Shopify's view (not cancelled, nothing
// packed or shipped), then ShipStation (no label bought, not shipped there).
export async function warehouseChecks(db: PrismaClient, shop: string, order: OrderDetails | null, email: string): Promise<AddressCheck[]> {
  if (!order) return [{ id: "found", label: "Order found in Shopify", ok: false, detail: "Check the order number with the customer." }];
  const shopify = addressChangeChecks(addressCheckOrder(order, email), order.country).filter((check) => ["cancelled", "shipped", "verified"].includes(check.id));
  const account = shipStationAccount(await db.helpDeskSettings.findUnique({ where: { shop } }));
  const label = shipStationCheck(account ? await shipStationStatus(account, order) : { state: "off" });
  return [...shopify, ...(label ? [{ ...label, label: "No shipping label in ShipStation (still at the warehouse)" }] : [])];
}

// For the customer: why the order can no longer be edited because of
// ShipStation, or "" (also when ShipStation isn't connected or can't be asked:
// the team checks it before updating the order).
export async function shipStationBlocksEdit(db: PrismaClient, shop: string, order: { id: string; name: string }) {
  const account = shipStationAccount(await db.helpDeskSettings.findUnique({ where: { shop } }));
  if (!account) return "";
  const status = await shipStationStatus(account, order);
  if (status.state !== "found") return "";
  return status.labels.length || status.orderStatuses.includes("shipped") ? CUSTOMER_BLOCKED.edit.shipped : "";
}

// Variants matching a SKU (or a product name), for staff adding a product.
export async function variantsBySku(admin: AdminClient, sku: string): Promise<SkuVariant[] | { error: string }> {
  const term = sku.trim().slice(0, 100);
  if (term.length < 2) return { error: "Type at least 2 characters of the SKU." };
  const safe = term.replace(/["\\]/g, "");
  try {
    const result = await run<{ nodes: { id: string; sku: string | null; title: string; displayName: string; price: string; inventoryQuantity: number | null; product: { title: string } }[] }>(
      admin, BY_SKU, { query: `sku:"${safe}" OR title:*${safe}*` }, "productVariants");
    return result.nodes.map((node) => ({ id: node.id, sku: node.sku || "", title: node.displayName || node.title, product: node.product.title, price: node.price, available: node.inventoryQuantity }));
  } catch (error) {
    return { error: error instanceof EditError ? error.message : "Shopify couldn't be searched. Please try again." };
  }
}

const lineNumber = (id: string) => id.split("/").pop() || "";

// Starts an edit and stages the changes; returns the calculated order's id.
async function stage(admin: AdminClient, orderId: string, ops: EditOps) {
  const begun = await run<{ calculatedOrder: {
    id: string; lineItems: { nodes: { id: string; quantity: number }[] };
    shippingLines?: { id: string; stagedStatus: string }[]; originalOrder?: { presentmentCurrencyCode: string } | null;
  } }>(
    admin, BEGIN, { id: `gid://shopify/Order/${orderId}` }, "orderEditBegin");
  const calculated = begun.calculatedOrder;
  for (const line of ops.lines) {
    const target = calculated.lineItems.nodes.find((node) => lineNumber(node.id) === lineNumber(line.lineItemId));
    if (!target) throw new EditError("An item isn't on the order any more. Reload the page.");
    if (target.quantity === line.quantity) continue;
    await run(admin, SET_QUANTITY, { id: calculated.id, lineItemId: target.id, quantity: line.quantity, restock: true }, "orderEditSetQuantity");
  }
  for (const add of ops.adds) await run(admin, ADD_VARIANT, { id: calculated.id, variantId: add.variantId, quantity: add.quantity }, "orderEditAddVariant");
  if (ops.shipping) {
    if (ops.shipping.replace) {
      for (const line of calculated.shippingLines ?? []) {
        if (line.stagedStatus !== "REMOVED") await run(admin, REMOVE_SHIPPING, { id: calculated.id, shippingLineId: line.id }, "orderEditRemoveShippingLine");
      }
    }
    const currencyCode = calculated.originalOrder?.presentmentCurrencyCode;
    if (!currencyCode) throw new EditError("Shopify didn't say the order's currency. Reload the page and try again.");
    await run(admin, ADD_SHIPPING, { id: calculated.id, shippingLine: { title: ops.shipping.title, price: { amount: ops.shipping.amount.toFixed(2), currencyCode } } }, "orderEditAddShippingLine");
  }
  return calculated.id;
}

export function cleanOps(raw: unknown): EditOps | null {
  const value = raw as Partial<EditOps> | null;
  if (!value || !Array.isArray(value.lines) || !Array.isArray(value.adds)) return null;
  const lines = value.lines.filter((line) => /^gid:\/\/shopify\/LineItem\/\d+$/.test(String(line?.lineItemId)))
    .map((line) => ({ lineItemId: String(line.lineItemId), quantity: Math.min(Math.max(Math.trunc(Number(line.quantity)) || 0, 0), 999) })).slice(0, 100);
  const adds = value.adds.filter((add) => /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(String(add?.variantId)))
    .map((add) => ({ variantId: String(add.variantId), quantity: Math.min(Math.max(Math.trunc(Number(add.quantity)) || 1, 1), 99) })).slice(0, 20);
  const asked = value.shipping as Partial<EditShipping> | null | undefined;
  const title = String(asked?.title ?? "").trim().slice(0, 100);
  // A blank price isn't free shipping.
  const amount = String(asked?.amount ?? "").trim() ? Math.round(Number(asked?.amount) * 100) / 100 : NaN;
  const shipping = asked && title && Number.isFinite(amount) && amount >= 0 && amount <= 10000
    ? { title, amount, replace: asked.replace !== false } : null;
  return { lines, adds, shipping };
}

const hasChanges = (ops: EditOps) => ops.lines.length > 0 || ops.adds.length > 0 || Boolean(ops.shipping);

async function ticketOrder(db: PrismaClient, admin: AdminClient, shop: string, id: string) {
  const ticket = await db.helpDeskTicket.findFirst({ where: { id, shop }, select: { email: true, details: true, orderId: true, editStatus: true, resolutionType: true } });
  if (!ticket) return { error: "This ticket no longer exists." };
  if (ticket.editStatus !== "Pending") return { error: ticket.editStatus ? DECIDED : "This ticket isn't an order edit request." };
  let details: Record<string, string> = {};
  try { details = JSON.parse(ticket.details) as Record<string, string>; } catch { /* no details */ }
  const order = await findOrderPatiently(admin, details.orderNumber, ticket.orderId, []);
  if (order === undefined) return { error: "Shopify couldn't be reached. Please try again." };
  return { ticket, order };
}

// The order's total before and after the changes, without saving them: the
// edit is begun and left uncommitted, so the order doesn't change.
export async function previewOrderEdit(db: PrismaClient, admin: AdminClient, shop: string, id: string, ops: EditOps): Promise<{ errors: Record<string, string>; totals?: EditTotals }> {
  if (!hasChanges(ops)) return { errors: { form: "Change a quantity, add a product or change the shipping first." } };
  const found = await ticketOrder(db, admin, shop, id);
  if ("error" in found) return { errors: { form: found.error! } };
  if (!found.order) return { errors: { form: "The order wasn't found in Shopify." } };
  try {
    const calculated = await stage(admin, found.order.id, ops);
    const { node } = await (await admin.graphql(TOTALS, { variables: { id: calculated } })).json().then((json: { data: { node: {
      originalOrder: { totalPriceSet: { shopMoney: Money } } | null; totalPriceSet: { shopMoney: Money }; totalOutstandingSet: { shopMoney: Money };
    } } }) => json.data);
    return { errors: {}, totals: { before: node.originalOrder?.totalPriceSet.shopMoney ?? null, after: node.totalPriceSet.shopMoney, outstanding: node.totalOutstandingSet.shopMoney } };
  } catch (error) {
    return { errors: { form: error instanceof EditError ? error.message : "Shopify couldn't work out the new total. Please try again." } };
  }
}

async function decide(db: PrismaClient, shop: string, id: string, next: EditStatus, input: { note: string; author: string; event: string; resolutionType: string; current: string }, admin?: AdminClient): Promise<EditResult> {
  const now = new Date();
  const { count } = await db.helpDeskTicket.updateMany({
    where: { id, shop, editStatus: "Pending" },
    data: { editStatus: next, editNote: input.note, editDecidedBy: input.author, editDecidedAt: now, lastActivityAt: now },
  });
  if (!count) return { errors: { form: DECIDED } };
  await db.helpDeskMessage.create({ data: { ticketId: id, kind: "event", author: input.author, body: input.event } });
  await updateTickets(db, shop, [id], { status: "Resolved", ...(input.current ? {} : { resolutionType: input.resolutionType }) }, input.author);
  queueEmail(db, { shop, ticketId: id, kind: "edit" }, admin);
  return { errors: {}, editStatus: next };
}

// Updates the order in Shopify, once it's still at the warehouse.
export async function applyOrderEdit(
  db: PrismaClient, admin: AdminClient, shop: string, id: string,
  input: { ops: EditOps; note: string; author: string; notifyCustomer: boolean; summary: string },
): Promise<EditResult> {
  const note = input.note.trim();
  if (note.length > MAX_MESSAGE_LENGTH) return { errors: { note: `Use no more than ${MAX_MESSAGE_LENGTH.toLocaleString("en")} characters.` } };
  if (!hasChanges(input.ops)) return { errors: { form: "Change a quantity, add a product or change the shipping first." } };
  const found = await ticketOrder(db, admin, shop, id);
  if ("error" in found) return { errors: { form: found.error! } };
  const blocked = (await warehouseChecks(db, shop, found.order, found.ticket.email)).find((check) => !check.ok && !check.warning && check.id !== "verified");
  if (blocked) return { errors: { form: `${blocked.label}: no. ${blocked.detail}` } };
  const author = input.author.trim().slice(0, 80) || "Staff";
  try {
    const calculated = await stage(admin, found.order!.id, input.ops);
    await run(admin, COMMIT, { id: calculated, notifyCustomer: input.notifyCustomer, staffNote: `Help Desk request, by ${author}` }, "orderEditCommit");
  } catch (error) {
    return { errors: { form: error instanceof EditError ? error.message : "Shopify couldn't update the order. Please try again." } };
  }
  return decide(db, shop, id, "Updated", {
    note, author, resolutionType: "Order updated", current: found.ticket.resolutionType,
    event: `Order ${found.order!.name} updated in Shopify: ${input.summary.slice(0, 1000) || "items changed"}`,
  }, admin);
}

// Rejects the request; the customer is told why.
export async function rejectOrderEdit(db: PrismaClient, shop: string, id: string, input: { note: string; author: string }, admin?: AdminClient): Promise<EditResult> {
  const note = input.note.trim();
  if (!note) return { errors: { note: "Tell the customer why the order can't be changed." } };
  if (note.length > MAX_MESSAGE_LENGTH) return { errors: { note: `Use no more than ${MAX_MESSAGE_LENGTH.toLocaleString("en")} characters.` } };
  const ticket = await db.helpDeskTicket.findFirst({ where: { id, shop }, select: { resolutionType: true } });
  if (!ticket) return { errors: { form: "This ticket no longer exists." } };
  return decide(db, shop, id, "Rejected", { note, author: input.author.trim().slice(0, 80) || "Staff", event: "Order edit request rejected", resolutionType: "Request declined", current: ticket.resolutionType }, admin);
}
