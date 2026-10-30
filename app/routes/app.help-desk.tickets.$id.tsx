import { useEffect, useRef, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useFetcher, useFetchers, useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  addressBlockers, addressChangeChecks, addressCheckOrder, shipStationCheck, addressFromValues, addressLines, countries, countryName, fieldLabels as LABELS, fillMacro, MAX_MESSAGE_LENGTH, PLAYABLE_VIDEO, priorities, PROVINCES, ticketStatuses, type MacroOrder,
} from "../services/help-desk";
import { adminContext, helpDeskAction, loadTicket } from "../services/help-desk-admin.server";
import type { TicketProduct } from "../services/help-desk-email.server";
import { categoryNames, describeCategory, groupMacros, resolutionTypes, rootCauses, subcategoriesOf, teamFor } from "../services/help-desk-taxonomy";
import { buildChecks, PHOTO_VERDICT, PhotoCheckButton, PhotoReportModal } from "../components/PhotoReport";
import { AddressBadge, ago, CancelBadge, DAY, DeleteConfirm, duration, formatDate, StatusBadge, ticketHref, useLiveRefresh, useResultToast } from "../components/help-desk/shared";

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
        <s-link href={`shopify://admin/products/${product.id.split("/").pop()}`} target="_blank">{product.title}</s-link>
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
  return <div style={{ maxWidth: "min(720px, 92%)", borderRadius: "4px 14px 14px 14px", background: "#18224A", border: "1px solid rgba(255,255,255,.1)", boxShadow: "0 2px 8px rgba(0,0,0,.25)", overflow: "hidden" }}>
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px", padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.03)" }}>
      <span style={{ color: "#FF9C8C", fontWeight: 650, fontSize: 13 }}>{ticket.name}</span>
      <span style={{ color: "#667085", fontSize: 12.5 }}>submitted a request · <span suppressHydrationWarning>{formatDate(ticket.createdAt)}</span></span>
    </div>
    <div style={{ display: "grid", gap: 8, padding: "12px 14px" }}>
      {rows.length === 0 && <span style={{ color: "#A9B3D3", fontSize: 13.5 }}>No additional details were submitted.</span>}
      {rows.map((key) => (
        <div key={key} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 160px) 1fr", gap: 12, fontSize: 13.5, lineHeight: 1.45 }}>
          <span style={{ color: "#8C97BD" }}>{LABELS[key]}</span>
          <span style={{ color: "#F2F4FA", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {key === "country" || key === "shipCountry" ? countryName(values[key]) : key === "registeredEmail" ? <a href={`mailto:${values[key]}`} style={{ color: "#9DB4FF" }}>{values[key]}</a> : values[key]}
          </span>
        </div>
      ))}
    </div>
    {/* Products, photos and videos on a light panel, so pictures show true to colour. */}
    {media && <div style={{ display: "grid", gap: 12, margin: "0 10px 10px", padding: 12, borderRadius: 10, background: "#fff", color: "#1A1F36" }}>
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

// WhatsApp-style bubble: the customer and the assistant on the left (white),
// your team on the right (green), internal notes on the right (yellow).
// Time and delivery sit inside the bubble.
function Message({ message, files, email, isNew, grouped, pending = false }: { message: TicketData["ticket"]["messages"][number]; files: TicketFile[]; email?: TicketEmail; isNew: boolean; grouped: boolean; pending?: boolean }) {
  if (message.kind === "event") {
    return <div style={{ display: "flex", justifyContent: "center", margin: "4px 0" }}>
      <span style={{ maxWidth: "85%", padding: "4px 10px", borderRadius: 8, background: "rgba(255,255,255,.08)", color: "#C9D1EA", fontSize: 12, textAlign: "center" }}>
        {message.body} · {message.author} · <span suppressHydrationWarning>{timeOnly(message.createdAt)}</span>
      </span>
    </div>;
  }
  const note = message.kind === "note";
  const customer = message.kind === "customer";
  const bot = message.kind === "bot";
  const mine = !customer && !bot;
  // Dark Zion theme: the customer in lighter navy, your team in Zion blue, notes in dark amber.
  const team = mine && !note;
  const background = note ? "#FFF4D6" : team ? "#334FB4" : "#FFFFFF";
  const delivery = pending ? "Sending…" : note ? "🔒 Internal note" : !mine ? "" : email ? "" : message.emailed ? "✓✓ Emailed" : "✓ On request page";
  return <div style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", marginTop: grouped ? 2 : 10, opacity: pending ? 0.7 : 1 }}>
    <div style={{
      position: "relative", maxWidth: "min(620px, 78%)", minWidth: 120, padding: "9px 13px 7px", background, color: note ? "#704F00" : team ? "#FFFFFF" : "#252B36",
      borderRadius: grouped ? 14 : mine ? "14px 4px 14px 14px" : "4px 14px 14px 14px", boxShadow: "0 1px 3px rgba(16,24,40,.08)",
      border: bot ? "1px dashed #C7CCD6" : note ? "1px solid #F0D98D" : team ? "1px solid #2B449E" : "1px solid #E5E7EB",
    }}>
      {!grouped && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 2, fontSize: 12.5, fontWeight: 650, color: note ? "#8A6400" : team ? "#DCE3FF" : bot ? "#667085" : "#172351" }}>
        {message.author}
        {isNew && <span style={{ padding: "0 6px", borderRadius: 6, background: "#E6EFFC", color: "#003A80", fontSize: 11 }}>New</span>}
        {bot && <span style={{ fontWeight: 500, color: "#A9B3D3" }}>· Automated answer</span>}
      </div>}
      <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 14, lineHeight: 1.45 }}>{message.body}</div>
      {files.length > 0 && <div style={{ marginTop: 8, padding: 8, borderRadius: 10, background: "#FFFFFF", color: "#1A1F36" }}><Gallery files={files} /></div>}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6, marginTop: 3, fontSize: 11, color: note ? "#9B7A22" : team ? "rgba(255,255,255,.72)" : "#858D9A" }}>
        {delivery && <span>{delivery}</span>}
        <span suppressHydrationWarning>{timeOnly(message.createdAt)}</span>
      </div>
      {email && mine && !note && <div style={{ marginTop: 4, display: "flex", justifyContent: "flex-end" }}><EmailStatus email={email} /></div>}
    </div>
  </div>;
}

// The ticket screen: chat on the left, details on the right; one column on narrow screens.
const LAYOUT_CSS = `
.hd-ticket { display: grid; grid-template-columns: minmax(0, 1.04fr) minmax(360px, .96fr); gap: 18px; align-items: start; }
.hd-ticket-main, .hd-ticket-side { display: grid; gap: 16px; min-width: 0; }
.hd-ticket-main { position: sticky; top: 70px; height: calc(100vh - 86px); min-height: 420px; align-self: start; }
.hd-chat { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; height: 100%; min-height: 0; }
.hd-chat-thread { min-height: 0; overflow: hidden; }
.hd-chat-scroll { height: 100%; min-height: 0; }
@media (max-width: 960px) {
  .hd-ticket { grid-template-columns: minmax(0, 1fr); }
  .hd-ticket-main { position: static; height: auto; min-height: 0; }
  .hd-chat { height: min(860px, calc(100vh - 80px)); min-height: 420px; }
}
`;

// A card in the right-hand column.
function SideCard({ heading, children }: { heading: string; children: React.ReactNode }) {
  return <section aria-label={heading} style={{ background: "#fff", border: "1px solid #E3E3E3", borderRadius: 12, boxShadow: "0 1px 0 rgba(26,26,26,.07)", overflow: "hidden" }}>
    <div style={{ padding: "12px 16px", borderBottom: "1px solid #EBEBEB", background: "#FAFAFA", fontSize: 13, fontWeight: 650, color: "#303030" }}>{heading}</div>
    <div style={{ padding: 16 }}>{children}</div>
  </section>;
}

const STATUS_DOT: Record<string, string> = { Open: "#F5A524", "In progress": "#5B8DEF", "Waiting on customer": "#A78BFA", Resolved: "#34A86B", Closed: "#8C97BD" };

// The chat window's top bar: the customer, where the ticket stands, and a live
// dot (the page checks for new messages every second).
function ChatHeader({ ticket, count }: { ticket: TicketData["ticket"]; count: number }) {
  const initials = ticket.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "?";
  const chip = (text: string, color: string) => <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 9px", borderRadius: 999, fontSize: 12, fontWeight: 600, color: "#E5EAF7", background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.12)", whiteSpace: "nowrap" }}>
    <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />{text}
  </span>;
  return <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px", padding: "12px 16px", background: "#172351", borderBottom: "1px solid rgba(255,255,255,.1)" }}>
    <style>{"@keyframes hd-live { 0% { box-shadow: 0 0 0 0 rgba(52,168,107,.6) } 70% { box-shadow: 0 0 0 7px rgba(52,168,107,0) } 100% { box-shadow: 0 0 0 0 rgba(52,168,107,0) } }"}</style>
    <span aria-hidden="true" style={{ display: "grid", placeItems: "center", width: 40, height: 40, borderRadius: "50%", background: "#334FB4", color: "#FFFFFF", fontWeight: 700, fontSize: 15, flex: "none" }}>{initials}</span>
    <div style={{ display: "grid", gap: 2, minWidth: 0, flex: "1 1 200px" }}>
      <span style={{ color: "#FFFFFF", fontWeight: 700, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ticket.name}</span>
      <span style={{ color: "#B7C2E4", fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {ticket.email}{ticket.category ? ` · ${ticket.subcategory ? `${ticket.category} › ${ticket.subcategory}` : ticket.category}` : ""}
      </span>
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
      {chip(ticket.status, STATUS_DOT[ticket.status] ?? "#8C97BD")}
      {ticket.priority !== "Normal" && chip(`${ticket.priority} priority`, ticket.priority === "Urgent" || ticket.priority === "High" ? "#EF3A24" : "#8C97BD")}
      {chip(ticket.assignee || "Unassigned", ticket.assignee ? "#5B8DEF" : "#8C97BD")}
      {ticket.channel === "chat" && chip("Live Chat", "#5B8DEF")}
      <CancelBadge status={ticket.cancelStatus} />
      <AddressBadge status={ticket.addressStatus} />
      <span title="New messages appear here by themselves" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#8FE3B0", fontWeight: 600 }}>
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: "#34A86B", animation: "hd-live 2s infinite" }} />Live · {count} message{count === 1 ? "" : "s"}
      </span>
    </div>
  </div>;
}

// The conversation as a chat window: fixed height, opens at the newest
// message and stays there as new ones arrive, unless you've scrolled up to
// read, then a button offers to jump down.
function ChatThread({ ticket, replyEmails, readAt }: { ticket: TicketData["ticket"]; replyEmails: Map<string, TicketEmail>; readAt: number }) {
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
      height: "100%", minHeight: 0, overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: "#53638F transparent", padding: "12px 14px 14px",
      // Deep Zion navy with a quiet blue glow and low-contrast texture.
      backgroundColor: "#111A35", backgroundImage: "radial-gradient(circle at 18% 0%, rgba(51,79,180,.26), transparent 48%), radial-gradient(rgba(255,255,255,.035) 1px, transparent 1px)", backgroundSize: "auto, 18px 18px",
    }}>
      <div ref={content}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
        <span suppressHydrationWarning style={{ padding: "4px 11px", borderRadius: 999, background: "#1C2A50", border: "1px solid #35436B", color: "#D8E0F5", fontSize: 11.5, fontWeight: 600 }}>{dayLabel(ticket.createdAt)}</span>
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
            <span suppressHydrationWarning style={{ padding: "4px 11px", borderRadius: 999, background: "#1C2A50", border: "1px solid #35436B", color: "#D8E0F5", fontSize: 11.5, fontWeight: 600 }}>{dayLabel(message.createdAt)}</span>
          </div>}
          <Message message={message} email={replyEmails.get(message.id)} grouped={grouped}
            files={ticket.attachments.filter((file) => file.messageId === message.id)}
            isNew={Boolean(readAt) && message.kind === "customer" && new Date(message.createdAt).getTime() > readAt} />
        </div>;
      })}
      {!ticket.messages.some((message) => message.kind !== "event") && !sending.length && <div style={{ display: "grid", justifyItems: "center", gap: 6, margin: "48px auto 0", maxWidth: 320, textAlign: "center", color: "#8C97BD", fontSize: 13 }}>
        <span aria-hidden="true" style={{ display: "grid", placeItems: "center", width: 44, height: 44, borderRadius: "50%", background: "rgba(255,255,255,.06)", fontSize: 20 }}>💬</span>
        <span style={{ color: "#C9D1EA", fontWeight: 600 }}>No replies yet</span>
        <span>Write to {ticket.name.split(" ")[0] || "the customer"} below. They see your reply on their request page right away.</span>
      </div>}
      {sending.map((message) => <Message key={message.id} pending isNew={false} grouped={false} files={[]}
        message={{ ...ticket.messages.at(-1)!, ...message, emailed: false, createdAt: new Date() }} />)}
      </div>
    </div>
    {unseen > 0 && <button type="button" onClick={toBottom} style={{
      position: "absolute", left: "50%", bottom: 14, transform: "translateX(-50%)", padding: "7px 14px", border: 0, borderRadius: 999, cursor: "pointer",
      background: "#EF3A24", color: "#fff", font: "inherit", fontSize: 13, fontWeight: 600, boxShadow: "0 4px 14px rgba(16,24,40,.28)",
    }}>{unseen} new message{unseen === 1 ? "" : "s"} ↓</button>}
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
    <span style={{ fontSize: 12.5, color: "#A9B3D3" }}>Send via</span>
    <div role="radiogroup" aria-label="Send via" title={`Request page: shown in their chat in your store. Email: also sent to ${email}.`}
      style={{ display: "flex", padding: 3, gap: 2, borderRadius: 10, background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.14)" }}>
      {CHANNELS.map((channel) => {
        const active = value === channel.id;
        return <button key={channel.id} type="button" role="radio" aria-checked={active} onClick={() => onChange(channel.id)} style={{
          display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 8, font: "inherit", fontSize: 12.5, cursor: "pointer",
          fontWeight: active ? 650 : 500, color: active ? "#fff" : "#D3DCF2", background: active ? "#334FB4" : "transparent", border: 0,
        }}>
          <s-icon type={channel.icon} size="small" />
          {channel.label}
        </button>;
      })}
    </div>
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
    color: kind === value ? "#fff" : "#D3DCF2", background: kind === value ? (value === "note" ? "#A36D0A" : "#334FB4") : "transparent",
  }}>{label}</button>;
  // Zion red, like the buttons on zioncases.com, so it stands out on the dark bar.
  const sendButton = (label: string, onClick: () => void, primary = true) => <button type="button" disabled={!body.trim() || sending} onClick={onClick} style={{
    padding: "9px 18px", borderRadius: 6, font: "inherit", fontSize: 14, fontWeight: 650, cursor: !body.trim() || sending ? "not-allowed" : "pointer",
    opacity: !body.trim() || sending ? 0.5 : 1, color: "#fff", background: primary ? (note ? "#B7791F" : "#EF3A24") : "transparent",
    border: primary ? "1px solid transparent" : "1px solid rgba(255,255,255,.28)", boxShadow: primary ? "0 2px 4px rgba(16,24,40,.12)" : "none",
  }}>{label}</button>;
  // The reply box is the bottom bar of the chat window, like a messaging app.
  const where = note ? "🔒 Only your team sees notes" : channel === "email" ? `Shown in their chat and emailed to ${ticket.email}` : "The customer sees this in their chat on the request page";
  return <div style={{ display: "grid", gap: 9, padding: "12px 14px 13px", background: note ? "#302714" : "#172351", borderTop: `1px solid ${note ? "#735B20" : "#2A3965"}`, color: "#D3DCF2", transition: "background .15s" }}>
    {ticket.status === "Resolved" && <span style={{ fontSize: 13, color: "#8FE3B0" }}>✓ This ticket is resolved. If the customer replies, it reopens automatically.</span>}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <div role="tablist" aria-label="Message type" style={{ display: "flex", padding: 3, gap: 2, borderRadius: 10, background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.14)" }}>
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
      <span style={{ fontSize: 12.5, color: "#A9B7D9" }}>Suggested:</span>
      {groups.suggested.slice(0, 4).map((item) => <button key={item.id} type="button" onClick={() => insert(item.id)} style={{
        padding: "4px 11px", borderRadius: 999, font: "inherit", fontSize: 12.5, cursor: "pointer",
        color: macro === item.id ? "#FFFFFF" : "#D3DCF2", background: macro === item.id ? "#334FB4" : "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.18)",
      }}>{item.title}</button>)}
    </div>}
    <div role="presentation" onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && body.trim() && !sending) { event.preventDefault(); send(); } }}>
    <s-text-area label={note ? "Note" : "Message"} labelAccessibilityVisibility="exclusive" rows={3} value={body} maxLength={MAX_MESSAGE_LENGTH}
      placeholder={note ? "Write a note only your team can see..." : `Write a message to ${ticket.name}...`}
      error={fetcher.data?.errors.body} onInput={(event) => setBody(event.currentTarget.value ?? "")} />
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {!note && <>
          <MediaSwitch ticket={ticket} kind="photos" />
          <MediaSwitch ticket={ticket} kind="videos" />
        </>}
      </div>
      <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
        {note ? sendButton(sending ? "Adding..." : "Add note", () => send()) : <>
          {sendButton("Send and resolve", () => send("Resolved"), false)}
          {sendButton(sending ? "Sending..." : channel === "email" ? "Send by email" : "Send", () => send())}
        </>}
      </div>
    </div>
    <span style={{ fontSize: 12, color: "#8C97BD" }}>{where} · Ctrl + Enter to send</span>
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
    color: on ? "#B9F0CF" : "#C9D1EA", background: on ? "rgba(52,168,107,.16)" : "rgba(255,255,255,.05)", border: `1px solid ${on ? "rgba(52,168,107,.5)" : "rgba(255,255,255,.14)"}`,
  }}>
    <span aria-hidden="true" style={{ position: "relative", flex: "none", width: 30, height: 18, borderRadius: 999, background: on ? "#34A86B" : "rgba(255,255,255,.22)", transition: "background .15s" }}>
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
  Pending: "The customer asked to cancel their whole order. Nothing has changed yet: approving cancels it in Shopify (and ShipStation); rejecting keeps it. The customer sees the decision on their request page and by email.",
  Approved: "Approved. Shopify is cancelling the order; this changes to Cancelled as soon as it's done. If it doesn't, cancel it in Shopify again.",
  Rejected: "Rejected. The customer was told the order can't be cancelled.",
  Cancelled: "The order is cancelled in Shopify. The customer has been told.",
};

// The customer's request to cancel their order, and the team's decision.
function CancellationPanel({ screen }: { screen: TicketData }) {
  const { ticket, order, shipStation } = screen;
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [options, setOptions] = useState({ refund: true, restock: true, notifyCustomer: false });
  const busy = fetcher.state !== "idle";
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const errors = Object.values(fetcher.data.errors);
    if (errors.length) { if (!fetcher.data.errors.note) shopify.toast.show(errors[0], { isError: true }); return; }
    if (fetcher.data.warning) shopify.toast.show(fetcher.data.warning, { isError: true, duration: 10000 });
    else shopify.toast.show(fetcher.data.notice === "Cancelled" ? "Approved: order cancelled in Shopify"
      : fetcher.data.notice === "Approved" ? "Approved: Shopify is cancelling the order" : `Cancellation request ${(fetcher.data.notice || "updated").toLowerCase()}`);
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
  const shipped = order && order.fulfilled !== "none";
  const open = status === "Pending" || status === "Approved";
  // Has the warehouse bought a label in ShipStation? (Only asked while the order can still be cancelled.)
  const labelCheck = order && !order.cancelled && !shipped && status !== "Cancelled" ? shipStationCheck(shipStation, "cancel") : null;
  const labelBlocked = Boolean(labelCheck && !labelCheck.ok && !labelCheck.warning);
  const stillOpen = status === "Cancelled" && order && !order.cancelled;
  const current = status === "Rejected" ? 1 : CANCEL_STEPS.indexOf(status);
  const reason = ticket.details.cancelReason;
  return <s-section heading="Cancellation request">
    <s-stack gap="base">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <CancelBadge status={status} />
        {order && <s-text color="subdued">Whole order {order.name} · {order.total}</s-text>}
      </s-stack>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {(status === "Rejected" ? ["Pending", "Rejected"] : CANCEL_STEPS).map((step, index) => {
          const done = index < current || status === "Cancelled";
          const here = index === current;
          const tone = step === "Rejected" ? "#B3261E" : done || (here && status === "Cancelled") ? "#0C7A43" : here ? "#334FB4" : "#8A8F98";
          return <div key={step} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {index > 0 && <span style={{ width: 28, height: 2, background: done || here ? tone : "#D4D6DB" }} />}
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
        <s-text color="subdued">Reason</s-text><s-text>{reason || "Not given"}</s-text>
        {ticket.details.details && <><s-text color="subdued">Customer&apos;s note</s-text><div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{ticket.details.details}</div></>}
        {ticket.cancelDecidedAt && <><s-text color="subdued">Decided</s-text>
          <s-text>{ticket.cancelDecidedBy || "Staff"} · <span suppressHydrationWarning>{formatDate(ticket.cancelDecidedAt)}</span></s-text></>}
        {ticket.cancelNote && <><s-text color="subdued">Told the customer</s-text><div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{ticket.cancelNote}</div></>}
      </s-grid>
      {open && shipped && <s-banner tone="warning" heading={`Order ${order.name} has already shipped`}>
        It can no longer be cancelled. Reject the request and offer a return instead.
      </s-banner>}
      {labelCheck && <s-stack direction="inline" gap="small-200" alignItems="start">
        <s-icon type={labelCheck.ok ? "check-circle" : labelCheck.warning ? "alert-triangle" : "x-circle"} tone={labelCheck.ok ? "success" : labelCheck.warning ? "warning" : "critical"} size="small" />
        <s-stack gap="none">
          <s-text>{labelCheck.label}</s-text>
          {labelCheck.detail && <s-text color="subdued">{labelCheck.detail}</s-text>}
        </s-stack>
      </s-stack>}
      {labelBlocked && <s-banner tone="warning" heading="Void the ShipStation label first">
        {labelCheck!.detail} Or reject the request with a note for the customer.
      </s-banner>}
      {open && order?.cancelled && <s-banner tone="info" heading={`Order ${order.name} is already cancelled in Shopify`}>
        Choose &ldquo;Approve &amp; cancel order&rdquo; to close the request and let the customer know.
      </s-banner>}
      {/* Marked cancelled here before the Help Desk cancelled orders itself. */}
      {stillOpen && <s-banner tone="critical" heading={`Order ${order.name} is still open in Shopify`}>
        This request was marked cancelled, but the order wasn&apos;t cancelled in Shopify. Cancel it there now.
      </s-banner>}
      {(status !== "Cancelled" || stillOpen) && <>
        <s-text-area label="Message to the customer" rows={3} value={note} maxLength={MAX_MESSAGE_LENGTH} disabled={busy}
          details={status === "Rejected" ? "Shown with the new decision." : "Shown on their request page and in the email. Required when you reject the request."}
          placeholder={shipped ? "e.g. Your order shipped this morning, so we can't cancel it. Once it arrives you can return it for a full refund." : "e.g. No problem, we've cancelled it and your refund is on the way."}
          error={fetcher.data?.errors.note} onInput={(event) => setNote(event.currentTarget.value ?? "")} />
        {confirming ? <s-box border="base" borderRadius="base" padding="base" background="subdued">
          <s-stack gap="small-200">
            <s-text type="strong">Cancel {order ? `order ${order.name}` : "this order"} in Shopify?</s-text>
            <s-text color="subdued">The whole order is cancelled. This can&apos;t be undone.{shipStation?.state === "found" ? " The ShipStation order is cancelled too." : ""}</s-text>
            <s-checkbox label="Refund the customer to their original payment method" checked={options.refund} onChange={() => setOptions({ ...options, refund: !options.refund })} />
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
          <s-button variant="primary" icon="check" disabled={busy || Boolean(shipped) || labelBlocked} onClick={() => order?.cancelled ? decide("cancel-shopify") : setConfirming(true)}>
            {stillOpen || status === "Approved" ? "Cancel order in Shopify" : status === "Rejected" ? "Approve instead & cancel order" : "Approve & cancel order"}
          </s-button>
          {(status === "Pending" || status === "Approved") && <s-button icon="x" tone="critical" disabled={busy} onClick={() => decide("reject")}>Reject</s-button>}
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

function TicketDetail({ screen }: { screen: TicketData }) {
  const { ticket, others, orders, trackingUrl: link } = screen;
  const shopify = useAppBridge();
  const values = ticket.details;
  const orderNumber = values.orderNumber?.replace(/^#/, "");
  const conversation = ticket.messages;
  const readAt = ticket.readAt ? new Date(ticket.readAt).getTime() : 0;
  const replyEmails = new Map(ticket.emails.filter((email) => email.messageId).map((email) => [email.messageId!, email]));
  const otherEmails = ticket.emails.filter((email) => !(email.kind === "reply" && email.messageId));
  useLiveRefresh({ ticketId: ticket.id });
  useNewMessageToast(conversation);
  const navigate = useNavigate();
  const remover = useFetcher<typeof action>();
  const [confirmDelete, setConfirmDelete] = useState(false);
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
  return <s-page heading={`#${ticket.number} · ${ticket.topic}`} inlineSize="large">
    <s-link slot="breadcrumb-actions" href="/app/help-desk">Help Desk</s-link>
    <s-button slot="primary-action" variant="primary" icon={resolved ? "refresh" : "check"} loading={quick.state !== "idle"}
      onClick={() => change({ status: resolved ? "Open" : "Resolved" })}>{resolved ? "Reopen" : "Resolve"}</s-button>
    {screen.me && ticket.assignee !== screen.me && <s-button slot="secondary-actions" icon="person" disabled={quick.state !== "idle"} onClick={() => change({ assignee: screen.me })}>Assign to me</s-button>}
    {link && <s-button slot="secondary-actions" icon="external" href={link} target="_blank">Customer&apos;s request page</s-button>}

    <style>{LAYOUT_CSS}</style>
    <div className="hd-ticket">
    <div className="hd-ticket-main">
    {/* One chat window, like a messaging app: who and where it stands, the conversation, then the reply box. */}
    <div className="hd-chat" style={{ borderRadius: 12, overflow: "hidden", border: "1px solid #2A3965", boxShadow: "0 12px 30px rgba(12,20,43,.2)", background: "#172351" }}>
      <ChatHeader ticket={ticket} count={conversation.filter((message) => message.kind !== "event").length + (ticket.channel === "chat" ? 0 : 1)} />
      <ChatThread ticket={ticket} replyEmails={replyEmails} readAt={readAt} />
      <Composer key={ticket.id} ticket={ticket} macros={screen.macros} storeName={screen.storeName} team={screen.team} configured={screen.configured} me={screen.me} order={macroOrder(screen.order)} />
    </div>
    </div>

    <div className="hd-ticket-side">

    <TicketProperties ticket={ticket} team={screen.team} suggestions={screen.tagSuggestions} />

    <CancellationPanel screen={screen} />
    <AddressPanel screen={screen} />

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

    <OrderTracking screen={screen} />

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
  </s-page>;
}


export default function HelpDeskTicket() {
  const screen = useLoaderData<typeof loader>();
  return <TicketDetail key={screen.ticket.id} screen={screen} />;
}
