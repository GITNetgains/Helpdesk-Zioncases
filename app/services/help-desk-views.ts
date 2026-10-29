import type { Prisma } from "@prisma/client";
import { CHAT_TOPIC, topics } from "./help-desk";

export const PAGE_SIZE = 25;
const UNRESOLVED = { not: "Resolved" };
// Inbox views, like the saved views of dedicated help desks.
export const VIEWS = {
  open: { label: "Needs attention", where: { status: { in: ["Open", "In progress"] } } },
  unassigned: { label: "Unassigned", where: { status: UNRESOLVED, assignee: "" } },
  urgent: { label: "High priority", where: { status: UNRESOLVED, priority: { in: ["High", "Urgent"] } } },
  waiting: { label: "Waiting on customer", where: { status: "Waiting on customer" } },
  resolved: { label: "Resolved", where: { status: "Resolved" } },
  // Order cancellation requests still waiting for a decision or for the order to be cancelled.
  cancellations: { label: "Cancellation requests", where: { cancelStatus: { in: ["Pending", "Approved"] } } },
  // Shipping address changes waiting for a decision.
  addresses: { label: "Address changes", where: { addressStatus: "Pending" } },
  // Tickets with a photo the AI photo check flagged as AI-made or reused.
  flagged: { label: "Flagged photos", where: { attachments: { some: { scan: { is: { overallVerdict: { in: ["likely_ai", "duplicate"] } } } } } } },
  all: { label: "All tickets", where: {} },
} satisfies Record<string, { label: string; where: Prisma.HelpDeskTicketWhereInput }>;
export type View = keyof typeof VIEWS;
export const TOPICS = [...topics, CHAT_TOPIC];
export const PERIODS = { "": "Any time", today: "Today", "7": "Last 7 days", "30": "Last 30 days", "90": "Last 90 days" } as const;
export const SORTS = { activity: "Last activity", newest: "Newest first", oldest: "Oldest first" } as const;
