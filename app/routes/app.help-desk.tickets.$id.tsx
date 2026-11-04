import { useEffect, useRef, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useFetcher, useFetchers, useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  addressBlockers, addressChangeChecks, addressCheckOrder, cancelReview, cancelScopes, parseEditRequest, solutionsFor, returnBlocker, RETURN_WINDOW_MONTHS, shipStationCheck, addressFromValues, addressLines, countries, countryName, fieldLabels as LABELS, fillMacro, MAX_MESSAGE_LENGTH, PLAYABLE_VIDEO, priorities, PROVINCES, ticketStatuses, type MacroOrder,
} from "../services/help-desk";
import { adminContext, helpDeskAction, loadTicket } from "../services/help-desk-admin.server";
import type { TicketProduct } from "../services/help-desk-email.server";
import { categoryNames, describeCategory, groupMacros, resolutionTypes, rootCauses, subcategoriesOf, teamFor } from "../services/help-desk-taxonomy";
import { buildChecks, PHOTO_VERDICT, PhotoCheckButton, PhotoReportModal } from "../components/PhotoReport";
import { ASSISTANT_AVATAR, nameInitial } from "../services/help-desk-avatar";
import { AddressBadge, EditBadge, QuoteBadge, ReplacementBadge, ReturnBadge, ago, CancelBadge, DAY, DeleteConfirm, duration, formatDate, StatusBadge, ticketHref, useLiveRefresh, useResultToast } from "../components/help-desk/shared";

// One ticket: /app/help-desk/tickets/:id.
export const loader = async ({ request, params }: LoaderFunctionArgs) => loadTicket(await adminContext(request), params.id ?? "");

export const action = helpDeskAction;

type TicketData = ReturnType<typeof useLoaderData<typeof loader>>;

// ---------- Ticket ----------

type TicketFile = TicketData["ticket"]["attachments"][number];

function Attachment({ file, onOpen, onReport }: { file: TicketFile; onOpen: (image: { url: string; name: string; id: string }) => void; onReport: () => void }) {
  const fetcher = useFetcher<{ url?: string; name?: string; error?: string }>();
  useEffect(() => {
    if (fetcher.state === "idle" && !fetcher.data) void fetcher.load(`/app/help-desk-attachment?id=${encodeURIComponent(file.id)}`);
  }, [fetcher, file.id]);
  const url = fetcher.data?.url;
  const video = file.type.startsWith("video/");
  return <div style={{ display: "grid", gap: 6, width: 112, alignContent: "start" }}>
    <s-clickable border="base" borderRadius="base" padding="none" accessibilityLabel={`Open ${file.name}`} disabled={!url} onClick={() => { if (url) onOpen({ url, name: file.name, id: file.id }); }}>
      <div style={{ width: 112, height: 112, display: "grid", placeItems: "center", overflow: "hidden" }}>
        {url && video ? <div style={{ display: "grid", placeItems: "center", gap: 4, width: "100%", height: "100%", background: "#1C2340", color: "#fff", fontSize: 12, textAlign: "center", padding: 6 }}>
          <span aria-hidden="true" style={{ fontSize: 28, lineHeight: 1 }}>▶</span><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 96 }}>{file.name}</span>
        </div>
          : url ? <img src={url} alt={file.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : fetcher.data?.error ? <s-text tone="critical">Unavailable</s-text> : <s-spinner size="base" />}
      </div>
    </s-clickable>
    {!video && <PhotoCheckButton scan={file.scan} onOpen={onReport} />}
  </div>;
}

// A short summary under the opened photo; the popup has the full report.
function ScanSummary({ file, onReport }: { file: TicketFile; onReport: () => void }) {
  const scan = file.scan;
  const verdict = scan?.status === "completed" ? PHOTO_VERDICT[scan.overallVerdict || "error"] ?? PHOTO_VERDICT.error : null;
  const issues = scan?.status === "completed"
    ? buildChecks(scan, { ticket: (ticketId) => ticketHref(ticketId), settings: "/app/help-desk/settings/photos" })
      .flatMap((check) => check.findings).filter((finding) => finding.severity === "critical" || finding.severity === "warning")
      .sort((a, b) => (a.severity === "critical" ? 0 : 1) - (b.severity === "critical" ? 0 : 1))
    : [];
  return <s-box border="base" borderRadius="base" padding="base" background="subdued">
    <s-stack gap="small-200">
      <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-text type="strong">AI photo check</s-text>
          {verdict ? <s-badge tone={verdict.badge}>{verdict.label}</s-badge>
            : <s-badge tone={scan?.status === "pending" ? "info" : "neutral"}>{!scan ? "Not checked" : scan.status === "pending" ? "Checking photo" : "Scan incomplete"}</s-badge>}
          {verdict && typeof scan?.overallConfidence === "number" && scan.overallVerdict !== "error" && <s-text color="subdued">{Math.round(scan.overallConfidence * 100)}% confidence</s-text>}
          {verdict && <s-text color="subdued">· {issues.length ? `${issues.length} issue${issues.length === 1 ? "" : "s"} found` : "No issues found"}</s-text>}
        </s-stack>
        <s-button icon="view" onClick={onReport}>View full report</s-button>
      </s-stack>
      {issues.slice(0, 3).map((issue, index) => (
        <s-stack key={index} direction="inline" gap="small-200" alignItems="center">
          <s-icon type={issue.severity === "critical" ? "alert-octagon" : "alert-triangle"} tone={issue.severity === "critical" ? "critical" : "warning"} size="small" />
          <s-text>{issue.title}</s-text>
        </s-stack>
      ))}
      {issues.length > 3 && <s-link onClick={onReport}>+ {issues.length - 3} more in the full report</s-link>}
    </s-stack>
  </s-box>;
}

function ProductList({ heading, products }: { heading: string; products: TicketProduct[] }) {
  return <s-stack gap="small-200">
    <s-text type="strong">{heading} ({products.length})</s-text>
    {products.map((product) => (
      <s-stack key={product.id} direction="inline" gap="base" alignItems="center">
        <s-thumbnail src={product.image || undefined} alt={product.title} size="small" />
        {/* An order line (a product since deleted, or an item asked to cancel) has no product page. */}
        {product.id.includes("/Product/")
          ? <s-link href={`shopify://admin/products/${product.id.split("/").pop()}`} target="_blank">{product.title}</s-link>
          : <s-text>{product.title}</s-text>}
      </s-stack>
    ))}
  </s-stack>;
}

function Gallery({ files, title }: { files: TicketFile[]; title?: string }) {
  const [image, setImage] = useState<{ url: string; name: string; id: string } | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  if (!files.length) return null;
  const open = image && files.find((file) => file.id === image.id);
  const report = reportId ? files.find((file) => file.id === reportId) ?? null : null;
  return <s-stack gap="small-200">
    <s-text type="strong">{title ?? (files.some((file) => file.type.startsWith("video/")) ? "Photos and videos" : "Images")} ({files.length})</s-text>
    <s-stack direction="inline" gap="base">
      {files.map((file) => <Attachment key={file.id} file={file} onOpen={setImage} onReport={() => setReportId(file.id)} />)}
    </s-stack>
    {image && <s-box border="base" borderRadius="base" padding="base">
      <s-stack gap="small-200">
        <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
          <s-text type="strong">{image.name}</s-text>
          <s-stack direction="inline" gap="small-200">
            <a href={image.url} download={image.name}><s-button icon="download">Download</s-button></a>
            <s-button icon="x" variant="tertiary" accessibilityLabel="Close" onClick={() => setImage(null)} />
          </s-stack>
        </s-stack>
        {open?.type.startsWith("video/")
          // AVI, MKV, WMV and the like don't play in a browser: they're downloaded to watch.
          ? PLAYABLE_VIDEO.includes(open.type)
            ? <video src={image.url} controls playsInline style={{ display: "block", width: "100%", maxHeight: 640, margin: "0 auto", borderRadius: 8, background: "#000" }} />
            : <s-banner tone="info">This video format can&apos;t play in the browser. Use Download to watch it.</s-banner>
          : <img src={image.url} alt={image.name} style={{ display: "block", maxWidth: "100%", maxHeight: 640, margin: "0 auto", borderRadius: 8 }} />}
        {open && !open.type.startsWith("video/") && <ScanSummary file={open} onReport={() => setReportId(open.id)} />}
      </s-stack>
    </s-box>}
    <PhotoReportModal file={report} onClose={() => setReportId(null)} ticketLink={(ticketId) => ticketHref(ticketId)} />
  </s-stack>;
}

function OriginalRequest({ ticket }: { ticket: TicketData["ticket"] }) {
  const values = ticket.details;
  const files = ticket.attachments.filter((file) => !file.messageId);
  if (ticket.channel === "chat") {
    return <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="center">
      <s-icon type="chat" tone="neutral" size="small" />
      <s-text color="subdued">{ticket.name} started a chat from the storefront · <span suppressHydrationWarning>{formatDate(ticket.createdAt)}</span>. Earlier messages with the assistant are shown below.</s-text>
    </s-stack>;
  }
  const rows = Object.keys(LABELS).filter((key) => key !== "phone" && values[key]);
  const loose = files.filter((file) => !file.productId || !ticket.products.some((product) => product.id === file.productId));
  const media = ticket.receivedProducts.length > 0 || ticket.products.length > 0 || files.length > 0;
  // The request as the first message of the chat: a card in the chat's own colours.
  return <div style={{ maxWidth: "min(720px, 92%)", borderRadius: "4px 14px 14px 14px", background: "var(--hdc-card-bg)", border: "1px solid var(--hdc-card-border)", boxShadow: "var(--hdc-bubble-shadow)", overflow: "hidden" }}>
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px", padding: "10px 14px", borderBottom: "1px solid var(--hdc-card-border)", background: "var(--hdc-card-head)" }}>
      <span style={{ color: "var(--hdc-card-name)", fontWeight: 650, fontSize: 13 }}>{ticket.name}</span>
      <span style={{ color: "var(--hdc-label)", fontSize: 12.5 }}>submitted a request · <span suppressHydrationWarning>{formatDate(ticket.createdAt)}</span></span>
    </div>
    <div style={{ display: "grid", gap: 8, padding: "12px 14px" }}>
      {rows.length === 0 && <span style={{ color: "var(--hdc-label)", fontSize: 13.5 }}>No additional details were submitted.</span>}
      {rows.map((key) => (
        <div key={key} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 160px) 1fr", gap: 12, fontSize: 13.5, lineHeight: 1.45 }}>
          <span style={{ color: "var(--hdc-label)" }}>{LABELS[key]}</span>
          <span style={{ color: "var(--hdc-value)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {key === "country" || key === "shipCountry" ? countryName(values[key]) : key === "registeredEmail" ? <a href={`mailto:${values[key]}`} style={{ color: "var(--hdc-link)" }}>{values[key]}</a> : values[key]}
          </span>
        </div>
      ))}
    </div>
    {/* Products, photos and videos on a quiet neutral panel, so pictures show true to colour. */}
    {media && <div style={{ display: "grid", gap: 12, margin: "0 10px 10px", padding: 12, borderRadius: 10, background: "var(--hdc-media-bg)", border: "1px solid var(--hdc-card-border)", color: "var(--hdc-value)" }}>
      {ticket.receivedProducts.length > 0 && <ProductList heading="Received by mistake" products={ticket.receivedProducts} />}
      {ticket.products.length > 0 && <ProductList heading={ticket.receivedProducts.length ? "Wanted instead" : "Products"} products={ticket.products} />}
      {/* A product issue's photos and videos, under the product they show. */}
      {ticket.products.filter((product) => files.some((file) => file.productId === product.id)).map((product) => (
        <Gallery key={product.id} title={`${product.title}: photos and videos`} files={files.filter((file) => file.productId === product.id)} />
      ))}
      <Gallery files={loose} />
    </div>}
  </div>;
}

type TicketEmail = TicketData["ticket"]["emails"][number];
const EMAIL_KIND: Record<string, string> = {
  "new-ticket": "New ticket alert to your team", "customer-reply": "Customer reply alert to your team",
  ack: "Confirmation to customer", reply: "Reply to customer", status: "Status update to customer", cancellation: "Cancellation update to customer", address: "Address change update to customer",
};

// Delivery state of one queued email, with a retry for failures.
function EmailStatus({ email }: { email: TicketEmail }) {
  const fetcher = useFetcher<typeof action>();
  useResultToast(fetcher, "Email sent again");
  const retrying = fetcher.state !== "idle";
  if (email.status === "sent") return <s-badge tone="success" icon="email">Emailed</s-badge>;
  if (email.status === "pending" || email.status === "processing") {
    return <s-badge tone="info">{email.attempts ? `Retrying (attempt ${email.attempts + 1})` : "Sending email"}</s-badge>;
  }
  return <s-stack direction="inline" gap="small-100" alignItems="center">
    <s-badge tone={email.status === "failed" ? "critical" : "neutral"}>{email.status === "failed" ? "Email failed" : "Email not sent"}</s-badge>
    {email.status === "failed" && <s-button variant="tertiary" icon="refresh" loading={retrying}
      onClick={() => void fetcher.submit({ intent: "email-retry", id: email.id }, { method: "post" })}>Retry</s-button>}
  </s-stack>;
}

const timeOnly = (value: string | Date) => new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
const dayLabel = (value: string | Date) => {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(Date.now() - DAY);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat("en", { weekday: "short", day: "numeric", month: "short", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" }).format(date);
};

// Messaging-app bubble: the customer and the assistant on the left, your team
// on the right in Zion blue, internal notes on the right in amber. Colours come
// from the chat's light and dark palettes (--hdc-* in LAYOUT_CSS).
// Time and delivery sit inside the bubble.
function Message({ message, files, email, isNew, grouped, pending = false }: { message: TicketData["ticket"]["messages"][number]; files: TicketFile[]; email?: TicketEmail; isNew: boolean; grouped: boolean; pending?: boolean }) {
  if (message.kind === "event") {
    return <div style={{ display: "flex", justifyContent: "center", margin: "4px 0" }}>
      <span style={{ maxWidth: "85%", padding: "4px 10px", borderRadius: 8, background: "var(--hdc-event-bg)", color: "var(--hdc-event-ink)", fontSize: 12, textAlign: "center" }}>
        {message.body} · {message.author} · <span suppressHydrationWarning>{timeOnly(message.createdAt)}</span>
      </span>
    </div>;
  }
  const note = message.kind === "note";
  const customer = message.kind === "customer";
  const bot = message.kind === "bot";
  const mine = !customer && !bot;
  const team = mine && !note;
  const tone = note ? "note" : team ? "team" : bot ? "bot" : "in";
  const delivery = pending ? "Sending…" : note ? "🔒 Internal note" : !mine ? "" : email ? "" : message.emailed ? "✓✓ Emailed" : "✓ On request page";
  // The assistant's logo, or the first letter of the team member's name.
  const face = (bot || mine) && <span aria-hidden="true" className={bot ? "hd-bot-face" : undefined} style={{
    display: "grid", placeItems: "center", flex: `0 0 ${bot ? 32 : 28}px`, width: bot ? 32 : 28, height: grouped ? 0 : bot ? 32 : 28, visibility: grouped ? "hidden" : "visible",
    margin: mine ? "0 0 0 8px" : "0 8px 0 0", borderRadius: "50%", fontSize: 12, fontWeight: 800, color: "#fff",
    ...(bot ? {} : { background: note ? "#8a6d1f" : "#ef3a24" }),
  }}>{bot ? "" : nameInitial(message.author)}</span>;
  return <div style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", marginTop: grouped ? 2 : 10, opacity: pending ? 0.7 : 1 }}>
    {bot && face}
    <div style={{
      position: "relative", maxWidth: "min(620px, 78%)", minWidth: 120, padding: "9px 13px 7px", background: `var(--hdc-${tone}-bg)`, color: `var(--hdc-${tone}-ink)`,
      borderRadius: grouped ? 14 : mine ? "14px 4px 14px 14px" : "4px 14px 14px 14px", boxShadow: "var(--hdc-bubble-shadow)",
      border: `1px ${bot ? "dashed" : "solid"} var(--hdc-${tone}-border)`,
    }}>
      {!grouped && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 2, fontSize: 12.5, fontWeight: 650, color: `var(--hdc-${tone}-author)` }}>
        {message.author}
        {isNew && <span style={{ padding: "0 6px", borderRadius: 6, background: "var(--hdc-new-bg)", color: "var(--hdc-new-ink)", fontSize: 11 }}>New</span>}
        {bot && <span style={{ fontWeight: 500, color: "var(--hdc-meta)" }}>· Automated answer</span>}
      </div>}
      <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 14, lineHeight: 1.45 }}>{message.body}</div>
      {files.length > 0 && <div style={{ marginTop: 8, padding: 8, borderRadius: 10, background: "var(--hdc-media-bg)", color: "var(--hdc-value)" }}><Gallery files={files} /></div>}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6, marginTop: 3, fontSize: 11, color: `var(--hdc-${tone}-meta)` }}>
        {delivery && <span>{delivery}</span>}
        <span suppressHydrationWarning>{timeOnly(message.createdAt)}</span>
      </div>
      {email && mine && !note && <div style={{ marginTop: 4, display: "flex", justifyContent: "flex-end" }}><EmailStatus email={email} /></div>}
    </div>
    {mine && face}
  </div>;
}

// Keep ticket details readable and let the conversation open as a docked widget.
const LAYOUT_CSS = `
.hd-ticket { display: block; }
.hd-bot-face { background: #000 url(${ASSISTANT_AVATAR}) center/cover no-repeat; box-shadow: 0 0 0 1.5px rgba(255,255,255,.25); }
.hd-ticket-side { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(280px, .85fr); gap: 18px; min-width: 0; align-items: start; }
.hd-ticket-main, .hd-ticket-rail { display: grid; gap: 16px; min-width: 0; align-content: start; }
.hd-chat { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; height: 100%; min-height: 0; }
.hd-chat-header { display: grid; gap: 12px; padding: 14px 16px; background: var(--hdc-head-bg); color: var(--hdc-head-title); border-bottom: 1px solid var(--hdc-line); }
.hd-chat-header-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; }
.hd-chat-identity { display: flex; align-items: center; gap: 11px; min-width: 0; }
.hd-chat-identity-copy { display: grid; gap: 3px; min-width: 0; }
.hd-chat-identity-copy strong, .hd-chat-identity-copy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hd-chat-identity-copy strong { color: var(--hdc-head-title); font-size: 14px; }
.hd-chat-identity-copy span { color: var(--hdc-head-sub); font-size: 11.5px; }
.hd-chat-header-actions { display: flex; align-items: center; gap: 7px; flex: none; }
.hd-chat-header-action { display: grid; place-items: center; width: 34px; height: 34px; padding: 0; border: 1px solid var(--hdc-btn-border); border-radius: 9px; background: var(--hdc-btn-bg); color: var(--hdc-btn-ink); cursor: pointer; transition: background .15s ease, border-color .15s ease; }
.hd-chat-header-action:hover { background: var(--hdc-btn-hover); }
.hd-chat-header-action:focus-visible, .hd-chat button:focus-visible { outline: 2px solid var(--hdc-focus); outline-offset: 2px; }
.hd-chat-header-action svg { width: 17px; height: 17px; }
.hd-chat-header-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.hd-chat-header-meta > span { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border: 1px solid var(--hdc-chip-border); border-radius: 999px; background: var(--hdc-chip-bg); color: var(--hdc-chip-ink); font-size: 11px; font-weight: 600; line-height: 1.2; }
.hd-chat-header-meta .hd-chat-live { margin-left: auto; border-color: transparent; background: transparent; color: var(--hdc-live); }
.hd-chat-live i { width: 7px; height: 7px; border-radius: 50%; background: #34a86b; animation: hd-live 2s infinite; }
.hd-chat-thread { min-height: 0; overflow: hidden; }
.hd-chat-scroll { height: 100%; min-height: 0; }
.hd-chat-dock { position: fixed; right: 24px; bottom: 24px; z-index: 10001; display: grid; grid-template-rows: minmax(0, 1fr); width: min(440px, calc(100vw - 32px)); height: min(720px, calc(100dvh - 48px)); min-height: 360px; border: 1px solid var(--hdc-frame-border); border-radius: 16px; background: var(--hdc-frame); box-shadow: var(--hdc-frame-shadow); overflow: hidden; opacity: 0; visibility: hidden; transform: translateY(14px) scale(.985); transform-origin: bottom right; pointer-events: none; transition: opacity .18s ease, transform .18s ease, visibility .18s; }
.hd-chat-dock[data-open="true"] { opacity: 1; visibility: visible; transform: translateY(0) scale(1); pointer-events: auto; }
.hd-chat-dock[data-expanded="true"] { top: 12px; right: 12px; bottom: 12px; left: 12px; width: auto; height: auto; min-height: 0; max-height: none; transform: none; }
.hd-chat-dock .hd-chat { height: 100%; }
.hd-chat-launcher { position: fixed; right: 24px; bottom: 24px; z-index: 10000; display: flex; align-items: center; gap: 11px; min-width: 220px; max-width: min(320px, calc(100vw - 32px)); padding: 10px 15px 10px 10px; border: 1px solid var(--hdc-launcher-border); border-radius: 999px; background: #172351; color: #fff; box-shadow: 0 8px 28px rgba(12,20,43,.3); cursor: pointer; text-align: left; font: inherit; transition: transform .16s ease, box-shadow .16s ease, opacity .16s ease; }
.hd-chat-launcher:hover { transform: translateY(-2px); box-shadow: 0 12px 34px rgba(12,20,43,.38); }
.hd-chat-launcher:focus-visible { outline: 3px solid #7e9cff; outline-offset: 3px; }
.hd-chat-launcher[data-open="true"] { opacity: 0; pointer-events: none; }
.hd-chat-launch-icon { display: grid; place-items: center; flex: none; width: 42px; height: 42px; border-radius: 50%; background: #EF3A24; }
.hd-chat-launch-icon svg { width: 21px; height: 21px; }
.hd-chat-launch-copy { display: grid; gap: 2px; min-width: 0; flex: 1; }
.hd-chat-launch-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.hd-chat-launch-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #B7C2E4; font-size: 11px; }
.hd-chat-launch-badge { display: grid; place-items: center; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: #EF3A24; color: #fff; font-size: 11px; font-weight: 700; }
.hd-chat-input { display: flex; align-items: flex-end; gap: 8px; padding: 5px 5px 5px 14px; border: 1px solid var(--hdc-input-border); border-radius: 14px; background: var(--hdc-input-bg); transition: border-color .15s ease, box-shadow .15s ease; }
.hd-chat-input:focus-within { border-color: var(--hdc-focus); box-shadow: 0 0 0 3px var(--hdc-focus-ring); }
.hd-chat-input textarea { flex: 1; min-width: 0; min-height: 24px; max-height: 180px; margin: 0; padding: 8px 0; border: 0; outline: 0; resize: none; background: transparent; color: var(--hdc-in-ink); font: inherit; font-size: 14px; line-height: 1.45; }
.hd-chat-input textarea::placeholder { color: var(--hdc-hint); }
.hd-chat-input[aria-invalid], .hd-chat-input:has(textarea[aria-invalid]) { border-color: var(--hdc-error); }
.hd-chat-send { flex: none; display: grid; place-items: center; width: 38px; height: 38px; padding: 0; border: 0; border-radius: 50%; background: var(--hdc-send); color: #fff; cursor: pointer; box-shadow: 0 2px 6px rgba(239,58,36,.3); transition: transform .12s ease, opacity .15s ease, box-shadow .15s ease; }
.hd-chat-input[data-note] .hd-chat-send { background: var(--hdc-send-note); box-shadow: 0 2px 6px rgba(183,121,31,.3); }
.hd-chat-send:not(:disabled):hover { transform: scale(1.06); }
.hd-chat-send:disabled { opacity: .35; cursor: not-allowed; box-shadow: none; }
.hd-chat-send svg { width: 18px; height: 18px; }
.hd-chat-resolve { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; padding: 6px 12px; border: 1px solid var(--hdc-ghost-border); border-radius: 999px; background: transparent; color: var(--hdc-ghost-ink); font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; transition: background .15s ease, opacity .15s ease; }
.hd-chat-resolve:not(:disabled):hover { background: var(--hdc-seg-bg); }
.hd-chat-resolve:disabled { opacity: .45; cursor: not-allowed; }
.hd-chat-resolve svg { width: 14px; height: 14px; color: var(--hdc-ok); }
@media (prefers-reduced-motion: reduce) { .hd-chat-send, .hd-chat-input { transition: none; } }
.hd-typing { display: inline-flex; align-items: center; gap: 9px; margin-top: 10px; padding: 9px 13px; border: 1px solid var(--hdc-in-border); border-radius: 4px 14px 14px 14px; background: var(--hdc-in-bg); box-shadow: var(--hdc-bubble-shadow); animation: hd-typing-in .18s ease-out; }
.hd-typing-dots { display: inline-flex; gap: 4px; }
.hd-typing-dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--hdc-meta); animation: hd-typing 1.2s infinite ease-in-out; }
.hd-typing-dots i:nth-child(2) { animation-delay: .15s; }
.hd-typing-dots i:nth-child(3) { animation-delay: .3s; }
.hd-typing-name { color: var(--hdc-meta); font-size: 12px; }
@keyframes hd-typing { 0%, 60%, 100% { transform: translateY(0); opacity: .45; } 30% { transform: translateY(-4px); opacity: 1; } }
@keyframes hd-typing-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .hd-typing-dots i, .hd-typing { animation: none; } .hd-typing-dots i { opacity: .8; } }
/* The chat's colours. Light: white panels on a soft grey thread, like a
   modern help desk. Dark: graphite panels that sit on the Polaris dark admin.
   Your team's messages stay Zion blue in both, the send button Zion red. */
.hd-chat-dock, .hd-chat-launcher {
  --hdc-frame: #e9edf7; --hdc-frame-border: #cfd6e6; --hdc-frame-shadow: 0 24px 64px rgba(23,35,81,.22), 0 2px 6px rgba(23,35,81,.08); --hdc-line: #d5dcec;
  --hdc-head-bg: linear-gradient(135deg, #172351 0%, #22306b 100%); --hdc-head-title: #ffffff; --hdc-head-sub: #c1cbea;
  --hdc-btn-bg: rgba(255,255,255,.08); --hdc-btn-border: rgba(255,255,255,.2); --hdc-btn-ink: #ffffff; --hdc-btn-hover: rgba(255,255,255,.16); --hdc-focus: #334fb4; --hdc-focus-ring: rgba(51,79,180,.18);
  --hdc-chip-bg: rgba(255,255,255,.09); --hdc-chip-border: rgba(255,255,255,.14); --hdc-chip-ink: #e5eaf7; --hdc-live: #8fe3b0;
  --hdc-thread-bg: #dfe5f3; --hdc-thread-glow: rgba(51,79,180,.18); --hdc-thread-dot: rgba(23,35,81,.08); --hdc-scroll: #a9b3cb;
  --hdc-input-bg: #ffffff; --hdc-input-border: #c6cee0; --hdc-error: #d92d20;
  --hdc-pill-bg: #172351; --hdc-pill-border: #172351; --hdc-pill-ink: #ffffff; --hdc-event-bg: rgba(255,255,255,.72); --hdc-event-ink: #3d4a66;
  --hdc-bubble-shadow: 0 1px 2px rgba(23,35,81,.1), 0 2px 8px rgba(23,35,81,.06);
  --hdc-in-bg: #ffffff; --hdc-in-border: #d3dae9; --hdc-in-ink: #1d2433; --hdc-in-author: #172351; --hdc-in-meta: #8a92a0;
  --hdc-bot-bg: #f7f9ff; --hdc-bot-border: #9fabca; --hdc-bot-ink: #1d2433; --hdc-bot-author: #5b6475; --hdc-bot-meta: #8a92a0; --hdc-meta: #8a92a0;
  --hdc-team-bg: #334fb4; --hdc-team-border: #2b449e; --hdc-team-ink: #ffffff; --hdc-team-author: #dce3ff; --hdc-team-meta: rgba(255,255,255,.75);
  --hdc-note-bg: #fff6dc; --hdc-note-border: #f0d98d; --hdc-note-ink: #5c4300; --hdc-note-author: #8a6400; --hdc-note-meta: #9b7a22;
  --hdc-new-bg: #e6effc; --hdc-new-ink: #003a80;
  --hdc-card-bg: #ffffff; --hdc-card-border: #d3dae9; --hdc-card-head: #f9fafb; --hdc-card-name: #c4320a; --hdc-label: #667085; --hdc-value: #1d2433; --hdc-link: #2458a6; --hdc-media-bg: #f9fafb;
  --hdc-bar-bg: #e9edf7; --hdc-bar-ink: #344054; --hdc-bar-note-bg: #fffbeb; --hdc-bar-note-border: #f0d98d;
  --hdc-seg-bg: #ffffff; --hdc-seg-border: #cfd6e6; --hdc-seg-ink: #475467; --hdc-accent: #172351; --hdc-note-accent: #a36d0a;
  --hdc-hint: #5b6680; --hdc-ok: #0c7a43;
  --hdc-sugg-bg: #ffffff; --hdc-sugg-border: #c6cee0; --hdc-sugg-ink: #344054;
  --hdc-ghost-border: #b9c2d8; --hdc-ghost-ink: #172351; --hdc-send: #ef3a24; --hdc-send-note: #b7791f;
  --hdc-switch-bg: #ffffff; --hdc-switch-border: #cfd6e6; --hdc-switch-ink: #475467; --hdc-track: #c5cad4;
  --hdc-switch-on-bg: #e3f5ea; --hdc-switch-on-border: rgba(12,122,67,.35); --hdc-switch-on-ink: #0c5132;
  --hdc-empty-bg: rgba(255,255,255,.7); --hdc-empty-title: #344054; --hdc-empty-ink: #667085;
  --hdc-launcher-border: #d9dfef;
}
.hd-theme-dark .hd-chat-dock, .hd-theme-dark .hd-chat-launcher {
  --hdc-frame: #1a1a1a; --hdc-frame-border: #333333; --hdc-frame-shadow: 0 24px 70px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,.03); --hdc-line: #2c2c2c;
  --hdc-head-bg: #1f1f1f; --hdc-head-title: #f2f2f2; --hdc-head-sub: #a3a3a3;
  --hdc-btn-bg: #262626; --hdc-btn-border: #3a3a3a; --hdc-btn-ink: #e5e5e5; --hdc-btn-hover: #303030; --hdc-focus: #8ea2ff; --hdc-focus-ring: rgba(142,162,255,.2);
  --hdc-input-bg: #242424; --hdc-input-border: #3a3a3a; --hdc-error: #f97066;
  --hdc-chip-bg: #262626; --hdc-chip-border: #363636; --hdc-chip-ink: #d6d6d6; --hdc-live: #6ee7a8;
  --hdc-thread-bg: #121212; --hdc-thread-glow: rgba(59,91,219,.14); --hdc-thread-dot: rgba(255,255,255,.035); --hdc-scroll: #3d3d3d;
  --hdc-pill-bg: #1f1f1f; --hdc-pill-border: #333333; --hdc-pill-ink: #cfcfcf; --hdc-event-bg: rgba(255,255,255,.06); --hdc-event-ink: #b5b5b5;
  --hdc-bubble-shadow: 0 1px 2px rgba(0,0,0,.4);
  --hdc-in-bg: #262626; --hdc-in-border: #333333; --hdc-in-ink: #ececec; --hdc-in-author: #c5ceff; --hdc-in-meta: #8f8f8f;
  --hdc-bot-bg: #202020; --hdc-bot-border: #474747; --hdc-bot-ink: #e2e2e2; --hdc-bot-author: #a8a8a8; --hdc-bot-meta: #8f8f8f; --hdc-meta: #8f8f8f;
  --hdc-team-bg: #3b5bdb; --hdc-team-border: #3352c4; --hdc-team-ink: #ffffff; --hdc-team-author: #e0e6ff; --hdc-team-meta: rgba(255,255,255,.75);
  --hdc-note-bg: #362b10; --hdc-note-border: #6b5520; --hdc-note-ink: #f3dfa2; --hdc-note-author: #f5c95c; --hdc-note-meta: #c9a54f;
  --hdc-new-bg: #1c2a50; --hdc-new-ink: #b3c3ff;
  --hdc-card-bg: #1f1f1f; --hdc-card-border: #333333; --hdc-card-head: #242424; --hdc-card-name: #ff9c8c; --hdc-label: #a3a3a3; --hdc-value: #ececec; --hdc-link: #9db4ff; --hdc-media-bg: #262626;
  --hdc-bar-bg: #1a1a1a; --hdc-bar-ink: #d4d4d4; --hdc-bar-note-bg: #2a2310; --hdc-bar-note-border: #5c4a1a;
  --hdc-seg-bg: #242424; --hdc-seg-border: #363636; --hdc-seg-ink: #cfcfcf; --hdc-accent: #3b5bdb; --hdc-note-accent: #a36d0a;
  --hdc-hint: #8f8f8f; --hdc-ok: #6ee7a8;
  --hdc-sugg-bg: #242424; --hdc-sugg-border: #3a3a3a; --hdc-sugg-ink: #d4d4d4;
  --hdc-ghost-border: #4a4a4a; --hdc-ghost-ink: #e5e5e5; --hdc-send: #ef3a24; --hdc-send-note: #b7791f;
  --hdc-switch-bg: #242424; --hdc-switch-border: #3a3a3a; --hdc-switch-ink: #cfcfcf; --hdc-track: #4a4a4a;
  --hdc-switch-on-bg: rgba(52,168,107,.16); --hdc-switch-on-border: rgba(52,168,107,.5); --hdc-switch-on-ink: #b9f0cf;
  --hdc-empty-bg: rgba(255,255,255,.06); --hdc-empty-title: #d6d6d6; --hdc-empty-ink: #9a9a9a;
  --hdc-launcher-border: rgba(255,255,255,.14);
}
@media (max-width: 560px) {
  .hd-ticket-side { grid-template-columns: minmax(0, 1fr); }
  .hd-chat-dock { right: 12px; bottom: 12px; width: calc(100vw - 24px); height: calc(100dvh - 24px); min-height: 300px; }
  .hd-chat-launcher { right: 16px; bottom: 16px; min-width: 0; }
}
@media (min-width: 561px) and (max-width: 1100px) { .hd-ticket-side { grid-template-columns: minmax(0, 1.3fr) minmax(250px, .9fr); gap: 12px; } }
@media (max-width: 560px) { .hd-chat-header { gap: 9px; padding: 11px 12px; } .hd-chat-header-meta .hd-chat-live { margin-left: 0; } .hd-chat-header-action { width: 32px; height: 32px; } }
@media (prefers-reduced-motion: reduce) { .hd-chat-dock, .hd-chat-launcher { transition: none; } }
`;

// A card in the right-hand column.
function SideCard({ heading, children }: { heading: string; children: React.ReactNode }) {
  return <section className="hd-admin-card" aria-label={heading} style={{ background: "var(--hd-surface, #fff)", border: "1px solid var(--hd-border, #E3E3E3)", borderRadius: 12, boxShadow: "0 1px 0 rgba(26,26,26,.07)", overflow: "hidden" }}>
    <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--hd-border, #EBEBEB)", background: "var(--hd-surface-muted, #FAFAFA)", fontSize: 13, fontWeight: 650, color: "var(--hd-ink, #303030)" }}>{heading}</div>
    <div style={{ padding: 16 }}>{children}</div>
  </section>;
}

const STATUS_DOT: Record<string, string> = { Open: "#F5A524", "In progress": "#5B8DEF", "Waiting on customer": "#A78BFA", Resolved: "#34A86B", Closed: "#8C97BD" };

// The chat window's top bar: the customer, where the ticket stands, and a live
// dot (the page checks for new messages every second).
function ChatHeader({ ticket, count, onClose, onExpand, expanded }: { ticket: TicketData["ticket"]; count: number; onClose: () => void; onExpand: () => void; expanded: boolean }) {
  const initials = ticket.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "?";
  const chip = (text: string, color: string) => <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 9px", borderRadius: 999, fontSize: 11, fontWeight: 600, color: "var(--hdc-chip-ink)", background: "var(--hdc-chip-bg)", border: "1px solid var(--hdc-chip-border)", whiteSpace: "nowrap" }}>
    <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />{text}
  </span>;
  return <div className="hd-chat-header">
    <style>{"@keyframes hd-live { 0% { box-shadow: 0 0 0 0 rgba(52,168,107,.6) } 70% { box-shadow: 0 0 0 7px rgba(52,168,107,0) } 100% { box-shadow: 0 0 0 0 rgba(52,168,107,0) } }"}</style>
    <div className="hd-chat-header-top">
      <div className="hd-chat-identity">
        <span aria-hidden="true" style={{ display: "grid", placeItems: "center", width: 40, height: 40, borderRadius: "50%", background: "#334FB4", color: "#FFFFFF", fontWeight: 700, fontSize: 15, flex: "none" }}>{initials}</span>
        <div className="hd-chat-identity-copy">
          <strong>{ticket.name}</strong>
          <span>{ticket.email}{ticket.category ? "\u00b7 " + (ticket.subcategory ? ticket.category + " \u203a " + ticket.subcategory : ticket.category) : ""}</span>
        </div>
      </div>
      <div className="hd-chat-header-actions">
        <button type="button" className="hd-chat-header-action" aria-label={expanded ? "Exit full screen" : "Open full screen chat"} title={expanded ? "Exit full screen" : "Full screen"} aria-pressed={expanded} onClick={onExpand}>
          {expanded
            ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M8 3v5H3m13-5v5h5M3 16h5v5m13-5h-5v5"/></svg>
            : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>}
        </button>
        <button type="button" className="hd-chat-header-action" aria-label="Close chat" title="Close chat" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </div>
    </div>
    <div className="hd-chat-header-meta">
      {chip(ticket.status, STATUS_DOT[ticket.status] ?? "#8C97BD")}
      {ticket.priority !== "Normal" && chip(`${ticket.priority} priority`, ticket.priority === "Urgent" || ticket.priority === "High" ? "#EF3A24" : "#8C97BD")}
      {chip(ticket.assignee || "Unassigned", ticket.assignee ? "#5B8DEF" : "#8C97BD")}
      {ticket.channel === "chat" && chip("Live Chat", "#5B8DEF")}
      <CancelBadge status={ticket.cancelStatus} />
      <AddressBadge status={ticket.addressStatus} />
      <ReturnBadge status={ticket.returnStatus} />
      <EditBadge status={ticket.editStatus} />
      <ReplacementBadge status={ticket.replacementStatus} kind={ticket.replacementKind} />
      <QuoteBadge status={ticket.quoteStatus} />
      <span className="hd-chat-live" title="New messages appear here automatically"><i aria-hidden="true" />Live · {count} message{count === 1 ? "" : "s"}</span>
    </div>
  </div>;
}

// The conversation as a chat window: fixed height, opens at the newest
// message and stays there as new ones arrive, unless you've scrolled up to
// read, then a button offers to jump down.
function ChatThread({ ticket, replyEmails, readAt, typing = false }: { ticket: TicketData["ticket"]; replyEmails: Map<string, TicketEmail>; readAt: number; typing?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  // Photos load after the first paint and push the thread down; stay on the newest message while pinned.
  useEffect(() => {
    const node = box.current;
    const inner = content.current;
    if (!node || !inner || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => { if (pinned.current) node.scrollTop = node.scrollHeight; });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);
  // A reply or note being sent shows at once, marked as sending, until the saved one replaces it.
  const sending = useFetchers().flatMap((fetcher) => {
    const form = fetcher.formData;
    if (fetcher.state === "idle" || form?.get("intent") !== "message" || form.get("id") !== ticket.id) return [];
    const body = String(form.get("body") ?? "").trim();
    return body ? [{ id: `sending-${fetcher.key}`, kind: String(form.get("kind")), author: String(form.get("author") ?? ""), body }] : [];
  });
  const [unseen, setUnseen] = useState(0);
  const count = ticket.messages.length + sending.length;
  const seenCount = useRef(count);
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    if (pinned.current) { node.scrollTop = node.scrollHeight; setUnseen(0); }
    else if (count > seenCount.current) setUnseen((value) => value + count - seenCount.current);
    seenCount.current = count;
  }, [count]);
  const toBottom = () => { const node = box.current; if (node) node.scrollTo({ top: node.scrollHeight, behavior: "smooth" }); setUnseen(0); };
  let lastDay = "";
  let lastAuthor = "";
  return <div className="hd-chat-thread" style={{ position: "relative", height: "100%" }}>
    <div ref={box} onScroll={(event) => {
      const node = event.currentTarget;
      pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
      if (pinned.current && unseen) setUnseen(0);
    }} style={{
      // Fills the screen above the reply box, like a chat app.
      // (The whole window, reply box included, fits on screen: it stays in view as the right column scrolls.)
      height: "100%", minHeight: 0, overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: "var(--hdc-scroll) transparent", padding: "12px 14px 14px",
      // A quiet thread: a soft glow in Zion blue and a faint dot texture.
      backgroundColor: "var(--hdc-thread-bg)", backgroundImage: "radial-gradient(circle at 18% 0%, var(--hdc-thread-glow), transparent 48%), radial-gradient(var(--hdc-thread-dot) 1px, transparent 1px)", backgroundSize: "auto, 18px 18px",
    }}>
      <div ref={content}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
        <span suppressHydrationWarning style={{ padding: "4px 11px", borderRadius: 999, background: "var(--hdc-pill-bg)", border: "1px solid var(--hdc-pill-border)", color: "var(--hdc-pill-ink)", fontSize: 11.5, fontWeight: 600 }}>{dayLabel(ticket.createdAt)}</span>
      </div>
      <OriginalRequest ticket={ticket} />
      {ticket.messages.map((message) => {
        const day = new Date(message.createdAt).toDateString();
        const newDay = day !== lastDay && day !== new Date(ticket.createdAt).toDateString();
        const author = `${message.kind}:${message.author}`;
        const grouped = !newDay && author === lastAuthor && message.kind !== "event";
        lastDay = day;
        lastAuthor = message.kind === "event" ? "" : author;
        return <div key={message.id}>
          {newDay && <div style={{ display: "flex", justifyContent: "center", margin: "12px 0 4px" }}>
            <span suppressHydrationWarning style={{ padding: "4px 11px", borderRadius: 999, background: "var(--hdc-pill-bg)", border: "1px solid var(--hdc-pill-border)", color: "var(--hdc-pill-ink)", fontSize: 11.5, fontWeight: 600 }}>{dayLabel(message.createdAt)}</span>
          </div>}
          <Message message={message} email={replyEmails.get(message.id)} grouped={grouped}
            files={ticket.attachments.filter((file) => file.messageId === message.id)}
            isNew={Boolean(readAt) && message.kind === "customer" && new Date(message.createdAt).getTime() > readAt} />
        </div>;
      })}
      {!ticket.messages.some((message) => message.kind !== "event") && !sending.length && <div style={{ display: "grid", justifyItems: "center", gap: 6, margin: "48px auto 0", maxWidth: 320, textAlign: "center", color: "var(--hdc-empty-ink)", fontSize: 13 }}>
        <span aria-hidden="true" style={{ display: "grid", placeItems: "center", width: 44, height: 44, borderRadius: "50%", background: "var(--hdc-empty-bg)", fontSize: 20 }}>💬</span>
        <span style={{ color: "var(--hdc-empty-title)", fontWeight: 600 }}>No replies yet</span>
        <span>Write to {ticket.name.split(" ")[0] || "the customer"} below. They see your reply on their request page right away.</span>
      </div>}
      {sending.map((message) => <Message key={message.id} pending isNew={false} grouped={false} files={[]}
        message={{ ...ticket.messages.at(-1)!, ...message, emailed: false, createdAt: new Date() }} />)}
      {typing && <TypingBubble name={ticket.name.split(/\s+/)[0] || "The customer"} />}
      </div>
    </div>
    {unseen > 0 && <button type="button" onClick={toBottom} style={{
      position: "absolute", left: "50%", bottom: 14, transform: "translateX(-50%)", padding: "7px 14px", border: 0, borderRadius: 999, cursor: "pointer",
      background: "#EF3A24", color: "#fff", font: "inherit", fontSize: 13, fontWeight: 600, boxShadow: "0 4px 14px rgba(16,24,40,.28)",
    }}>{unseen} new message{unseen === 1 ? "" : "s"} ↓</button>}
  </div>;
}

// The customer is writing: three dots in a bubble on their side, like a messaging app.
function TypingBubble({ name }: { name: string }) {
  return <div className="hd-typing" role="status" aria-label={`${name} is typing`}>
    <span className="hd-typing-dots" aria-hidden="true"><i /><i /><i /></span>
    <span className="hd-typing-name">{name} is typing</span>
  </div>;
}

// Where a reply goes. The request page always gets it (that's the chat the
// customer sees in the store); email also sends it to their inbox. Only
// channels that are set up are offered; WhatsApp and SMS join this list once
// a messaging account is connected.
const CHANNELS = [
  { id: "page", label: "Request page", icon: "chat" },
  { id: "email", label: "Email", icon: "email" },
] as const;

function ChannelPicker({ value, onChange, email }: { value: "page" | "email"; onChange: (value: "page" | "email") => void; email: string }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <span style={{ fontSize: 12.5, color: "var(--hdc-hint)" }}>Send via</span>
    <div role="radiogroup" aria-label="Send via" title={`Request page: shown in their chat in your store. Email: also sent to ${email}.`}
      style={{ display: "flex", padding: 3, gap: 2, borderRadius: 10, background: "var(--hdc-seg-bg)", border: "1px solid var(--hdc-seg-border)" }}>
      {CHANNELS.map((channel) => {
        const active = value === channel.id;
        return <button key={channel.id} type="button" role="radio" aria-checked={active} onClick={() => onChange(channel.id)} style={{
          display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 8, font: "inherit", fontSize: 12.5, cursor: "pointer",
          fontWeight: active ? 650 : 500, color: active ? "#fff" : "var(--hdc-seg-ink)", background: active ? "var(--hdc-accent)" : "transparent", border: 0,
        }}>
          <s-icon type={channel.icon} size="small" />
          {channel.label}
        </button>;
      })}
    </div>
  </div>;
}

// Opens the conversation dock from anywhere on the page ("Join chat").
const OPEN_CHAT_EVENT = "hd-open-chat";

// Joins a chat that's waiting for a person: a greeting goes to the customer's
// request page at once (their chat stops showing "Connecting"), the request is
// no longer flagged, and the assistant stays quiet while the team chats.
function JoinChat({ ticket, author, storeName }: { ticket: TicketData["ticket"]; author: string; storeName: string }) {
  const fetcher = useFetcher<typeof action>();
  useResultToast(fetcher, `You joined the chat. ${ticket.name.split(/\s+/)[0] || "The customer"} sees your message now.`);
  const first = ticket.name.trim().split(/\s+/)[0];
  const body = `Hi${first ? ` ${first}` : ""}, this is ${author.replace(/ Support$/, "")} from the ${storeName} team. I've joined the chat and I'm reading your messages now. How can I help?`;
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !Object.keys(fetcher.data.errors).length) document.querySelector<HTMLTextAreaElement>(".hd-chat textarea")?.focus();
  }, [fetcher.state, fetcher.data]);
  return <div style={{ marginTop: 10 }}>
    <s-button variant="primary" icon="chat" loading={fetcher.state !== "idle"}
      onClick={() => {
        // The conversation opens at once, so the greeting appears in it as it's sent.
        window.dispatchEvent(new CustomEvent(OPEN_CHAT_EVENT));
        void fetcher.submit({ intent: "message", id: ticket.id, kind: "reply", channel: "page", author, body, status: "In progress" }, { method: "post" });
      }}>Join chat</s-button>
  </div>;
}

function Composer({ ticket, macros, storeName, team, configured, me, order }: { ticket: TicketData["ticket"]; macros: TicketData["macros"]; storeName: string; team: string[]; configured: boolean; me: string; order: MacroOrder | null }) {
  const fetcher = useFetcher<typeof action>();
  const [kind, setKind] = useState<"reply" | "note">("reply");
  const [body, setBody] = useState("");
  const [macro, setMacro] = useState("");
  const [channel, setChannel] = useState<"page" | "email">("page");
  const groups = groupMacros(macros, ticket);
  const offered = groups.suggested.length ? groups.suggested : groups.general;
  const insert = (id: string) => {
    const chosen = macros.find((item) => item.id === id);
    // Choosing a saved reply swaps in its text, replacing the previous one.
    setMacro(chosen?.id ?? "");
    if (chosen) setBody(fillMacro(chosen.body, ticket, storeName, order));
  };
  const authors = [...new Set([...(me ? [me] : []), ...team, `${storeName} Support`])];
  // Replies go out as the staff member signed in to Shopify; a choice made on this device is remembered when they aren't known.
  const [author, setAuthor] = useState(() => me || (ticket.assignee && authors.includes(ticket.assignee) ? ticket.assignee : authors[0]));
  useEffect(() => {
    if (me) return;
    try { const saved = localStorage.getItem("help-desk-author"); if (saved && authors.includes(saved)) setAuthor(saved); } catch { /* storage unavailable */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const sending = fetcher.state !== "idle";
  const sentKind = useRef(kind);
  useResultToast(fetcher, (result) => sentKind.current === "note" ? "Note added" : result.emailed ? "Reply sent to the customer" : "Reply saved. It's shown on the customer's request page.");
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !Object.keys(fetcher.data.errors).length) { setBody(""); setMacro(""); }
  }, [fetcher.state, fetcher.data]);
  const send = (status = "") => {
    sentKind.current = kind;
    try { localStorage.setItem("help-desk-author", author); } catch { /* storage unavailable */ }
    void fetcher.submit({ intent: "message", id: ticket.id, kind, body, author, status, channel }, { method: "post" });
  };
  const note = kind === "note";
  const pill = (value: "reply" | "note", label: string) => <button type="button" role="tab" aria-selected={kind === value} onClick={() => setKind(value)} style={{
    padding: "7px 14px", borderRadius: 8, font: "inherit", fontSize: 13.5, cursor: "pointer", fontWeight: kind === value ? 650 : 500, border: 0,
    color: kind === value ? "#fff" : "var(--hdc-seg-ink)", background: kind === value ? (value === "note" ? "var(--hdc-note-accent)" : "var(--hdc-accent)") : "transparent",
  }}>{label}</button>;
  // The box grows with what's typed, up to a few lines, then scrolls.
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const node = input.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 180)}px`;
  }, [body]);
  const empty = !body.trim() || sending;
  const lastPing = useRef(0);
  const pingTyping = () => {
    if (note || Date.now() - lastPing.current < 2_000) return;
    lastPing.current = Date.now();
    void fetch(`/app/help-desk-pulse?ticket=${encodeURIComponent(ticket.id)}&typing=${encodeURIComponent(author)}`, { headers: { Accept: "application/json" }, cache: "no-store" }).catch(() => {});
  };
  // The reply box is the bottom bar of the chat window, like a messaging app.
  const where = note ? "🔒 Only your team sees notes" : channel === "email" ? `Shown in their chat and emailed to ${ticket.email}` : "The customer sees this in their chat on the request page";
  return <div style={{ display: "grid", gap: 9, padding: "12px 14px 13px", background: note ? "var(--hdc-bar-note-bg)" : "var(--hdc-bar-bg)", borderTop: `1px solid ${note ? "var(--hdc-bar-note-border)" : "var(--hdc-line)"}`, color: "var(--hdc-bar-ink)", transition: "background .15s" }}>
    {ticket.status === "Resolved" && <span style={{ fontSize: 13, color: "var(--hdc-ok)" }}>✓ This ticket is resolved. If the customer replies, it reopens automatically.</span>}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <div role="tablist" aria-label="Message type" style={{ display: "flex", padding: 3, gap: 2, borderRadius: 10, background: "var(--hdc-seg-bg)", border: "1px solid var(--hdc-seg-border)" }}>
        {pill("reply", `Reply to ${ticket.name.split(" ")[0] || "customer"}`)}
        {pill("note", "Internal note")}
      </div>
      {!note && configured && <div style={{ marginLeft: "auto" }}><ChannelPicker value={channel} onChange={setChannel} email={ticket.email} /></div>}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
      <div>
        {/* Only the replies for this ticket's category; general ones when it has none. */}
        <s-select label="Insert a saved reply" labelAccessibilityVisibility="exclusive" value={macro} disabled={!offered.length} onChange={(event) => insert(event.currentTarget.value ?? "")}>
          <s-option value="">{offered.length ? "Insert a saved reply" : "No saved replies for this category"}</s-option>
          <s-option-group label={groups.suggested.length ? `For ${ticket.subcategory || ticket.category}` : "General replies"}>
            {offered.map((item) => <s-option key={item.id} value={item.id}>{item.title}</s-option>)}
          </s-option-group>
        </s-select>
      </div>
      <div>
        <s-select label={note ? "Note by" : "Reply as"} labelAccessibilityVisibility="exclusive" value={author} onChange={(event) => setAuthor(event.currentTarget.value || authors[0])}>
          {authors.map((name) => <s-option key={name} value={name}>{note ? "Note by" : "Reply as"} {name}</s-option>)}
        </s-select>
      </div>
    </div>
    {!note && groups.suggested.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      <span style={{ fontSize: 12.5, color: "var(--hdc-hint)" }}>Suggested:</span>
      {groups.suggested.slice(0, 4).map((item) => <button key={item.id} type="button" onClick={() => insert(item.id)} style={{
        padding: "4px 11px", borderRadius: 999, font: "inherit", fontSize: 12.5, cursor: "pointer",
        color: macro === item.id ? "#FFFFFF" : "var(--hdc-sugg-ink)", background: macro === item.id ? "var(--hdc-accent)" : "var(--hdc-sugg-bg)", border: `1px solid ${macro === item.id ? "var(--hdc-accent)" : "var(--hdc-sugg-border)"}`,
      }}>{item.title}</button>)}
    </div>}
    {/* Like a messaging app: Enter sends, Shift + Enter starts a new line (not while an IME is composing). */}
    <div className="hd-chat-input" data-note={note || undefined}>
      <textarea ref={input} rows={1} value={body} maxLength={MAX_MESSAGE_LENGTH} aria-label={note ? "Note" : "Message"} aria-invalid={Boolean(fetcher.data?.errors.body) || undefined}
        placeholder={note ? "Write a note only your team can see..." : `Write a message to ${ticket.name}...`}
        onChange={(event) => { setBody(event.currentTarget.value); if (event.currentTarget.value.trim()) pingTyping(); }}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.altKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!empty) send(); } }} />
      <button type="button" className="hd-chat-send" disabled={empty} onClick={() => send()}
        aria-label={note ? "Add note" : channel === "email" ? "Send by email" : "Send"} title={note ? "Add note (Enter)" : "Send (Enter)"}>
        {sending
          ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur=".8s" repeatCount="indefinite" /></path></svg>
          : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>}
      </button>
    </div>
    {fetcher.data?.errors.body && <span role="alert" style={{ fontSize: 12.5, color: "var(--hdc-error)" }}>{fetcher.data.errors.body}</span>}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {!note && <>
          <MediaSwitch ticket={ticket} kind="photos" />
          <MediaSwitch ticket={ticket} kind="videos" />
        </>}
      </div>
      {!note && <button type="button" className="hd-chat-resolve" disabled={empty} onClick={() => send("Resolved")} title="Send this reply and mark the ticket Resolved">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
        Send and resolve
      </button>}
    </div>
    <span style={{ fontSize: 12, color: "var(--hdc-hint)" }}>{where} · Enter to send · Shift + Enter for a new line</span>
  </div>;
}

// Whether the customer can add photos, or a video, to their replies. Off until
// staff ask; the request page shows "Add photos" / "Add a video" within a couple of seconds.
const MEDIA = {
  photos: { field: "allowPhotos", icon: "📷", short: "Photos", name: "Photo uploads", noun: "photos", example: "send photos with their reply, e.g. of a damaged item" },
  videos: { field: "allowVideos", icon: "🎥", short: "Video", name: "Video uploads", noun: "a video", example: "send a video with their reply, e.g. of a lid that won't close" },
} as const;
function MediaSwitch({ ticket, kind }: { ticket: TicketData["ticket"]; kind: keyof typeof MEDIA }) {
  const media = MEDIA[kind];
  const fetcher = useFetcher<typeof action>();
  const asked = useRef(false);
  useResultToast(fetcher, () => `${media.name} turned ${asked.current ? "on" : "off"}`);
  // Shows the new position straight away, before the server answers.
  const on = fetcher.formData ? fetcher.formData.get(media.field) === "true" : ticket[media.field];
  const first = ticket.name.split(" ")[0] || "the customer";
  const toggle = () => { asked.current = !on; void fetcher.submit({ intent: "update", id: ticket.id, [media.field]: String(!on) }, { method: "post" }); };
  const hint = on ? `${first} can add ${media.noun} to their reply on the request page.` : `Turn on to let ${first} ${media.example}.`;
  return <button type="button" role="switch" aria-checked={on} aria-label={`Allow ${first} to add ${media.noun}`} title={hint} onClick={toggle} disabled={fetcher.state !== "idle"} style={{
    display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 10px 5px 6px", borderRadius: 999, font: "inherit", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
    color: on ? "var(--hdc-switch-on-ink)" : "var(--hdc-switch-ink)", background: on ? "var(--hdc-switch-on-bg)" : "var(--hdc-switch-bg)", border: `1px solid ${on ? "var(--hdc-switch-on-border)" : "var(--hdc-switch-border)"}`,
  }}>
    <span aria-hidden="true" style={{ position: "relative", flex: "none", width: 30, height: 18, borderRadius: 999, background: on ? "#34A86B" : "var(--hdc-track)", transition: "background .15s" }}>
      <span style={{ position: "absolute", top: 2, left: on ? 14 : 2, width: 14, height: 14, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
    </span>
    {media.icon} {media.short} {on ? "on" : "off"}
  </button>;
}

// Category › Sub-category › Root cause › Resolution. Set automatically when the
// ticket arrives; correcting it keeps the overview's reports accurate.
function Classification({ ticket, busy, update }: { ticket: TicketData["ticket"]; busy: boolean; update: (changes: Record<string, string>) => void }) {
  const subcategories = subcategoriesOf(ticket.category);
  const needsResolution = ticket.status === "Resolved" && !ticket.resolutionType;
  // Until someone on the team changes the category, it's the app's guess.
  const automatic = Boolean(ticket.category) && !ticket.messages.some((message) => message.kind === "event" && /^Category (set to|cleared)/.test(message.body));
  const team = teamFor(ticket.rootCause);
  // What the customer asked for on the form ("What would you like?"), as a
  // resolution the team can confirm with one click. Never set for them: what
  // the team does can differ.
  const asked = ticket.details.resolution || "";
  const askedType = asked === "Return" ? "Return accepted" : (resolutionTypes as readonly string[]).includes(asked) ? asked : "";
  return <s-stack gap="base">
    <s-stack gap="small-100">
      {automatic && <s-stack direction="inline"><s-badge tone="info" icon="wand">Set automatically</s-badge></s-stack>}
      <s-text color="subdued">{automatic ? "Guessed from the customer's request. Check it and change it if it's wrong." : "What this ticket is about and how it ended. The overview reports use it."}</s-text>
    </s-stack>
    <s-select label="Category" value={ticket.category} disabled={busy} details={describeCategory(ticket.category) || undefined}
      onChange={(event) => update({ category: event.currentTarget.value ?? "" })}>
      <s-option value="">Not classified</s-option>
      {categoryNames.map((value) => <s-option key={value} value={value}>{value}</s-option>)}
    </s-select>
    {subcategories.length > 0 && <s-select label="Sub-category" value={ticket.subcategory} disabled={busy} onChange={(event) => update({ subcategory: event.currentTarget.value ?? "" })}>
      <s-option value="">Not set</s-option>
      {subcategories.map((value) => <s-option key={value} value={value}>{value}</s-option>)}
    </s-select>}
    <s-select label="Root cause" value={ticket.rootCause} disabled={busy}
      details={team ? `Fixed by: ${team}` : "Why did this happen? Set it once you know, so the right team can fix it."}
      onChange={(event) => update({ rootCause: event.currentTarget.value ?? "" })}>
      <s-option value="">Not known yet</s-option>
      {rootCauses.map((value) => <s-option key={value} value={value}>{value}</s-option>)}
    </s-select>
    <s-select label="Resolution" value={ticket.resolutionType} disabled={busy} error={needsResolution ? "Record how this ticket was resolved." : undefined}
      details={needsResolution ? undefined : "What you did for the customer. Set it when you resolve the ticket."}
      onChange={(event) => update({ resolutionType: event.currentTarget.value ?? "" })}>
      <s-option value="">Not resolved yet</s-option>
      {resolutionTypes.map((value) => <s-option key={value} value={value}>{value}</s-option>)}
    </s-select>
    {asked && ticket.resolutionType !== askedType && <s-stack direction="inline" gap="small-200" alignItems="center">
      <s-text color="subdued">Customer asked for: <s-text type="strong">{asked}</s-text></s-text>
      {askedType && <s-button variant="tertiary" disabled={busy} onClick={() => update({ resolutionType: askedType })}>Use this</s-button>}
    </s-stack>}
    <s-link href="/app/help-desk/settings/categories" target="_blank">Which category should I pick?</s-link>
  </s-stack>;
}

function ClassificationSection({ ticket }: { ticket: TicketData["ticket"] }) {
  const fetcher = useFetcher<typeof action>();
  useResultToast(fetcher, "Classification updated");
  const update = (changes: Record<string, string>) => void fetcher.submit({ intent: "update", id: ticket.id, ...changes }, { method: "post" });
  return <SideCard heading="Classification">
    <Classification ticket={ticket} busy={fetcher.state !== "idle"} update={update} />
  </SideCard>;
}

function TicketProperties({ ticket, team, suggestions }: { ticket: TicketData["ticket"]; team: string[]; suggestions: TicketData["tagSuggestions"] }) {
  const fetcher = useFetcher<typeof action>();
  const [tags, setTags] = useState(ticket.tags);
  useEffect(() => setTags(ticket.tags), [ticket.tags]);
  useResultToast(fetcher, "Ticket updated");
  const update = (changes: Record<string, string>) => void fetcher.submit({ intent: "update", id: ticket.id, ...changes }, { method: "post" });
  const people = [...new Set([...team, ...(ticket.assignee ? [ticket.assignee] : [])])];
  const busy = fetcher.state !== "idle";
  return <SideCard heading="Ticket">
    <s-stack gap="base">
      <s-grid gridTemplateColumns="1fr 1fr" gap="small-300">
        <s-select label="Status" value={ticket.status} disabled={busy} onChange={(event) => update({ status: event.currentTarget.value || "Open" })}>
          {ticketStatuses.map((value) => <s-option key={value} value={value}>{value}</s-option>)}
        </s-select>
        <s-select label="Priority" value={ticket.priority} disabled={busy} onChange={(event) => update({ priority: event.currentTarget.value || "Normal" })}>
          {priorities.map((value) => <s-option key={value} value={value}>{value}</s-option>)}
        </s-select>
      </s-grid>
      <s-select label="Assignee" value={ticket.assignee} disabled={busy}
        details={team.length ? undefined : "Add your team in Help Desk settings to assign tickets."} onChange={(event) => update({ assignee: event.currentTarget.value ?? "" })}>
        <s-option value="">Unassigned</s-option>
        {people.map((name) => <s-option key={name} value={name}>{name}</s-option>)}
      </s-select>
      <form onSubmit={(event) => { event.preventDefault(); if (tags !== ticket.tags) update({ tags }); }}>
        <s-text-field label="Tags" value={tags} placeholder="e.g. damaged, vip" details="Separate tags with commas. Press Enter to save."
          onInput={(event) => setTags(event.currentTarget.value ?? "")} onBlur={() => { if (tags !== ticket.tags) update({ tags }); }} />
      </form>
      {(suggestions.fromRequest.length > 0 || suggestions.popular.length > 0) && <s-stack gap="small-100">
        {[["From this request", suggestions.fromRequest], ["Your team uses", suggestions.popular]].filter(([, list]) => list.length).map(([label, list]) => (
          <s-stack key={label as string} gap="small-100">
            <s-text color="subdued">{label as string}</s-text>
            <s-stack direction="inline" gap="small-100">
              {(list as string[]).filter((tag) => !tags.split(",").map((value) => value.trim().toLowerCase()).includes(tag)).map((tag) => (
                <s-clickable-chip key={tag} disabled={busy} accessibilityLabel={`Add tag ${tag}`} onClick={() => {
                  const next = [...tags.split(",").map((value) => value.trim()).filter(Boolean), tag].join(", ");
                  setTags(next);
                  update({ tags: next });
                }}>+ {tag}</s-clickable-chip>
              ))}
            </s-stack>
          </s-stack>
        ))}
      </s-stack>}
      <s-divider />
      <s-stack gap="small-100">
        <s-text color="subdued">Created <span suppressHydrationWarning>{formatDate(ticket.createdAt)}</span></s-text>
        <s-text color="subdued">{ticket.firstResponseAt
          ? <>First response in {duration(new Date(ticket.firstResponseAt).getTime() - new Date(ticket.createdAt).getTime())}</>
          : <span suppressHydrationWarning>Waiting for a first response · {ago(ticket.createdAt)}</span>}</s-text>
        {ticket.resolvedAt && <s-text color="subdued">Resolved <span suppressHydrationWarning>{formatDate(ticket.resolvedAt)}</span></s-text>}
      </s-stack>
    </s-stack>
  </SideCard>;
}

// Tells staff when the customer writes while the ticket is open.
function useNewMessageToast(messages: { id: string; kind: string }[]) {
  const shopify = useAppBridge();
  const seen = useRef(new Set(messages.map((message) => message.id)));
  useEffect(() => {
    const fresh = messages.filter((message) => !seen.current.has(message.id));
    fresh.forEach((message) => seen.current.add(message.id));
    if (fresh.some((message) => message.kind === "customer")) shopify.toast.show("New message from the customer");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);
}

// The order's tracking for the order.* placeholders in saved replies.
function macroOrder(order: TicketData["order"]): MacroOrder | null {
  if (!order) return null;
  const shipment = order.shipments.find((entry) => entry.number) ?? order.shipments[0];
  return { name: order.name, carrier: shipment?.carrier ?? "", trackingNumber: shipment?.number ?? "", trackingUrl: shipment?.url ?? "", shipmentStatus: shipment?.label ?? "" };
}

const shortDate = (value: string | null) => value ? new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(value)) : "";
// Requests that only make sense before an order ships.
// (Cancellations and address changes have their own panels with this warning.)
const BEFORE_SHIPPING = ["Edit Items, Color or Quantity"];

// The ticket's Shopify order: payment, fulfillment, every shipment's carrier
// and tracking, and the items with SKUs. Warns when a cancellation or change
// arrives for an order that has already shipped.
function OrderTracking({ screen }: { screen: TicketData }) {
  const { order, orderError, orderNumber, orderVerified, ticket } = screen;
  if (!orderNumber) return null;
  if (!order) return <SideCard heading="Order & tracking">
    <s-paragraph color="subdued">{orderError
      ? "Shopify couldn't be reached to load this order. Reload the page to try again."
      : `Order ${orderNumber} wasn't found in Shopify. Check the number with the customer.`}</s-paragraph>
  </SideCard>;
  const shipped = order.fulfilled !== "none";
  const delivered = order.shipments.find((shipment) => shipment.deliveredAt);
  return <SideCard heading="Order & tracking">
    <s-stack gap="base">
      {shipped && BEFORE_SHIPPING.includes(ticket.subcategory) && <s-banner tone="warning" heading="This order has already shipped">
        It can no longer be cancelled or changed. The &ldquo;Order already shipped&rdquo; saved reply explains the return option.
      </s-banner>}
      {ticket.subcategory === "Delivered but Not Received" && delivered && <s-banner tone="info" heading={`The carrier marked it delivered on ${shortDate(delivered.deliveredAt)}`}>
        Ask the customer to check with neighbours and around the building, then open a claim with the carrier if it&apos;s still missing.
      </s-banner>}
      <s-stack gap="small-100">
        <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
          <s-link href={`shopify://admin/orders/${order.id}`} target="_blank">{order.name}</s-link>
          <s-text type="strong">{order.total}</s-text>
        </s-stack>
        <s-text color="subdued">Placed {shortDate(order.createdAt)}{order.city || order.country ? ` · Ships to ${[order.city, order.province, order.country].filter(Boolean).join(", ")}` : ""}</s-text>
        <s-stack direction="inline" gap="small-100">
          {order.cancelled ? <s-badge tone="critical">Cancelled</s-badge> : <>
            {order.payment && <s-badge>{order.payment}</s-badge>}
            <s-badge tone={order.fulfilled === "full" ? "success" : order.fulfilled === "partial" ? "warning" : "caution"}>{order.fulfillment || "Unfulfilled"}</s-badge>
          </>}
        </s-stack>
        {!orderVerified && <s-text color="subdued">Placed with a different email than this ticket, so the customer&apos;s request page doesn&apos;t show its tracking.</s-text>}
      </s-stack>

      <s-divider />
      {order.shipments.length === 0
        ? <s-text color="subdued">{order.cancelled ? "This order was cancelled." : "Not shipped yet, so there's no tracking."}</s-text>
        : order.shipments.map((shipment, index) => <s-stack key={index} gap="small-100">
          <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
            <s-text type="strong">{order.shipments.length > 1 ? `Shipment ${order.shipments.length - index}` : "Shipment"}</s-text>
            <s-badge tone={shipment.tone}>{shipment.label}</s-badge>
          </s-stack>
          {(shipment.carrier || shipment.number) && <s-text>{[shipment.carrier, shipment.number].filter(Boolean).join(" · ")}</s-text>}
          <s-text color="subdued">{[
            shipment.shippedAt && `Shipped ${shortDate(shipment.shippedAt)}`,
            shipment.deliveredAt ? `Delivered ${shortDate(shipment.deliveredAt)}` : shipment.estimatedAt && `Expected ${shortDate(shipment.estimatedAt)}`,
          ].filter(Boolean).join(" · ")}</s-text>
          {shipment.url && <s-stack direction="inline"><s-button icon="external" href={shipment.url} target="_blank">Track package</s-button></s-stack>}
        </s-stack>)}

      <s-divider />
      <s-stack gap="small-200">
        {order.items.map((item, index) => <s-stack key={index} direction="inline" gap="small-200" alignItems="center">
          {item.image ? <s-thumbnail src={item.image} alt="" size="small" /> : null}
          <s-stack gap="none">
            <s-text>{item.quantity} × {item.title}</s-text>
            {(item.variant || item.sku) && <s-text color="subdued">{[item.variant, item.sku && `SKU ${item.sku}`].filter(Boolean).join(" · ")}</s-text>}
          </s-stack>
        </s-stack>)}
      </s-stack>
    </s-stack>
  </SideCard>;
}

// Each step of a cancellation request, as the customer sees it too.
const CANCEL_STEPS = ["Pending", "Approved", "Cancelled"];
const CANCEL_COPY: Record<string, string> = {
  Pending: "Nothing has changed in Shopify. Check the order below, then approve or reject the request. Approving doesn't cancel anything: the order (or its items) is cancelled in Shopify as the next step, and the request is marked Cancelled only once Shopify shows it. The customer sees each decision on their request page and by email.",
  Approved: "Approved, but not cancelled yet. Cancel it in Shopify now; this changes to Cancelled as soon as Shopify shows it. If Shopify is already cancelling the order, this happens by itself.",
  Rejected: "Rejected. The customer was told the order can't be cancelled. The order is unchanged.",
  Cancelled: "Cancelled in Shopify. The customer has been told.",
};
const REFUND_CHOICES = [
  ["original", "Refund to the original payment method"],
  ["store-credit", "Refund as store credit"],
  ["none", "Don't refund (e.g. refunded already, or never paid)"],
] as const;
const money = (amount: number, currency: string) => new Intl.NumberFormat("en", { style: "currency", currency: currency || "USD" }).format(amount);

function CheckRow({ check }: { check: { id: string; label: string; ok: boolean; detail: string; warning?: boolean } }) {
  return <s-stack direction="inline" gap="small-200" alignItems="start">
    <s-icon type={check.ok ? "check-circle" : check.warning ? "alert-triangle" : "x-circle"} tone={check.ok ? "success" : check.warning ? "warning" : "critical"} size="small" />
    <s-stack gap="none">
      <s-text>{check.label}</s-text>
      {check.detail && <s-text color="subdued">{check.detail}</s-text>}
    </s-stack>
  </s-stack>;
}

// The customer's request to cancel their order (or some of its items), and the
// team's decision: approve or reject, then cancel in Shopify. Nothing here
// changes the order until staff choose to cancel it in Shopify.
function CancellationPanel({ screen }: { screen: TicketData }) {
  const { ticket, order, shipStation } = screen;
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [options, setOptions] = useState({ refund: "original", restock: true, notifyCustomer: false });
  const busy = fetcher.state !== "idle";
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const errors = Object.values(fetcher.data.errors);
    if (errors.length) { if (!fetcher.data.errors.note) shopify.toast.show(errors[0], { isError: true }); return; }
    if (fetcher.data.warning) shopify.toast.show(fetcher.data.warning, { isError: true, duration: 10000 });
    else shopify.toast.show(fetcher.data.notice === "Cancelled" ? "Cancelled in Shopify"
      : fetcher.data.notice === "Approved" ? "Cancellation request approved" : `Cancellation request ${(fetcher.data.notice || "updated").toLowerCase()}`);
    setNote("");
    setConfirming(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);
  if (!ticket.cancelStatus) return null;
  const status = ticket.cancelStatus;
  const decide = (decision: string) => void fetcher.submit({
    intent: "cancellation", id: ticket.id, decision, note, author: screen.me || "Staff",
    ...(decision === "cancel-shopify" ? Object.fromEntries(Object.entries(options).map(([key, value]) => [key, String(value)])) : {}),
  }, { method: "post" });
  const open = status === "Pending" || status === "Approved";
  // Only some items, or a whole order that has partly shipped: Shopify's
  // orderCancel can't do it, so staff remove the items with Edit order.
  const someItems = ticket.details.cancelScope === cancelScopes[1];
  const byEdit = someItems || order?.fulfilled === "partial";
  // What Shopify says now (payment, returns, shipping), then ShipStation's labels.
  const shipped = order?.fulfilled === "full";
  const labelCheck = order && !order.cancelled && !shipped && status !== "Cancelled" ? shipStationCheck(shipStation, "cancel") : null;
  const checks = [...(order && !order.cancelled ? cancelReview(order) : []), ...(labelCheck ? [labelCheck] : [])];
  // What stops Shopify cancelling the whole order (a partly shipped one goes through Edit order).
  const blocking = checks.filter((check) => !check.ok && !check.warning && !(byEdit && check.id === "shipped" && !shipped));
  const stillOpen = status === "Cancelled" && order && !order.cancelled && !byEdit;
  const current = status === "Rejected" ? 1 : CANCEL_STEPS.indexOf(status);
  const reason = ticket.details.cancelReason;
  // The items asked about, with how many have been removed so far.
  const lines = new Map((order?.items ?? []).map((item) => [item.lineItemId, item]));
  return <s-section heading="Cancellation request">
    <s-stack gap="base">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <CancelBadge status={status} />
        {order && <s-text color="subdued">{someItems ? `Selected items on ${order.name}` : `Whole order ${order.name}`} · {order.total} · {order.payment || "Payment unknown"} · {order.fulfillment || "Unfulfilled"}</s-text>}
      </s-stack>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {(status === "Rejected" ? ["Pending", "Rejected"] : CANCEL_STEPS).map((step, index) => {
          const done = index < current || status === "Cancelled";
          const here = index === current;
          const tone = step === "Rejected" ? "#B3261E" : done || (here && status === "Cancelled") ? "#0C7A43" : here ? "#334FB4" : "#8A8F98";
          return <div key={step} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {index > 0 && <span style={{ width: 28, height: 2, background: done || here ? tone : "var(--hd-border, #D4D6DB)" }} />}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: here ? 650 : 500, color: tone }}>
              <span style={{ display: "grid", placeItems: "center", width: 20, height: 20, borderRadius: "50%", fontSize: 11, color: "#fff", background: done || here ? tone : "#D4D6DB" }}>
                {step === "Rejected" ? "✕" : done ? "✓" : index + 1}
              </span>
              {step}
            </span>
          </div>;
        })}
      </div>
      <s-paragraph color="subdued">{CANCEL_COPY[status]}</s-paragraph>
      <s-grid gridTemplateColumns="minmax(130px, 1fr) 3fr" gap="small-200">
        <s-text color="subdued">To cancel</s-text>
        <s-stack gap="none">
          {someItems ? ticket.products.map((product) => {
            const line = lines.get(product.id);
            return <s-text key={product.id}>{product.title}{line ? ` × ${line.quantity}${line.current < line.quantity ? ` (${line.quantity - line.current} removed)` : ""}` : ""}</s-text>;
          }) : <s-text>The whole order{order?.fulfilled === "partial" ? " (everything not shipped yet)" : ""}</s-text>}
        </s-stack>
        <s-text color="subdued">Reason</s-text><s-text>{reason || "Not given"}</s-text>
        {ticket.details.details && <><s-text color="subdued">Customer&apos;s note</s-text><div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{ticket.details.details}</div></>}
        {order && order.refunded > 0 && <><s-text color="subdued">Refunded so far</s-text><s-text>{money(order.refunded, order.currency)} of {order.total}</s-text></>}
        {ticket.cancelDecidedAt && <><s-text color="subdued">Decided</s-text>
          <s-text>{ticket.cancelDecidedBy || "Staff"} · <span suppressHydrationWarning>{formatDate(ticket.cancelDecidedAt)}</span></s-text></>}
        {ticket.cancelNote && <><s-text color="subdued">Told the customer</s-text><div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{ticket.cancelNote}</div></>}
      </s-grid>
      {(open || status === "Rejected") && checks.length > 0 && <>
        <s-divider />
        <s-stack gap="small-200">
          <s-text type="strong">Before cancelling: Shopify{labelCheck ? " and ShipStation" : ""} now</s-text>
          {checks.map((check) => <CheckRow key={check.id} check={check} />)}
        </s-stack>
      </>}
      {open && order?.cancelled && <s-banner tone="info" heading={`Order ${order.name} is already cancelled in Shopify`}>
        Choose &ldquo;Cancel in Shopify&rdquo; to close the request and let the customer know.
      </s-banner>}
      {open && byEdit && order && !order.cancelled && !shipped && <s-banner tone="info" heading={someItems ? "Only some items" : `Part of order ${order.name} has shipped`}>
        Shopify can&apos;t cancel {someItems ? "single items" : "a partly shipped order"}. Approve the request, remove {someItems ? "these items" : "the items not shipped yet"} with Edit order in Shopify (refund and restock there), then choose &ldquo;Confirm items removed&rdquo;. The Help Desk checks Shopify before marking it Cancelled.
      </s-banner>}
      {/* Marked cancelled here before the Help Desk cancelled orders itself. */}
      {stillOpen && <s-banner tone="critical" heading={`Order ${order.name} is still open in Shopify`}>
        This request was marked cancelled, but the order wasn&apos;t cancelled in Shopify. Cancel it there now.
      </s-banner>}
      {(status !== "Cancelled" || stillOpen) && <>
        <s-text-area label="Message to the customer" rows={3} value={note} maxLength={MAX_MESSAGE_LENGTH} disabled={busy}
          details={status === "Rejected" ? "Shown with the new decision." : "Shown on their request page and in the email. Required when you reject the request."}
          placeholder={shipped ? "e.g. Your order shipped this morning, so we can't cancel it. Once it arrives you can return it for a full refund." : "e.g. No problem, we're cancelling it and your refund is on the way."}
          error={fetcher.data?.errors.note} onInput={(event) => setNote(event.currentTarget.value ?? "")} />
        {confirming ? <s-box border="base" borderRadius="base" padding="base" background="subdued">
          <s-stack gap="small-200">
            <s-text type="strong">Cancel {order ? `order ${order.name}` : "this order"} in Shopify?</s-text>
            <s-text color="subdued">The whole order is cancelled. This can&apos;t be undone.{shipStation?.state === "found" ? " The ShipStation order is cancelled too." : ""}</s-text>
            <s-select label="Refund" value={options.refund} onChange={(event) => setOptions({ ...options, refund: event.currentTarget.value || "original" })}
              details={order ? `Order total ${order.total}${order.refunded > 0 ? `, ${money(order.refunded, order.currency)} refunded already` : ""}. Shopify refunds what's left in full.` : undefined}>
              {REFUND_CHOICES.map(([value, label]) => <s-option key={value} value={value}>{label}</s-option>)}
            </s-select>
            <s-checkbox label="Restock the items" checked={options.restock} onChange={() => setOptions({ ...options, restock: !options.restock })} />
            <s-checkbox label="Also send Shopify's order cancellation email" details="The Help Desk already emails the customer about the decision." checked={options.notifyCustomer}
              onChange={() => setOptions({ ...options, notifyCustomer: !options.notifyCustomer })} />
            <s-stack direction="inline" gap="small-200">
              <s-button variant="primary" tone="critical" loading={busy} onClick={() => decide("cancel-shopify")}>Cancel order</s-button>
              <s-button disabled={busy} onClick={() => setConfirming(false)}>Keep order</s-button>
            </s-stack>
          </s-stack>
        </s-box>
        : <s-stack direction="inline" gap="small-200">
          {(status === "Pending" || status === "Rejected") && !order?.cancelled && <s-button icon="check" disabled={busy || shipped} onClick={() => decide("approve")}>
            {status === "Rejected" ? "Approve instead" : "Approve"}
          </s-button>}
          {byEdit && !order?.cancelled ? <>
            {order && !shipped && <s-button href={`shopify://admin/orders/${order.id}`} target="_blank" disabled={busy}>Edit order in Shopify</s-button>}
            {status !== "Rejected" && <s-button variant="primary" icon="check" disabled={busy || shipped} onClick={() => decide("confirm-items")}>Confirm items removed</s-button>}
          </> : <s-button variant="primary" icon="check" disabled={busy || blocking.length > 0} onClick={() => order?.cancelled ? decide("cancel-shopify") : setConfirming(true)}>
            {stillOpen || status === "Approved" || order?.cancelled ? "Cancel in Shopify" : status === "Rejected" ? "Approve instead & cancel in Shopify" : "Approve & cancel in Shopify"}
          </s-button>}
          {open && <s-button icon="x" tone="critical" disabled={busy} onClick={() => decide("reject")}>Reject</s-button>}
        </s-stack>}
      </>}
    </s-stack>
  </s-section>;
}

const ADDRESS_COPY: Record<string, string> = {
  Pending: "The customer asked to send their order to a new address. Check it below, correct it if needed, then update it in Shopify, or reject the request.",
  Updated: "The order's shipping address was updated in Shopify. The customer has been told.",
  Rejected: "Rejected. The customer was told the address can't be changed. You can still update it if things change.",
};
type AddressForm = { name: string; address1: string; address2: string; city: string; province: string; zip: string; country: string; phone: string };

function AddressLines({ heading, lines }: { heading: string; lines: string[] }) {
  return <s-stack gap="small-100">
    <s-text color="subdued">{heading}</s-text>
    {lines.length ? lines.map((line, index) => <s-text key={index} type={index === 1 ? "strong" : undefined}>{line}</s-text>) : <s-text color="subdued">Not available</s-text>}
  </s-stack>;
}

// The customer's request to ship their order somewhere else, checked against
// the rules for when an address can still change.
function AddressPanel({ screen }: { screen: TicketData }) {
  const { ticket, order, orderError, shipStation } = screen;
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const requested = addressFromValues(ticket.details);
  const [form, setForm] = useState<AddressForm>(requested);
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const busy = fetcher.state !== "idle";
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const errors = fetcher.data.errors;
    if (errors.form) shopify.toast.show(errors.form, { isError: true });
    if (Object.keys(errors).length) return;
    if (fetcher.data.warning) shopify.toast.show(fetcher.data.warning, { isError: true, duration: 10000 });
    else shopify.toast.show(fetcher.data.notice === "Updated" ? "Shipping address updated" : "Address change rejected");
    setNote("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);
  if (!ticket.addressStatus) return null;
  const status = ticket.addressStatus;
  const open = status !== "Updated";
  // Shopify's rules, then whether ShipStation has bought a label for the old address.
  const labelCheck = order ? shipStationCheck(shipStation) : null;
  const checks = orderError ? [] : [...addressChangeChecks(order && addressCheckOrder(order, ticket.email), form.country), ...(labelCheck ? [labelCheck] : [])];
  const blocked = addressBlockers(checks);
  // The order itself can't change (shipped, cancelled...): only rejecting is left.
  // A different country is the address's problem, which staff can still correct.
  const orderBlocked = Boolean(orderError) || blocked.some((check) => check.id !== "country");
  // Only a ShipStation label in the way: voiding it there opens the update again.
  const labelOnly = blocked.length > 0 && blocked.every((check) => check.id === "label");
  const unverified = checks.some((check) => check.id === "verified" && !check.ok);
  const errors = fetcher.data?.errors ?? {};
  const set = (key: keyof AddressForm) => (event: Event) => setForm({ ...form, [key]: (event.currentTarget as HTMLInputElement).value ?? "" });
  const submit = (decision: "update" | "reject") => void fetcher.submit({
    intent: "address", id: ticket.id, decision, note, author: screen.me || "Staff", confirmed: String(confirmed), ...(decision === "update" ? form : {}),
  }, { method: "post" });
  const applied = ticket.addressApplied as Partial<AddressForm> | null;
  return <s-section heading="Address change request">
    <s-stack gap="base">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <AddressBadge status={status} />
        {order && <s-text color="subdued">Order {order.name} · {order.fulfillment || "Unfulfilled"}</s-text>}
      </s-stack>
      <s-paragraph color="subdued">{ADDRESS_COPY[status]}</s-paragraph>
      <s-grid gridTemplateColumns="1fr 1fr" gap="base">
        <AddressLines heading={status === "Updated" ? "Ships to now (Shopify)" : "Current address (Shopify)"} lines={order?.shippingAddress ? addressLines(order.shippingAddress) : []} />
        <AddressLines heading={status === "Updated" ? "Changed to" : "Requested address"} lines={addressLines(status === "Updated" && applied ? applied : requested)} />
      </s-grid>
      {ticket.details.details && <s-text color="subdued">Customer&apos;s note: {ticket.details.details}</s-text>}
      {ticket.addressDecidedAt && <s-text color="subdued">{status} by {ticket.addressDecidedBy || "Staff"} · <span suppressHydrationWarning>{formatDate(ticket.addressDecidedAt)}</span>
        {ticket.addressNote ? ` · Told the customer: ${ticket.addressNote}` : ""}</s-text>}
      {open && <>
        <s-divider />
        <s-stack gap="small-200">
          <s-text type="strong">Can this address still be changed?</s-text>
          {orderError ? <s-text color="subdued">Shopify couldn&apos;t be reached to check the order. Reload the page to try again.</s-text>
            : checks.map((check) => <s-stack key={check.id} direction="inline" gap="small-200" alignItems="start">
              <s-icon type={check.ok ? "check-circle" : check.id === "verified" || check.warning ? "alert-triangle" : "x-circle"} tone={check.ok ? "success" : check.id === "verified" || check.warning ? "warning" : "critical"} size="small" />
              <s-stack gap="none">
                <s-text>{check.label}</s-text>
                {check.detail && <s-text color="subdued">{check.detail}</s-text>}
              </s-stack>
            </s-stack>)}
        </s-stack>
        <s-divider />
        {labelOnly && <s-banner tone="warning" heading="Void the ShipStation label first">
          {blocked[0].detail} Or reject the request with a note for the customer.
        </s-banner>}
        {orderBlocked && !orderError && !labelOnly && <s-banner tone="critical" heading="This address can't be changed any more">
          {blocked.filter((check) => check.id !== "country" && check.id !== "label").map((check) => check.detail).join(" ")} Reject the request with a note for the customer.
        </s-banner>}
        {!orderBlocked && <>
        <s-text type="strong">Address to send to Shopify</s-text>
        <s-grid gridTemplateColumns="1fr 1fr" gap="base">
          <s-text-field label="Recipient name" value={form.name} error={errors.name} disabled={busy} onInput={set("name")} />
          <s-text-field label="Phone (optional)" value={form.phone} error={errors.phone} disabled={busy} onInput={set("phone")} />
          <s-text-field label="Street address" value={form.address1} error={errors.address1} disabled={busy} onInput={set("address1")} />
          <s-text-field label="Apartment, suite (optional)" value={form.address2} disabled={busy} onInput={set("address2")} />
          <s-text-field label="City" value={form.city} error={errors.city} disabled={busy} onInput={set("city")} />
          {PROVINCES[form.country]
            ? <s-select label={form.country === "CA" ? "Province" : "State"} value={form.province.toUpperCase()} error={errors.province} disabled={busy} onChange={set("province")}>
              <s-option value="">Select</s-option>
              {PROVINCES[form.country].map(([code, name]) => <s-option key={code} value={code}>{name}</s-option>)}
            </s-select>
            : <s-text-field label="State or province (optional)" value={form.province} error={errors.province} disabled={busy} onInput={set("province")} />}
          <s-text-field label="ZIP or postal code" value={form.zip} error={errors.zip} disabled={busy} onInput={set("zip")} />
          <s-select label="Country" value={form.country} error={errors.country} disabled={busy} onChange={set("country")}>
            <s-option value="">Select a country</s-option>
            {countries.map((country) => <s-option key={country.code} value={country.code}>{country.name}</s-option>)}
          </s-select>
        </s-grid>
        </>}
        <s-text-area label="Message to the customer" rows={2} value={note} maxLength={MAX_MESSAGE_LENGTH} disabled={busy} error={errors.note}
          details="Shown on their request page and in the email. Required when you reject the request."
          placeholder={blocked.length ? "e.g. Your order has already shipped, so we can't change the address. You can ask the carrier to redirect it." : "e.g. Done! Your order will go to the new address."}
          onInput={(event) => setNote(event.currentTarget.value ?? "")} />
        {unverified && !blocked.length && <s-checkbox label="I've confirmed this change with the customer who placed the order" checked={confirmed} disabled={busy} onChange={() => setConfirmed(!confirmed)} />}
        <s-stack direction="inline" gap="small-200">
          {!orderBlocked && <s-button variant="primary" icon="location" loading={busy && fetcher.formData?.get("decision") === "update"}
            disabled={busy || blocked.length > 0 || (unverified && !confirmed)} onClick={() => submit("update")}>{shipStation?.state === "found" ? "Update address in Shopify and ShipStation" : "Update address in Shopify"}</s-button>}
          {status === "Pending" && <s-button icon="x" tone={orderBlocked ? undefined : "critical"} variant={orderBlocked ? "primary" : undefined} disabled={busy} onClick={() => submit("reject")}>Reject</s-button>}
        </s-stack>
        {!orderBlocked && blocked.length > 0 && <s-text color="subdued">Change the country to {order ? countryName(order.country) : "the order's country"}, or reject the request.</s-text>}
      </>}
    </s-stack>
  </s-section>;
}

// The return label staff sent, to open or download.
function LabelLink({ id }: { id: string }) {
  const fetcher = useFetcher<{ url?: string; name?: string; error?: string }>();
  useEffect(() => {
    if (fetcher.state === "idle" && !fetcher.data) void fetcher.load(`/app/help-desk-attachment?id=${encodeURIComponent(id)}`);
  }, [fetcher, id]);
  if (fetcher.data?.error) return <s-text tone="critical">The label is no longer available.</s-text>;
  if (!fetcher.data?.url) return <s-spinner size="base" />;
  return <s-link href={fetcher.data.url} download={fetcher.data.name}>Download return label ({fetcher.data.name})</s-link>;
}

const RETURN_COPY: Record<string, string> = {
  Pending: "Check the conditions below. If they're met, send the return label: it approves the return and the customer gets it by email and on their request page.",
  "Label sent": "The customer has the return label. Once the product arrives at the warehouse and you've checked it, mark it received, then refund or exchange it.",
  Received: "The product is back and verified. Refund or exchange it, then resolve the ticket.",
  Rejected: "The return was rejected. You can still approve it by sending a label.",
};

// A damaged or defective item sent back, by the Process Guidelines: the
// conditions to check, then the label, then the product received and verified.
function ReturnPanel({ screen }: { screen: TicketData }) {
  const { ticket, order, orderError } = screen;
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [note, setNote] = useState("");
  const [label, setLabel] = useState<File | null>(null);
  const busy = fetcher.state !== "idle";
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const errors = fetcher.data.errors;
    if (errors.form) shopify.toast.show(errors.form, { isError: true });
    if (Object.keys(errors).length) return;
    shopify.toast.show(fetcher.data.notice === "Label sent" ? "Return label sent to the customer" : fetcher.data.notice === "Received" ? "Return marked as received" : "Return rejected");
    setNote("");
    setLabel(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);
  if (!ticket.returnStatus) return null;
  const status = ticket.returnStatus;
  const values = ticket.details;
  const errors = fetcher.data?.errors ?? {};
  const deliveredAt = order?.shipments.map((shipment) => shipment.deliveredAt).filter((at): at is string => Boolean(at)).sort().at(-1) ?? null;
  // A wrong item has no return window: the mistake was ours.
  const wrongItem = values.orderType === "Wrong Product Received";
  const blocker = order && !wrongItem ? returnBlocker({ placedAt: order.createdAt, shipped: order.fulfilled !== "none" || order.shipments.length > 0, cancelled: order.cancelled }) : null;
  const photos = ticket.attachments.filter((file) => !file.messageId && file.type.startsWith("image/")).length;
  const checks = [
    { id: "order", ok: Boolean(order) && !blocker, warning: !order, label: `Order status: ${order ? `${order.name} · ${order.fulfillment || "Unfulfilled"}` : orderError ? "Shopify couldn't be reached" : "order not found"}`,
      detail: blocker || (order ? `Placed ${formatDate(order.createdAt)}${deliveredAt ? ` · delivered ${formatDate(deliveredAt)}` : ""}` : "Check the order number with the customer.") },
    ...(wrongItem ? [] : [{ id: "window", ok: Boolean(order) && !blocker, warning: !order, label: `Within ${RETURN_WINDOW_MONTHS} months of purchase`, detail: "" }]),
    { id: "photos", ok: photos > 0, warning: false, label: "Issue described with photos", detail: photos ? `${photos} photo${photos === 1 ? "" : "s"}` : "No photos: ask the customer for some." },
    { id: "condition", ok: values.returnCondition === "Yes", warning: false, label: "Unused condition + original packaging", detail: values.returnCondition === "Yes" ? "Confirmed by the customer. Check it again when it arrives." : "Not confirmed by the customer." },
    { id: "resolution", ok: Boolean(values.resolution), warning: false, label: `Wants: ${values.resolution || "not chosen"}`, detail: values.replacement ? `Exchange for ${values.replacement}` : "" },
  ];
  const submit = (decision: "label" | "received" | "reject") => {
    const body = new FormData();
    for (const [key, value] of Object.entries({ intent: "return", id: ticket.id, decision, note, author: screen.me || "Staff" })) body.append(key, value);
    if (decision === "label" && label) body.append("label", label);
    void fetcher.submit(body, { method: "post", encType: "multipart/form-data" });
  };
  const pending = status === "Pending" || status === "Rejected";
  return <s-section heading="Return request">
    <s-stack gap="base">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <ReturnBadge status={status} />
        {order && <s-text color="subdued">Order {order.name}</s-text>}
      </s-stack>
      <s-paragraph color="subdued">{RETURN_COPY[status]}</s-paragraph>
      {ticket.returnLabelId && status !== "Rejected" && <LabelLink id={ticket.returnLabelId} />}
      {ticket.returnDecidedAt && <s-text color="subdued">{status} by {ticket.returnDecidedBy || "Staff"} · <span suppressHydrationWarning>{formatDate(ticket.returnDecidedAt)}</span>
        {ticket.returnNote ? ` · Told the customer: ${ticket.returnNote}` : ""}</s-text>}
      {status !== "Received" && <>
        <s-divider />
        <s-stack gap="small-200">
          <s-text type="strong">Conditions to match</s-text>
          {checks.map((check) => <s-stack key={check.id} direction="inline" gap="small-200" alignItems="start">
            <s-icon type={check.ok ? "check-circle" : check.warning ? "alert-triangle" : "x-circle"} tone={check.ok ? "success" : check.warning ? "warning" : "critical"} size="small" />
            <s-stack gap="none">
              <s-text>{check.label}</s-text>
              {check.detail && <s-text color="subdued">{check.detail}</s-text>}
            </s-stack>
          </s-stack>)}
        </s-stack>
        <s-divider />
        {pending && <s-stack gap="small-100">
          <s-text type="strong">Return label</s-text>
          <input type="file" accept="application/pdf,image/png,image/jpeg" disabled={busy} aria-label="Return label" onChange={(event) => setLabel(event.currentTarget.files?.[0] ?? null)} />
          <s-text color={errors.label ? undefined : "subdued"} tone={errors.label ? "critical" : undefined}>{errors.label || "PDF, PNG or JPG, up to 10 MB. Sending it approves the return."}</s-text>
        </s-stack>}
        <s-text-area label="Message to the customer" rows={2} value={note} maxLength={MAX_MESSAGE_LENGTH} disabled={busy} error={errors.note}
          details="Shown on their request page and in the email. Required when you reject the return."
          placeholder={pending ? "e.g. Please print the label, attach it to the box and drop it off within 14 days." : "e.g. We've received your case and checked it. Your refund is on its way."}
          onInput={(event) => setNote(event.currentTarget.value ?? "")} />
        <s-stack direction="inline" gap="small-200">
          {pending && <s-button variant="primary" icon="email" loading={busy && fetcher.formData?.get("decision") === "label"} disabled={busy || !label} onClick={() => submit("label")}>Approve &amp; send return label</s-button>}
          {status === "Label sent" && <s-button variant="primary" icon="check" loading={busy && fetcher.formData?.get("decision") === "received"} disabled={busy} onClick={() => submit("received")}>Mark received &amp; verified</s-button>}
          {status === "Pending" && <s-button icon="x" tone="critical" disabled={busy} onClick={() => submit("reject")}>Reject</s-button>}
        </s-stack>
      </>}
    </s-stack>
  </s-section>;
}

const EDIT_COPY: Record<string, string> = {
  Pending: "Check the order is still at the warehouse, set the new quantities (0 removes an item) and add products by SKU. Preview the new total, confirm any price difference with the customer, then update the order in Shopify.",
  Updated: "The order was updated in Shopify.",
  Rejected: "The request was rejected.",
};
type AddRow = { variantId: string; title: string; sku: string; price: string; quantity: number };
const editMoney = (value: { amount: string; currencyCode: string } | null | undefined) => value
  ? new Intl.NumberFormat("en", { style: "currency", currency: value.currencyCode }).format(Number(value.amount)) : "—";

// An order edit request, by its Process Guidelines: still at the warehouse
// (Shopify and ShipStation), the changes set line by line and products added by
// SKU, the price difference previewed, then the order updated in Shopify.
function EditPanel({ screen }: { screen: TicketData }) {
  const { ticket, order, orderError, shipStation } = screen;
  const fetcher = useFetcher<typeof action>();
  const finder = useFetcher<typeof action>();
  const preview = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const request = parseEditRequest(ticket.details.editRequest);
  const asked = new Map(request.lines.map((line) => [line.id, line]));
  const lines = (order?.items ?? []).filter((item) => item.lineItemId && item.current > 0);
  const [quantities, setQuantities] = useState<Record<string, number>>(() => Object.fromEntries(lines.map((item) => {
    const line = asked.get(item.lineItemId);
    return [item.lineItemId, line?.action === "Remove" ? 0 : line?.action === "Change quantity" && line.quantity !== null ? line.quantity : item.current];
  })));
  const [adds, setAdds] = useState<AddRow[]>([]);
  const [sku, setSku] = useState("");
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(true);
  const busy = fetcher.state !== "idle";
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const errors = fetcher.data.errors;
    if (errors.form) shopify.toast.show(errors.form, { isError: true });
    if (Object.keys(errors).length) return;
    shopify.toast.show(fetcher.data.notice === "Updated" ? "Order updated in Shopify" : "Order edit request rejected");
    setNote("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);
  useEffect(() => {
    if (preview.state === "idle" && preview.data?.errors.form) shopify.toast.show(preview.data.errors.form, { isError: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview.state, preview.data]);
  if (!ticket.editStatus) return null;
  const status = ticket.editStatus;
  const pending = status === "Pending";
  // Still at the warehouse: not cancelled, packed or shipped in Shopify, and no label in ShipStation.
  const labelCheck = order ? shipStationCheck(shipStation) : null;
  const checks = orderError ? [] : [
    ...addressChangeChecks(order && addressCheckOrder(order, ticket.email), order?.country ?? "").filter((check) => ["found", "cancelled", "shipped", "verified"].includes(check.id)),
    ...(labelCheck ? [{ ...labelCheck, label: "No shipping label in ShipStation (still at the warehouse)" }] : []),
  ];
  const blocked = addressBlockers(checks);
  const ops = {
    lines: lines.filter((item) => quantities[item.lineItemId] !== undefined && quantities[item.lineItemId] !== item.current)
      .map((item) => ({ lineItemId: item.lineItemId, quantity: quantities[item.lineItemId] })),
    adds: adds.map((add) => ({ variantId: add.variantId, quantity: add.quantity })),
  };
  const summary = [
    ...lines.filter((item) => ops.lines.some((line) => line.lineItemId === item.lineItemId))
      .map((item) => quantities[item.lineItemId] === 0 ? `removed ${item.title}` : `${item.title} × ${quantities[item.lineItemId]} (was ${item.current})`),
    ...adds.map((add) => `added ${add.title}${add.sku ? ` (${add.sku})` : ""} × ${add.quantity}`),
  ].join("; ");
  const changed = ops.lines.length + ops.adds.length > 0;
  const send = (decision: "preview" | "apply" | "reject") => {
    const target = decision === "preview" ? preview : fetcher;
    void target.submit({ intent: "edit", id: ticket.id, decision, ops: JSON.stringify(ops), note, author: screen.me || "Staff", notifyCustomer: String(notify), summary }, { method: "post" });
  };
  const totals = preview.state === "idle" ? preview.data?.totals : undefined;
  const difference = totals ? Number(totals.outstanding.amount) : 0;
  const errors = fetcher.data?.errors ?? {};
  return <s-section heading="Order edit request">
    <s-stack gap="base">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <EditBadge status={status} />
        {order && <s-text color="subdued">Order {order.name} · {order.fulfillment || "Unfulfilled"} · {order.total}</s-text>}
      </s-stack>
      <s-paragraph color="subdued">{EDIT_COPY[status]}</s-paragraph>
      <s-stack gap="small-100">
        <s-text type="strong">The customer asked for</s-text>
        {request.lines.map((line) => <s-text key={line.id}>• {line.title}: {line.action === "Remove" ? "remove" : line.action === "Change quantity" ? `quantity ${line.quantity}` : `change to ${line.variant}`}</s-text>)}
        {request.adds.map((add) => <s-text key={add.id}>• Add {add.title} × {add.quantity}</s-text>)}
        {ticket.details.details && <s-text color="subdued">Customer&apos;s note: {ticket.details.details.split("\n").filter((row) => !request.lines.some((line) => row.startsWith(`${line.title}:`)) && !row.startsWith("Add: ")).join(" ") || "—"}</s-text>}
      </s-stack>
      {ticket.editDecidedAt && <s-text color="subdued">{status} by {ticket.editDecidedBy || "Staff"} · <span suppressHydrationWarning>{formatDate(ticket.editDecidedAt)}</span>
        {ticket.editNote ? ` · Told the customer: ${ticket.editNote}` : ""}</s-text>}
      {pending && <>
        <s-divider />
        <s-stack gap="small-200">
          <s-text type="strong">Is the order still at the warehouse?</s-text>
          {orderError ? <s-text color="subdued">Shopify couldn&apos;t be reached to check the order. Reload the page to try again.</s-text>
            : checks.map((check) => <s-stack key={check.id} direction="inline" gap="small-200" alignItems="start">
              <s-icon type={check.ok ? "check-circle" : check.id === "verified" || check.warning ? "alert-triangle" : "x-circle"} tone={check.ok ? "success" : check.id === "verified" || check.warning ? "warning" : "critical"} size="small" />
              <s-stack gap="none"><s-text>{check.label}</s-text>{check.detail && <s-text color="subdued">{check.detail}</s-text>}</s-stack>
            </s-stack>)}
        </s-stack>
        {blocked.length > 0 && <s-banner tone="critical" heading="This order can't be edited any more">
          {blocked.map((check) => check.detail).join(" ")} Reject the request with a note for the customer.
        </s-banner>}
        {!blocked.length && order && <>
          <s-divider />
          <s-text type="strong">Items on the order</s-text>
          {lines.map((item) => {
            const line = asked.get(item.lineItemId);
            return <s-grid key={item.lineItemId} gridTemplateColumns="1fr 120px" gap="base" alignItems="center">
              <s-stack gap="none">
                <s-text>{item.title}{item.variant ? ` - ${item.variant}` : ""}</s-text>
                <s-text color="subdued">{[item.sku && `SKU ${item.sku}`, `Ordered ${item.current}`, line && `Asked: ${line.action === "Change color or size" ? `change to ${line.variant}: set 0 and add the new variant by SKU` : line.action.toLowerCase()}`].filter(Boolean).join(" · ")}</s-text>
              </s-stack>
              <s-number-field label="New quantity" labelAccessibilityVisibility="exclusive" min={0} max={999} value={String(quantities[item.lineItemId] ?? item.current)} disabled={busy}
                onInput={(event) => setQuantities({ ...quantities, [item.lineItemId]: Math.max(0, Math.trunc(Number(event.currentTarget.value)) || 0) })} />
            </s-grid>;
          })}
          <s-text color="subdued">Set 0 to remove an item.</s-text>
          <s-divider />
          <s-text type="strong">Add products by SKU</s-text>
          <s-stack direction="inline" gap="small-200" alignItems="end">
            <s-text-field label="SKU or product name" value={sku} error={finder.data?.errors.sku} onInput={(event) => setSku(event.currentTarget.value ?? "")} />
            <s-button icon="search" loading={finder.state !== "idle"} onClick={() => void finder.submit({ intent: "edit", decision: "sku", sku }, { method: "post" })}>Find</s-button>
          </s-stack>
          {finder.state === "idle" && finder.data?.variants && (finder.data.variants.length
            ? finder.data.variants.map((variant) => <s-stack key={variant.id} direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
              <s-text>{variant.title}{variant.sku ? ` · SKU ${variant.sku}` : ""} · {variant.price}{variant.available !== null ? ` · ${variant.available} in stock` : ""}</s-text>
              <s-button icon="plus" disabled={adds.some((add) => add.variantId === variant.id)} onClick={() => setAdds([...adds, { variantId: variant.id, title: variant.title, sku: variant.sku, price: variant.price, quantity: 1 }])}>Add</s-button>
            </s-stack>)
            : <s-text color="subdued">No products match that SKU.</s-text>)}
          {adds.map((add, index) => <s-grid key={add.variantId} gridTemplateColumns="1fr 120px auto" gap="base" alignItems="center">
            <s-text>{add.title}{add.sku ? ` · SKU ${add.sku}` : ""} · {add.price}</s-text>
            <s-number-field label="Quantity" labelAccessibilityVisibility="exclusive" min={1} max={99} value={String(add.quantity)}
              onInput={(event) => setAdds(adds.map((entry, at) => at === index ? { ...entry, quantity: Math.min(99, Math.max(1, Math.trunc(Number(event.currentTarget.value)) || 1)) } : entry))} />
            <s-button icon="delete" tone="critical" accessibilityLabel={`Remove ${add.title}`} onClick={() => setAdds(adds.filter((_, at) => at !== index))} />
          </s-grid>)}
          <s-divider />
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-button icon="calculator" disabled={!changed} loading={preview.state !== "idle"} onClick={() => send("preview")}>Preview new total</s-button>
            {totals && <s-text>Was {editMoney(totals.before)} · now {editMoney(totals.after)} · {difference > 0 ? `customer owes ${editMoney(totals.outstanding)}` : difference < 0 ? `refund due ${editMoney({ ...totals.outstanding, amount: String(-difference) })}` : "no difference"}</s-text>}
          </s-stack>
        </>}
        <s-text-area label="Message to the customer" rows={2} value={note} maxLength={MAX_MESSAGE_LENGTH} disabled={busy} error={errors.note}
          details="Shown on their request page and in the email. Required when you reject the request."
          placeholder={blocked.length ? "e.g. Your order has already left our warehouse, so we can't change it." : "e.g. Done! We've swapped the case to Blue. The price is the same."}
          onInput={(event) => setNote(event.currentTarget.value ?? "")} />
        {!blocked.length && <s-checkbox label="Send Shopify's order update email (with any invoice for the difference)" checked={notify} disabled={busy} onChange={() => setNotify(!notify)} />}
        <s-stack direction="inline" gap="small-200">
          {!blocked.length && order && <s-button variant="primary" icon="edit" disabled={busy || !changed} loading={busy && fetcher.formData?.get("decision") === "apply"} onClick={() => send("apply")}>Update order in Shopify</s-button>}
          <s-button icon="x" tone={blocked.length ? undefined : "critical"} variant={blocked.length ? "primary" : undefined} disabled={busy} onClick={() => send("reject")}>Reject</s-button>
        </s-stack>
      </>}
    </s-stack>
  </s-section>;
}

const REPLACEMENT_COPY: Record<string, string> = {
  Pending: "Check the order below: is the part still in transit, or was it in the original shipment? Then approve the replacement, or reject it with a note.",
  Approved: "The replacement is approved. Ship the part, then enter its tracking so the customer can follow it.",
  Shipped: "The replacement part has shipped and the customer has its tracking.",
  Rejected: "The replacement was rejected. You can still approve it.",
};
const LOST_COPY: Record<string, string> = {
  Pending: "Check the order's shipments below and the carrier's tracking. Then approve sending the product again or a refund (the customer's choice is selected), or reject the request with a note.",
  Approved: "Approved. Send the product again and enter its tracking, or refund it in Shopify and tell the customer in the message.",
  Shipped: "The customer has the next steps for this lost package.",
  Rejected: "The request was rejected. You can still approve it.",
};
const WARRANTY_COPY: Record<string, string> = {
  Pending: "Check the purchase date and warranty coverage below, and the customer's photos. Then approve a solution (replacement, repair...), or reject the claim with a note.",
  Approved: "The claim is approved. Send the customer the next steps: the instructions, and the tracking if something ships.",
  Shipped: "The customer has the next steps for this claim.",
  Rejected: "The claim was rejected. You can still approve it.",
};

// A missing or lost part, by its Procedure Guidelines: the order checked,
// the replacement confirmed, then shipped with tracking.
function ReplacementPanel({ screen }: { screen: TicketData }) {
  const { ticket, order, orderError } = screen;
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [note, setNote] = useState("");
  const [tracking, setTracking] = useState({ carrier: "", number: "", url: "" });
  const warranty = ticket.replacementKind === "warranty";
  const lost = ticket.replacementKind === "lost";
  // A lost package starts with what the customer asked for.
  const [solution, setSolution] = useState(lost ? ticket.replacementSolution : "");
  const busy = fetcher.state !== "idle";
  const solutions = solutionsFor(ticket.replacementKind);
  const special = warranty || lost;
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const errors = fetcher.data.errors;
    if (errors.form) shopify.toast.show(errors.form, { isError: true });
    if (Object.keys(errors).length) return;
    shopify.toast.show(fetcher.data.notice === "Approved" ? (warranty ? "Warranty claim approved" : lost ? "Lost package request approved" : "Replacement approved")
      : fetcher.data.notice === "Shipped" ? "Next steps sent to the customer" : special ? "Request rejected" : "Replacement rejected");
    setNote("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);
  if (!ticket.replacementStatus) return null;
  const status = ticket.replacementStatus;
  const errors = fetcher.data?.errors ?? {};
  const submit = (decision: "approve" | "ship" | "reject") => void fetcher.submit({
    intent: "replacement", id: ticket.id, decision, note, author: screen.me || "Staff", solution, ...(decision === "ship" ? tracking : {}),
  }, { method: "post" });
  // Check Order Status: shipped in full? delivered? still in transit?
  const delivered = order?.shipments.filter((shipment) => shipment.deliveredAt) ?? [];
  // A warranty: when it was bought (the order, or the month they gave), for the coverage.
  const bought = order?.createdAt || (ticket.details.purchaseDate ? `${ticket.details.purchaseDate}-01` : "");
  const months = bought ? Math.floor((Date.now() - Date.parse(bought)) / (30.44 * 86400000)) : null;
  const warrantyChecks = [
    { id: "bought", ok: Boolean(bought), warning: !bought, label: "Purchase date",
      detail: bought ? `${order ? `Order ${order.name}, placed` : `Bought${ticket.details.purchasedFrom ? ` from ${ticket.details.purchasedFrom}` : ""} in`} ${formatDate(bought)}${months !== null ? ` (${months} month${months === 1 ? "" : "s"} ago)` : ""}` : "No order or purchase date: ask the customer for a receipt." },
    { id: "coverage", ok: true, warning: false, label: "Warranty coverage", detail: "Check the product's warranty period and that the damage is covered (not wear, misuse or an accident)." },
    { id: "photos", ok: ticket.attachments.some((file) => !file.messageId && file.type.startsWith("image/")), warning: false, label: "Defect shown in photos", detail: "" },
  ];
  const checks = warranty ? warrantyChecks : order ? [
    { id: "shipped", ok: order.fulfilled === "full", warning: order.fulfilled === "partial", label: "Whole order shipped",
      detail: order.fulfilled === "full" ? "" : order.fulfilled === "partial" ? "Part of the order hasn't shipped yet: the part may still be coming." : "Nothing has shipped yet." },
    { id: "delivered", ok: delivered.length > 0 && delivered.length === order.shipments.length, warning: true, label: "Delivered",
      detail: order.shipments.length ? order.shipments.map((shipment) => `${shipment.label}${shipment.carrier ? ` · ${shipment.carrier}` : ""}${shipment.number ? ` ${shipment.number}` : ""}`).join("; ") : "No shipments yet." },
    ...(lost ? [{ id: "carrier", ok: true, warning: false, label: "Carrier's tracking", detail: "Open the tracking and check for a delivery scan or exception. Open a claim with the carrier if it's lost." }]
      : [{ id: "packed", ok: true, warning: false, label: "Was it in the original shipment?", detail: "Check the packing record or ShipStation, and the customer's photos." }]),
  ] : [];
  return <s-section heading={warranty ? "Warranty claim" : lost ? "Lost package" : "Missing part"}>
    <s-stack gap="base">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <ReplacementBadge status={status} kind={ticket.replacementKind} />
        {order && <s-text color="subdued">Order {order.name} · {order.fulfillment || "Unfulfilled"}</s-text>}
      </s-stack>
      <s-paragraph color="subdued">{(warranty ? WARRANTY_COPY : lost ? LOST_COPY : REPLACEMENT_COPY)[status]}</s-paragraph>
      {ticket.details.details && <s-text>{warranty ? "Problem" : lost ? "Customer's details" : "Missing"}: {ticket.details.details}</s-text>}
      {special && ticket.replacementSolution && <s-text>{lost && status === "Pending" ? "Customer would like" : "Approved solution"}: {ticket.replacementSolution}</s-text>}
      {ticket.replacementTracking && <s-text>Replacement tracking: {[ticket.replacementCarrier, ticket.replacementTracking].filter(Boolean).join(" ")}
        {ticket.replacementTrackingUrl && <> · <s-link href={ticket.replacementTrackingUrl} target="_blank">Track</s-link></>}</s-text>}
      {ticket.replacementDecidedAt && <s-text color="subdued">{status} by {ticket.replacementDecidedBy || "Staff"} · <span suppressHydrationWarning>{formatDate(ticket.replacementDecidedAt)}</span>
        {ticket.replacementNote ? ` · Told the customer: ${ticket.replacementNote}` : ""}</s-text>}
      {status !== "Shipped" && <>
        <s-divider />
        <s-stack gap="small-200">
          <s-text type="strong">{warranty ? "Check warranty eligibility" : "Check order status"}</s-text>
          {orderError && !warranty ? <s-text color="subdued">Shopify couldn&apos;t be reached to check the order. Reload the page to try again.</s-text>
            : !order && !warranty ? <s-text color="subdued">The order wasn&apos;t found in Shopify. Check the order number with the customer.</s-text>
            : checks.map((check) => <s-stack key={check.id} direction="inline" gap="small-200" alignItems="start">
              <s-icon type={["packed", "coverage", "carrier"].includes(check.id) ? "info" : check.ok ? "check-circle" : check.warning ? "alert-triangle" : "x-circle"} tone={["packed", "coverage", "carrier"].includes(check.id) ? "info" : check.ok ? "success" : check.warning ? "warning" : "critical"} size="small" />
              <s-stack gap="none"><s-text>{check.label}</s-text>{check.detail && <s-text color="subdued">{check.detail}</s-text>}</s-stack>
            </s-stack>)}
        </s-stack>
        <s-divider />
        {special && (status === "Pending" || status === "Rejected") && <s-select label="Solution to approve" value={solution} error={errors.solution} disabled={busy} onChange={(event) => setSolution(event.currentTarget.value ?? "")}>
          <s-option value="">Select a solution</s-option>
          {solutions.map((entry) => <s-option key={entry} value={entry}>{entry}</s-option>)}
        </s-select>}
        {status === "Approved" && special && <s-text color="subdued">{lost ? "Sending it again: add the tracking. A refund: refund it in Shopify, then tell the customer in the message." : "If something ships (a replacement, or the repaired item), add its tracking. Otherwise write the next steps in the message."}</s-text>}
        {status === "Approved" && <s-grid gridTemplateColumns="1fr 1fr" gap="base">
          <s-text-field label="Carrier" value={tracking.carrier} disabled={busy} placeholder="e.g. USPS" onInput={(event) => setTracking({ ...tracking, carrier: event.currentTarget.value ?? "" })} />
          <s-text-field label={special ? "Tracking number (optional)" : "Tracking number"} value={tracking.number} error={errors.number} disabled={busy} onInput={(event) => setTracking({ ...tracking, number: event.currentTarget.value ?? "" })} />
          <s-text-field label="Tracking link (optional)" value={tracking.url} error={errors.url} disabled={busy} placeholder="https://" onInput={(event) => setTracking({ ...tracking, url: event.currentTarget.value ?? "" })} />
        </s-grid>}
        <s-text-area label="Message to the customer" rows={2} value={note} maxLength={MAX_MESSAGE_LENGTH} disabled={busy} error={errors.note}
          details="Shown on their request page and in the email. Required when you reject the request."
          placeholder={warranty ? (status === "Approved" ? "e.g. Please send the case to our warehouse with the prepaid label attached; we'll repair it within 5 days." : "e.g. Good news: your lock is covered, and we'll replace it.")
            : status === "Approved" ? "e.g. Your replacement risers are on their way." : "e.g. Good news: we'll send you a replacement lid."}
          onInput={(event) => setNote(event.currentTarget.value ?? "")} />
        <s-stack direction="inline" gap="small-200">
          {(status === "Pending" || status === "Rejected") && <s-button variant="primary" icon="check" loading={busy && fetcher.formData?.get("decision") === "approve"} disabled={busy || (special && !solution)} onClick={() => submit("approve")}>{warranty ? "Approve claim" : lost ? "Approve" : "Approve replacement"}</s-button>}
          {status === "Approved" && <s-button variant="primary" icon="delivery" loading={busy && fetcher.formData?.get("decision") === "ship"} disabled={busy || (special ? !tracking.number.trim() && !note.trim() : !tracking.number.trim())} onClick={() => submit("ship")}>{special ? "Send next steps" : "Mark shipped & send tracking"}</s-button>}
          {(status === "Pending" || status === "Approved") && <s-button icon="x" tone="critical" disabled={busy} onClick={() => submit("reject")}>Reject</s-button>}
        </s-stack>
      </>}
    </s-stack>
  </s-section>;
}

const QUOTE_COPY: Record<string, string> = {
  Pending: "Check the products are available and which carriers can ship them to this address with the method asked for. Then send the estimated delivery date, shipping cost and taxes, or tell the customer it isn't available.",
  Quoted: "The shipping details were sent to the customer.",
  Unavailable: "The customer was told it can't be shipped there.",
};

// An international shipping quote, by its Process Guidelines: availability
// and carriers checked, then the delivery date, shipping cost and taxes sent.
function QuotePanel({ screen }: { screen: TicketData }) {
  const { ticket } = screen;
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [quote, setQuote] = useState({ carrier: "", delivery: "", shipping: "", taxes: "" });
  const [note, setNote] = useState("");
  const busy = fetcher.state !== "idle";
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const errors = fetcher.data.errors;
    if (errors.form) shopify.toast.show(errors.form, { isError: true });
    if (Object.keys(errors).length) return;
    shopify.toast.show(fetcher.data.notice === "Quoted" ? "Shipping details sent to the customer" : "Customer told it isn't available");
    setNote("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);
  if (!ticket.quoteStatus) return null;
  const status = ticket.quoteStatus;
  const values = ticket.details;
  const errors = fetcher.data?.errors ?? {};
  const set = (key: keyof typeof quote) => (event: Event) => setQuote({ ...quote, [key]: (event.currentTarget as HTMLInputElement).value ?? "" });
  const submit = (decision: "send" | "unavailable") => void fetcher.submit({ intent: "quote", id: ticket.id, decision, note, author: screen.me || "Staff", ...quote }, { method: "post" });
  return <s-section heading="International shipping quote">
    <s-stack gap="base">
      <s-stack direction="inline" gap="small-200" alignItems="center"><QuoteBadge status={status} /></s-stack>
      <s-paragraph color="subdued">{QUOTE_COPY[status]}</s-paragraph>
      <s-stack gap="small-100">
        {values.quantities && <s-text>Products: {values.quantities.split("\n").join(", ")}</s-text>}
        <s-text>Ship to: {[values.address, values.country ? countryName(values.country) : ""].filter(Boolean).join(", ")}</s-text>
        <s-text>Shipping method: {values.shippingMethod || "—"}</s-text>
      </s-stack>
      {status === "Quoted" && <s-text>Sent: {[ticket.quoteCarrier, `delivery ${ticket.quoteDelivery}`, `shipping ${ticket.quoteShipping}`, `taxes ${ticket.quoteTaxes}`].filter(Boolean).join(" · ")}</s-text>}
      {ticket.quoteDecidedAt && <s-text color="subdued">{status} by {ticket.quoteDecidedBy || "Staff"} · <span suppressHydrationWarning>{formatDate(ticket.quoteDecidedAt)}</span>
        {ticket.quoteNote ? ` · Told the customer: ${ticket.quoteNote}` : ""}</s-text>}
      {status === "Pending" && <>
        <s-divider />
        <s-text type="strong">Shipping details for the customer</s-text>
        <s-grid gridTemplateColumns="1fr 1fr" gap="base">
          <s-text-field label="Carrier and service (optional)" value={quote.carrier} disabled={busy} placeholder="e.g. DHL Express" onInput={set("carrier")} />
          <s-text-field label="Estimated delivery date" value={quote.delivery} error={errors.delivery} disabled={busy} placeholder="e.g. Nov 18-22, 2026" onInput={set("delivery")} />
          <s-text-field label="Shipping cost" value={quote.shipping} error={errors.shipping} disabled={busy} placeholder="e.g. $45.00" onInput={set("shipping")} />
          <s-text-field label="Taxes and duties" value={quote.taxes} error={errors.taxes} disabled={busy} placeholder="e.g. About $12 VAT, paid on delivery" onInput={set("taxes")} />
        </s-grid>
        <s-text-area label="Message to the customer" rows={2} value={note} maxLength={MAX_MESSAGE_LENGTH} disabled={busy} error={errors.note}
          details="Shown on their request page and in the email. Required when it isn't available."
          placeholder="e.g. The case is in stock. Reply here and we'll send you a checkout link." onInput={(event) => setNote(event.currentTarget.value ?? "")} />
        <s-stack direction="inline" gap="small-200">
          <s-button variant="primary" icon="email" loading={busy && fetcher.formData?.get("decision") === "send"} disabled={busy} onClick={() => submit("send")}>Send shipping details</s-button>
          <s-button icon="x" tone="critical" disabled={busy} onClick={() => submit("unavailable")}>Not available</s-button>
        </s-stack>
      </>}
    </s-stack>
  </s-section>;
}

function TicketDetail({ screen }: { screen: TicketData }) {
  const { ticket, others, orders, trackingUrl: link } = screen;
  const shopify = useAppBridge();
  const values = ticket.details;
  const orderNumber = values.orderNumber?.replace(/^#/, "");
  const conversation = ticket.messages;
  const readAt = ticket.readAt ? new Date(ticket.readAt).getTime() : 0;
  const replyEmails = new Map(ticket.emails.filter((email) => email.messageId).map((email) => [email.messageId!, email]));
  const otherEmails = ticket.emails.filter((email) => !(email.kind === "reply" && email.messageId));
  const [customerTyping, setCustomerTyping] = useState(false);
  useLiveRefresh({ ticketId: ticket.id, onPulse: (pulse) => setCustomerTyping(pulse.customerTyping === true) });
  useNewMessageToast(conversation);
  const navigate = useNavigate();
  const remover = useFetcher<typeof action>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatFullscreen, setChatFullscreen] = useState(false);
  const quick = useFetcher<typeof action>();
  useResultToast(quick, "Ticket updated");
  const resolved = ticket.status === "Resolved";
  const change = (changes: Record<string, string>) => void quick.submit({ intent: "update", id: ticket.id, ...changes }, { method: "post" });
  useEffect(() => {
    if (remover.state !== "idle" || !remover.data) return;
    if (Object.keys(remover.data.errors).length) shopify.toast.show(Object.values(remover.data.errors)[0], { isError: true });
    else { shopify.toast.show(`Ticket #${ticket.number} deleted`); navigate("/app/help-desk"); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remover.state, remover.data]);
  // "Join chat" (and anything else on the page) can open the conversation.
  useEffect(() => {
    const open = () => { setChatFullscreen(false); setChatOpen(true); };
    window.addEventListener(OPEN_CHAT_EVENT, open);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, open);
  }, []);
  useEffect(() => {
    if (!chatOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (chatFullscreen) setChatFullscreen(false);
      else setChatOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chatOpen, chatFullscreen]);
  return <s-page heading={`#${ticket.number} · ${ticket.topic}`} inlineSize="large">
    <s-link slot="breadcrumb-actions" href="/app/help-desk">Help Desk</s-link>
    <s-button slot="primary-action" variant="primary" icon={resolved ? "refresh" : "check"} loading={quick.state !== "idle"}
      onClick={() => change({ status: resolved ? "Open" : "Resolved" })}>{resolved ? "Reopen" : "Resolve"}</s-button>
    {screen.me && ticket.assignee !== screen.me && <s-button slot="secondary-actions" icon="person" disabled={quick.state !== "idle"} onClick={() => change({ assignee: screen.me })}>Assign to me</s-button>}
    {link && <s-button slot="secondary-actions" icon="external" href={link} target="_blank">Customer&apos;s request page</s-button>}

    <style>{LAYOUT_CSS}</style>
    {ticket.humanRequestedAt && !resolved && <s-banner tone="critical" heading={`${ticket.name} is waiting to talk to a person`}>
      The assistant on their request page handed this chat to your team {ago(ticket.humanRequestedAt)}. Their chat shows &quot;Connecting you to a person&quot; until someone joins.
      <JoinChat ticket={ticket} author={screen.me || `${screen.storeName} Support`} storeName={screen.storeName} />
    </s-banner>}
    <div className="hd-ticket">
    <div className="hd-ticket-side">
    <div className="hd-ticket-main">
    <TicketProperties ticket={ticket} team={screen.team} suggestions={screen.tagSuggestions} />
    <CancellationPanel screen={screen} />
    <AddressPanel screen={screen} />
    <ReturnPanel screen={screen} />
    <EditPanel screen={screen} />
    <ReplacementPanel screen={screen} />
    <QuotePanel screen={screen} />
    <OrderTracking screen={screen} />
    </div>
    <div className="hd-ticket-rail">
    <SideCard heading="Customer">
      <s-stack gap="small-200">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-avatar initials={ticket.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "?"} alt={ticket.name} size="small" />
          <s-text type="strong">{ticket.name}</s-text>
        </s-stack>
        <s-stack direction="inline" gap="small-100" alignItems="center">
          <s-link href={`mailto:${ticket.email}?subject=${encodeURIComponent(`Re: [#${ticket.number}] ${ticket.topic}`)}`}>{ticket.email}</s-link>
          <s-button variant="tertiary" icon="clipboard" accessibilityLabel="Copy email" onClick={() => {
            void navigator.clipboard?.writeText(ticket.email).then(() => shopify.toast.show("Email copied"));
          }} />
        </s-stack>
        {values.phone && <s-link href={`tel:${values.phone.replace(/[^\d+]/g, "")}`}>{values.phone}</s-link>}
        {ticket.customerId && <s-link href={`shopify://admin/customers/${ticket.customerId}`} target="_blank">View customer in Shopify</s-link>}
        {orderNumber && <s-link href={`shopify://admin/orders?query=${encodeURIComponent(orderNumber)}`} target="_blank">Find order {values.orderNumber}</s-link>}
      </s-stack>
    </SideCard>

    <ClassificationSection ticket={ticket} />

    <SideCard heading="Recent orders">
      {orders === null ? <s-paragraph color="subdued">Orders couldn&apos;t be loaded.</s-paragraph>
        : orders.length === 0 ? <s-paragraph color="subdued">No orders found for {ticket.email}.</s-paragraph>
        : <s-stack gap="base">
          {orders.map((order) => (
            <s-stack key={order.id} gap="small-100">
              <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
                <s-link href={`shopify://admin/orders/${order.id}`} target="_blank">{order.name}</s-link>
                <s-text>{order.total}</s-text>
              </s-stack>
              <s-stack direction="inline" gap="small-100">
                <s-text color="subdued">{order.date}</s-text>
                {order.cancelled ? <s-badge tone="critical">Cancelled</s-badge> : <>
                  {order.payment && <s-badge>{order.payment}</s-badge>}
                  {order.fulfillment && <s-badge tone={order.fulfillment === "Fulfilled" ? "success" : "warning"}>{order.fulfillment}</s-badge>}
                </>}
              </s-stack>
            </s-stack>
          ))}
        </s-stack>}
    </SideCard>

    {otherEmails.length > 0 && <SideCard heading="Emails">
      <s-stack gap="small-200">
        {otherEmails.map((email) => (
          <s-stack key={email.id} gap="small-100">
            <s-text>{EMAIL_KIND[email.kind] ?? email.kind}</s-text>
            <s-stack direction="inline" gap="small-100" alignItems="center">
              <EmailStatus email={email} />
              <s-text color="subdued"><span suppressHydrationWarning>{formatDate(email.sentAt ?? email.createdAt)}</span></s-text>
            </s-stack>
            {email.status === "failed" && email.lastError && <s-text color="subdued">{email.lastError}</s-text>}
          </s-stack>
        ))}
      </s-stack>
    </SideCard>}

    {others.length > 0 && <SideCard heading={`Other requests (${others.length})`}>
      <s-stack gap="small-200">
        {others.map((other) => (
          <s-stack key={other.id} direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
            <s-link href={ticketHref(other.id)}>#{other.number} {other.topic}</s-link>
            <StatusBadge status={other.status} />
          </s-stack>
        ))}
      </s-stack>
    </SideCard>}

    <SideCard heading="Delete ticket">
      <s-stack gap="small-200">
        <s-paragraph color="subdued">Removes this ticket, its conversation, photos and emails for good.</s-paragraph>
        {confirmDelete
          ? <DeleteConfirm count={1} busy={remover.state !== "idle"} onCancel={() => setConfirmDelete(false)}
            onConfirm={() => { const form = new FormData(); form.set("intent", "delete"); form.append("ids", ticket.id); void remover.submit(form, { method: "post" }); }} />
          : <s-button tone="critical" icon="delete" onClick={() => setConfirmDelete(true)}>Delete ticket</s-button>}
      </s-stack>
    </SideCard>
    </div>
    </div>
    </div>
    <button type="button" className="hd-chat-launcher" data-open={String(chatOpen)} aria-controls="hd-chat-dock" aria-expanded={chatOpen} onClick={() => { setChatFullscreen(false); setChatOpen(true); }}>
      <span className="hd-chat-launch-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-2 2V11.5A7.5 7.5 0 0 1 10.5 4h2A7.5 7.5 0 0 1 20 11.5Z"/><path d="M7.5 11.5h7"/></svg></span>
      <span className="hd-chat-launch-copy"><strong>{ticket.humanRequestedAt && !resolved ? "Customer waiting" : "Open conversation"}</strong><small>#{ticket.number} · {ticket.name}</small></span>
      {ticket.humanRequestedAt && !resolved && <span className="hd-chat-launch-badge">New</span>}
    </button>
    <div id="hd-chat-dock" className="hd-chat-dock" data-open={String(chatOpen)} data-expanded={String(chatFullscreen)} aria-hidden={!chatOpen}>
      <div className="hd-chat" style={{ overflow: "hidden", background: "var(--hdc-frame)" }}>
        <ChatHeader ticket={ticket} count={conversation.filter((message) => message.kind !== "event").length + (ticket.channel === "chat" ? 0 : 1)} onClose={() => { setChatOpen(false); setChatFullscreen(false); }} onExpand={() => setChatFullscreen((current) => !current)} expanded={chatFullscreen} />
        <ChatThread ticket={ticket} replyEmails={replyEmails} readAt={readAt} typing={customerTyping} />
        <Composer key={ticket.id} ticket={ticket} macros={screen.macros} storeName={screen.storeName} team={screen.team} configured={screen.configured} me={screen.me} order={macroOrder(screen.order)} />
      </div>
    </div>
  </s-page>;
}


export default function HelpDeskTicket() {
  const screen = useLoaderData<typeof loader>();
  return <TicketDetail key={screen.ticket.id} screen={screen} />;
}
