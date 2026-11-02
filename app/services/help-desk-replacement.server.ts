import type { PrismaClient } from "@prisma/client";
import { MAX_MESSAGE_LENGTH, solutionsFor, type ReplacementStatus } from "./help-desk";
import { updateTickets } from "./help-desk.server";
import { queueEmail } from "./help-desk-outbox.server";

// Missing or lost parts (the Procedure Guidelines on the form), and warranty
// claims (replacementKind "warranty"): the team checks the purchase date and
// coverage, approves a solution (replacement, repair...) and sends the next
// steps, with tracking when something ships. The customer
// picks the product, says which part is missing and adds photos; the ticket
// starts Pending. Staff check the order (still in transit? in the original
// shipment?) and confirm the replacement (Approved) or reject it with a reason,
// then ship the part and enter its tracking (Shipped). Each step is logged,
// shown on the customer's request page and emailed to them.

type AdminClient = { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };
export type ReplacementResult = { errors: Record<string, string>; replacementStatus?: ReplacementStatus };

const DECIDED = "This request has already moved on. Reload the page to see where it stands.";

async function step(
  db: PrismaClient, shop: string, id: string, next: ReplacementStatus, from: ReplacementStatus[],
  input: { note: string; author: string; event: string; status: string; resolutionType?: string; tracking?: { carrier: string; number: string; url: string }; solution?: string },
  admin?: AdminClient,
): Promise<ReplacementResult> {
  const note = input.note.trim();
  if (note.length > MAX_MESSAGE_LENGTH) return { errors: { note: `Use no more than ${MAX_MESSAGE_LENGTH.toLocaleString("en")} characters.` } };
  const ticket = await db.helpDeskTicket.findFirst({ where: { id, shop }, select: { replacementStatus: true, resolutionType: true } });
  if (!ticket) return { errors: { form: "This ticket no longer exists." } };
  if (!ticket.replacementStatus) return { errors: { form: "This ticket isn't a missing part request." } };
  const author = input.author.trim().slice(0, 80) || "Staff";
  const now = new Date();
  const { count } = await db.helpDeskTicket.updateMany({
    where: { id, shop, replacementStatus: { in: from } },
    data: {
      replacementStatus: next, replacementNote: note, replacementDecidedBy: author, replacementDecidedAt: now, lastActivityAt: now,
      ...(input.solution ? { replacementSolution: input.solution } : {}),
      ...(input.tracking ? { replacementCarrier: input.tracking.carrier, replacementTracking: input.tracking.number, replacementTrackingUrl: input.tracking.url } : {}),
    },
  });
  if (!count) return { errors: { form: DECIDED } };
  await db.helpDeskMessage.create({ data: { ticketId: id, kind: "event", author, body: input.event } });
  await updateTickets(db, shop, [id], {
    status: input.status, ...(input.resolutionType && !ticket.resolutionType ? { resolutionType: input.resolutionType } : {}),
  }, author);
  queueEmail(db, { shop, ticketId: id, kind: "replacement" }, admin);
  return { errors: {}, replacementStatus: next };
}

const kindOf = async (db: PrismaClient, shop: string, id: string) =>
  await db.helpDeskTicket.findFirst({ where: { id, shop }, select: { replacementKind: true, replacementSolution: true } });
// What each kind is called in the log.
const NAME: Record<string, string> = { warranty: "Warranty claim", lost: "Lost package" };

// The order was checked and the part is owed: the replacement is confirmed.
// A warranty claim or a lost package is approved with its solution (a
// replacement, repair... or, for a lost package, sent again or refunded:
// what the customer asked for unless the team decides otherwise).
export async function approveReplacement(db: PrismaClient, shop: string, id: string, input: { note: string; author: string; solution?: string }, admin?: AdminClient): Promise<ReplacementResult> {
  const ticket = await kindOf(db, shop, id);
  const solutions = solutionsFor(ticket?.replacementKind ?? "");
  if (ticket && solutions.length) {
    const solution = input.solution || (ticket.replacementKind === "lost" ? ticket.replacementSolution : "");
    if (!solutions.includes(solution)) return { errors: { solution: "Choose the solution you're approving." } };
    return step(db, shop, id, "Approved", ["Pending", "Rejected"], { ...input, solution, status: "In progress", event: `${NAME[ticket.replacementKind]} approved: ${solution}` }, admin);
  }
  return step(db, shop, id, "Approved", ["Pending", "Rejected"], { ...input, status: "In progress", event: "Replacement approved" }, admin);
}

// Not owed (still in transit, or it was in the box): the customer is told why.
export async function rejectReplacement(db: PrismaClient, shop: string, id: string, input: { note: string; author: string }, admin?: AdminClient): Promise<ReplacementResult> {
  const kind = (await kindOf(db, shop, id))?.replacementKind ?? "";
  if (!input.note.trim()) return { errors: { note: kind === "warranty" ? "Tell the customer why the claim isn't covered." : kind === "lost" ? "Tell the customer why the request can't be approved." : "Tell the customer why the part can't be replaced." } };
  return step(db, shop, id, "Rejected", ["Pending", "Approved"], { ...input, status: "Resolved", resolutionType: "Request declined", event: NAME[kind] ? `${NAME[kind]} rejected` : "Replacement rejected" }, admin);
}

// The part is on its way: its carrier and tracking number, shared with the customer.
// A warranty's or lost package's next steps may ship nothing (a repair, a
// refund): then the instructions are the message.
export async function shipReplacement(
  db: PrismaClient, shop: string, id: string, input: { note: string; author: string; carrier: string; number: string; url: string }, admin?: AdminClient,
): Promise<ReplacementResult> {
  const tracking = { carrier: input.carrier.trim().slice(0, 60), number: input.number.trim().slice(0, 100), url: input.url.trim().slice(0, 500) };
  const ticket = await kindOf(db, shop, id);
  const name = NAME[ticket?.replacementKind ?? ""];
  if (name && !tracking.number) {
    if (!input.note.trim()) return { errors: { note: "Write the next steps for the customer, or enter the tracking number." } };
    return step(db, shop, id, "Shipped", ["Approved"], {
      ...input, status: "Resolved", resolutionType: ticket?.replacementSolution === "Refund" ? "Refund" : undefined, event: `${name}: next steps sent to the customer`,
    }, admin);
  }
  if (!tracking.number) return { errors: { number: "Enter the tracking number of the replacement." } };
  if (tracking.url && !/^https:\/\/[^\s]+$/i.test(tracking.url)) return { errors: { url: "Enter a tracking link starting with https://, or leave it empty." } };
  return step(db, shop, id, "Shipped", ["Approved"], {
    ...input, tracking, status: "Resolved", resolutionType: name ? (ticket?.replacementKind === "lost" ? "Replacement" : undefined) : "Replacement part",
    event: `${name ? `${name}: shipped` : "Replacement part shipped"}${tracking.carrier ? ` with ${tracking.carrier}` : ""}: ${tracking.number}`,
  }, admin);
}
