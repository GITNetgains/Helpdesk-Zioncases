import type { PrismaClient } from "@prisma/client";
import { MAX_MESSAGE_LENGTH, type QuoteStatus } from "./help-desk";
import { updateTickets } from "./help-desk.server";
import { queueEmail } from "./help-desk-outbox.server";

// International shipping quotes (the Process Guidelines on the form). The
// customer picks the products, the address and Regular or Expedited shipping;
// the request starts Pending. Staff check the products are available and which
// carriers can take them there, then send the estimated delivery date, the
// shipping cost and the taxes (Quoted), or say it can't be shipped there
// (Unavailable). Each step is logged, shown on the request page and emailed.

type AdminClient = { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };
export type QuoteResult = { errors: Record<string, string>; quoteStatus?: QuoteStatus };
export type QuoteInput = { carrier: string; delivery: string; shipping: string; taxes: string; note: string; author: string };

const DECIDED = "This quote has already been sent. Reload the page to see where it stands.";

async function step(db: PrismaClient, shop: string, id: string, next: QuoteStatus, data: Record<string, string>, input: { note: string; author: string; event: string; resolutionType: string }, admin?: AdminClient): Promise<QuoteResult> {
  const note = input.note.trim();
  if (note.length > MAX_MESSAGE_LENGTH) return { errors: { note: `Use no more than ${MAX_MESSAGE_LENGTH.toLocaleString("en")} characters.` } };
  const ticket = await db.helpDeskTicket.findFirst({ where: { id, shop }, select: { quoteStatus: true, resolutionType: true } });
  if (!ticket) return { errors: { form: "This ticket no longer exists." } };
  if (!ticket.quoteStatus) return { errors: { form: "This ticket isn't a shipping quote request." } };
  const author = input.author.trim().slice(0, 80) || "Staff";
  const now = new Date();
  const { count } = await db.helpDeskTicket.updateMany({
    where: { id, shop, quoteStatus: "Pending" },
    data: { ...data, quoteStatus: next, quoteNote: note, quoteDecidedBy: author, quoteDecidedAt: now, lastActivityAt: now },
  });
  if (!count) return { errors: { form: DECIDED } };
  await db.helpDeskMessage.create({ data: { ticketId: id, kind: "event", author, body: input.event } });
  await updateTickets(db, shop, [id], { status: "Resolved", ...(ticket.resolutionType ? {} : { resolutionType: input.resolutionType }) }, author);
  queueEmail(db, { shop, ticketId: id, kind: "quote" }, admin);
  return { errors: {}, quoteStatus: next };
}

// The products are available and can ship there: the estimated delivery, the shipping cost and taxes.
export async function sendQuote(db: PrismaClient, shop: string, id: string, input: QuoteInput, admin?: AdminClient): Promise<QuoteResult> {
  const clean = (value: string, max = 200) => value.trim().slice(0, max);
  const quote = { quoteCarrier: clean(input.carrier, 100), quoteDelivery: clean(input.delivery), quoteShipping: clean(input.shipping, 100), quoteTaxes: clean(input.taxes) };
  const errors: Record<string, string> = {};
  if (!quote.quoteDelivery) errors.delivery = "Enter the estimated delivery date.";
  if (!quote.quoteShipping) errors.shipping = "Enter the shipping cost.";
  if (!quote.quoteTaxes) errors.taxes = "Enter the taxes and duties, or \"None\".";
  if (Object.keys(errors).length) return { errors };
  return step(db, shop, id, "Quoted", quote, {
    note: input.note, author: input.author, resolutionType: "Question answered",
    event: `Shipping details sent: ${[quote.quoteCarrier, `delivery ${quote.quoteDelivery}`, `shipping ${quote.quoteShipping}`, `taxes ${quote.quoteTaxes}`].filter(Boolean).join(", ")}`,
  }, admin);
}

// The products aren't available, or no carrier ships there: the customer is told why.
export async function quoteUnavailable(db: PrismaClient, shop: string, id: string, input: { note: string; author: string }, admin?: AdminClient): Promise<QuoteResult> {
  if (!input.note.trim()) return { errors: { note: "Tell the customer why it can't be shipped there." } };
  return step(db, shop, id, "Unavailable", {}, { ...input, resolutionType: "Request declined", event: "Shipping quote: not available" }, admin);
}
