import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { syncTicketOrder } from "../services/help-desk-orders.server";
import { forgetTicketOrder } from "../services/help-desk-admin.server";

// An order was cancelled in Shopify (from the Shopify admin, or by the Help
// Desk itself). Open cancellation requests for it are marked cancelled and the
// customer is told, without waiting for someone to open the ticket.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, admin, payload } = await authenticate.webhook(request);
  const order = payload as { id?: number | string; name?: string };
  const id = order.id != null ? String(order.id) : "";
  const tickets = await db.helpDeskTicket.findMany({
    where: {
      shop, cancelStatus: { in: ["Pending", "Approved"] },
      // orderId is saved once the ticket's order is found; before that, the typed number.
      OR: [...(id ? [{ orderId: id }] : []), ...(order.name ? [{ orderName: order.name }, { details: { contains: `"orderNumber":"${order.name}"` } }] : [])],
    },
    select: { id: true, email: true },
  });
  for (const ticket of tickets) {
    forgetTicketOrder(shop, ticket.id, ticket);
    await syncTicketOrder(db, admin, ticket.id).catch((error) => console.error(`Help Desk could not close cancellation request ${ticket.id}:`, error));
  }
  return new Response();
};
