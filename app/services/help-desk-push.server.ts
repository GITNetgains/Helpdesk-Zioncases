import type { PrismaClient } from "@prisma/client";
import webpush from "web-push";

// Browser notifications (Web Push) for customers: when the team replies on a
// request, each browser that turned them on from the request page gets one,
// even with the page closed. The service worker skips it while the customer
// is looking at that request's page, which shows the reply by itself.

// The store's VAPID key pair, made the first time it's needed.
export async function pushKeys(db: PrismaClient, shop: string) {
  const saved = await db.helpDeskSettings.findUnique({ where: { shop }, select: { pushPublicKey: true, pushPrivateKey: true } });
  if (saved?.pushPublicKey && saved.pushPrivateKey) return { publicKey: saved.pushPublicKey, privateKey: saved.pushPrivateKey };
  const keys = webpush.generateVAPIDKeys();
  await db.helpDeskSettings.upsert({
    where: { shop }, create: { shop, pushPublicKey: keys.publicKey, pushPrivateKey: keys.privateKey },
    update: { pushPublicKey: keys.publicKey, pushPrivateKey: keys.privateKey },
  });
  return keys;
}

// Only the push services' own HTTPS addresses, with the browser's keys as
// base64url (what PushSubscription.toJSON() gives).
const KEY = /^[A-Za-z0-9_-]{16,200}$/;
export function readSubscription(input: { endpoint: string; p256dh: string; auth: string }) {
  let url: URL;
  try { url = new URL(input.endpoint); } catch { return null; }
  if (url.protocol !== "https:" || input.endpoint.length > 1000 || !KEY.test(input.p256dh) || !KEY.test(input.auth)) return null;
  return { endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth };
}

// Turns notifications on (or off) for this request in this browser.
export async function savePushSubscription(db: PrismaClient, shop: string, token: string, input: { endpoint: string; p256dh: string; auth: string }, on = true) {
  const subscription = readSubscription(input);
  if (!subscription) return false;
  const ticket = await db.helpDeskTicket.findFirst({ where: { shop, accessToken: token }, select: { id: true } });
  if (!ticket) return false;
  if (!on) {
    await db.helpDeskPushSubscription.deleteMany({ where: { ticketId: ticket.id, endpoint: subscription.endpoint } });
    return true;
  }
  await db.helpDeskPushSubscription.upsert({
    where: { ticketId_endpoint: { ticketId: ticket.id, endpoint: subscription.endpoint } },
    create: { ticketId: ticket.id, ...subscription }, update: { p256dh: subscription.p256dh, auth: subscription.auth },
  });
  return true;
}

const preview = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 157)}...` : flat;
};

// Notifies the request's browsers of a team reply. Never throws; a browser
// that's gone (the push service says 404 or 410) is forgotten.
export async function notifyReply(db: PrismaClient, shop: string, messageId: string, send: typeof webpush.sendNotification = webpush.sendNotification.bind(webpush)) {
  try {
    const message = await db.helpDeskMessage.findFirst({
      where: { id: messageId, kind: "reply", ticket: { shop } },
      select: { author: true, body: true, ticket: { select: { id: true, number: true, accessToken: true, pushSubscriptions: true } } },
    });
    const browsers = message?.ticket.pushSubscriptions ?? [];
    if (!message || !browsers.length) return 0;
    const keys = await pushKeys(db, shop);
    const payload = JSON.stringify({
      title: `${message.author || "Our team"} replied to request #${message.ticket.number}`,
      body: preview(message.body) || "Open your request to read it.",
      ticket: message.ticket.accessToken,
      tag: `help-desk-${message.ticket.id}`,
    });
    const vapidDetails = { subject: process.env.SHOPIFY_APP_URL?.startsWith("https://") ? process.env.SHOPIFY_APP_URL : `https://${shop}`, publicKey: keys.publicKey, privateKey: keys.privateKey };
    let sent = 0;
    await Promise.all(browsers.map(async (browser) => {
      try {
        await send({ endpoint: browser.endpoint, keys: { p256dh: browser.p256dh, auth: browser.auth } }, payload, { vapidDetails, TTL: 24 * 60 * 60, urgency: "high" });
        sent++;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await db.helpDeskPushSubscription.delete({ where: { id: browser.id } }).catch(() => undefined);
        else console.error(`Help Desk could not send a browser notification for ticket ${message.ticket.id}:`, error instanceof Error ? error.message : error);
      }
    }));
    return sent;
  } catch (error) {
    console.error("Help Desk browser notifications failed:", error);
    return 0;
  }
}

// The service worker, served from the store at /apps/help-desk?sw=1 so it
// runs on the store's own domain, for the request pages under /apps/help-desk.
export const SERVICE_WORKER = `
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });

function requestUrl(ticket) {
  return self.registration.scope + (ticket ? '?ticket=' + encodeURIComponent(ticket) : '');
}
function sameRequest(url, ticket) {
  try { return new URL(url).searchParams.get('ticket') === ticket; } catch (error) { return false; }
}

self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (error) {}
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windows) {
    // The customer is looking at this request right now: the page shows the reply itself.
    var watching = windows.some(function (client) { return client.visibilityState === 'visible' && client.focused && sameRequest(client.url, data.ticket); });
    if (watching) return;
    return self.registration.showNotification(data.title || 'New message from our team', {
      body: data.body || '', tag: data.tag || 'help-desk', renotify: true, data: { url: requestUrl(data.ticket), ticket: data.ticket || '' },
    });
  }));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = event.notification.data || {};
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windows) {
    for (var i = 0; i < windows.length; i++) {
      if (sameRequest(windows[i].url, target.ticket) && windows[i].focus) return windows[i].focus();
    }
    return self.clients.openWindow(target.url || self.registration.scope);
  }));
});
`;
