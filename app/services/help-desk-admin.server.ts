import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import type { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { countryName, defaultMacros, suggestTags, MAX_MESSAGE_LENGTH, priorities, ticketStatuses } from "./help-desk";
import { addStaffMessage, classifyUnsorted, deleteTickets, readHelpDeskForm, submitTicket, updateTickets } from "./help-desk.server";
import { categoryNames, rootCauses, subcategoriesOf } from "./help-desk-taxonomy";
import { cachedProducts, emailConfigured, loadProducts, loadShop, sendTestEmail, trackingUrl } from "./help-desk-email.server";
import { ordersByEmail, syncTicketOrder } from "./help-desk-orders.server";
import { cancelOrderInShopify, decideCancellation } from "./help-desk-cancel.server";
import { rejectAddressChange, updateAddressInShopify } from "./help-desk-address.server";
import { DETECTOR_MODES, rescanMissingKeyScans, scanImage, serializeScan } from "./image-scan/scan.server";
import { PROVIDERS, verifyCredentials } from "./image-scan/detector.server";
import { ensureWorker, queueEmail, retryEmail } from "./help-desk-outbox.server";
import { assignableTeam, listStaff, recordStaff } from "./help-desk-staff.server";
import { loadDashboard } from "./help-desk-dashboard.server";
import { DASHBOARD_RANGES, type DashboardRange } from "./help-desk-dashboard";
import { PAGE_SIZE, PERIODS, SORTS, TOPICS, VIEWS, type View } from "./help-desk-views";
import { forget, memo } from "./memo.server";
import { forgetShippingSetup, loadShippingSetup } from "./help-desk-shipping.server";
import { parseDays, readShippingSettings } from "./help-desk-shipping";
import { listShipStationStores, shipStationAccount, shipStationStatus } from "./help-desk-shipstation.server";
import { checkPlacesKey } from "./help-desk-places.server";
import type { ShipStationStatus } from "./help-desk";

// Server side of the Help Desk admin: one loader per screen (inbox, overview,
// ticket, settings) and the action every screen posts to.

// Staff status changes that email the customer (when turned on in settings).
const STATUS_EMAIL_STATUSES = ["In progress", "Resolved"];
const MINUTE = 60_000;
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const headers = { "Cache-Control": "private, no-store" };

const parseJson = <T,>(value: string, fallback: T): T => { try { return JSON.parse(value) as T; } catch { return fallback; } };
const teamList = (team: string | undefined) => [...new Set((team || "").split(",").map((name) => name.trim()).filter(Boolean))];
const pick = <T extends string>(value: string | null, options: readonly T[]) => (options as readonly string[]).includes(value || "") ? value as T : "";

// New stores get a starter set of saved replies once.
async function ensureMacros(shop: string) {
  const settings = await db.helpDeskSettings.findUnique({ where: { shop } });
  if (settings) return settings;
  if (!await db.helpDeskMacro.count({ where: { shop } })) await db.helpDeskMacro.createMany({ data: defaultMacros.map((macro) => ({ shop, ...macro })) });
  return db.helpDeskSettings.upsert({ where: { shop }, update: {}, create: { shop } });
}

// What every screen needs: the signed-in staff member, the shop's settings and team.
export async function adminContext(request: Request) {
  const { admin, session, redirect } = await authenticate.admin(request);
  const { shop } = session;
  ensureWorker(db);
  const settings = await ensureMacros(shop);
  // Whoever is using the app is recorded as staff, so tickets can be assigned to them.
  const me = await recordStaff(db, shop, session.onlineAccessInfo?.associated_user);
  const staff = await listStaff(db, shop);
  const team = assignableTeam(staff, teamList(settings.team));
  return { admin, shop, settings, staff, redirect, base: { configured: emailConfigured(), team, me } };
}
type Context = Awaited<ReturnType<typeof adminContext>>;

// What the setup checklist shows on the inbox and the overview.
function setupStatus(settings: Context["settings"]) {
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    formLastSeenAt: settings.formLastSeenAt, signature: Boolean(settings.signature), aiEnabled: settings.aiDetectionEnabled,
    detectorConnected: settings.aiDetectionProvider === "truthscan" ? Boolean(settings.truthscanKey) : Boolean(settings.sightengineUser && settings.sightengineSecret),
  };
}

export async function loadSettings({ admin, shop, settings, staff, base }: Context) {
  const [macros, store, shippingSetup, shipStationStores] = await Promise.all([
    db.helpDeskMacro.findMany({ where: { shop }, orderBy: { createdAt: "asc" } }),
    loadShop(admin).catch(() => ({ name: "", email: "", url: "" })),
    loadShippingSetup(admin, shop),
    // The account's stores, to choose from (null: the saved keys stopped working; undefined: not asked).
    settings.shipstationKey && settings.shipstationSecret
      ? memo(shipStationStoresKey(shop), 10 * MINUTE, () => listShipStationStores(settings.shipstationKey, settings.shipstationSecret).catch(() => undefined))
      : Promise.resolve(undefined),
  ]);
  return data({
    ...base, macros: macros.map(({ id, title, body, category, subcategory }) => ({ id, title, body, category, subcategory })), storeEmail: store.email, staff,
    storefront: { apiKey: process.env.SHOPIFY_API_KEY || "", formLastSeenAt: settings.formLastSeenAt, hasPlacesKey: Boolean(settings.googlePlacesKey) },
    settings: { notify: settings.notify, notifyEmail: settings.notifyEmail, autoReply: settings.autoReply, statusEmails: settings.statusEmails, signature: settings.signature, team: settings.team },
    // Secrets never go to the browser, only whether they're saved.
    ai: {
      enabled: settings.aiDetectionEnabled, mode: settings.aiDetectorMode, provider: settings.aiDetectionProvider,
      sightengineUser: settings.sightengineUser, hasSightengineSecret: Boolean(settings.sightengineSecret), hasTruthscanKey: Boolean(settings.truthscanKey),
    },
    shipStation: {
      hasKeys: Boolean(settings.shipstationKey && settings.shipstationSecret), storeId: settings.shipstationStoreId,
      stores: shipStationStores ?? [], keysWork: shipStationStores !== null, reachable: shipStationStores !== undefined,
    },
    // Shipping Times: the store's zones and rates from Shopify (null: read_shipping
    // not granted yet; undefined: Shopify couldn't be asked) and what the store set.
    shipping: { setup: shippingSetup ?? null, access: shippingSetup !== null, times: readShippingSettings(settings.shippingTimes) },
  }, { headers });
}

// The ticket's order and the customer's recent orders, cached briefly while the ticket is open.
const ticketOrderKey = (shop: string, ticketId: string) => `order|${shop}|${ticketId}`;
const emailOrdersKey = (shop: string, email: string) => `email-orders|${shop}|${email}`;
const shipStationKey = (shop: string, ticketId: string) => `shipstation|${shop}|${ticketId}`;
const shipStationStoresKey = (shop: string) => `shipstation-stores|${shop}`;
export function forgetTicketOrder(shop: string, ticketId: string, ticket?: { email: string } | null) {
  forget(ticketOrderKey(shop, ticketId));
  forget(shipStationKey(shop, ticketId));
  if (ticket) forget(emailOrdersKey(shop, ticket.email));
}

export async function loadTicket({ admin, shop, settings, base, redirect }: Context, ticketId: string) {
  // Deleted, or another store's ticket.
  const owned = await db.helpDeskTicket.findFirst({ where: { id: ticketId, shop }, select: { id: true } });
  if (!owned) throw redirect("/app/help-desk");
  // The order with live tracking first: it can also correct the sub-category
  // (say, "where is my order?" for one Shopify shows as delivered). The open
  // ticket reloads as messages arrive, so Shopify lookups are reused briefly.
  const liveOrder = await memo(ticketOrderKey(shop, owned.id), 2 * MINUTE, () => syncTicketOrder(db, admin, owned.id));
  const ticket = await db.helpDeskTicket.findFirst({
    where: { id: ticketId, shop },
    include: {
      attachments: { select: { id: true, name: true, type: true, messageId: true, productId: true, scan: true } }, messages: { orderBy: { createdAt: "asc" } },
      emails: { orderBy: { createdAt: "asc" }, select: { id: true, kind: true, messageId: true, status: true, attempts: true, lastError: true, sentAt: true, createdAt: true } },
    },
  });
  if (!ticket) throw redirect("/app/help-desk");
  // Messages after the previous visit are marked new, like an unread divider.
  const readAt = ticket.staffReadAt;
  await db.helpDeskTicket.update({ where: { id: ticket.id }, data: { unread: false, staffReadAt: new Date() } });
  const values = parseJson<Record<string, string>>(ticket.details, {});
  const [products, receivedProducts, others, orders, macros, store, usedTags] = await Promise.all([
    cachedProducts(admin, shop, parseJson<string[]>(ticket.products, [])),
    cachedProducts(admin, shop, parseJson<string[]>(ticket.receivedProducts, [])),
    db.helpDeskTicket.findMany({
      where: { shop, email: ticket.email, id: { not: ticket.id } }, orderBy: { createdAt: "desc" }, take: 10,
      select: { id: true, number: true, topic: true, status: true, createdAt: true },
    }),
    memo(emailOrdersKey(shop, ticket.email), 2 * MINUTE, () => ordersByEmail(admin, ticket.email)),
    db.helpDeskMacro.findMany({ where: { shop }, orderBy: { createdAt: "asc" }, select: { id: true, title: true, body: true, category: true, subcategory: true } }),
    memo(`shop|${shop}`, 30 * MINUTE, () => loadShop(admin)).catch(() => ({ name: "", email: "", url: "" })),
    // Recent tags across the store, for suggestions on the Tags field.
    db.helpDeskTicket.findMany({ where: { shop, tags: { not: "" } }, orderBy: { updatedAt: "desc" }, take: 300, select: { tags: true } }),
  ]);
  const { accessToken, details, id, number, name, email, topic, status, priority, assignee, tags, category, subcategory, rootCause, resolutionType, customerId, channel, createdAt, firstResponseAt, resolvedAt, allowPhotos, allowVideos, cancelStatus, cancelNote, cancelDecidedBy, cancelDecidedAt,
    addressStatus, addressNote, addressApplied, addressDecidedBy, addressDecidedAt, attachments, messages, emails } = ticket;
  const files = attachments.map(({ scan, ...file }) => ({ ...file, scan: serializeScan(scan) }));
  // An open address change: has ShipStation bought a label for the old address? null: not asked.
  const account = shipStationAccount(settings);
  const asksShipStation = ["Pending", "Rejected"].includes(addressStatus) || ["Pending", "Approved", "Rejected"].includes(ticket.cancelStatus);
  const shipStation: ShipStationStatus | null = !asksShipStation || !liveOrder || liveOrder.cancelled ? null
    : !account ? { state: "off" }
    : await memo(shipStationKey(shop, id), 2 * MINUTE, async () => { const status = await shipStationStatus(account, liveOrder); return status.state === "error" ? undefined : status; }) ?? { state: "error" };
  const rest = {
    id, number, name, email, topic, status, priority, assignee, tags, category, subcategory, rootCause, resolutionType, customerId, channel, createdAt, firstResponseAt, resolvedAt, allowPhotos, allowVideos,
    cancelStatus, cancelNote, cancelDecidedBy, cancelDecidedAt, attachments: files, messages, emails, readAt,
    addressStatus, addressNote, addressApplied: parseJson<Record<string, string> | null>(addressApplied || "null", null), addressDecidedBy, addressDecidedAt,
  };
  return data({
    ...base, macros, others, orders, storeName: store.name || shop,
    // order: the ticket's order (null: not found, or no order number). orderError: Shopify couldn't be reached.
    order: liveOrder ?? null, orderError: liveOrder === undefined, shipStation, orderNumber: values.orderNumber || "", orderVerified: ticket.orderVerified,
    trackingUrl: store.url ? trackingUrl(store.url, accessToken) : "",
    ticket: { ...rest, details: parseJson<Record<string, string>>(details, {}), products, receivedProducts },
    tagSuggestions: suggestTags({ topic, tags, details: parseJson<Record<string, string>>(details, {}) }, usedTags.map((row) => row.tags)),
  }, { headers });
}

export async function loadInbox({ shop, settings, base }: Context, url: URL) {
  // Tickets from before classification existed, or with a renamed category, get sorted on the next visit.
  await classifyUnsorted(db, shop);
  const page = Math.floor(Math.max(1, Math.min(100000, Number(url.searchParams.get("page")) || 1)));
  // Older links filter by status; they map onto the matching view.
  const legacyStatus = pick(url.searchParams.get("status"), ticketStatuses);
  const view: View = Object.prototype.hasOwnProperty.call(VIEWS, url.searchParams.get("view") || "") ? url.searchParams.get("view") as View
    : legacyStatus === "Resolved" ? "resolved" : legacyStatus === "Waiting on customer" ? "waiting" : "open";
  const topic = pick(url.searchParams.get("topic"), TOPICS);
  const priority = pick(url.searchParams.get("priority"), priorities);
  const category = pick(url.searchParams.get("category"), categoryNames);
  const subcategory = category ? pick(url.searchParams.get("subcategory"), subcategoriesOf(category)) : "";
  const rootCause = pick(url.searchParams.get("rootCause"), rootCauses);
  const assignee = (url.searchParams.get("assignee") || "").slice(0, 80);
  const sort = Object.prototype.hasOwnProperty.call(SORTS, url.searchParams.get("sort") || "activity") ? (url.searchParams.get("sort") || "activity") as keyof typeof SORTS : "activity";
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const period = Object.prototype.hasOwnProperty.call(PERIODS, url.searchParams.get("period") || "") ? (url.searchParams.get("period") || "") as keyof typeof PERIODS : "";
  const since = period === "today" ? new Date(new Date().setHours(0, 0, 0, 0)) : period ? new Date(Date.now() - Number(period) * DAY) : null;
  const number = /^#?\d{1,9}$/.test(q) ? Number(q.replace("#", "")) : null;
  const where: Prisma.HelpDeskTicketWhereInput = {
    shop, ...VIEWS[view].where,
    ...(topic ? { topic } : {}),
    ...(priority ? { priority } : {}),
    ...(category ? { category } : {}),
    ...(subcategory ? { subcategory } : {}),
    ...(rootCause ? { rootCause } : {}),
    ...(assignee ? { assignee } : {}),
    ...(since ? { createdAt: { gte: since } } : {}),
    // details holds every submitted field, so this also matches order numbers and messages.
    ...(q ? { OR: [{ id: q }, ...(number !== null ? [{ number }] : []), { name: { contains: q } }, { email: { contains: q } }, { details: { contains: q } }, { tags: { contains: q } }] } : {}),
  };
  const orderBy: Prisma.HelpDeskTicketOrderByWithRelationInput[] = sort === "newest" ? [{ createdAt: "desc" }, { id: "desc" }]
    : sort === "oldest" ? [{ createdAt: "asc" }, { id: "asc" }] : [{ lastActivityAt: "desc" }, { createdAt: "desc" }];
  const now = Date.now();
  const [tickets, count, viewCounts, responded] = await Promise.all([
    db.helpDeskTicket.findMany({
      where, orderBy, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE,
      select: {
        id: true, number: true, name: true, email: true, topic: true, status: true, priority: true, assignee: true, tags: true, unread: true, channel: true, cancelStatus: true, addressStatus: true,
        category: true, subcategory: true, orderName: true, carrier: true, shipmentStatus: true, createdAt: true, lastActivityAt: true, firstResponseAt: true, details: true, _count: { select: { attachments: true, messages: { where: { kind: "customer" } } } },
      },
    }),
    db.helpDeskTicket.count({ where }),
    Promise.all((Object.keys(VIEWS) as View[]).map(async (key) => [key, await db.helpDeskTicket.count({ where: { shop, ...VIEWS[key].where } })] as const)),
    db.helpDeskTicket.findMany({ where: { shop, firstResponseAt: { gte: new Date(now - 30 * DAY) } }, select: { createdAt: true, firstResponseAt: true }, take: 2000 }),
  ]);
  const flaggedScans = await db.helpDeskImageScan.findMany({
    where: { shop, overallVerdict: { in: ["likely_ai", "duplicate"] }, attachment: { ticketId: { in: tickets.map((ticket) => ticket.id) } } },
    select: { overallVerdict: true, attachment: { select: { ticketId: true } } },
  });
  const flagged = new Map<string, string>();
  for (const scan of flaggedScans) if (flagged.get(scan.attachment.ticketId) !== "likely_ai") flagged.set(scan.attachment.ticketId, scan.overallVerdict!);
  const responseTimes = responded.map((ticket) => ticket.firstResponseAt!.getTime() - ticket.createdAt.getTime());
  return data({
    ...base,
    tickets: tickets.map(({ details, _count, ...ticket }) => {
      const values = parseJson<Record<string, string>>(details, {});
      return {
        ...ticket, images: _count.attachments, customerReplies: _count.messages, photoFlag: flagged.get(ticket.id) ?? null,
        // The Shopify order with its carrier and delivery status once it's attached, e.g. "#100472 · UPS · In transit".
        reference: (ticket.orderName ? [ticket.orderName, ticket.carrier, ticket.shipmentStatus].filter(Boolean).join(" · ") : "")
          || values.orderNumber || (values.country ? countryName(values.country) : "") || (values.existing ? `Existing partner: ${values.existing}` : ""),
      };
    }),
    count, page, views: Object.fromEntries(viewCounts) as Record<View, number>,
    metrics: { avgResponse: responseTimes.length ? responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length : null },
    filters: { view, topic, priority, category, subcategory, rootCause, assignee, sort, q, period },
    overview: setupStatus(settings),
  }, { headers });
}

export async function loadOverview({ shop, settings, base }: Context, url: URL) {
  await classifyUnsorted(db, shop);
  const requested = Number(url.searchParams.get("range"));
  const range: DashboardRange = (DASHBOARD_RANGES as readonly number[]).includes(requested) ? requested as DashboardRange : 30;
  return data({ ...base, dashboard: await loadDashboard(db, shop, range), overview: setupStatus(settings) }, { headers });
}

export type ActionResult = { errors: Record<string, string>; ticketId?: string; emailed?: boolean; updated?: number; notice?: string; warning?: string };

export const helpDeskAction = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop } = session;
  let form: FormData;
  try { form = await readHelpDeskForm(request); }
  catch { return data<ActionResult>({ errors: { form: "Could not read the request. Use up to five images of 10 MB each." } }, { status: 400 }); }
  const text = (key: string) => String(form.get(key) ?? "");
  const fail = (message: string, status = 400, key = "form") => data<ActionResult>({ errors: { [key]: message } }, { status });
  const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  try {
    switch (text("intent")) {
      case "settings": {
        const notifyEmail = text("notifyEmail").trim();
        if (notifyEmail && !validEmail(notifyEmail)) return fail("Enter a valid email address.", 400, "notifyEmail");
        if (text("signature").length > 2000) return fail("Use no more than 2,000 characters.", 400, "signature");
        const values = {
          notify: text("notify") === "true", notifyEmail, autoReply: text("autoReply") === "true", statusEmails: text("statusEmails") === "true",
          signature: text("signature").trim(), team: teamList(text("team")).map((name) => name.slice(0, 60)).slice(0, 50).join(", "),
        };
        await db.helpDeskSettings.upsert({ where: { shop }, update: values, create: { shop, ...values } });
        return data<ActionResult>({ errors: {} });
      }
      case "shipping-times": {
        const processing = text("processing").trim();
        if (processing && !parseDays(processing)) return fail("Enter business days like 1-2, or leave it blank.", 400, "processing");
        const rates: Record<string, string> = {};
        for (const [name, days] of Object.entries(parseJson<Record<string, unknown>>(text("rates"), {})).slice(0, 200)) {
          if (typeof days !== "string" || !days.trim()) continue;
          if (!parseDays(days)) return fail(`Enter days like 3-5 for ${name.slice(0, 60)}.`, 400, "rates");
          rates[name.trim().slice(0, 120)] = days.trim().slice(0, 10);
        }
        if (text("note").length > 500) return fail("Use no more than 500 characters.", 400, "note");
        const shippingTimes = JSON.stringify({ processing, rates, note: text("note").trim() });
        await db.helpDeskSettings.upsert({ where: { shop }, update: { shippingTimes }, create: { shop, shippingTimes } });
        forgetShippingSetup(shop);
        return data<ActionResult>({ errors: {} });
      }
      case "test-email": {
        const to = text("to").trim();
        if (!emailConfigured()) return fail("Email sending is not set up on the server yet.");
        if (!validEmail(to)) return fail("Enter a valid email address first.");
        try { await sendTestEmail(shop, admin, to); }
        catch { return fail("The test email could not be sent. Check the SMTP settings on the server.", 502); }
        return data<ActionResult>({ errors: {} });
      }
      case "update":
      case "status":
      case "bulk": {
        const ids = text("intent") === "bulk" ? form.getAll("ids").map(String) : [text("id")];
        const changes = Object.fromEntries(["status", "priority", "assignee", "tags", "category", "subcategory", "rootCause", "resolutionType", "allowPhotos", "allowVideos"].filter((key) => form.has(key)).map((key) => [key, text(key)]));
        if (!Object.keys(changes).length || !ids.length) return fail("Choose what to change.");
        const before = new Map((await db.helpDeskTicket.findMany({ where: { shop, id: { in: ids } }, select: { id: true, status: true } })).map((ticket) => [ticket.id, ticket.status]));
        const updated = await updateTickets(db, shop, ids, changes, text("author") || "Staff");
        if (updated < 1) return fail(updated < 0 ? "That value isn't valid." : "These tickets couldn't be updated. Reload the page and try again.");
        // Tell customers when their ticket starts being worked on or is resolved.
        if (changes.status && STATUS_EMAIL_STATUSES.includes(changes.status)) {
          for (const [ticketId, status] of before) if (status !== changes.status) queueEmail(db, { shop, ticketId, kind: "status" }, admin);
        }
        return data<ActionResult>({ errors: {}, updated });
      }
      // An order cancellation request: approve, reject, mark cancelled, or cancel the order in Shopify.
      case "cancellation": {
        const input = { note: text("note"), author: text("author") || "Staff" };
        const result = text("decision") === "cancel-shopify"
          ? await cancelOrderInShopify(db, admin, shop, text("id"), { ...input, refund: text("refund") !== "false", restock: text("restock") !== "false", notifyCustomer: text("notifyCustomer") === "true" })
          : await decideCancellation(db, shop, text("id"), { ...input, decision: text("decision") }, admin);
        // The ticket reloads next: show the order as Shopify has it now, not the cached copy.
        forgetTicketOrder(shop, text("id"), await db.helpDeskTicket.findFirst({ where: { id: text("id"), shop }, select: { email: true } }));
        if (!result.cancelStatus) return data<ActionResult>({ errors: result.errors }, { status: 400 });
        return data<ActionResult>({ errors: {}, ticketId: text("id"), notice: result.cancelStatus, warning: result.warning });
      }
      // A shipping address change request: update the address in Shopify, or reject it.
      case "address": {
        const input = { note: text("note"), author: text("author") || "Staff" };
        const result = text("decision") === "update"
          ? await updateAddressInShopify(db, admin, shop, text("id"), {
            ...input, confirmed: text("confirmed") === "true",
            address: { name: text("name"), address1: text("address1"), address2: text("address2"), city: text("city"), province: text("province"), zip: text("zip"), country: text("country"), phone: text("phone") },
          })
          : await rejectAddressChange(db, shop, text("id"), input, admin);
        forgetTicketOrder(shop, text("id"), await db.helpDeskTicket.findFirst({ where: { id: text("id"), shop }, select: { email: true } }));
        if (!result.addressStatus) return data<ActionResult>({ errors: result.errors }, { status: 400 });
        return data<ActionResult>({ errors: {}, ticketId: text("id"), notice: result.addressStatus, warning: result.warning });
      }
      case "message": {
        const result = await addStaffMessage(db, shop, text("id"), { kind: text("kind"), body: text("body"), author: text("author"), status: text("status") || undefined });
        if (!result.messageId) return data<ActionResult>({ errors: result.errors }, { status: 400 });
        // Every reply shows on the customer's request page; "email" also emails it.
        const byEmail = text("kind") === "reply" && text("channel") !== "page" && emailConfigured();
        if (byEmail) queueEmail(db, { shop, ticketId: result.ticketId!, kind: "reply", messageId: result.messageId }, admin);
        const emailed = byEmail;
        return data<ActionResult>({ errors: {}, ticketId: result.ticketId, emailed });
      }
      case "scan": {
        const file = await db.helpDeskAttachment.findFirst({ where: { id: text("id"), ticket: { shop } }, select: { id: true } });
        if (!file) return fail("This image no longer exists.");
        const result = await scanImage(db, file.id, { forceDetector: text("force") === "true", manual: true });
        if (!result) return fail("This file can't be scanned.");
        return data<ActionResult>(result.status === "failed" ? { errors: { form: result.error || "The scan failed. Try again." } } : { errors: {} });
      }
      case "ai-settings": {
        const provider = text("provider") in PROVIDERS ? text("provider") : "sightengine";
        const mode = (DETECTOR_MODES as readonly string[]).includes(text("mode")) ? text("mode") : "always";
        // A store that never saved the general settings has no row yet.
        const current = await db.helpDeskSettings.findUnique({ where: { shop } })
          || { aiDetectionProvider: "", sightengineUser: "", sightengineSecret: "", truthscanKey: "" };
        // Blank secret fields keep the saved value.
        const next = {
          aiDetectionEnabled: text("enabled") === "true", aiDetectorMode: mode, aiDetectionProvider: provider,
          sightengineUser: text("sightengineUser").trim().slice(0, 200),
          sightengineSecret: text("sightengineSecret").trim().slice(0, 200) || current.sightengineSecret,
          truthscanKey: text("truthscanKey").trim().slice(0, 300) || current.truthscanKey,
        };
        const credentials = provider === "truthscan" ? { apiKey: next.truthscanKey } : { apiUser: next.sightengineUser, apiSecret: next.sightengineSecret };
        const changed = provider === "truthscan" ? next.truthscanKey !== current.truthscanKey
          : next.sightengineUser !== current.sightengineUser || next.sightengineSecret !== current.sightengineSecret;
        const hasCredentials = provider === "truthscan" ? Boolean(next.truthscanKey) : Boolean(next.sightengineUser && next.sightengineSecret);
        let notice = "";
        if (hasCredentials && (changed || provider !== current.aiDetectionProvider)) {
          const check = await verifyCredentials(provider, credentials);
          if (!check.valid) return fail(check.message || "These credentials don't work.", 400, "credentials");
          notice = "warning" in check && check.warning ? check.warning : "";
        }
        await db.helpDeskSettings.upsert({ where: { shop }, update: next, create: { shop, ...next } });
        // Photos scanned before a key was added get the detector now.
        if (hasCredentials && next.aiDetectionEnabled) await rescanMissingKeyScans(db, shop);
        return data<ActionResult>({ errors: {}, notice });
      }
      // ShipStation keys (blank fields keep the saved ones) and the store that holds this shop's orders.
      case "shipstation-settings": {
        const current = await db.helpDeskSettings.findUnique({ where: { shop } }) || { shipstationKey: "", shipstationSecret: "", shipstationStoreId: "" };
        forget(shipStationStoresKey(shop));
        if (text("disconnect") === "true") {
          const off = { shipstationKey: "", shipstationSecret: "", shipstationStoreId: "" };
          await db.helpDeskSettings.upsert({ where: { shop }, update: off, create: { shop, ...off } });
          return data<ActionResult>({ errors: {}, notice: "ShipStation disconnected" });
        }
        const key = text("key").trim().slice(0, 200) || current.shipstationKey;
        const secret = text("secret").trim().slice(0, 200) || current.shipstationSecret;
        if (!key || !secret) return fail("Enter the ShipStation API key and API secret.", 400, "credentials");
        let stores;
        try { stores = await listShipStationStores(key, secret); } catch { return fail("ShipStation couldn't be reached. Please try again."); }
        if (!stores) return fail("ShipStation didn't accept these keys. Check the API key and secret.", 400, "credentials");
        // The chosen store, or the one Shopify store named like this shop.
        let storeId = stores.some((store) => store.id === text("storeId")) ? text("storeId") : "";
        if (!storeId) {
          const name = (await loadShop(admin).catch(() => ({ name: "" }))).name.trim().toLowerCase();
          const named = stores.filter((store) => store.marketplace === "Shopify" && store.name.trim().toLowerCase() === name);
          if (named.length === 1) storeId = named[0].id;
        }
        const next = { shipstationKey: key, shipstationSecret: secret, shipstationStoreId: storeId };
        await db.helpDeskSettings.upsert({ where: { shop }, update: next, create: { shop, ...next } });
        return data<ActionResult>({ errors: {}, notice: storeId ? "ShipStation connected" : "Keys saved. Now choose the ShipStation store that holds this shop's orders." });
      }
      // Google Places key for address suggestions (checked with Google first), or removing it.
      case "places-settings": {
        forget(`places-key|${shop}`);
        if (text("remove") === "true") {
          await db.helpDeskSettings.upsert({ where: { shop }, update: { googlePlacesKey: "" }, create: { shop, googlePlacesKey: "" } });
          return data<ActionResult>({ errors: {}, notice: "Google key removed. Suggestions now come from OpenStreetMap" });
        }
        const key = text("key").trim().slice(0, 200);
        if (!key) return fail("Paste your Google API key.", 400, "placesKey");
        const problem = await checkPlacesKey(key);
        if (problem) return fail(problem, 400, "placesKey");
        await db.helpDeskSettings.upsert({ where: { shop }, update: { googlePlacesKey: key }, create: { shop, googlePlacesKey: key } });
        return data<ActionResult>({ errors: {}, notice: "Address suggestions now use Google" });
      }
      case "delete": {
        const ids = form.getAll("ids").map(String).filter(Boolean);
        if (!ids.length) return fail("Choose tickets to delete.");
        const deleted = await deleteTickets(db, shop, ids);
        if (!deleted) return fail("These tickets no longer exist.");
        return data<ActionResult>({ errors: {}, updated: deleted });
      }
      case "email-retry":
        if (!emailConfigured()) return fail("Email sending is not set up on the server yet.");
        if (!await retryEmail(db, shop, text("id"), admin)) return fail("This email can't be retried.");
        return data<ActionResult>({ errors: {} });
      case "macro-save": {
        const title = text("title").trim();
        const body = text("body").trim();
        const errors: Record<string, string> = {};
        if (!title || title.length > 80) errors.title = "Enter a name of up to 80 characters.";
        if (!body || body.length > MAX_MESSAGE_LENGTH) errors.body = "Enter the reply text.";
        // Empty category: a general reply for any ticket; empty sub-category: the whole category.
        const category = categoryNames.includes(text("category")) ? text("category") : "";
        const subcategory = subcategoriesOf(category).includes(text("subcategory")) ? text("subcategory") : "";
        if (Object.keys(errors).length) return data<ActionResult>({ errors }, { status: 400 });
        if (text("id")) {
          const { count } = await db.helpDeskMacro.updateMany({ where: { id: text("id"), shop }, data: { title, body, category, subcategory } });
          if (!count) return fail("This saved reply no longer exists.");
        } else if (await db.helpDeskMacro.count({ where: { shop } }) >= 100) {
          return fail("You can save up to 100 replies.");
        } else await db.helpDeskMacro.create({ data: { shop, title, body, category, subcategory } });
        return data<ActionResult>({ errors: {} });
      }
      case "staff-visibility": {
        const { count } = await db.helpDeskStaff.updateMany({ where: { id: text("id"), shop }, data: { hidden: text("hidden") === "true" } });
        if (!count) return fail("This staff member is no longer listed.");
        return data<ActionResult>({ errors: {} });
      }
      case "macro-delete":
        await db.helpDeskMacro.deleteMany({ where: { id: text("id"), shop } });
        return data<ActionResult>({ errors: {} });
      default: {
        const result = await submitTicket(db, shop, form);
        return data<ActionResult>(result, { status: Object.keys(result.errors).length ? 400 : 200 });
      }
    }
  } catch {
    return fail("The change could not be saved. Please try again.", 500);
  }
};

