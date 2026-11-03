import nodemailer from "nodemailer";
import type { PrismaClient } from "@prisma/client";
import { addressLines, cancelScopes, countryName, fieldLabels, type ShippingAddress } from "./help-desk";
import { memo } from "./memo.server";

// SMTP settings live in the server .env; without them notifications are skipped.
//   SMTP_HOST, SMTP_PORT (default 587; 465 uses TLS), SMTP_USER, SMTP_PASS, SMTP_FROM (defaults to SMTP_USER)
type AdminClient = { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };
export type TicketProduct = { id: string; title: string; image: string };

// Most mail providers reject messages over ~20-25 MB, so larger image sets are linked instead.
const MAX_ATTACHED_BYTES = 15 * 1024 * 1024;
const SHOP_QUERY = `#graphql
  query HelpDeskShop { shop { name email primaryDomain { url } } }
`;
const PRODUCTS_QUERY = `#graphql
  query HelpDeskProducts($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product { id title featuredImage { url(transform: { maxWidth: 160 }) } }
      ... on LineItem { id title image { url(transform: { maxWidth: 160 }) } }
    }
  }
`;

export function emailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function transport() {
  const port = Number(process.env.SMTP_PORT) || 587;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

const placeholders = (ids: string[]) => ids.map(id => ({ id, title: id.split("/").pop() || id, image: "" }));

// Throws when Shopify can't be asked, so a cache never keeps the placeholders.
async function fetchProducts(admin: AdminClient, ids: string[]): Promise<TicketProduct[]> {
  const json = await (await admin.graphql(PRODUCTS_QUERY, { variables: { ids } })).json();
  if (!json.data?.nodes) throw new Error("No products returned");
  const found = new Map<string, TicketProduct>();
  // A LineItem: an ordered product since deleted, named as on the order.
  for (const node of json.data.nodes as ({ id: string; title: string; featuredImage?: { url: string } | null; image?: { url: string } | null } | null)[]) {
    if (node?.id) found.set(node.id, { id: node.id, title: node.title, image: node.featuredImage?.url || node.image?.url || "" });
  }
  return placeholders(ids).map(product => found.get(product.id) ?? { ...product, title: `Deleted product (${product.title})` });
}

export async function loadProducts(admin: AdminClient, ids: string[]): Promise<TicketProduct[]> {
  if (!ids.length) return [];
  return fetchProducts(admin, ids).catch(() => placeholders(ids));
}

// The same, reused for 10 minutes: the live ticket and request pages reload
// as messages arrive, and a ticket's products don't change.
export async function cachedProducts(admin: AdminClient, shop: string, ids: string[]): Promise<TicketProduct[]> {
  if (!ids.length) return [];
  return memo(`products|${shop}|${ids.join(",")}`, 10 * 60_000, () => fetchProducts(admin, ids)).catch(() => placeholders(ids));
}

export async function loadShop(admin: AdminClient) {
  const json = await (await admin.graphql(SHOP_QUERY)).json();
  return { name: String(json.data?.shop?.name || ""), email: String(json.data?.shop?.email || ""), url: String(json.data?.shop?.primaryDomain?.url || "") };
}

// The customer's private page for a ticket, served through the app proxy.
export function trackingUrl(storeUrl: string, token: string) {
  return `${storeUrl.replace(/\/$/, "")}/apps/help-desk?ticket=${encodeURIComponent(token)}`;
}

const sender = (storeName: string) => ({ name: `${storeName} Help Desk`, address: process.env.SMTP_FROM || process.env.SMTP_USER! });

export async function notificationRecipient(db: PrismaClient, shop: string, admin: AdminClient) {
  const settings = await db.helpDeskSettings.findUnique({ where: { shop } });
  if (settings && !settings.notify) return null;
  const store = await loadShop(admin);
  return { to: settings?.notifyEmail || store.email, store };
}

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const multiline = (value: string) => escape(value).replace(/\r?\n/g, "<br>");

function ticketUrl(shop: string, id: string) {
  return `https://admin.shopify.com/store/${shop.replace(/\.myshopify\.com$/, "")}/apps/${process.env.SHOPIFY_API_KEY}/app/help-desk/tickets/${encodeURIComponent(id)}`;
}

// Styled like Shopify's own staff notifications: a plain white card, store
// name on top, one dark call-to-action button and label/value rows.
export function renderEmail(input: {
  storeName: string; adminUrl: string; ticketId: string; number?: number; createdAt: Date; name: string; email: string; topic: string;
  values: Record<string, string>; products: TicketProduct[]; receivedProducts?: TicketProduct[]; images: { cid: string; name: string }[]; skippedImages: number;
}) {
  const row = (label: string, value: string) => `<tr><td style="padding:10px 0;border-top:1px solid #ebebeb;width:38%;vertical-align:top;color:#616161;font-size:14px">${escape(label)}</td><td style="padding:10px 0;border-top:1px solid #ebebeb;vertical-align:top;color:#303030;font-size:14px;line-height:20px">${value}</td></tr>`;
  const heading = (text: string) => `<h3 style="margin:28px 0 8px;font-size:15px;font-weight:600;color:#303030">${escape(text)}</h3>`;
  const contact = [
    row("Name", escape(input.name)),
    row("Email", `<a href="mailto:${escape(input.email)}" style="color:#005bd3;text-decoration:none">${escape(input.email)}</a>`),
    ...(input.values.phone ? [row("Phone", `<a href="tel:${escape(input.values.phone.replace(/[^\d+]/g, ""))}" style="color:#005bd3;text-decoration:none">${escape(input.values.phone)}</a>`)] : []),
  ].join("");
  const details = Object.keys(fieldLabels)
    .filter(key => key !== "phone" && input.values[key])
    .map(key => row(fieldLabels[key], key === "country" ? escape(countryName(input.values[key])) : multiline(input.values[key])))
    .join("");
  const productRows = (list: TicketProduct[]) => list.map(product => `<tr>
    <td style="padding:8px 12px 8px 0;border-top:1px solid #ebebeb;width:48px">${product.image
      ? `<img src="${escape(product.image)}" width="48" height="48" alt="" style="display:block;width:48px;height:48px;border-radius:8px;object-fit:cover;border:1px solid #ebebeb">`
      : `<div style="width:48px;height:48px;border-radius:8px;background:#f1f1f1"></div>`}</td>
    <td style="padding:8px 0;border-top:1px solid #ebebeb;font-size:14px;color:#303030">${escape(product.title)}</td></tr>`).join("");
  const received = input.receivedProducts ?? [];
  const productSection = (title: string, list: TicketProduct[]) => list.length
    ? `${heading(`${title} (${list.length})`)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${productRows(list)}</table>` : "";
  const images = input.images.map(image => `<td style="padding:0 8px 8px 0;vertical-align:top"><img src="cid:${image.cid}" width="120" height="120" alt="${escape(image.name)}" style="display:block;width:120px;height:120px;border-radius:8px;object-fit:cover;border:1px solid #ebebeb"></td>`).join("");
  const receivedAt = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(input.createdAt) + " UTC";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>New Help Desk request</title></head>
<body style="margin:0;padding:0;background:#f1f1f1;font-family:-apple-system,BlinkMacSystemFont,'San Francisco','Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#303030">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f1f1"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e3e3e3">
<tr><td style="padding:32px 32px 0">
  <p style="margin:0 0 24px;font-size:16px;font-weight:600;color:#303030">${escape(input.storeName)}</p>
  <h1 style="margin:0 0 8px;font-size:22px;line-height:28px;font-weight:650;color:#303030">New Help Desk request</h1>
  <p style="margin:0 0 20px;font-size:14px;line-height:20px;color:#616161">${escape(input.name)} sent a request about <strong style="color:#303030">${escape(input.topic)}</strong>.</p>
  <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#303030">
    <a href="${escape(input.adminUrl)}" style="display:inline-block;padding:11px 18px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">View ticket in Shopify</a>
  </td></tr></table>
</td></tr>
<tr><td style="padding:0 32px 32px">
  ${heading("Customer")}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${contact}</table>
  ${details ? `${heading("Request details")}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${row("Topic", escape(input.topic))}${details}</table>` : ""}
  ${productSection("Received by mistake", received)}
  ${productSection(received.length ? "Wanted instead" : "Products", input.products)}
  ${images ? `${heading(`Images (${input.images.length})`)}<table role="presentation" cellpadding="0" cellspacing="0"><tr>${images}</tr></table>` : ""}
  ${input.skippedImages ? `<p style="margin:8px 0 0;font-size:13px;color:#616161">${input.skippedImages} image${input.skippedImages === 1 ? " is" : "s are"} too large to attach. View ${input.skippedImages === 1 ? "it" : "them"} on the ticket.</p>` : ""}
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #ebebeb;font-size:13px;line-height:18px;color:#616161">
  Reply from the ticket in Shopify so the conversation stays in one place.<br>Received ${escape(receivedAt)} · Ticket ${escape(input.number ? `#${input.number}` : input.ticketId)}
</td></tr>
</table></td></tr></table></body></html>`;
}

function renderText(values: Record<string, string>, input: { name: string; email: string; topic: string; adminUrl: string; products: TicketProduct[]; receivedProducts: TicketProduct[] }) {
  const lines = [`New Help Desk request: ${input.topic}`, "", `Name: ${input.name}`, `Email: ${input.email}`];
  for (const key of Object.keys(fieldLabels)) if (values[key]) lines.push(`${fieldLabels[key]}: ${key === "country" ? countryName(values[key]) : values[key]}`);
  if (input.receivedProducts.length) lines.push(`Received by mistake: ${input.receivedProducts.map(product => product.title).join(", ")}`);
  if (input.products.length) lines.push(`${input.receivedProducts.length ? "Wanted instead" : "Products"}: ${input.products.map(product => product.title).join(", ")}`);
  lines.push("", `View ticket: ${input.adminUrl}`);
  return lines.join("\n");
}

// The senders below are run by the email queue (help-desk-outbox.server.ts).
// Each returns "sent", or "skipped" when there's nothing to send (email
// turned off, ticket gone); delivery failures throw so the queue retries.
export type SendResult = "sent" | "skipped";

// Emails the store about a newly created ticket.
export async function notifyTicket(db: PrismaClient, shop: string, admin: AdminClient, ticketId: string): Promise<SendResult> {
  const ticket = await db.helpDeskTicket.findFirst({ where: { id: ticketId, shop }, include: { attachments: { where: { messageId: null } }, messages: { where: { kind: { in: ["customer", "bot"] } }, orderBy: { createdAt: "asc" } } } });
  const recipient = ticket && await notificationRecipient(db, shop, admin);
  if (!ticket || !recipient?.to) return "skipped";
  const values = JSON.parse(ticket.details) as Record<string, string>;
  const [products, receivedProducts] = await Promise.all([
    loadProducts(admin, JSON.parse(ticket.products) as string[]),
    loadProducts(admin, JSON.parse(ticket.receivedProducts) as string[]),
  ]);
  let budget = MAX_ATTACHED_BYTES;
  const attached = ticket.attachments.filter(file => (budget -= file.data.length) >= 0);
  const adminUrl = ticketUrl(shop, ticket.id);
  const storeName = recipient.store.name || shop;
  // A chat ticket's request is its transcript.
  const transcript = ticket.channel === "chat" ? ticket.messages.map(message => `${message.kind === "bot" ? "Assistant" : ticket.name}: ${message.body}`).join("\n\n") : "";
  const shown = transcript ? { transcript } : values;
  await transport().sendMail({
    from: sender(storeName),
    to: recipient.to,
    replyTo: { name: ticket.name, address: ticket.email },
    subject: `[#${ticket.number}] New Help Desk ${ticket.channel === "chat" ? "chat" : "request"}: ${ticket.topic} from ${ticket.name}`,
    html: renderEmail({
      storeName, adminUrl, ticketId: ticket.id, number: ticket.number, createdAt: ticket.createdAt, name: ticket.name, email: ticket.email, topic: ticket.topic,
      values: shown, products, receivedProducts, images: attached.map(file => ({ cid: `${file.id}@help-desk`, name: file.name })), skippedImages: ticket.attachments.length - attached.length,
    }),
    text: renderText(shown, { name: ticket.name, email: ticket.email, topic: ticket.topic, adminUrl, products, receivedProducts }),
    attachments: attached.map(file => ({ filename: file.name, content: Buffer.from(file.data), contentType: file.type, cid: `${file.id}@help-desk` })),
  });
  return "sent";
}

// A short customer-facing message in the same card style: a heading, plain
// paragraphs (escaped, line breaks kept) and a button to the tracking page.
export function renderCustomerEmail(input: { storeName: string; heading: string; paragraphs: string[]; quote?: string; buttonUrl: string; buttonLabel: string; footer: string }) {
  const paragraphs = input.paragraphs.map(text => `<p style="margin:0 0 16px;font-size:15px;line-height:22px;color:#303030">${multiline(text)}</p>`).join("");
  const quote = input.quote ? `<div style="margin:0 0 20px;padding:16px;border-radius:8px;background:#f7f7f7;font-size:15px;line-height:22px;color:#303030">${multiline(input.quote)}</div>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(input.heading)}</title></head>
<body style="margin:0;padding:0;background:#f1f1f1;font-family:-apple-system,BlinkMacSystemFont,'San Francisco','Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#303030">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f1f1"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e3e3e3">
<tr><td style="padding:32px">
  <p style="margin:0 0 24px;font-size:16px;font-weight:600;color:#303030">${escape(input.storeName)}</p>
  <h1 style="margin:0 0 16px;font-size:22px;line-height:28px;font-weight:650;color:#303030">${escape(input.heading)}</h1>
  ${paragraphs}${quote}
  <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#303030">
    <a href="${escape(input.buttonUrl)}" style="display:inline-block;padding:11px 18px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">${escape(input.buttonLabel)}</a>
  </td></tr></table>
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #ebebeb;font-size:13px;line-height:18px;color:#616161">${multiline(input.footer)}</td></tr>
</table></td></tr></table></body></html>`;
}

async function customerContext(db: PrismaClient, shop: string, admin: AdminClient, ticketId: string) {
  const [ticket, settings] = await Promise.all([db.helpDeskTicket.findFirst({ where: { id: ticketId, shop } }), db.helpDeskSettings.findUnique({ where: { shop } })]);
  if (!ticket) return null;
  const store = await loadShop(admin);
  const storeName = store.name || shop;
  return {
    ticket, settings, storeName, url: trackingUrl(store.url, ticket.accessToken),
    first: ticket.name.trim().split(/\s+/)[0] || ticket.name,
    replyTo: settings?.notifyEmail || store.email || undefined,
  };
}

// Confirms a new ticket to the customer with its number and tracking link.
export async function sendAcknowledgement(db: PrismaClient, shop: string, admin: AdminClient, ticketId: string): Promise<SendResult> {
  const context = await customerContext(db, shop, admin, ticketId);
  if (!context || context.settings?.autoReply === false) return "skipped";
  const { ticket, storeName, url, first, replyTo } = context;
  const chat = ticket.channel === "chat";
  await transport().sendMail({
    from: sender(storeName),
    to: { name: ticket.name, address: ticket.email },
    replyTo,
    subject: `[#${ticket.number}] We've received your ${chat ? "message" : "request"}`,
    html: renderCustomerEmail({
      storeName, heading: `We've received your ${chat ? "message" : "request"} #${ticket.number}`,
      paragraphs: [`Hi ${first},`, chat
        ? `Thanks for chatting with ${storeName}. Our team will reply in the chat, and we'll email you too, so you don't need to keep the page open.`
        : `Thanks for contacting ${storeName}. Your request about "${ticket.topic}" is now with our support team, and we'll get back to you as soon as we can.`,
      "You can check the status of your request or add more information at any time."],
      buttonUrl: url, buttonLabel: "View your request", footer: `Ticket #${ticket.number} · Keep this email to find your request again.`,
    }),
    text: `Hi ${first},\n\nThanks for contacting ${storeName}. We've received your request #${ticket.number} and will get back to you soon.\n\nView your request: ${url}`,
  });
  return "sent";
}

// Emails a staff reply to the customer.
export async function sendReplyEmail(db: PrismaClient, shop: string, admin: AdminClient, messageId: string): Promise<SendResult> {
  const message = await db.helpDeskMessage.findFirst({ where: { id: messageId, kind: "reply", ticket: { shop } } });
  const context = message && await customerContext(db, shop, admin, message.ticketId);
  if (!message || !context) return "skipped";
  const { ticket, settings, storeName, url, replyTo } = context;
  const body = [message.body, settings?.signature?.trim()].filter(Boolean).join("\n\n");
  await transport().sendMail({
    from: sender(storeName),
    to: { name: ticket.name, address: ticket.email },
    replyTo,
    subject: `Re: [#${ticket.number}] ${ticket.topic}`,
    html: renderCustomerEmail({
      storeName, heading: `New reply on request #${ticket.number}`, paragraphs: [], quote: body,
      buttonUrl: url, buttonLabel: "View and reply", footer: `${message.author} replied to your request about "${ticket.topic}".\nReply from your request page so we see your message straight away.`,
    }),
    text: `${body}\n\n---\nView and reply to request #${ticket.number}: ${url}`,
  });
  await db.helpDeskMessage.update({ where: { id: message.id }, data: { emailed: true } });
  return "sent";
}

const STATUS_EMAIL: Record<string, { heading: string; text: string }> = {
  "In progress": { heading: "We're working on your request", text: "Our team has started working on your request. We'll update you as soon as there's news." },
  Resolved: { heading: "Your request has been resolved", text: "We've marked your request as resolved. If anything still isn't right, just reply on your request page and we'll pick it up again." },
};

// Tells the customer their ticket moved to In progress or Resolved.
export async function sendStatusEmail(db: PrismaClient, shop: string, admin: AdminClient, ticketId: string): Promise<SendResult> {
  const context = await customerContext(db, shop, admin, ticketId);
  const copy = context && STATUS_EMAIL[context.ticket.status];
  if (!context || !copy || context.settings?.statusEmails === false) return "skipped";
  const { ticket, storeName, url, first, replyTo } = context;
  await transport().sendMail({
    from: sender(storeName),
    to: { name: ticket.name, address: ticket.email },
    replyTo,
    subject: `[#${ticket.number}] ${copy.heading}`,
    html: renderCustomerEmail({
      storeName, heading: copy.heading, paragraphs: [`Hi ${first},`, copy.text],
      buttonUrl: url, buttonLabel: "View your request", footer: `Ticket #${ticket.number} · ${ticket.topic}`,
    }),
    text: `Hi ${first},\n\n${copy.text}\n\nView your request #${ticket.number}: ${url}`,
  });
  return "sent";
}

// What the customer is told at each step of an order cancellation request.
// order: "order #1001", or "the selected items on order #1001" (items: true).
const CANCEL_EMAIL: Record<string, { heading: (items: boolean) => string; text: (order: string, items: boolean) => string }> = {
  Approved: { heading: () => "Your cancellation request is approved", text: (order) => `Good news: we've approved your request to cancel ${order}. We're cancelling it now and will confirm once it's done.` },
  Rejected: { heading: () => "We couldn't cancel your order", text: (order) => `We've looked at your request to cancel ${order}, but unfortunately we're not able to cancel it.` },
  Cancelled: {
    heading: (items) => items ? "Items cancelled from your order" : "Your order has been cancelled",
    text: (order, items) => `${order[0].toUpperCase()}${order.slice(1)} ${items ? "have" : "has"} been cancelled. If a refund is due, it's on its way: refunds to a card usually take 5-10 business days to appear.`,
  },
};

// Tells the customer where their cancellation request stands.
export async function sendCancellationEmail(db: PrismaClient, shop: string, admin: AdminClient, ticketId: string): Promise<SendResult> {
  const context = await customerContext(db, shop, admin, ticketId);
  const copy = context && CANCEL_EMAIL[context.ticket.cancelStatus];
  if (!context || !copy) return "skipped";
  const { ticket, storeName, url, first, replyTo } = context;
  let details: Record<string, string> = {};
  try { details = JSON.parse(ticket.details) as Record<string, string>; } catch { /* no details */ }
  const orderNumber = ticket.orderName || details.orderNumber || "";
  const items = details.cancelScope === cancelScopes[1];
  const order = `${items ? "the selected items on " : ""}${orderNumber ? `order ${orderNumber}` : "your order"}`;
  const text = copy.text(order, items);
  const heading = copy.heading(items);
  await transport().sendMail({
    from: sender(storeName),
    to: { name: ticket.name, address: ticket.email },
    replyTo,
    subject: `[#${ticket.number}] ${heading}`,
    html: renderCustomerEmail({
      storeName, heading, paragraphs: [`Hi ${first},`, text], quote: ticket.cancelNote || undefined,
      buttonUrl: url, buttonLabel: "View your request", footer: `Ticket #${ticket.number} · Cancellation request`,
    }),
    text: `Hi ${first},\n\n${text}${ticket.cancelNote ? `\n\n${ticket.cancelNote}` : ""}\n\nView your request #${ticket.number}: ${url}`,
  });
  return "sent";
}

// What the customer is told about a missing part (help-desk-replacement.server.ts).
const REPLACEMENT_EMAIL: Record<string, { heading: string; text: (order: string) => string }> = {
  Approved: { heading: "Your replacement part is approved", text: (order) => `We've checked ${order} and approved a replacement for the missing part. We're arranging the shipment and will send you the tracking details as soon as it's on its way.` },
  Shipped: { heading: "Your replacement part is on its way", text: (order) => `The replacement part for ${order} has shipped. You can follow it with the tracking details below.` },
  Rejected: { heading: "We couldn't send a replacement part", text: (order) => `We've looked at your request about a missing part on ${order}, but unfortunately we're not able to send a replacement.` },
};

const LOST_EMAIL: Record<string, { heading: string; text: (order: string, solution: string) => string }> = {
  Approved: { heading: "Your lost package request is approved", text: (order, solution) => solution === "Refund"
    ? `We've checked the shipment of ${order} and approved a refund for the missing products. We'll confirm once it's done.`
    : `We've checked the shipment of ${order} and we'll send the missing products again. We'll share the tracking as soon as they ship.` },
  Shipped: { heading: "Next steps for your lost package", text: (order) => `Here are the next steps for the missing products from ${order}.` },
  Rejected: { heading: "About your lost package", text: (order) => `We've looked at your request about ${order}, but unfortunately we're not able to approve it.` },
};
const WARRANTY_EMAIL: Record<string, { heading: string; text: (order: string, solution: string) => string }> = {
  Approved: { heading: "Your warranty claim is approved", text: (order, solution) => `We've verified your purchase${order === "your order" ? "" : ` (${order})`} and your warranty claim is approved${solution ? `: ${solution.toLowerCase()}` : ""}. We'll send you the instructions and shipping details shortly.` },
  Shipped: { heading: "Next steps for your warranty claim", text: () => "Here are the next steps for your warranty claim." },
  Rejected: { heading: "We couldn't approve your warranty claim", text: () => "We've reviewed your warranty claim, but unfortunately it isn't covered by our warranty." },
};

// Tells the customer where their missing part stands, with the tracking once it ships.
export async function sendReplacementEmail(db: PrismaClient, shop: string, admin: AdminClient, ticketId: string): Promise<SendResult> {
  const context = await customerContext(db, shop, admin, ticketId);
  const warranty = context?.ticket.replacementKind === "warranty";
  const lost = context?.ticket.replacementKind === "lost";
  const found = context && (warranty ? WARRANTY_EMAIL : lost ? LOST_EMAIL : REPLACEMENT_EMAIL)[context.ticket.replacementStatus];
  if (!context || !found) return "skipped";
  const copy = { heading: found.heading, text: (order: string) => found.text(order, context.ticket.replacementSolution) };
  const { ticket, storeName, url, first, replyTo } = context;
  let values: Record<string, string> = {};
  try { values = JSON.parse(ticket.details) as Record<string, string>; } catch { /* no details */ }
  const order = ticket.orderName || values.orderNumber ? `order ${ticket.orderName || values.orderNumber}` : "your order";
  const text = copy.text(order);
  const tracking = ticket.replacementStatus === "Shipped" && ticket.replacementTracking
    ? [ticket.replacementCarrier && `Carrier: ${ticket.replacementCarrier}`, `Tracking number: ${ticket.replacementTracking}`, ticket.replacementTrackingUrl && `Track it: ${ticket.replacementTrackingUrl}`].filter(Boolean).join("\n") : "";
  const quote = [tracking, ticket.replacementNote].filter(Boolean).join("\n\n");
  await transport().sendMail({
    from: sender(storeName),
    to: { name: ticket.name, address: ticket.email },
    replyTo,
    subject: `[#${ticket.number}] ${copy.heading}`,
    html: renderCustomerEmail({
      storeName, heading: copy.heading, paragraphs: [`Hi ${first},`, text], quote: quote || undefined,
      buttonUrl: url, buttonLabel: "View your request", footer: `Ticket #${ticket.number} · ${warranty ? "Warranty claim" : lost ? "Lost package" : "Missing part"}`,
    }),
    text: `Hi ${first},\n\n${text}${quote ? `\n\n${quote}` : ""}\n\nView your request #${ticket.number}: ${url}`,
  });
  return "sent";
}

// Sends the customer their international shipping details, or says it isn't available.
export async function sendQuoteEmail(db: PrismaClient, shop: string, admin: AdminClient, ticketId: string): Promise<SendResult> {
  const context = await customerContext(db, shop, admin, ticketId);
  if (!context || !["Quoted", "Unavailable"].includes(context.ticket.quoteStatus)) return "skipped";
  const { ticket, storeName, url, first, replyTo } = context;
  const quoted = ticket.quoteStatus === "Quoted";
  const heading = quoted ? "Your international shipping details" : "We can't ship to your address";
  const text = quoted ? "We've checked product availability and shipping options for your address. Here are the details:"
    : "We've checked product availability and shipping options for your address, but unfortunately we're not able to ship these products there.";
  const details = quoted ? [ticket.quoteCarrier && `Carrier: ${ticket.quoteCarrier}`, `Estimated delivery: ${ticket.quoteDelivery}`, `Shipping cost: ${ticket.quoteShipping}`, `Taxes and duties: ${ticket.quoteTaxes}`].filter(Boolean).join("\n") : "";
  const quote = [details, ticket.quoteNote].filter(Boolean).join("\n\n");
  await transport().sendMail({
    from: sender(storeName),
    to: { name: ticket.name, address: ticket.email },
    replyTo,
    subject: `[#${ticket.number}] ${heading}`,
    html: renderCustomerEmail({
      storeName, heading, paragraphs: [`Hi ${first},`, text], quote: quote || undefined,
      buttonUrl: url, buttonLabel: "View your request", footer: `Ticket #${ticket.number} · International shipping`,
    }),
    text: `Hi ${first},\n\n${text}${quote ? `\n\n${quote}` : ""}\n\nView your request #${ticket.number}: ${url}`,
  });
  return "sent";
}

// Tells the customer whether their order was changed (help-desk-edit.server.ts).
export async function sendEditEmail(db: PrismaClient, shop: string, admin: AdminClient, ticketId: string): Promise<SendResult> {
  const context = await customerContext(db, shop, admin, ticketId);
  if (!context || !["Updated", "Rejected"].includes(context.ticket.editStatus)) return "skipped";
  const { ticket, storeName, url, first, replyTo } = context;
  let values: Record<string, string> = {};
  try { values = JSON.parse(ticket.details) as Record<string, string>; } catch { /* no details */ }
  const order = ticket.orderName || values.orderNumber ? `order ${ticket.orderName || values.orderNumber}` : "your order";
  const updated = ticket.editStatus === "Updated";
  const heading = updated ? "Your order has been updated" : "We couldn't change your order";
  const text = updated ? `We've updated ${order} with the changes you asked for. If there's a price difference, you'll receive a separate invoice or refund from us.`
    : `We looked at your request to change ${order}, but unfortunately we're not able to change it.`;
  await transport().sendMail({
    from: sender(storeName),
    to: { name: ticket.name, address: ticket.email },
    replyTo,
    subject: `[#${ticket.number}] ${heading}`,
    html: renderCustomerEmail({
      storeName, heading, paragraphs: [`Hi ${first},`, text], quote: ticket.editNote || undefined,
      buttonUrl: url, buttonLabel: "View your request", footer: `Ticket #${ticket.number} · Order change request`,
    }),
    text: `Hi ${first},\n\n${text}${ticket.editNote ? `\n\n${ticket.editNote}` : ""}\n\nView your request #${ticket.number}: ${url}`,
  });
  return "sent";
}

// What the customer is told at each step of a return (help-desk-return.server.ts).
const RETURN_EMAIL: Record<string, { heading: string; text: (order: string) => string }> = {
  "Label sent": {
    heading: "Your return is approved: here's your return label",
    text: (order) => `We've approved the return for ${order}. Your return label is attached and on your request page. Please print it, attach it to the package and send it to our warehouse. Once received, our team will inspect the product and proceed with your refund or exchange.`,
  },
  Received: { heading: "We've received your return", text: (order) => `Your return for ${order} has arrived at our warehouse and our team has inspected the product. We're now proceeding with your refund or exchange and will let you know.` },
  Rejected: { heading: "We couldn't accept your return", text: (order) => `We've looked at your return request for ${order}, but unfortunately it doesn't meet our return conditions.` },
};

// Tells the customer where their return stands; the label goes with the approval.
export async function sendReturnEmail(db: PrismaClient, shop: string, admin: AdminClient, ticketId: string): Promise<SendResult> {
  const context = await customerContext(db, shop, admin, ticketId);
  const copy = context && RETURN_EMAIL[context.ticket.returnStatus];
  if (!context || !copy) return "skipped";
  const { ticket, storeName, url, first, replyTo } = context;
  let values: Record<string, string> = {};
  try { values = JSON.parse(ticket.details) as Record<string, string>; } catch { /* no details */ }
  const order = ticket.orderName || values.orderNumber ? `order ${ticket.orderName || values.orderNumber}` : "your order";
  const label = ticket.returnStatus === "Label sent" && ticket.returnLabelId
    ? await db.helpDeskAttachment.findFirst({ where: { id: ticket.returnLabelId, ticketId }, select: { name: true, type: true, data: true } }) : null;
  const text = copy.text(order);
  await transport().sendMail({
    from: sender(storeName),
    to: { name: ticket.name, address: ticket.email },
    replyTo,
    subject: `[#${ticket.number}] ${copy.heading}`,
    html: renderCustomerEmail({
      storeName, heading: copy.heading, paragraphs: [`Hi ${first},`, text], quote: ticket.returnNote || undefined,
      buttonUrl: url, buttonLabel: "View your request", footer: `Ticket #${ticket.number} · Return request`,
    }),
    text: `Hi ${first},

${text}${ticket.returnNote ? `

${ticket.returnNote}` : ""}

View your request #${ticket.number}: ${url}`,
    ...(label ? { attachments: [{ filename: label.name, content: Buffer.from(label.data), contentType: label.type }] } : {}),
  });
  return "sent";
}

// Tells the customer whether their order's shipping address was changed.
export async function sendAddressEmail(db: PrismaClient, shop: string, admin: AdminClient, ticketId: string): Promise<SendResult> {
  const context = await customerContext(db, shop, admin, ticketId);
  if (!context || !["Updated", "Rejected"].includes(context.ticket.addressStatus)) return "skipped";
  const { ticket, storeName, url, first, replyTo } = context;
  let values: Record<string, string> = {};
  try { values = JSON.parse(ticket.details) as Record<string, string>; } catch { /* no details */ }
  const order = ticket.orderName || values.orderNumber ? `order ${ticket.orderName || values.orderNumber}` : "your order";
  const updated = ticket.addressStatus === "Updated";
  let applied: Partial<ShippingAddress> = {};
  try { applied = JSON.parse(ticket.addressApplied || "{}") as Partial<ShippingAddress>; } catch { /* none */ }
  const heading = updated ? "Your shipping address has been updated" : "We couldn't change your shipping address";
  const text = updated ? `We've updated the shipping address of ${order}. It will be delivered to:` : `We looked at your request to change the shipping address of ${order}, but unfortunately we're not able to change it.`;
  const quote = [updated ? addressLines(applied).join("\n") : "", ticket.addressNote].filter(Boolean).join("\n\n");
  await transport().sendMail({
    from: sender(storeName),
    to: { name: ticket.name, address: ticket.email },
    replyTo,
    subject: `[#${ticket.number}] ${heading}`,
    html: renderCustomerEmail({
      storeName, heading, paragraphs: [`Hi ${first},`, text], quote: quote || undefined,
      buttonUrl: url, buttonLabel: "View your request", footer: `Ticket #${ticket.number} · Address change request`,
    }),
    text: `Hi ${first},\n\n${text}${quote ? `\n\n${quote}` : ""}\n\nView your request #${ticket.number}: ${url}`,
  });
  return "sent";
}

// Tells the store a customer added a message to their ticket.
// handoff: the assistant on the request page couldn't answer, or the customer asked for a person.
export async function notifyCustomerReply(db: PrismaClient, shop: string, admin: AdminClient, messageId: string, handoff = false): Promise<SendResult> {
  const message = await db.helpDeskMessage.findFirst({ where: { id: messageId, kind: "customer", ticket: { shop } }, include: { ticket: true } });
  const recipient = message && await notificationRecipient(db, shop, admin);
  if (!message || !recipient?.to) return "skipped";
  const { ticket } = message;
  const storeName = recipient.store.name || shop;
  const adminUrl = ticketUrl(shop, ticket.id);
  await transport().sendMail({
    from: sender(storeName),
    to: recipient.to,
    replyTo: { name: ticket.name, address: ticket.email },
    subject: handoff ? `[#${ticket.number}] ${ticket.name} wants to talk to a person` : `Re: [#${ticket.number}] ${ticket.name} replied`,
    html: renderCustomerEmail({
      storeName, heading: handoff ? `${ticket.name} is waiting for a person on #${ticket.number}` : `${ticket.name} replied to #${ticket.number}`,
      paragraphs: handoff ? [`About: ${ticket.topic}`, "The assistant on their request page couldn't answer this, or they asked for a person. Please reply on the ticket."] : [`About: ${ticket.topic}`],
      quote: message.body, buttonUrl: adminUrl, buttonLabel: "Open ticket in Shopify", footer: `Ticket #${ticket.number} · ${ticket.email}`,
    }),
    text: `${ticket.name} ${handoff ? "wants to talk to a person on" : "replied to"} #${ticket.number}:\n\n${message.body}\n\nOpen ticket: ${adminUrl}`,
  });
  return "sent";
}

export async function sendTestEmail(shop: string, admin: AdminClient, to: string) {
  const store = await loadShop(admin);
  const storeName = store.name || shop;
  const values = { phone: "+1 555 0100", orderNumber: "#1001", issue: "Defective product received", details: "This is a sample request so you can preview Help Desk notifications." };
  await transport().sendMail({
    from: sender(storeName),
    to,
    subject: "Test: New Help Desk request",
    html: renderEmail({
      storeName, adminUrl: ticketUrl(shop, "test"), ticketId: "test", createdAt: new Date(), name: "Sample Customer", email: "customer@example.com",
      topic: "Returns & Exchanges", values, products: [], images: [], skippedImages: 0,
    }),
  });
}
