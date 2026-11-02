import type { PrismaClient } from "@prisma/client";
import { MAX_IMAGE_BYTES, MAX_MESSAGE_LENGTH, type ReturnStatus } from "./help-desk";
import { updateTickets } from "./help-desk.server";
import { queueEmail } from "./help-desk-outbox.server";

// Damaged or defective items sent back (the Process Guidelines on the form).
// The customer's request starts Pending. Staff check it meets the conditions
// (within 6 months, unused, original packaging) and either reject it with a
// reason or approve it by sending the return label, which the customer gets by
// email and on their request page. Once the product is back at the warehouse
// and verified, staff mark it Received; the refund or exchange follows.
// Each step is logged and emailed to the customer.

type AdminClient = { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };
export type ReturnResult = { errors: Record<string, string>; returnStatus?: ReturnStatus };

const DECIDED = "This return has already moved on. Reload the page to see where it stands.";
// A label as carriers and ShipStation give it: a PDF or an image.
export const RETURN_LABEL_TYPES = ["application/pdf", "image/png", "image/jpeg"];

// The label's real type from its first bytes, so a renamed file can't pass.
export function labelType(bytes: Uint8Array): string | null {
  const head = Buffer.from(bytes.subarray(0, 8));
  if (head.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  if (head.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (head[0] === 255 && head[1] === 216 && head[2] === 255) return "image/jpeg";
  return null;
}

const cleanNote = (note: string) => note.trim();
const tooLong = (note: string) => note.length > MAX_MESSAGE_LENGTH ? { note: `Use no more than ${MAX_MESSAGE_LENGTH.toLocaleString("en")} characters.` } : null;

// Moves the return on (only from the steps given), logs it, sets the ticket's
// status and emails the customer.
async function step(
  db: PrismaClient, shop: string, id: string, next: ReturnStatus, from: ReturnStatus[],
  input: { note: string; author: string; event: string; status: string; resolutionType?: string; label?: { name: string; type: string; data: Uint8Array<ArrayBuffer> } },
  admin?: AdminClient,
): Promise<ReturnResult> {
  const now = new Date();
  const ticket = await db.helpDeskTicket.findFirst({ where: { id, shop }, select: { returnStatus: true, resolutionType: true } });
  if (!ticket) return { errors: { form: "This ticket no longer exists." } };
  if (!ticket.returnStatus) return { errors: { form: "This ticket isn't a return request." } };
  if (!(from as string[]).includes(ticket.returnStatus)) return { errors: { form: DECIDED } };
  const author = input.author.trim().slice(0, 80) || "Staff";
  const event = await db.helpDeskMessage.create({ data: { ticketId: id, kind: "event", author, body: input.event } });
  // The label is kept with the event that sent it, so it isn't one of the customer's photos.
  const label = input.label ? await db.helpDeskAttachment.create({ data: { ticketId: id, messageId: event.id, ...input.label } }) : null;
  const { count } = await db.helpDeskTicket.updateMany({
    where: { id, shop, returnStatus: { in: from } },
    data: {
      returnStatus: next, returnNote: input.note, returnDecidedBy: author, returnDecidedAt: now, lastActivityAt: now,
      ...(label ? { returnLabelId: label.id } : {}),
    },
  });
  if (!count) {
    await db.helpDeskMessage.delete({ where: { id: event.id } });
    return { errors: { form: DECIDED } };
  }
  await updateTickets(db, shop, [id], {
    status: input.status, ...(input.resolutionType && !ticket.resolutionType ? { resolutionType: input.resolutionType } : {}),
  }, author);
  queueEmail(db, { shop, ticketId: id, kind: "return" }, admin);
  return { errors: {}, returnStatus: next };
}

// Approves the return by sending its label (a PDF or image, up to 10 MB).
export async function sendReturnLabel(
  db: PrismaClient, shop: string, id: string, input: { label: File | null; note: string; author: string }, admin?: AdminClient,
): Promise<ReturnResult> {
  const note = cleanNote(input.note);
  const long = tooLong(note);
  if (long) return { errors: long };
  const file = input.label;
  if (!file || !file.size) return { errors: { label: "Attach the return label (PDF, PNG or JPG)." } };
  if (file.size > MAX_IMAGE_BYTES) return { errors: { label: "Use a label file of up to 10 MB." } };
  const data = new Uint8Array(await file.arrayBuffer());
  const type = labelType(data);
  if (!type) return { errors: { label: "The label must be a PDF, PNG or JPG file." } };
  const name = (file.name || "return-label").replace(/[\\/\r\n"]/g, "_").slice(0, 200);
  return step(db, shop, id, "Label sent", ["Pending", "Rejected"], {
    note, author: input.author, status: "Waiting on customer", label: { name, type, data },
    event: `Return approved. Return label sent to the customer: ${name}`,
  }, admin);
}

// The conditions aren't met: the customer is told why.
export async function rejectReturn(db: PrismaClient, shop: string, id: string, input: { note: string; author: string }, admin?: AdminClient): Promise<ReturnResult> {
  const note = cleanNote(input.note);
  if (!note) return { errors: { note: "Tell the customer why the return can't be accepted." } };
  const long = tooLong(note);
  if (long) return { errors: long };
  return step(db, shop, id, "Rejected", ["Pending"], { note, author: input.author, status: "Resolved", resolutionType: "Request declined", event: "Return rejected" }, admin);
}

// The product is back at the warehouse and the team has checked it. The refund
// or exchange is the next step, so the ticket stays open for it.
export async function markReturnReceived(db: PrismaClient, shop: string, id: string, input: { note: string; author: string }, admin?: AdminClient): Promise<ReturnResult> {
  const note = cleanNote(input.note);
  const long = tooLong(note);
  if (long) return { errors: long };
  return step(db, shop, id, "Received", ["Label sent"], { note, author: input.author, status: "In progress", resolutionType: "Return accepted", event: "Returned product received and verified" }, admin);
}

// The label as the customer downloads it from their request page.
export async function returnLabelFile(db: PrismaClient, shop: string, token: string) {
  const ticket = await db.helpDeskTicket.findFirst({ where: { shop, accessToken: token }, select: { id: true, returnLabelId: true, returnStatus: true } });
  if (!ticket?.returnLabelId || ticket.returnStatus === "Rejected") return null;
  return db.helpDeskAttachment.findFirst({ where: { id: ticket.returnLabelId, ticketId: ticket.id }, select: { name: true, type: true, data: true } });
}
