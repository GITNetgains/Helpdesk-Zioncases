import type { PrismaClient } from "@prisma/client";
import { addressBlockers, addressChangeChecks, addressCheckOrder, addressLines, addressProblems, MAX_MESSAGE_LENGTH, sameAddress, type AddressStatus, type ShippingAddress } from "./help-desk";
import { updateTickets } from "./help-desk.server";
import { findOrderPatiently } from "./help-desk-orders.server";
import { queueEmail } from "./help-desk-outbox.server";

// Shipping address change requests. The customer sends the new address from
// the storefront form (the ticket starts Pending). Staff check it against the
// rules in addressChangeChecks (help-desk.ts), may correct it, and update the
// order's shipping address in Shopify, or reject the request with a reason.
// Each decision is logged, shown on the customer's request page and emailed.

type AdminClient = { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };
export type AddressResult = { errors: Record<string, string>; addressStatus?: AddressStatus };

const UPDATE_MUTATION = `#graphql
  mutation HelpDeskUpdateAddress($input: OrderInput!) {
    orderUpdate(input: $input) {
      order { id }
      userErrors { field message }
    }
  }
`;
const NO_ACCESS = "The app isn't allowed to edit orders yet. Open the app again and approve the updated permissions.";
const DECIDED = "This request has already been decided. Reload the page to see where it stands.";

const clean = (address: ShippingAddress): ShippingAddress => ({
  name: address.name.trim().slice(0, 120), address1: address.address1.trim().slice(0, 200), address2: address.address2.trim().slice(0, 200),
  city: address.city.trim().slice(0, 100), province: address.province.trim().toUpperCase().slice(0, 10), zip: address.zip.trim().toUpperCase().slice(0, 20),
  country: address.country.trim().toUpperCase(), phone: address.phone.trim().slice(0, 40),
});

// What's wrong with an address before it's sent to Shopify (help-desk.ts).
export const addressErrors = (address: ShippingAddress): Record<string, string> => addressProblems(address);

// Marks the decision on the ticket (only from a status it allows), logs it,
// resolves the ticket and emails the customer.
async function decide(
  db: PrismaClient, shop: string, id: string, next: AddressStatus, from: AddressStatus[],
  input: { note: string; author: string; event: string; applied?: ShippingAddress }, admin?: AdminClient,
): Promise<AddressResult> {
  const now = new Date();
  const { count } = await db.helpDeskTicket.updateMany({
    where: { id, shop, addressStatus: { in: from } },
    data: {
      addressStatus: next, addressNote: input.note, addressDecidedBy: input.author, addressDecidedAt: now, lastActivityAt: now,
      ...(input.applied ? { addressApplied: JSON.stringify(input.applied) } : {}),
    },
  });
  if (!count) return { errors: { form: DECIDED } };
  const ticket = await db.helpDeskTicket.findUniqueOrThrow({ where: { id }, select: { resolutionType: true } });
  await db.helpDeskMessage.create({ data: { ticketId: id, kind: "event", author: input.author, body: input.event } });
  await updateTickets(db, shop, [id], {
    status: "Resolved", ...(ticket.resolutionType ? {} : { resolutionType: next === "Updated" ? "Order updated" : "Request declined" }),
  }, input.author);
  queueEmail(db, { shop, ticketId: id, kind: "address" }, admin);
  return { errors: {}, addressStatus: next };
}

// Rejects the request; the customer is told why.
export async function rejectAddressChange(db: PrismaClient, shop: string, id: string, input: { note: string; author: string }, admin?: AdminClient): Promise<AddressResult> {
  const note = input.note.trim();
  if (!note) return { errors: { note: "Tell the customer why the address can't be changed." } };
  if (note.length > MAX_MESSAGE_LENGTH) return { errors: { note: `Use no more than ${MAX_MESSAGE_LENGTH.toLocaleString("en")} characters.` } };
  const author = input.author.trim().slice(0, 80) || "Staff";
  return decide(db, shop, id, "Rejected", ["Pending"], { note, author, event: "Address change rejected" }, admin);
}

// Sets the order's shipping address in Shopify to the requested one (as staff
// may have corrected it), once the order passes every check. confirmed: staff
// confirmed the change with the order's customer when the emails differ.
export async function updateAddressInShopify(
  db: PrismaClient, admin: AdminClient, shop: string, id: string,
  input: { address: ShippingAddress; note: string; author: string; confirmed: boolean },
  delays = [800, 1200, 2000],
): Promise<AddressResult> {
  const ticket = await db.helpDeskTicket.findFirst({ where: { id, shop }, select: { email: true, details: true, orderId: true, addressStatus: true } });
  if (!ticket) return { errors: { form: "This ticket no longer exists." } };
  if (!["Pending", "Rejected"].includes(ticket.addressStatus)) return { errors: { form: ticket.addressStatus ? DECIDED : "This ticket isn't an address change request." } };
  const address = clean(input.address);
  const invalid = addressErrors(address);
  if (Object.keys(invalid).length) return { errors: invalid };
  const note = input.note.trim();
  if (note.length > MAX_MESSAGE_LENGTH) return { errors: { note: `Use no more than ${MAX_MESSAGE_LENGTH.toLocaleString("en")} characters.` } };
  let details: Record<string, string> = {};
  try { details = JSON.parse(ticket.details) as Record<string, string>; } catch { /* no details */ }

  // The checks run on the order as Shopify has it right now.
  const order = await findOrderPatiently(admin, details.orderNumber, ticket.orderId, delays);
  if (order === undefined) return { errors: { form: "Shopify couldn't be reached. Please try again." } };
  const checks = addressChangeChecks(order && addressCheckOrder(order, ticket.email), address.country);
  const blocked = addressBlockers(checks);
  if (blocked.length) return { errors: { form: `${blocked[0].label}: no. ${blocked[0].detail}` } };
  if (order?.shippingAddress && sameAddress(address, order.shippingAddress)) return { errors: { form: `${order.name} already ships to this address. Nothing to change.` } };
  if (!checks.find((check) => check.id === "verified")?.ok && !input.confirmed) {
    return { errors: { form: "This order was placed with a different email. Confirm the change with the order's customer, then tick the box to update it." } };
  }

  const [firstName, ...rest] = address.name.split(/\s+/);
  try {
    const response = await admin.graphql(UPDATE_MUTATION, {
      variables: {
        input: {
          id: `gid://shopify/Order/${order!.id}`,
          shippingAddress: {
            firstName, lastName: rest.join(" ") || firstName, address1: address.address1, address2: address.address2 || null, city: address.city,
            provinceCode: address.province || null, zip: address.zip, countryCode: address.country, phone: address.phone || null,
          },
        },
      },
    });
    const json = await response.json();
    const result = json.data?.orderUpdate as { order: { id: string } | null; userErrors: { field: string[] | null; message: string }[] } | undefined;
    if (!result) {
      console.error("Help Desk could not update a shipping address in Shopify:", JSON.stringify(json.errors ?? json));
      return { errors: { form: /access|denied|scope/i.test(JSON.stringify(json.errors ?? "")) ? NO_ACCESS : "Shopify couldn't update the address. Please try again." } };
    }
    if (result.userErrors.length) return { errors: { form: `Shopify didn't accept this address: ${result.userErrors.map((error) => error.message).join(" ")}` } };
  } catch (error) {
    const text = `${error instanceof Error ? error.message : ""} ${JSON.stringify((error as { body?: unknown })?.body ?? "")}`;
    console.error("Help Desk could not update a shipping address in Shopify:", text);
    return { errors: { form: /access|denied|scope|write_orders/i.test(text) ? NO_ACCESS : "Shopify couldn't update the address. Please try again." } };
  }
  const author = input.author.trim().slice(0, 80) || "Staff";
  const previous = order!.shippingAddress ? addressLines(order!.shippingAddress).join(", ") : "none";
  return decide(db, shop, id, "Updated", ["Pending", "Rejected"], {
    note, author, applied: address, event: `Shipping address of ${order!.name} updated in Shopify to ${addressLines(address).join(", ")} (was ${previous})`,
  }, admin);
}
