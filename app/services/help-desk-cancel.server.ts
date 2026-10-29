import type { PrismaClient } from "@prisma/client";
import { MAX_MESSAGE_LENGTH, type CancelStatus } from "./help-desk";
import { updateTickets } from "./help-desk.server";
import { findOrder, findOrderPatiently } from "./help-desk-orders.server";
import { queueEmail } from "./help-desk-outbox.server";

// Order cancellation requests. The customer asks to cancel their whole order
// from the storefront form (the ticket starts Pending); the team rejects it, or
// approves it, which cancels the order in Shopify. An order cancelled from the
// Shopify admin closes its request too (orders/cancelled webhook and order
// sync). Every decision is logged on the ticket, shown on the customer's
// request page and emailed to them.

type AdminClient = { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };
export type CancelDecision = "approve" | "reject" | "mark-cancelled";
export type CancelResult = { errors: Record<string, string>; cancelStatus?: CancelStatus };

// Which statuses each decision can be made from. shopify: the order is now
// cancelled in Shopify (also fixing a request only marked cancelled here);
// shopify-started: Shopify accepted the cancellation but hasn't finished it.
type Step = CancelDecision | "shopify" | "shopify-started";
const FROM: Record<Step, CancelStatus[]> = {
  approve: ["Pending", "Rejected"],
  reject: ["Pending", "Approved"],
  "mark-cancelled": ["Pending", "Approved"],
  shopify: ["Pending", "Approved", "Rejected", "Cancelled"],
  "shopify-started": ["Pending", "Approved", "Rejected", "Cancelled"],
};
const TO: Record<Step, CancelStatus> = { approve: "Approved", reject: "Rejected", "mark-cancelled": "Cancelled", shopify: "Cancelled", "shopify-started": "Approved" };

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

// Approve, reject or mark as cancelled. A rejection needs a reason for the customer.
export async function decideCancellation(db: PrismaClient, shop: string, id: string, input: { decision: string; note: string; author: string }, admin?: AdminClient): Promise<CancelResult> {
  const decision = input.decision as CancelDecision;
  if (!["approve", "reject", "mark-cancelled"].includes(decision)) return { errors: { form: "Choose approve, reject or mark as cancelled." } };
  const note = cleanNote(input.note);
  if (note.length > MAX_MESSAGE_LENGTH) return { errors: { note: `Use no more than ${MAX_MESSAGE_LENGTH.toLocaleString("en")} characters.` } };
  if (decision === "reject" && !note) return { errors: { note: "Tell the customer why the order can't be cancelled." } };
  const author = input.author.trim().slice(0, 80) || "Staff";
  const event = decision === "approve" ? "Cancellation request approved" : decision === "reject" ? "Cancellation request rejected" : "Order marked as cancelled";
  return applyDecision(db, shop, id, decision, { note, author, event }, admin);
}

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
  input: { note: string; author: string; refund: boolean; restock: boolean; notifyCustomer: boolean },
  delays = CONFIRM_DELAYS_MS,
): Promise<CancelResult> {
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
  if (order.fulfilled !== "none") return { errors: { form: `Order ${order.name} has already shipped, so it can't be cancelled. Reject the request and offer a return instead.` } };
  try {
    const response = await admin.graphql(CANCEL_MUTATION, {
      variables: {
        orderId: `gid://shopify/Order/${order.id}`, reason: "CUSTOMER", restock: input.restock, notifyCustomer: input.notifyCustomer,
        refundMethod: input.refund ? { originalPaymentMethodsRefund: true } : null,
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
  const how = [input.refund ? "refunded to the original payment method" : "not refunded", input.restock ? "items restocked" : "items not restocked"].join(", ");
  // Shopify cancels in the background; usually it's done within a second or two.
  for (const delay of delays) {
    await sleep(delay);
    if ((await findOrder(admin, details.orderNumber, found.id))?.cancelled) {
      return applyDecision(db, shop, id, "shopify", { note, author, event: `Approved: order ${order.name} cancelled in Shopify (${how})` }, admin);
    }
  }
  return applyDecision(db, shop, id, "shopify-started", { note, author, event: `Approved: Shopify is cancelling order ${order.name} (${how})` }, admin);
}
