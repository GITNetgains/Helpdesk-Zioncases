import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ADDRESS_FIELDS, addressFromValues, cancelReasons, countries, PROVINCES, deliveryIssues, issueResolutions, issues, MAX_MESSAGE_LENGTH, purchasePlaces, orderTypes, productParts, topics, updates } from "../services/help-desk";
import { liveStamp, renderLookupPage, renderRequestPage } from "../services/help-desk-request-page";
import { formGroups } from "../services/help-desk-form";
import { addCustomerMessage, customerCanReply, MAX_REPLY_IMAGES, readHelpDeskForm, submitTicket } from "../services/help-desk.server";
import { checkOrderChange, conflictingRequest, customerOrders, issueItems, lookupTracking, productVariants, syncTicketOrder } from "../services/help-desk-orders.server";
import { memo } from "../services/memo.server";
import { cachedProducts, loadProducts } from "../services/help-desk-email.server";
import { ensureWorker, queueEmail } from "../services/help-desk-outbox.server";
import { loadShippingSetup, lookupShipping } from "../services/help-desk-shipping.server";
import { SHIPPING_TIMES_COUNTRIES } from "../services/help-desk-shipping";
import { queueTicketScans } from "../services/image-scan/scan.server";
import { blocked, clear, clientKey, hit } from "../services/rate-limit.server";

const headers = { "Cache-Control": "no-store" };
const privateHeaders = { "Cache-Control": "private, no-store" };
const TOKEN = /^[a-f0-9]{48}$/;
const MINUTE = 60_000;
// Customer-visible message kinds; internal notes and the activity log stay private.
const PUBLIC_KINDS = ["customer", "reply", "bot"];

// Records that the storefront form loaded, at most every 10 minutes, so the
// admin can tell whether it's live on the store.
async function markSeen(shop: string, field: "formLastSeenAt") {
  const stale = new Date(Date.now() - 10 * MINUTE);
  try {
    const { count } = await db.helpDeskSettings.updateMany({ where: { shop, OR: [{ [field]: null }, { [field]: { lt: stale } }] }, data: { [field]: new Date() } });
    if (!count && !await db.helpDeskSettings.findUnique({ where: { shop }, select: { shop: true } })) {
      await db.helpDeskSettings.create({ data: { shop, [field]: new Date() } });
    }
  } catch (error) {
    console.error(`Help Desk could not record ${field} for ${shop}:`, error);
  }
}

const json = (body: unknown, status = 200, extra: HeadersInit = headers) => Response.json(body, { status, headers: extra });
const tooMany = () => json({ errors: { form: "Too many requests. Please wait a minute and try again." } }, 429);
const files = (form: FormData, key = "images") => form.getAll(key).filter((value): value is File => typeof value !== "string" && Boolean(value.name));

// Only Shopify-signed proxy requests from an installed store reach these
// endpoints, and the shop always comes from the signature, never the request.
export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session) return json({ error: "Help desk is unavailable." }, 403);
  const { shop } = session;
  ensureWorker(db);
  const params = new URL(request.url).searchParams;
  // Signed by Shopify, so this is the shopper's own customer ID (empty when logged out).
  const customerId = params.get("logged_in_customer_id") || "";

  // Self-service order tracking from the form: answered without a ticket.
  if (params.get("track")) return track(admin, params.get("order") || "", params.get("email") || "", clientKey(request, shop));
  // Shipping Times: rates and delivery times for a destination, and optionally the customer's own order.
  if (params.get("shipping")) return shipping(shop, admin, params, clientKey(request, shop));
  // Before a cancellation or address change opens: can this order still be changed?
  const check = params.get("check");
  // Product issues: the order's items, to pick the one with the problem.
  if (check === "items") return orderItems(admin, params.get("order") || "", params.get("email") || "", clientKey(request, shop));
  // Wrong colour or size: the product's variants, to pick the one they wanted.
  if (check === "variants") return variants(shop, admin, params.get("product") || "", clientKey(request, shop));
  if (check === "cancel" || check === "address") return orderCheck(shop, admin, check, params.get("order") || "", params.get("email") || "", clientKey(request, shop));

  const token = params.get("ticket");
  if (token !== null && params.get("pulse")) return pulse(shop, token, clientKey(request, shop));
  // live: the open page's own refresh, just the request's HTML without the theme around it.
  if (token !== null) return trackingPage(shop, admin, token, {}, params.get("live") === "1");

  void markSeen(shop, "formLastSeenAt");
  const [orders, tickets, shippingSetup] = await Promise.all([
    customerOrders(admin, customerId),
    /^\d+$/.test(customerId) ? db.helpDeskTicket.findMany({
      where: { shop, customerId }, orderBy: { createdAt: "desc" }, take: 20,
      select: { number: true, topic: true, status: true, cancelStatus: true, addressStatus: true, createdAt: true, lastActivityAt: true, accessToken: true },
    }) : null,
    // Where the store ships from, so Domestic and International Shipping offer the right countries.
    loadShippingSetup(admin, shop).catch(() => undefined),
  ]);
  return json({
    home: shippingSetup?.home || "US", shippingCountries: SHIPPING_TIMES_COUNTRIES, countries, issues, orderTypes, topics, updates, deliveryIssues, productParts, cancelReasons, issueResolutions, purchasePlaces, provinces: PROVINCES, groups: formGroups, orders,
    tickets: tickets && tickets.map(({ accessToken, lastActivityAt, ...ticket }) => ({ ...ticket, updatedAt: lastActivityAt ?? ticket.createdAt, token: accessToken })),
  }, 200, privateHeaders);
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session) return json({ errors: { form: "Help desk is unavailable." } }, 403);
  if (request.method !== "POST") return json({ errors: { form: "Method not allowed." } }, 405);
  const { shop } = session;
  const client = clientKey(request, shop);
  const customerId = new URL(request.url).searchParams.get("logged_in_customer_id") || "";
  const wantsJson = request.headers.get("Accept")?.includes("application/json");
  let form: FormData;
  try { form = await readHelpDeskForm(request); }
  catch { return json({ errors: { form: "Could not read your request. Upload up to five images of 10 MB each." } }, 400); }
  if (form.get("website")) return json({ errors: { form: "Unable to submit this request." } }, 400);
  const text = (key: string) => String(form.get(key) ?? "");

  switch (form.get("intent")) {
    // A reply on the customer's own ticket, identified by its secret token.
    case "reply": {
      const token = text("token");
      if (!hit(`reply|${client}`, 10, MINUTE)) return wantsJson ? tooMany() : trackingPage(shop, admin, token, { error: "Too many messages. Please wait a minute.", draft: text("body") });
      try {
        const result = await addCustomerMessage(db, shop, token, text("body"), files(form), files(form, "videos"));
        if (result.messageId && result.ticketId) {
          queueEmail(db, { shop, ticketId: result.ticketId, kind: "customer-reply", messageId: result.messageId }, admin);
          void queueTicketScans(db, result.ticketId, result.messageId);
        }
        if (wantsJson) return json(result, result.messageId ? 200 : 400);
        return trackingPage(shop, admin, token, result.messageId ? { sent: true } : { error: Object.values(result.errors)[0], draft: text("body") });
      } catch {
        if (wantsJson) return json({ errors: { form: "Your message could not be sent. Please try again." } }, 500);
        return trackingPage(shop, admin, token, { error: "Your message could not be sent. Please try again.", draft: text("body") });
      }
    }
    // Lost the link? Ticket number plus the email it was opened with finds it.
    case "lookup": {
      const key = `lookup-miss|${client}`;
      if (blocked(key, 5) || !hit(`lookup|${client}`, 10, MINUTE)) return lookupPage({ error: "Too many attempts. Please try again in 15 minutes." }, 429);
      const number = Number(text("number").replace(/^#/, "").trim());
      const email = text("email").trim().toLowerCase();
      const ticket = Number.isInteger(number) && number > 0 && email
        ? await db.helpDeskTicket.findFirst({ where: { shop, number }, select: { email: true, accessToken: true } }) : null;
      if (!ticket || ticket.email.toLowerCase() !== email) {
        hit(key, 5, 15 * MINUTE);
        return lookupPage({ error: "We couldn't find a request with that number and email.", number: text("number"), email: text("email") }, 404);
      }
      clear(key);
      return trackingPage(shop, admin, ticket.accessToken);
    }
    case null:
    case undefined:
      break;
    // A customer cannot update ticket statuses or choose the store owning a ticket.
    default:
      return json({ errors: { form: "Invalid request." } }, 400);
  }

  if (!hit(`ticket|${client}`, 5, MINUTE)) return tooMany();
  try {
    const refused = await refuseChange(shop, admin, form);
    if (refused) return refused;
    const result = await submitTicket(db, shop, form, customerId);
    if (result.created && result.ticketId) {
      queueEmail(db, { shop, ticketId: result.ticketId, kind: "new-ticket" }, admin);
      queueEmail(db, { shop, ticketId: result.ticketId, kind: "ack" }, admin);
      // Photos are checked for AI generation and reuse in the background.
      void queueTicketScans(db, result.ticketId);
      // The order and its tracking are attached in the background too. A
      // just-placed order may not be in Shopify's search yet, so try again shortly.
      const ticketId = result.ticketId;
      void (async () => {
        for (const delay of [0, 10_000, 30_000, 90_000]) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          if (await syncTicketOrder(db, admin, ticketId) !== null) return;
        }
      })().catch((error) => console.error(`Help Desk could not attach the order to ticket ${ticketId}:`, error));
    }
    return json(result, Object.keys(result.errors).length ? 400 : 200);
  } catch {
    return json({ errors: { form: "Your request could not be saved. Please try again." } }, 500);
  }
}

// "Check order status" on the form. The order number and email must match, and
// misses are limited, so order numbers can't be tried one after another.
// Every answer is a 200 with an error message: Shopify's app proxy can replace
// error responses with its own page, which the form couldn't read.
async function track(admin: Parameters<typeof lookupTracking>[0], order: string, email: string, client: string) {
  const misses = `track-miss|${client}`;
  if (blocked(misses, 5) || !hit(`track|${client}`, 10, MINUTE)) return json({ error: "Too many attempts. Please try again in 15 minutes." }, 200, privateHeaders);
  const tracking = await lookupTracking(admin, order.slice(0, 40), email.slice(0, 200));
  if (tracking === undefined) return json({ error: "Order status is unavailable right now. Please submit a request below." }, 200, privateHeaders);
  if (!tracking) {
    hit(misses, 5, 15 * MINUTE);
    return json({ error: "We couldn't find an order with that number and email. Please check both, or submit a request below." }, 200, privateHeaders);
  }
  clear(misses);
  return json({ tracking }, 200, privateHeaders);
}

// "Check Shipping Times" on the form. The destination needs nothing else; an
// order number is only answered with the email it was placed with, and misses
// count toward the same lockout as tracking.
async function shipping(shop: string, admin: Parameters<typeof lookupTracking>[0], params: URLSearchParams, client: string) {
  const misses = `track-miss|${client}`;
  if (!hit(`shipping|${client}`, 20, MINUTE)) return json({ error: "Too many attempts. Please wait a minute and try again." }, 200, privateHeaders);
  const country = (params.get("country") || "").toUpperCase();
  if (!countries.some((entry) => entry.code === country)) return json({ error: "Select the country we're shipping to." }, 200, privateHeaders);
  const province = (params.get("province") || "").toUpperCase().slice(0, 10);
  let orderNumber = (params.get("order") || "").slice(0, 40);
  const email = (params.get("email") || "").slice(0, 200);
  // Locked out of order lookups: still answer for the destination.
  const locked = Boolean(orderNumber) && blocked(misses, 5);
  if (locked) orderNumber = "";
  // The customer's products and address, for Shopify's exact rates.
  const products = (params.get("products") || "").split(",").filter((id) => /^gid:\/\/shopify\/Product\/\d+$/.test(id)).slice(0, 10);
  const part = (key: string) => (params.get(key) || "").trim().slice(0, 100);
  const result = await lookupShipping(db, admin, shop, { country, province, orderNumber, email, ...(products.length ? { products, city: part("city"), zip: part("zip"), address1: part("address1") } : {}) });
  if ("error" in result) return json({ error: "Shipping times are unavailable right now. Please send us your question below." }, 200, privateHeaders);
  if (result.orderError === "notFound") hit(misses, 5, 15 * MINUTE);
  else if (result.order) clear(misses);
  const orderError = locked ? "Too many attempts. Please try again in 15 minutes."
    : result.orderError === "notFound" ? "We couldn't find an order with that number and email, so these are our general shipping times."
      : result.orderError ? "We couldn't check your order right now, so these are our general shipping times." : undefined;
  return json({ shipping: result.answer, order: result.order ?? null, ...(orderError ? { orderError } : {}) }, 200, privateHeaders);
}

// "Continue" on a product issue: the order's items, so the customer picks the
// one with the problem. Same limits as tracking: number and email must match.
async function orderItems(admin: Parameters<typeof lookupTracking>[0], order: string, email: string, client: string) {
  const misses = `track-miss|${client}`;
  if (blocked(misses, 5) || !hit(`track|${client}`, 10, MINUTE)) return json({ error: "Too many attempts. Please try again in 15 minutes." }, 200, privateHeaders);
  const found = await issueItems(admin, order.slice(0, 40), email.slice(0, 200));
  if (found === undefined) return json({ error: "We couldn't check your order right now.", unavailable: true }, 200, privateHeaders);
  if (!found) {
    hit(misses, 5, 15 * MINUTE);
    return json({ error: "We couldn't find an order with that number and email. Please check both.", notFound: true }, 200, privateHeaders);
  }
  clear(misses);
  return json({ found }, 200, privateHeaders);
}

// A product's variants, for "Wrong colour or size". Public store data, cached
// a few minutes and rate limited like the other lookups.
async function variants(shop: string, admin: Parameters<typeof lookupTracking>[0], product: string, client: string) {
  if (!hit(`variants|${client}`, 30, MINUTE)) return json({ error: "Too many attempts. Please wait a minute and try again." }, 200, privateHeaders);
  const list = await memo(`variants|${shop}|${product}`, 5 * MINUTE, async () => {
    const found = await productVariants(admin, product);
    if (found === undefined) throw new Error("unavailable");
    return found;
  }).catch(() => undefined);
  return json(list === undefined ? { unavailable: true } : { variants: list }, 200, privateHeaders);
}

// "Continue" on Cancel Order and Modify Address. Same limits as the tracking
// check: the number and email must match, and misses are counted.
async function orderCheck(shop: string, admin: Parameters<typeof lookupTracking>[0], kind: "cancel" | "address", order: string, email: string, client: string) {
  const misses = `track-miss|${client}`;
  if (blocked(misses, 5) || !hit(`track|${client}`, 10, MINUTE)) return json({ error: "Too many attempts. Please try again in 15 minutes." }, 200, privateHeaders);
  const answer = await checkOrderChange(admin, kind, order.slice(0, 40), email.slice(0, 200));
  if (answer === undefined) return json({ error: "We couldn't check your order right now. Please try again in a moment." }, 200, privateHeaders);
  if (!answer.allowed) {
    if (answer.notFound) hit(misses, 5, 15 * MINUTE);
    return json({ error: answer.error }, 200, privateHeaders);
  }
  clear(misses);
  const conflict = await conflictingRequest(db, shop, kind, answer);
  if (conflict) return json({ error: conflict }, 200, privateHeaders);
  return json({ allowed: true, country: answer.country }, 200, privateHeaders);
}

// The same checks again when the request is sent, so a request made without
// the form, or for an order that shipped meanwhile, is refused. Only when
// Shopify can't be reached does the request go through, for the team to check.
async function refuseChange(shop: string, admin: Parameters<typeof lookupTracking>[0], form: FormData) {
  const value = (key: string) => String(form.get(key) ?? "").trim();
  const kind = value("orderType") === orderTypes[0] ? (value("update") === updates[2] ? "cancel" : value("update") === updates[1] ? "address" : null) : null;
  if (!kind || value("topic") !== topics[3] || !value("orderNumber")) return null;
  // A retried submission returns the request it already created.
  if (value("requestKey") && await db.helpDeskTicket.findUnique({ where: { shop_requestKey: { shop, requestKey: value("requestKey") } }, select: { id: true } })) return null;
  const values = Object.fromEntries(ADDRESS_FIELDS.map((key) => [key, value(key)]));
  const answer = await checkOrderChange(admin, kind, value("orderNumber").slice(0, 40), value("email").slice(0, 200), kind === "address" ? { ...addressFromValues(values), country: value("shipCountry").toUpperCase() } : undefined);
  if (!answer) return null;
  const error = answer.allowed ? await conflictingRequest(db, shop, kind, answer) : answer.error;
  return error ? json({ errors: { orderNumber: error } }, 400) : null;
}

// The open request page asks every few seconds whether anything the customer
// can see has changed, so new replies appear like a chat. Only public messages
// count: an internal note never shows up as activity.
async function pulse(shop: string, token: string, client: string) {
  // The page asks every second (60 a minute), plus on focus.
  if (!hit(`pulse|${client}`, 120, MINUTE)) return json({ error: "Too many requests." }, 429);
  const ticket = TOKEN.test(token) ? await db.helpDeskTicket.findFirst({
    where: { shop, accessToken: token },
    select: {
      status: true, allowPhotos: true, allowVideos: true, cancelStatus: true, addressStatus: true, _count: { select: { messages: { where: { kind: { in: PUBLIC_KINDS } } } } },
      messages: { where: { kind: { in: PUBLIC_KINDS } }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
    },
  }) : null;
  if (!ticket) return json({ error: "Not found." }, 404);
  return json({ stamp: liveStamp(ticket.status, ticket._count.messages, ticket.messages[0]?.id, ticket.allowPhotos, `${ticket.cancelStatus ?? ""}${ticket.addressStatus ? `|${ticket.addressStatus}` : ""}`, ticket.allowVideos) }, 200, privateHeaders);
}

const liquid = (html: string, status = 200) => new Response(html, { status, headers: { ...privateHeaders, "Content-Type": "application/liquid" } });

// Finding a request without its link: ticket number plus email.
const lookupPage = (state: { error?: string; number?: string; email?: string } = {}, status = 200) => liquid(renderLookupPage(state), status);

// The customer's private request page.
type AdminClient = Parameters<typeof loadProducts>[0];
const productIds = (value: string) => { try { const ids = JSON.parse(value); return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []; } catch { return []; } };

async function trackingPage(shop: string, admin: AdminClient | undefined, token: string, state: { sent?: boolean; error?: string; draft?: string } = {}, live = false) {
  if (!token) return lookupPage();
  const ticket = TOKEN.test(token) ? await db.helpDeskTicket.findFirst({
    where: { shop, accessToken: token },
    include: { messages: { where: { kind: { in: PUBLIC_KINDS } }, orderBy: { createdAt: "asc" } }, attachments: { select: { messageId: true, type: true } } },
  }) : null;
  if (!ticket) return lookupPage({ error: "This link is not valid or the request no longer exists. You can look it up with its number instead." }, 404);
  const imageCounts = new Map<string, number>();
  let requestImages = 0;
  for (const file of ticket.attachments) {
    if (file.messageId) imageCounts.set(file.messageId, (imageCounts.get(file.messageId) ?? 0) + 1);
    else requestImages++;
  }
  // Product names and pictures for shipping and wrong-item requests, and the
  // order's tracking, refreshed from Shopify when it's more than 30 minutes old.
  // (Not on a live refresh: that's for new messages, and has to be quick.)
  const stale = !live && (!ticket.orderSyncedAt || Date.now() - ticket.orderSyncedAt.getTime() > 30 * MINUTE);
  const [products, receivedProducts] = admin
    ? await Promise.all([
      cachedProducts(admin, shop, productIds(ticket.products)), cachedProducts(admin, shop, productIds(ticket.receivedProducts)),
      stale ? syncTicketOrder(db, admin, ticket.id).catch(() => undefined) : null,
    ])
    : [[], []];
  const order = stale && admin ? await db.helpDeskTicket.findUnique({ where: { id: ticket.id } }) ?? ticket : ticket;
  const shipment = order.orderVerified
    ? { order: order.orderName, status: order.shipmentStatus, carrier: order.carrier, number: order.trackingNumber, url: order.trackingUrl } : null;
  const html = renderRequestPage(ticket, {
    imageCounts, requestImages, products, receivedProducts, shipment, canReply: customerCanReply(ticket), maxImages: MAX_REPLY_IMAGES, maxLength: MAX_MESSAGE_LENGTH, state,
  });
  // Plain HTML is passed through as it is, skipping Shopify's render of the whole theme.
  return live ? new Response(html, { headers: { ...privateHeaders, "Content-Type": "text/html; charset=utf-8" } }) : liquid(html);
}
