import type { PrismaClient } from "@prisma/client";
import { cancelReview, cancelScopes, MAX_MESSAGE_LENGTH, shipStationCheck, type CancelStatus } from "./help-desk";
import { updateTickets } from "./help-desk.server";
import { findOrder, findOrderPatiently } from "./help-desk-orders.server";
import { queueEmail } from "./help-desk-outbox.server";
import { cancelShipStationOrders, shipStationAccount, shipStationStatus } from "./help-desk-shipstation.server";

// Order cancellation requests. The customer only asks, from the storefront
// form, to cancel their order or some of its items (the ticket starts
// Pending); nothing changes in Shopify until the team decides. They reject it,
// approve it (still nothing changes in Shopify), and cancel it in Shopify:
// the whole order with Shopify's orderCancel, only while it hasn't shipped,
// has no open return and ShipStation has no label for it (the ShipStation
// order is then cancelled too, so the warehouse doesn't send it); selected
// items (or what's left of a partly shipped order) by removing them with Edit
// order in Shopify, which the Help Desk then confirms. A request is only marked
// Cancelled once Shopify shows it done. An order cancelled from the Shopify
// admin closes its request too (orders/cancelled webhook and order sync).
// Every decision is logged on the ticket, shown on the customer's request
// page and emailed to them.

type AdminClient = { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };
// warning: the order is cancelled in Shopify, but staff still have something to do.
export type CancelResult = { errors: Record<string, string>; cancelStatus?: CancelStatus; warning?: string };

// Which statuses each step can be taken from. Approving is a decision only: the
// order is unchanged. A request is only marked cancelled once Shopify shows it
// (never by hand), so the customer is never told it's cancelled while it's
// still going out.
// shopify: the order is now cancelled in Shopify (also fixing a request only
// marked cancelled here in the past); shopify-started: Shopify accepted the
// cancellation but hasn't finished it; items: the items asked about are no
// longer on the order in Shopify.
type Step = "approve" | "reject" | "shopify" | "shopify-started" | "items";
const FROM: Record<Step, CancelStatus[]> = {
  approve: ["Pending", "Rejected"],
  reject: ["Pending", "Approved"],
  shopify: ["Pending", "Approved", "Rejected", "Cancelled"],
  "shopify-started": ["Pending", "Approved", "Rejected", "Cancelled"],
  items: ["Pending", "Approved"],
};
const TO: Record<Step, CancelStatus> = { approve: "Approved", reject: "Rejected", shopify: "Cancelled", "shopify-started": "Approved", items: "Cancelled" };

const CANCEL_MUTATION = `#graphql
  mutation HelpDeskCancelOrder($orderId: ID!, $reason: OrderCancelReason!, $refundMethod: OrderCancelRefundMethodInput, $restock: Boolean!, $notifyCustomer: Boolean, $staffNote: String) {
    orderCancel(orderId: $orderId, reason: $reason, refundMethod: $refundMethod, restock: $restock, notifyCustomer: $notifyCustomer, staffNote: $staffNote) {
      job { id done }
      orderCancelUserErrors { field message code }
    }
  }
`;

const NO_ACCESS = "The app isn't allowed to cancel orders yet. Open the app again and approve the updated permissions, or cancel the order in Shopify and choose \"Mark as cancelled\".";

// Moves a request to its next status, only if it's still where the decision
// expects it (so two agents can't decide at once), then logs it, updates the
// ticket and emails the customer.
async function applyDecision(
  db: PrismaClient, shop: string, id: string, decision: Step,
  input: { note: string; author: string; event: string }, admin?: AdminClient,
): Promise<CancelResult> {
  const next = TO[decision];
  const now = new Date();
  const { count } = await db.helpDeskTicket.updateMany({
    where: { id, shop, cancelStatus: { in: FROM[decision] } },
    data: { cancelStatus: next, cancelNote: input.note, cancelDecidedBy: input.author, cancelDecidedAt: now, lastActivityAt: now },
  });
  if (!count) return { errors: { form: "This request has already been decided. Reload the page to see where it stands." } };
  const ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id }, select: { status: true, resolutionType: true } });
  await db.helpDeskMessage.create({ data: { ticketId: id, kind: "event", author: input.author, body: input.event } });
  // Approved: being worked on. Rejected or cancelled: the request is done.
  const done = next !== "Approved";
  await updateTickets(db, shop, [id], {
    status: done ? "Resolved" : ["Open", "Resolved"].includes(ticket.status) ? "In progress" : ticket.status,
    ...(done && !ticket.resolutionType ? { resolutionType: next === "Rejected" ? "Request declined" : "Order cancelled" } : {}),
  }, input.author);
  queueEmail(db, { shop, ticketId: id, kind: "cancellation" }, admin);
  return { errors: {}, cancelStatus: next };
}

const cleanNote = (note: string) => note.trim();

// Rejects the request (the customer is told why), or approves it. Approving
// changes nothing in Shopify: the order is cancelled there next
// (cancelOrderInShopify, or Edit order and confirmItemsCancelled), and only
// then is the request marked Cancelled. Not for an order that has shipped or
// is already cancelled, when Shopify can be asked.
export async function decideCancellation(db: PrismaClient, shop: string, id: string, input: { decision: string; note: string; author: string }, admin?: AdminClient): Promise<CancelResult> {
  if (input.decision !== "reject" && input.decision !== "approve") return { errors: { form: "Approve or reject the request. It's marked cancelled once the order is cancelled in Shopify." } };
  const note = cleanNote(input.note);
  if (note.length > MAX_MESSAGE_LENGTH) return { errors: { note: `Use no more than ${MAX_MESSAGE_LENGTH.toLocaleString("en")} characters.` } };
  const author = input.author.trim().slice(0, 80) || "Staff";
  if (input.decision === "reject") {
    if (!note) return { errors: { note: "Tell the customer why the order can't be cancelled." } };
    return applyDecision(db, shop, id, "reject", { note, author, event: "Cancellation request rejected" }, admin);
  }
  const ticket = await db.helpDeskTicket.findFirst({ where: { id, shop }, select: { details: true, orderId: true, cancelStatus: true } });
  if (!ticket?.cancelStatus) return { errors: { form: "This ticket isn't a cancellation request." } };
  if (admin) {
    const order = await findOrder(admin, parseDetails(ticket.details).orderNumber, ticket.orderId);
    if (order?.cancelled) return { errors: { form: `Order ${order.name} is already cancelled in Shopify. Choose "Cancel in Shopify" to close the request.` } };
    if (order?.fulfilled === "full") return { errors: { form: `Order ${order.name} has already shipped, so it can't be cancelled. Reject the request and offer a return instead.` } };
  }
  return applyDecision(db, shop, id, "approve", { note, author, event: "Cancellation request approved. The order hasn't been changed in Shopify yet." }, admin);
}

const parseDetails = (details: string) => { try { return JSON.parse(details) as Record<string, string>; } catch { return {}; } };
const parseIds = (value: string) => { try { const ids = JSON.parse(value); return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []; } catch { return []; } };

// How the order is refunded when it's cancelled: to the original payment
// method, as store credit, or not at all (e.g. it was refunded already).
export const refundMethods = ["original", "store-credit", "none"] as const;
export type RefundMethod = typeof refundMethods[number];
const REFUND_INPUT: Record<RefundMethod, Record<string, unknown> | null> = {
  original: { originalPaymentMethodsRefund: true }, "store-credit": { storeCreditRefund: {} }, none: null,
};
const REFUND_LOG: Record<RefundMethod, string> = { original: "refunded to the original payment method", "store-credit": "refunded as store credit", none: "not refunded" };

// How long to wait for Shopify to finish cancelling (it runs as a background
// job) before showing the request as Approved; the orders/cancelled webhook
// and the next order sync then mark it Cancelled.
const CONFIRM_DELAYS_MS = [800, 1200, 2000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Approves the request by cancelling the ticket's order in Shopify (the whole
// order), refunding it to the original payment method and restocking it unless
// told otherwise. Also cancels an order that was only marked cancelled here.
export async function cancelOrderInShopify(
  db: PrismaClient, admin: AdminClient, shop: string, id: string,
  // refund: a RefundMethod (true: the original payment method; false: none).
  input: { note: string; author: string; refund: boolean | RefundMethod; restock: boolean; notifyCustomer: boolean },
  delays = CONFIRM_DELAYS_MS,
): Promise<CancelResult> {
  const refund: RefundMethod = input.refund === true ? "original" : input.refund === false ? "none" : refundMethods.includes(input.refund) ? input.refund : "original";
  const ticket = await db.helpDeskTicket.findFirst({ where: { id, shop }, select: { number: true, details: true, cancelStatus: true, orderId: true } });
  if (!ticket) return { errors: { form: "This ticket no longer exists." } };
  if (!ticket.cancelStatus) return { errors: { form: "This ticket isn't a cancellation request." } };
  const note = cleanNote(input.note);
  if (note.length > MAX_MESSAGE_LENGTH) return { errors: { note: `Use no more than ${MAX_MESSAGE_LENGTH.toLocaleString("en")} characters.` } };
  let details: Record<string, string> = {};
  try { details = JSON.parse(ticket.details) as Record<string, string>; } catch { /* no details */ }
  // The order as Shopify has it now, not the snapshot from when the ticket arrived.
  // A just-placed order may not be in Shopify's search yet, so give it a moment.
  const order = await findOrderPatiently(admin, details.orderNumber, ticket.orderId, delays);
  if (order === undefined) return { errors: { form: "Shopify couldn't be reached. Please try again." } };
  if (!order) {
    return { errors: { form: `Order ${details.orderNumber || "number"} wasn't found in Shopify. If it was placed in the last few minutes, Shopify may still be adding it: try again shortly. Otherwise check the number with the customer.` } };
  }
  const found = order;
  const author = input.author.trim().slice(0, 80) || "Staff";
  if (order.cancelled) {
    if (ticket.cancelStatus === "Cancelled") return { errors: { form: `Order ${order.name} is already cancelled in Shopify.` } };
    return applyDecision(db, shop, id, "shopify", { note, author, event: `Order ${order.name} was already cancelled in Shopify` }, admin);
  }
  if (details.cancelScope === cancelScopes[1]) {
    return { errors: { form: `The customer asked to cancel only some items. Remove them from order ${order.name} with Edit order in Shopify, then choose "Confirm items removed".` } };
  }
  // Shipped (all or part), or an open return: Shopify won't cancel the order.
  const blocked = cancelReview(order).find((check) => !check.ok && !check.warning);
  if (blocked) return { errors: { form: `Order ${order.name}: ${blocked.detail}` } };
  // The warehouse may have bought a label in ShipStation before Shopify shows
  // anything shipped: asked afresh, as one may have been bought since the page opened.
  const account = shipStationAccount(await db.helpDeskSettings.findUnique({ where: { shop } }));
  const shipStation = account ? await shipStationStatus(account, order) : null;
  const labelCheck = account ? shipStationCheck(shipStation, "cancel") : null;
  if (labelCheck && !labelCheck.ok && !labelCheck.warning) return { errors: { form: labelCheck.detail } };
  try {
    const response = await admin.graphql(CANCEL_MUTATION, {
      variables: {
        orderId: `gid://shopify/Order/${order.id}`, reason: "CUSTOMER", restock: input.restock, notifyCustomer: input.notifyCustomer,
        refundMethod: REFUND_INPUT[refund],
        staffNote: `Help Desk #${ticket.number}: ${details.cancelReason || "Customer asked to cancel"}`.slice(0, 255),
      },
    });
    const json = await response.json();
    const result = json.data?.orderCancel as { job: { id: string } | null; orderCancelUserErrors: { message: string }[] } | undefined;
    if (!result) {
      console.error("Help Desk could not cancel an order in Shopify:", JSON.stringify(json.errors ?? json));
      return { errors: { form: /access|denied|scope/i.test(JSON.stringify(json.errors ?? "")) ? NO_ACCESS : "Shopify couldn't cancel the order. Please try again." } };
    }
    if (result.orderCancelUserErrors.length) return { errors: { form: result.orderCancelUserErrors.map((error) => error.message).join(" ") } };
  } catch (error) {
    const text = `${error instanceof Error ? error.message : ""} ${JSON.stringify((error as { body?: unknown })?.body ?? "")}`;
    console.error("Help Desk could not cancel an order in Shopify:", text);
    return { errors: { form: /access|denied|scope|write_orders/i.test(text) ? NO_ACCESS : "Shopify couldn't cancel the order. Please try again." } };
  }
  const how = [REFUND_LOG[refund], input.restock ? "items restocked" : "items not restocked"].join(", ");
  // The ShipStation order is cancelled too, so it drops off the warehouse's list now.
  let warning = "";
  let shipStationNote = "";
  if (account && shipStation?.state === "found") {
    try {
      shipStationNote = await cancelShipStationOrders(account, order) ? "; ShipStation order cancelled" : "";
    } catch (error) {
      console.error("Help Desk could not cancel an order in ShipStation:", error instanceof Error ? error.message : error);
      warning = `Order ${order.name} is cancelled in Shopify, but ShipStation couldn't be updated. Cancel it in ShipStation by hand so it isn't shipped.`;
    }
  } else if (account && shipStation?.state === "error") {
    // (Not connected at all: the panel says so before cancelling; nothing failed here.)
    warning = `Order ${order.name} is cancelled in Shopify, but ShipStation couldn't be reached. Cancel it in ShipStation by hand so it isn't shipped.`;
  }
  // Shopify cancels in the background; usually it's done within a second or two.
  let result: CancelResult | null = null;
  for (const delay of delays) {
    await sleep(delay);
    if ((await findOrder(admin, details.orderNumber, found.id))?.cancelled) {
      result = await applyDecision(db, shop, id, "shopify", { note, author, event: `Approved: order ${order.name} cancelled in Shopify (${how}${shipStationNote})` }, admin);
      break;
    }
  }
  result ??= await applyDecision(db, shop, id, "shopify-started", { note, author, event: `Approved: Shopify is cancelling order ${order.name} (${how}${shipStationNote})` }, admin);
  if (warning && result.cancelStatus) {
    await db.helpDeskMessage.create({ data: { ticketId: id, kind: "note", author: "Help Desk", body: warning } });
    return { ...result, warning };
  }
  return result;
}

// Items can't be cancelled with orderCancel: staff remove them with Edit order
// in Shopify (which also works out the refund there). This confirms, from
// Shopify, that it's done: every item the customer picked (or, for a whole
// order that has partly shipped, everything not shipped) is off the order
// rather than shipped. Only then is the request marked Cancelled.
export async function confirmItemsCancelled(db: PrismaClient, admin: AdminClient, shop: string, id: string, input: { note: string; author: string }): Promise<CancelResult> {
  const ticket = await db.helpDeskTicket.findFirst({ where: { id, shop }, select: { details: true, cancelStatus: true, orderId: true, products: true } });
  if (!ticket) return { errors: { form: "This ticket no longer exists." } };
  if (!ticket.cancelStatus) return { errors: { form: "This ticket isn't a cancellation request." } };
  const note = cleanNote(input.note);
  if (note.length > MAX_MESSAGE_LENGTH) return { errors: { note: `Use no more than ${MAX_MESSAGE_LENGTH.toLocaleString("en")} characters.` } };
  const details = parseDetails(ticket.details);
  const order = await findOrder(admin, details.orderNumber, ticket.orderId);
  if (order === undefined) return { errors: { form: "Shopify couldn't be reached. Please try again." } };
  if (!order) return { errors: { form: `Order ${details.orderNumber || "number"} wasn't found in Shopify.` } };
  const author = input.author.trim().slice(0, 80) || "Staff";
  if (order.cancelled) {
    if (ticket.cancelStatus === "Cancelled") return { errors: { form: `Order ${order.name} is already cancelled in Shopify.` } };
    return applyDecision(db, shop, id, "shopify", { note, author, event: `Order ${order.name} was already cancelled in Shopify` }, admin);
  }
  const picked = details.cancelScope === cancelScopes[1] ? parseIds(ticket.products) : [];
  const targets = picked.length ? order.items.filter((item) => picked.includes(item.lineItemId)) : order.items;
  if (picked.length && targets.length < picked.length) return { errors: { form: `Some of the items asked about aren't on order ${order.name} any more. Check the order in Shopify.` } };
  const name = (item: (typeof targets)[number], count: number) => `${[item.title, item.variant].filter(Boolean).join(" - ")} × ${count}`;
  const waiting = targets.filter((item) => item.unfulfilled > 0);
  if (waiting.length) {
    return { errors: { form: `Shopify still has ${waiting.map((item) => name(item, item.unfulfilled)).join(", ")} to ship on order ${order.name}. Remove ${waiting.length === 1 && waiting[0].unfulfilled === 1 ? "it" : "them"} with Edit order in Shopify, then confirm again.` } };
  }
  // Nothing left to ship: each picked item must have been removed, not shipped.
  const removed = targets.filter((item) => item.current < item.quantity);
  const shipped = picked.length ? targets.filter((item) => item.current >= item.quantity) : removed.length ? [] : targets;
  if (shipped.length) {
    return { errors: { form: `${shipped.map((item) => name(item, item.quantity)).join(", ")} ${shipped.length === 1 ? "has" : "have"} shipped on order ${order.name}, so ${shipped.length === 1 ? "it wasn't" : "they weren't"} cancelled. Reject the request and offer a return instead.` } };
  }
  return applyDecision(db, shop, id, "items", { note, author, event: `Approved: ${removed.map((item) => name(item, item.quantity - item.current)).join(", ")} removed from order ${order.name} in Shopify` }, admin);
}
