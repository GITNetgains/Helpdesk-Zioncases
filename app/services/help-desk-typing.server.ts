// Who is typing in a ticket's chat right now, for the "typing..." bubble on
// both sides. Each side pings every couple of seconds while it types; a ping
// counts for a few seconds, and sending the message clears it. Kept in this
// server's memory: it's only ever a few seconds old, so nothing is lost on a
// restart (the app runs as one process).

const FRESH_MS = 5_000;
type Typing = { customer?: number; staff?: { name: string; at: number }; assistant?: number };
const state = new Map<string, Typing>();

export function markTyping(ticketId: string, who: "customer" | "assistant" | { staff: string }, now = Date.now()) {
  const entry = state.get(ticketId) ?? {};
  if (who === "customer") entry.customer = now;
  else if (who === "assistant") entry.assistant = now;
  else entry.staff = { name: who.staff.trim().slice(0, 80) || "Our team", at: now };
  state.set(ticketId, entry);
  // Forget old tickets now and then, so the map can't grow.
  if (state.size > 500) for (const [id, value] of state) if (!isFresh(value, now)) state.delete(id);
}

export function clearTyping(ticketId: string, who: "customer" | "assistant" | "staff") {
  const entry = state.get(ticketId);
  if (entry) delete entry[who];
}

const isFresh = (entry: Typing, now: number) =>
  [entry.customer, entry.assistant, entry.staff?.at].some((at) => at !== undefined && now - at < FRESH_MS);

// What each side should show: the customer typing (for staff), and who's
// typing to the customer (a team member, or the assistant working on a reply).
export function typingState(ticketId: string, now = Date.now()) {
  const entry = state.get(ticketId);
  const fresh = (at?: number) => at !== undefined && now - at < FRESH_MS;
  return {
    customer: fresh(entry?.customer),
    toCustomer: entry?.staff && fresh(entry.staff.at) ? entry.staff.name : fresh(entry?.assistant) ? "Assistant" : null,
  };
}
