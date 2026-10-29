import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { categoryNames, classifyTicket, classifyWithChoice, resolutionTypes, rootCauses, subcategoriesOf } from "./help-desk-taxonomy";
import { ADDRESS_FIELDS, CHAT_TOPIC, imagesRequired, ticketStatuses, countries, MAX_IMAGES, MAX_IMAGE_BYTES, MAX_MESSAGE_LENGTH, MAX_VIDEO_BYTES, VIDEO_FORMATS_LABEL, looksLikeVideo, videoFormat, issueResolutions, orderTypes, priorities, productParts, topics, updates, validateHelpDesk, type HelpDeskValues } from "./help-desk";

const fields = ["name", "email", "phone", "topic", "country", "address", "otherDetails", "existing", "registeredEmail", "query", "orderNumber", "orderType", "update", "cancelReason", ...ADDRESS_FIELDS, "delivery", "issue", "part", "details", "orderDetails", "productDetails", "resolution", "replacement", "purchasedFrom", "purchaseDate"];
// created is false when a retried submission returns the ticket saved earlier.
export type TicketResult = { errors: Record<string, string>; ticketId?: string; number?: number; token?: string; created?: boolean };

export async function readHelpDeskForm(request: Request) {
  // Room for the images and a reply's video.
  const limit = MAX_IMAGES * MAX_IMAGE_BYTES + MAX_VIDEO_BYTES + 256 * 1024;
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Empty request");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("Request too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("Content-Type") || "" } }).formData();
}

export async function submitTicket(db: PrismaClient, shop: string, form: FormData, customerId = ""): Promise<TicketResult> {
  const values: HelpDeskValues = {};
  for (const field of fields) {
    const value = form.get(field);
    if (typeof value === "string") values[field] = value.trim();
  }
  const shipping = values.topic === topics[0];
  const partner = values.topic === topics[1] || values.topic === topics[2];
  const order = values.topic === topics[3];
  const returns = values.topic === topics[4];
  const question = values.topic === topics[5];
  const active = new Set(["name", "email", "phone", "topic",
    ...(shipping ? ["country", "address", "otherDetails"] : []),
    ...(partner ? ["existing", "query", ...(values.existing === "Yes" ? ["registeredEmail"] : [])] : []),
    ...(order || returns ? ["orderNumber", "details"] : []),
    ...(order ? ["orderType", ...(values.orderType === orderTypes[0] ? ["update", ...(values.update === updates[2] ? ["cancelReason"] : []), ...(values.update === updates[1] ? ADDRESS_FIELDS : [])] : []), ...(values.orderType === orderTypes[1] ? ["issue", "part", "resolution", "replacement", "purchasedFrom", "purchaseDate"] : []), ...(values.orderType === orderTypes[2] ? ["resolution", "replacement"] : []), ...(values.orderType === orderTypes[3] ? ["delivery"] : [])] : []),
    ...(returns ? ["orderDetails", "productDetails", "issue", "part", "resolution"] : []),
    // country: where it ships to, for a customs or tax question.
    ...(question ? ["query", "orderNumber", "country"] : []),
  ]);
  for (const key of Object.keys(values)) if (!active.has(key)) delete values[key];
  const wrongProduct = order && values.orderType === orderTypes[2];
  // A damaged, defective or missing item: the products it's about, and an optional video.
  const productIssue = order && values.orderType === orderTypes[1];
  const products = shipping || wrongProduct || productIssue ?form.getAll("products").filter((value): value is string => typeof value === "string") : [];
  const receivedProducts = wrongProduct ? form.getAll("receivedProducts").filter((value): value is string => typeof value === "string") : [];
  // A product issue or wrong item: for each product picked from the order,
  // what's wrong with it (or what came instead) and its own photos and video,
  // so the team knows which is which.
  const fileList = (key: string) => form.getAll(key).filter((value): value is File => typeof value !== "string" && Boolean(value.name));
  // Each product can also name its part and how many are affected and, for a
  // wrong item, the variant they wanted or how many arrived and how many they want.
  const perProduct = productIssue || wrongProduct ? [...new Set(products)].slice(0, 20).map((id) => {
    const text = (key: string, max = 200) => String(form.get(`${key}:${id}`) ?? "").trim().slice(0, max);
    const count = (key: string, min: number) => (text(key) === "" ? null : Math.min(Math.max(Math.trunc(Number(text(key))) || 0, min), 999));
    // A part outside the list ("Whole item") stands as the note when there's none.
    const part = productParts.includes(text("itemPart")) ? text("itemPart") : "";
    const quantity = count("itemQty", 1) ?? 1;
    const variant = text("itemVariant");
    const received = count("itemReceived", 0);
    const wanted = count("itemWanted", 1);
    const asked = [variant && `wants ${variant}`, received !== null && `received ${received}`, wanted !== null && `wants ${wanted}`].filter(Boolean).join(", ");
    // What they'd like for this product: a refund, or a replacement (and with what).
    const resolution = issueResolutions.includes(text("itemResolution")) ? text("itemResolution") : "";
    const replacement = resolution === "Replacement" ? text("itemReplacement", 1000) : "";
    return { id, title: text("itemTitle"), note: text("itemNote", 5000) || (part ? "" : text("itemPart")), part, quantity, asked, resolution, replacement, images: fileList(`images:${id}`), videos: fileList(`videos:${id}`) };
  }).filter((item) => item.note || item.part || item.asked || item.images.length || item.videos.length) : [];
  if (perProduct.length) {
    const wants = (item: (typeof perProduct)[number]) => item.resolution && `${item.resolution}${item.replacement ? `: ${item.replacement}` : ""}`;
    values.details = perProduct.map((item) => `${item.title || "Product"}${item.part ? ` (${item.part})` : ""}${item.quantity > 1 ? ` × ${item.quantity}` : ""}: ${[item.asked, item.note].filter(Boolean).join(". ") || item.part}${item.resolution ? ` → ${wants(item)}` : ""}`).join("\n\n");
    // The ticket's own request: the products' answer when they agree (else the first one's), and every replacement wanted.
    const answers = [...new Set(perProduct.map((item) => item.resolution).filter(Boolean))];
    if (answers.length) values.resolution = answers[0];
    const replacements = perProduct.filter((item) => item.replacement).map((item) => `${item.title || "Product"} → ${item.replacement}`);
    if (replacements.length) values.replacement = replacements.join("; ");
    // The first product's part refines the ticket's sub-category (a missing lid is "Lids or panels missing").
    const part = perProduct.find((item) => item.part)?.part;
    if (productIssue && part) values.part = part;
  }
  // Checked per product below; the overall rules see one product's worth.
  const files = perProduct.length ? perProduct.flatMap((item) => item.images).slice(0, MAX_IMAGES)
    : returns || question || (order && (values.orderType === orderTypes[1] || wrongProduct)) ? fileList("images") : [];
  const errors = validateHelpDesk(values, products, files, receivedProducts);
  const image = (file: File) => ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size > 0 && file.size <= MAX_IMAGE_BYTES;
  const video = (file: File) => looksLikeVideo(file) && file.size > 0 && file.size <= MAX_VIDEO_BYTES;
  if (perProduct.some((item) => !item.note && !item.part && !item.asked)) errors.details = "Tell us what's wrong with each product.";
  if (imagesRequired(values) && perProduct.some((item) => !item.images.length)) errors.images = "Add a photo of each product.";
  if (perProduct.some((item) => item.images.length > MAX_IMAGES || !item.images.every(image))) errors.images = `Use up to ${MAX_IMAGES} JPG, PNG or WebP images per product, 10 MB each.`;
  if (perProduct.some((item) => item.videos.length > 1)) errors.videos = "Attach one video per product.";
  else if (perProduct.some((item) => !item.videos.every(video))) errors.videos = `Use a video (${VIDEO_FORMATS_LABEL}), up to 50 MB.`;
  for (const [key, value] of Object.entries(values)) if (value.length > 5000) errors[key] = "Use no more than 5,000 characters.";
  if (values.country && !countries.some(country => country.code === values.country)) errors.country = "Select a valid country.";
  const validIds = (ids: string[]) => ids.length <= 100 && ids.every(id => /^gid:\/\/shopify\/Product\/\d+$/.test(id));
  if (!validIds(products)) errors.products = "Select up to 100 valid products.";
  if (!validIds(receivedProducts)) errors.receivedProducts = "Select up to 100 valid products.";
  const requestKey = form.get("requestKey");
  if (typeof requestKey !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(requestKey)) errors.form = "Reload the page and try again.";
  if (Object.keys(errors).length) return { errors };
  // The category the customer picked is stored on the ticket, not with the request's fields.
  const chosen = { category: String(form.get("category") ?? "").trim(), subcategory: String(form.get("subcategory") ?? "").trim() };
  const existing = await db.helpDeskTicket.findUnique({ where: { shop_requestKey: { shop, requestKey: requestKey as string } }, select: { id: true, number: true, accessToken: true } });
  if (existing) return { errors: {}, ticketId: existing.id, number: existing.number, token: existing.accessToken, created: false };
  const images = await readImages(perProduct.length ? [] : files);
  if ("error" in images) return { errors: { images: images.error } };
  const productFiles = [];
  for (const item of perProduct) {
    const shots = await readImages(item.images);
    if ("error" in shots) return { errors: { images: shots.error } };
    const clip = await readVideos(item.videos);
    if ("error" in clip) return { errors: { videos: clip.error } };
    productFiles.push(...[...shots.attachments, ...clip.attachments].map((file) => ({ ...file, productId: item.id })));
  }
  const videos = productIssue ? form.getAll("videos").filter((value): value is File => typeof value !== "string" && Boolean(value.name)) : [];
  if (videos.length > 1) return { errors: { videos: "Attach one video." } };
  if (videos.some((file) => !looksLikeVideo(file) || !file.size || file.size > MAX_VIDEO_BYTES)) return { errors: { videos: `Use a video (${VIDEO_FORMATS_LABEL}), up to 50 MB.` } };
  const clips = await readVideos(videos);
  if ("error" in clips) return { errors: { videos: clips.error } };
  // A request to cancel the whole order waits for the team's decision.
  const cancellation = order && values.orderType === orderTypes[0] && values.update === updates[2];
  // So does a new shipping address.
  const addressChange = order && values.orderType === orderTypes[0] && values.update === updates[1];
  if (addressChange) values.shipCountry = values.shipCountry.toUpperCase();
  return createNumberedTicket(db, {
    ...(cancellation ? { cancelStatus: "Pending", tags: "cancel" } : {}),
    ...(addressChange ? { addressStatus: "Pending", tags: "address-change" } : {}),
    shop, requestKey: requestKey as string, name: values.name, email: values.email, topic: values.topic, details: JSON.stringify(values), ...classifyWithChoice(values.topic, values, chosen),
    products: JSON.stringify([...new Set(products)]), receivedProducts: JSON.stringify([...new Set(receivedProducts)]),
    customerId: /^\d+$/.test(customerId) ? customerId : "", attachments: { create: [...images.attachments, ...clips.attachments, ...productFiles] },
  });
}

// Checks each image's bytes match its declared type, so a renamed file can't pass as an image.
export async function readImages(files: File[]): Promise<{ error: string } | { attachments: { name: string; type: string; data: Uint8Array<ArrayBuffer> }[] }> {
  const attachments = [];
  for (const file of files) {
    const data = new Uint8Array(await file.arrayBuffer());
    const bytes = Buffer.from(data.buffer);
    const valid = file.type === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : file.type === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : file.type === "image/webp" && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    if (!valid) return { error: "An attachment does not match its image format. Choose JPG, PNG or WebP images." };
    attachments.push({ name: file.name.slice(0, 200), type: file.type, data });
  }
  return { attachments };
}

// The same for a video, in any common format: its bytes say which (videoFormat),
// and that's the type it's stored with, whatever the browser called it.
export async function readVideos(files: File[]): Promise<{ error: string } | { attachments: { name: string; type: string; data: Uint8Array<ArrayBuffer> }[] }> {
  const attachments = [];
  for (const file of files) {
    const data = new Uint8Array(await file.arrayBuffer());
    const type = videoFormat(data);
    if (!type) return { error: "This file isn't a video we can read. Try another video file." };
    attachments.push({ name: file.name.slice(0, 200), type, data });
  }
  return { attachments };
}

type NewTicket = Omit<Prisma.HelpDeskTicketUncheckedCreateInput, "number" | "accessToken" | "lastActivityAt"> & { requestKey: string };

// Creates a ticket with the shop's next number and a tracking token. A
// concurrent submission that takes the same number fails the unique index, so
// retry with the next one; a retried request (same requestKey) returns the
// ticket saved first.
async function createNumberedTicket(db: PrismaClient, data: NewTicket): Promise<TicketResult> {
  const { shop, requestKey } = data;
  for (let attempt = 0; ; attempt++) {
    const last = await db.helpDeskTicket.findFirst({ where: { shop }, orderBy: { number: "desc" }, select: { number: true } });
    try {
      const ticket = await db.helpDeskTicket.create({
        data: { ...data, number: Math.max(1000, last?.number ?? 0) + 1, accessToken: randomBytes(24).toString("hex"), lastActivityAt: new Date() },
        select: { id: true, number: true, accessToken: true },
      });
      return { errors: {}, ticketId: ticket.id, number: ticket.number, token: ticket.accessToken, created: true };
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002" || attempt >= 5) throw error;
      const saved = await db.helpDeskTicket.findUnique({ where: { shop_requestKey: { shop, requestKey } }, select: { id: true, number: true, accessToken: true } });
      if (saved) return { errors: {}, ticketId: saved.id, number: saved.number, token: saved.accessToken, created: false };
    }
  }
}

export { CHAT_TOPIC };

// allowPhotos / allowVideos: "true" or "false", whether the customer may add photos / a video to their replies.
export type TicketChanges = { status?: string; priority?: string; assignee?: string; tags?: string; category?: string; subcategory?: string; rootCause?: string; resolutionType?: string; allowPhotos?: string; allowVideos?: string };

// Classification fields an agent can change, with the label used on the timeline.
const CLASSIFICATION = [["category", "Category"], ["subcategory", "Sub-category"], ["rootCause", "Root cause"], ["resolutionType", "Resolution"]] as const;

// Classifies tickets saved before classification existed, and ones whose
// category was renamed or removed from the taxonomy, a batch at a time.
export async function classifyUnsorted(db: PrismaClient, shop: string, limit = 200) {
  const tickets = await db.helpDeskTicket.findMany({
    where: { shop, OR: [{ category: "" }, { category: { notIn: categoryNames } }] }, select: { id: true, topic: true, details: true }, take: limit,
  });
  for (const ticket of tickets) {
    let details: Record<string, string> = {};
    try { details = JSON.parse(ticket.details) as Record<string, string>; } catch { /* keep empty */ }
    await db.helpDeskTicket.update({ where: { id: ticket.id }, data: classifyTicket(ticket.topic, details) });
  }
  return tickets.length;
}

const cleanTags = (tags: string) => [...new Set(tags.split(",").map(tag => tag.trim().slice(0, 40)).filter(Boolean))].slice(0, 20).join(", ");

// Applies property changes to the shop's tickets and logs each change on the
// ticket's timeline. Returns how many tickets were found, or -1 for an invalid value.
export async function updateTickets(db: PrismaClient, shop: string, ids: string[], changes: TicketChanges, author = "Staff") {
  if (changes.status !== undefined && !ticketStatuses.includes(changes.status as typeof ticketStatuses[number])) return -1;
  if (changes.priority !== undefined && !priorities.includes(changes.priority as typeof priorities[number])) return -1;
  if (changes.assignee !== undefined && changes.assignee.length > 80) return -1;
  // Empty clears a classification field.
  if (changes.category && !categoryNames.includes(changes.category)) return -1;
  if (changes.rootCause && !(rootCauses as string[]).includes(changes.rootCause)) return -1;
  if (changes.resolutionType && !(resolutionTypes as readonly string[]).includes(changes.resolutionType)) return -1;
  if (changes.allowPhotos !== undefined && !["true", "false"].includes(changes.allowPhotos)) return -1;
  if (changes.allowVideos !== undefined && !["true", "false"].includes(changes.allowVideos)) return -1;
  const tickets = await db.helpDeskTicket.findMany({ where: { shop, id: { in: ids.slice(0, 100) } } });
  if (changes.subcategory && tickets.some((ticket) => !subcategoriesOf(changes.category ?? ticket.category).includes(changes.subcategory!))) return -1;
  for (const ticket of tickets) {
    const data: Prisma.HelpDeskTicketUpdateInput = {};
    const events: string[] = [];
    if (changes.status !== undefined && changes.status !== ticket.status) {
      data.status = changes.status;
      data.resolvedAt = changes.status === "Resolved" ? new Date() : null;
      events.push(`Status changed from ${ticket.status} to ${changes.status}`);
    }
    if (changes.priority !== undefined && changes.priority !== ticket.priority) {
      data.priority = changes.priority;
      events.push(`Priority changed from ${ticket.priority} to ${changes.priority}`);
    }
    if (changes.assignee !== undefined && changes.assignee.trim() !== ticket.assignee) {
      data.assignee = changes.assignee.trim();
      events.push(data.assignee ? `Assigned to ${data.assignee}` : "Unassigned");
    }
    if (changes.tags !== undefined && cleanTags(changes.tags) !== ticket.tags) {
      data.tags = cleanTags(changes.tags);
      events.push(data.tags ? `Tags set to ${data.tags}` : "Tags removed");
    }
    if (changes.allowPhotos !== undefined && (changes.allowPhotos === "true") !== ticket.allowPhotos) {
      data.allowPhotos = changes.allowPhotos === "true";
      events.push(data.allowPhotos ? "Photo uploads turned on for the customer" : "Photo uploads turned off for the customer");
    }
    if (changes.allowVideos !== undefined && (changes.allowVideos === "true") !== ticket.allowVideos) {
      data.allowVideos = changes.allowVideos === "true";
      events.push(data.allowVideos ? "Video uploads turned on for the customer" : "Video uploads turned off for the customer");
    }
    // A new category drops a sub-category that doesn't belong to it.
    const category = changes.category ?? ticket.category;
    const subcategory = changes.subcategory ?? (changes.category !== undefined && !subcategoriesOf(category).includes(ticket.subcategory) ? "" : undefined);
    const classification = { ...changes, subcategory };
    for (const [key, label] of CLASSIFICATION) {
      const value = classification[key];
      if (value === undefined || value === ticket[key]) continue;
      data[key] = value;
      events.push(value ? `${label} set to ${value}` : `${label} cleared`);
    }
    if (!events.length) continue;
    await db.helpDeskTicket.update({
      where: { id: ticket.id },
      data: { ...data, messages: { create: events.map(body => ({ kind: "event", author, body })) } },
    });
  }
  return tickets.length;
}

export async function updateTicketStatus(db: PrismaClient, shop: string, id: string, status: string) {
  return (await updateTickets(db, shop, [id], { status })) === 1;
}

export type MessageResult = { errors: Record<string, string>; messageId?: string; ticketId?: string };

const checkBody = (body: string) => !body ? "Write a message first."
  : body.length > MAX_MESSAGE_LENGTH ? `Use no more than ${MAX_MESSAGE_LENGTH.toLocaleString("en")} characters.` : "";

// Adds a staff reply (visible to the customer) or an internal note. A reply
// counts as the first response and, unless a status is given, moves an
// unresolved ticket to "Waiting on customer".
export async function addStaffMessage(db: PrismaClient, shop: string, id: string, input: { kind: string; body: string; author: string; status?: string }): Promise<MessageResult> {
  const body = input.body.trim();
  if (!["reply", "note"].includes(input.kind)) return { errors: { form: "Choose a reply or an internal note." } };
  if (checkBody(body)) return { errors: { body: checkBody(body) } };
  if (input.status && !ticketStatuses.includes(input.status as typeof ticketStatuses[number])) return { errors: { form: "Select a valid status." } };
  const ticket = await db.helpDeskTicket.findFirst({ where: { id, shop } });
  if (!ticket) return { errors: { form: "This ticket no longer exists." } };
  const author = input.author.trim().slice(0, 80) || "Staff";
  const now = new Date();
  const message = await db.helpDeskMessage.create({ data: { ticketId: ticket.id, kind: input.kind, author, body } });
  if (input.kind === "reply") {
    await db.helpDeskTicket.update({ where: { id: ticket.id }, data: { lastActivityAt: now, unread: false, ...(ticket.firstResponseAt ? {} : { firstResponseAt: now }) } });
  }
  const status = input.status || (input.kind === "reply" && ticket.status !== "Resolved" ? "Waiting on customer" : "");
  if (status) await updateTickets(db, shop, [ticket.id], { status }, author);
  return { errors: {}, messageId: message.id, ticketId: ticket.id };
}

// A customer's reply from their tracking page. Reopens waiting or resolved tickets.
export const MAX_REPLY_IMAGES = 3;

// Form tickets take customer messages only after the team has replied
// (status "Waiting on customer"); live chats stay open so the chat keeps flowing.
export const customerCanReply = (ticket: { channel: string; status: string }) => ticket.channel === "chat" || ticket.status === "Waiting on customer";

export async function addCustomerMessage(db: PrismaClient, shop: string, token: string, text: string, files: File[] = [], videos: File[] = []): Promise<MessageResult> {
  const body = text.trim();
  if (!/^[a-f0-9]{48}$/.test(token)) return { errors: { form: "This link is not valid." } };
  // Photos or a video alone are a valid reply.
  if ((body || !(files.length + videos.length)) && checkBody(body)) return { errors: { body: checkBody(body) } };
  if (videos.length > 1) return { errors: { videos: "Attach one video." } };
  if (videos.some((file) => !looksLikeVideo(file) || !file.size || file.size > MAX_VIDEO_BYTES)) {
    return { errors: { videos: `Use a video (${VIDEO_FORMATS_LABEL}), up to 50 MB.` } };
  }
  if (files.length > MAX_REPLY_IMAGES) return { errors: { images: `Attach up to ${MAX_REPLY_IMAGES} images.` } };
  if (files.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || !file.size || file.size > MAX_IMAGE_BYTES)) {
    return { errors: { images: "Use JPG, PNG or WebP images, up to 10 MB each." } };
  }
  const images = await readImages(files);
  if ("error" in images) return { errors: { images: images.error } };
  const clips = await readVideos(videos);
  if ("error" in clips) return { errors: { videos: clips.error } };
  const ticket = await db.helpDeskTicket.findFirst({ where: { shop, accessToken: token } });
  if (!ticket) return { errors: { form: "This request could not be found." } };
  if (!customerCanReply(ticket)) return { errors: { form: "You can add a message once our team replies. We'll let you know when they do." } };
  // Photos only when staff asked for them (the page hides the field otherwise).
  if (files.length && !ticket.allowPhotos) return { errors: { images: "Photos can't be added to this request. Please send your message as text." } };
  if (videos.length && !ticket.allowVideos) return { errors: { videos: "Videos can't be added to this request. Please send your message as text." } };
  const sent = [files.length && `${files.length} image${files.length === 1 ? "" : "s"}`, videos.length && "a video"].filter(Boolean).join(" and ");
  const message = await db.helpDeskMessage.create({
    data: { ticketId: ticket.id, kind: "customer", author: ticket.name, body: body || `Sent ${sent}` },
  });
  const attachments = [...images.attachments, ...clips.attachments];
  if (attachments.length) {
    await db.helpDeskAttachment.createMany({ data: attachments.map((file) => ({ ...file, ticketId: ticket.id, messageId: message.id })) });
  }
  await db.helpDeskTicket.update({ where: { id: ticket.id }, data: { lastActivityAt: new Date(), unread: true } });
  if (ticket.status === "Waiting on customer" || ticket.status === "Resolved") await updateTickets(db, shop, [ticket.id], { status: "Open" }, ticket.name);
  return { errors: {}, messageId: message.id, ticketId: ticket.id };
}

// Permanently deletes the shop's tickets. Messages, images, image scans and
// queued emails go with them (cascading relations). Returns how many were deleted.
export async function deleteTickets(db: PrismaClient, shop: string, ids: string[]) {
  const { count } = await db.helpDeskTicket.deleteMany({ where: { shop, id: { in: ids.slice(0, 100) } } });
  return count;
}

// Privacy: a customer asked the store to erase their data (customers/redact).
// Removes every ticket opened with their email or Shopify customer ID.
export async function redactCustomer(db: PrismaClient, shop: string, customer: { email?: string | null; id?: string | number | null }) {
  const email = customer.email?.trim();
  const id = customer.id != null ? String(customer.id) : "";
  const or = [...(email ? [{ email }] : []), ...(/^\d+$/.test(id) ? [{ customerId: id }] : [])];
  if (!or.length) return 0;
  const { count } = await db.helpDeskTicket.deleteMany({ where: { shop, OR: or } });
  return count;
}

// Privacy: the store uninstalled the app 48 hours ago (shop/redact). Erases
// all Help Desk data held for it.
export async function purgeShop(db: PrismaClient, shop: string) {
  await db.$transaction([
    db.helpDeskTicket.deleteMany({ where: { shop } }),
    db.helpDeskFaq.deleteMany({ where: { shop } }),
    db.helpDeskBotQuestion.deleteMany({ where: { shop } }),
    db.helpDeskMacro.deleteMany({ where: { shop } }),
    db.helpDeskSettings.deleteMany({ where: { shop } }),
    db.helpDeskStaff.deleteMany({ where: { shop } }),
  ]);
}
