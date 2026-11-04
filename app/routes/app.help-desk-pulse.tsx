import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { markTyping, typingState } from "../services/help-desk-typing.server";

// A cheap fingerprint of what the open Help Desk screen shows. The admin polls
// it every few seconds and reloads the full page (orders and all) only when it
// changes, so customer messages and photo checks appear like in a chat app.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { shop } = session;
  const ticketId = new URL(request.url).searchParams.get("ticket");
  const headers = { "Cache-Control": "private, no-store" };

  // The notification bell: customers the chat assistant passed to the team, newest first.
  if (new URL(request.url).searchParams.get("waiting")) {
    const where = { shop, status: { not: "Resolved" }, humanRequestedAt: { not: null } };
    const [count, waiting] = await Promise.all([
      db.helpDeskTicket.count({ where }),
      db.helpDeskTicket.findMany({ where, orderBy: { humanRequestedAt: "desc" }, take: 8, select: { id: true, number: true, name: true, topic: true, humanRequestedAt: true } }),
    ]);
    return Response.json({ count, waiting }, { headers });
  }

  if (ticketId) {
    // Staff typing a reply: the customer sees "typing..." on their request page.
    const typing = new URL(request.url).searchParams.get("typing");
    if (typing !== null) {
      const ticket = await db.helpDeskTicket.findFirst({ where: { id: ticketId, shop }, select: { id: true } });
      if (ticket) markTyping(ticket.id, { staff: typing });
      return Response.json({ ok: Boolean(ticket) }, { headers });
    }
    // Not the ticket's updatedAt: opening the ticket marks it read (and syncs its
    // order), which would change the stamp and reload the page over and over.
    // Every change staff or the customer make adds a message or a timeline event.
    const [ticket, messages, scans] = await Promise.all([
      db.helpDeskTicket.findFirst({ where: { id: ticketId, shop }, select: { status: true, allowPhotos: true, allowVideos: true } }),
      db.helpDeskMessage.aggregate({ where: { ticketId, ticket: { shop } }, _count: true, _max: { createdAt: true } }),
      db.helpDeskImageScan.aggregate({ where: { shop, attachment: { ticketId } }, _count: true, _max: { updatedAt: true } }),
    ]);
    if (!ticket) return Response.json({ stamp: "gone" }, { headers });
    const stamp = [ticket.status, ticket.allowPhotos ? 1 : 0, ticket.allowVideos ? 1 : 0, messages._count, messages._max.createdAt?.getTime() ?? 0, scans._count, scans._max.updatedAt?.getTime() ?? 0].join(".");
    // customerTyping: for the "typing..." bubble; not part of the stamp, so it never reloads the page.
    return Response.json({ stamp, customerTyping: typingState(ticketId).customer }, { headers });
  }

  const scope = new URL(request.url).searchParams.get("scope");
  // Photo Checks: every image scan, and every photo or video customers send.
  if (scope === "photos") {
    const [scans, attachments] = await Promise.all([
      db.helpDeskImageScan.aggregate({ where: { shop }, _count: true, _max: { updatedAt: true } }),
      db.helpDeskAttachment.count({ where: { ticket: { shop } } }),
    ]);
    return Response.json({ stamp: `${scans._count}.${scans._max.updatedAt?.getTime() ?? 0}.${attachments}` }, { headers });
  }
  // Settings: what a teammate saves (the settings, articles, saved replies,
  // team) and what customers search, so every open Settings screen keeps up.
  if (scope === "settings") {
    const [settings, articles, searches, staff, macros] = await Promise.all([
      db.helpDeskSettings.findUnique({ where: { shop } }),
      db.helpDeskFaq.aggregate({ where: { shop }, _count: true, _max: { updatedAt: true } }),
      db.helpDeskBotQuestion.count({ where: { shop } }),
      db.helpDeskStaff.findMany({ where: { shop }, select: { id: true }, orderBy: { id: "asc" } }),
      db.helpDeskMacro.findMany({ where: { shop }, select: { id: true, title: true, body: true }, orderBy: { id: "asc" } }),
    ]);
    // The settings row has no updated time: its saved values are the fingerprint
    // (not when the storefront form was last seen, which changes on its own).
    const { formLastSeenAt: _seen, ...saved } = settings ?? {};
    void _seen;
    const stamp = fingerprint(JSON.stringify([saved, articles._count, articles._max.updatedAt, searches, staff.map((member) => member.id), macros]));
    return Response.json({ stamp }, { headers });
  }
  // The inbox and Overview: tickets, and every message on them.
  const [tickets, messages] = await Promise.all([
    db.helpDeskTicket.aggregate({ where: { shop }, _count: true, _max: { updatedAt: true } }),
    db.helpDeskMessage.aggregate({ where: { ticket: { shop } }, _count: true, _max: { createdAt: true } }),
  ]);
  return Response.json({ stamp: `${tickets._count}.${tickets._max.updatedAt?.getTime() ?? 0}.${messages._count}.${messages._max.createdAt?.getTime() ?? 0}` }, { headers });
};

// A short, stable fingerprint of some text.
function fingerprint(text: string) {
  let hash = 0;
  for (let index = 0; index < text.length; index++) hash = (Math.imul(hash, 31) + text.charCodeAt(index)) | 0;
  return `${(hash >>> 0).toString(36)}.${text.length}`;
}
