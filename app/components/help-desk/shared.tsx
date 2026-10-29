import { useEffect, useRef } from "react";
import { useRevalidator, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import SectionNavigation from "../SectionNavigation";
import { since, type ChecklistItem } from "../HelpDeskUi";
import type { ActionResult } from "../../services/help-desk-admin.server";

// Pieces every Help Desk admin screen uses.

export function HelpDeskNavigation({ current }: { current: "tickets" | "overview" | "settings" }) {
  return <SectionNavigation label="Help Desk sections" current={current} items={[
    { id: "tickets", label: "Inbox", href: "/app/help-desk" },
    { id: "overview", label: "Overview & setup", href: "/app/help-desk/overview" },
    { id: "settings", label: "Settings", href: "/app/help-desk/settings" },
  ]} />;
}

const STATUS_TONE = { Open: "warning", "In progress": "info", "Waiting on customer": "caution", Resolved: "success" } as const;
const PRIORITY_TONE = { Low: "neutral", Normal: "neutral", High: "warning", Urgent: "critical" } as const;
export const DAY = 24 * 3600_000;

export const formatDate = (value: string | Date) => new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
export function duration(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60 ? `${minutes % 60}m` : ""}`.trim();
  return `${Math.round(hours / 24)}d`;
}
export const ago = (value: string | Date) => `${duration(Date.now() - new Date(value).getTime())} ago`;

export function StatusBadge({ status }: { status: string }) {
  return <s-badge tone={STATUS_TONE[status as keyof typeof STATUS_TONE] ?? "neutral"}>{status}</s-badge>;
}
export function PriorityBadge({ priority }: { priority: string }) {
  return <s-badge tone={PRIORITY_TONE[priority as keyof typeof PRIORITY_TONE] ?? "neutral"} icon={priority === "Urgent" ? "alert-triangle" : undefined}>{priority}</s-badge>;
}

// Where an order cancellation request stands; nothing for other tickets.
const CANCEL_TONE = { Pending: "warning", Approved: "info", Rejected: "critical", Cancelled: "success" } as const;
export function CancelBadge({ status }: { status: string }) {
  if (!status) return null;
  return <s-badge tone={CANCEL_TONE[status as keyof typeof CANCEL_TONE] ?? "neutral"} icon="order">Cancellation: {status}</s-badge>;
}

// Where a shipping address change request stands; nothing for other tickets.
const ADDRESS_TONE = { Pending: "warning", Updated: "success", Rejected: "critical" } as const;
export function AddressBadge({ status }: { status: string }) {
  if (!status) return null;
  return <s-badge tone={ADDRESS_TONE[status as keyof typeof ADDRESS_TONE] ?? "neutral"} icon="location">Address change: {status}</s-badge>;
}

// Shows a toast for a fetcher's result once it settles.
export function useResultToast(fetcher: { state: string; data?: ActionResult }, success: string | ((data: ActionResult) => string)) {
  const shopify = useAppBridge();
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const errors = Object.values(fetcher.data.errors);
    if (errors.length) shopify.toast.show(errors[0], { isError: true });
    else shopify.toast.show(typeof success === "string" ? success : success(fetcher.data));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data, shopify]);
}

// Help Desk URLs: the inbox (with its filters), each ticket, the overview and settings.
export const ticketHref = (id: string) => `/app/help-desk/tickets/${encodeURIComponent(id)}`;
export function inboxHref(changes: Record<string, string>, current = "") {
  const params = new URLSearchParams(current);
  params.delete("status");
  for (const [key, value] of Object.entries(changes)) {
    if (value) params.set(key, value); else params.delete(key);
  }
  if (!("page" in changes)) params.delete("page");
  const query = params.toString();
  return `/app/help-desk${query ? `?${query}` : ""}`;
}

// Inbox links that keep the filters currently applied.
export function useInboxLink() {
  const [searchParams] = useSearchParams();
  return (changes: Record<string, string>) => inboxHref(changes, searchParams.toString());
}



// Live updates, like a chat app: asks the server for a cheap fingerprint of
// the screen every few seconds (faster on an open ticket, and at once when the
// tab comes back into view) and reloads the page data only when it changed, so
// new customer messages and photo checks appear without a refresh. A change
// seen while a reload is still running is retried on the next tick, never
// dropped, and a failed check (a deploy, a dropped connection) is ignored.
// Typed text is kept. `paused` holds off while the user is mid-action.
export function useLiveRefresh({ ticketId = "", paused = false, intervalMs = ticketId ? 1_000 : 4_000 }: { ticketId?: string; paused?: boolean; intervalMs?: number } = {}) {
  const revalidator = useRevalidator();
  const live = useRef({ revalidator, paused });
  live.current = { revalidator, paused };

  useEffect(() => {
    // App Bridge adds the session token to fetches to the app's own server.
    const url = `/app/help-desk-pulse${ticketId ? `?ticket=${encodeURIComponent(ticketId)}` : ""}`;
    let last: string | null = null;
    let checking = false;
    let stopped = false;
    const check = async () => {
      if (checking || stopped || live.current.paused || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
        if (!response.ok) return;
        const { stamp } = await response.json() as { stamp?: string };
        if (!stamp || stopped) return;
        if (last !== null && stamp !== last) {
          // Still loading the previous change: leave `last` alone so the next tick picks this one up.
          if (live.current.revalidator.state !== "idle") return;
          await live.current.revalidator.revalidate();
        }
        last = stamp;
      } catch {
        // Offline, restarting or signed out: try again on the next tick.
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), intervalMs);
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => { stopped = true; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); };
  }, [ticketId, intervalMs]);
}


// Asks before tickets are deleted for good.
export function DeleteConfirm({ count, busy, onCancel, onConfirm }: { count: number; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <s-box paddingBlockStart="base">
    <s-banner tone="critical" heading={`Delete ${count === 1 ? "this ticket" : `${count} tickets`} permanently?`}>
      <s-stack gap="base">
        <s-paragraph>The conversation, notes, photos and photo checks are deleted and can&apos;t be recovered. The customer&apos;s request page link stops working.</s-paragraph>
        <s-stack direction="inline" gap="small-200">
          <s-button tone="critical" variant="primary" loading={busy} onClick={onConfirm}>Delete permanently</s-button>
          <s-button variant="tertiary" disabled={busy} onClick={onCancel}>Cancel</s-button>
        </s-stack>
      </s-stack>
    </s-banner>
  </s-box>;
}


export function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <div style={{ display: "grid", gap: 12, alignContent: "start", height: "100%", padding: 16, background: "#fff", border: "1px solid #E3E3E3", borderRadius: 12, boxShadow: "0 1px 0 rgba(26,26,26,.05)" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <s-heading>{title}</s-heading>
      {action}
    </div>
    {children}
  </div>;
}


// What the setup checklist needs, from the inbox or overview loader.
export type SetupData = {
  overview: { apiKey: string; formLastSeenAt: string | Date | null; signature: boolean; aiEnabled: boolean; detectorConnected: boolean };
  team: string[]; configured: boolean;
};

// The four things a store needs set up, shared by the inbox nudge and the setup page.
export function setupSteps(screen: SetupData): ChecklistItem[] {
  const { overview, team, configured } = screen;
  const formLive = Boolean(overview.formLastSeenAt && Date.now() - new Date(overview.formLastSeenAt).getTime() < 30 * DAY);
  // Theme editor deep link: add the form block to a page.
  const formLink = `shopify://admin/themes/current/editor?template=page&addAppBlockId=${overview.apiKey}/help_desk&target=newAppsSection`;
  return [
    {
      id: "form", done: formLive, title: "Add the Help Desk form to your store",
      description: formLive ? `Live on your store · last opened ${since(overview.formLastSeenAt)}.` : "Create a page such as Contact or Support, then add the Help Desk form block to it in your theme.",
      action: formLive ? undefined : <s-stack direction="inline" gap="small-200">
        <s-button href="shopify://admin/pages/new" target="_blank">Create page</s-button>
        <s-button variant="primary" href={formLink} target="_blank">Add form block</s-button>
      </s-stack>,
    },
    {
      id: "team", done: team.length > 0 && overview.signature, title: "Add your team and reply signature",
      description: team.length ? `${team.length} team member${team.length === 1 ? "" : "s"}${overview.signature ? " and a signature" : ". Add a reply signature too"}.` : "Add the names of the people who reply, so you can assign tickets and reply as them.",
      action: team.length > 0 && overview.signature ? undefined : <s-button href="/app/help-desk/settings/team">Add team</s-button>,
    },
    {
      id: "email", done: configured, title: "Turn on email sending",
      description: configured ? "Customers get confirmations and replies by email, and your team gets alerts." : "Needs your email (SMTP) details added on the app server. Until then tickets and request pages work, but no emails are sent.",
    },
    {
      id: "photos", done: overview.aiEnabled && overview.detectorConnected, title: "Connect your AI detector",
      description: !overview.aiEnabled ? "Switched off: customer photos aren't being checked."
        : overview.detectorConnected ? "On, with your AI detector connected."
        : "Only the free checks are running. Add your Sightengine or TruthScan API key so photos they can't settle get the AI detector's verdict.",
      action: overview.aiEnabled && overview.detectorConnected ? undefined : <s-button href="/app/help-desk/settings/photos">{overview.aiEnabled ? "Connect detector" : "Turn on"}</s-button>,
    },
  ];
}

