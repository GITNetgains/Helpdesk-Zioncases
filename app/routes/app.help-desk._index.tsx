import { useEffect, useRef, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { priorities, ticketStatuses } from "../services/help-desk";
import { adminContext, helpDeskAction, loadInbox } from "../services/help-desk-admin.server";
import { categoryNames, rootCauses, subcategoriesOf } from "../services/help-desk-taxonomy";
import { PAGE_SIZE, PERIODS, SORTS, TOPICS, VIEWS, type View } from "../services/help-desk-views";
import { StatTile, TONES } from "../components/HelpDeskUi";
import { AddressBadge, ago, CancelBadge, DeleteConfirm, duration, HelpDeskNavigation, PriorityBadge, setupSteps, StatusBadge, ticketHref, useInboxLink, useLiveRefresh, useResultToast } from "../components/help-desk/shared";

// The Help Desk inbox: /app/help-desk, with its views and filters in the query.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await adminContext(request);
  const url = new URL(request.url);
  // Links from before each screen had its own address (including emails already sent).
  const ticket = url.searchParams.get("ticket");
  if (ticket) throw context.redirect(`/app/help-desk/tickets/${encodeURIComponent(ticket)}`);
  if (url.searchParams.get("settings")) throw context.redirect(`/app/help-desk/settings${url.searchParams.get("part") ? `/${url.searchParams.get("part")}` : ""}`);
  if (url.searchParams.get("section") === "setup") throw context.redirect("/app/help-desk/overview");
  return loadInbox(context, url);
};

export const action = helpDeskAction;

type InboxData = ReturnType<typeof useLoaderData<typeof loader>>;

function BulkBar({ ids, team, onDone }: { ids: string[]; team: string[]; onDone: () => void }) {
  const fetcher = useFetcher<typeof action>();
  const [confirming, setConfirming] = useState(false);
  const deleting = useRef(false);
  const remove = (targets: string[]) => {
    deleting.current = true;
    const form = new FormData();
    form.set("intent", "delete");
    targets.forEach((id) => form.append("ids", id));
    void fetcher.submit(form, { method: "post" });
  };
  useResultToast(fetcher, (result) => `${result.updated ?? ids.length} ticket${(result.updated ?? ids.length) === 1 ? "" : "s"} ${deleting.current ? "deleted" : "updated"}`);
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data && !Object.keys(fetcher.data.errors).length) onDone(); }, [fetcher.state, fetcher.data, onDone]);
  const apply = (changes: Record<string, string>) => {
    deleting.current = false;
    const form = new FormData();
    form.set("intent", "bulk");
    ids.forEach((id) => form.append("ids", id));
    for (const [key, value] of Object.entries(changes)) form.set(key, value);
    void fetcher.submit(form, { method: "post" });
  };
  const busy = fetcher.state !== "idle";
  return <s-box padding="base" background="subdued">
    <s-stack direction="inline" gap="base" alignItems="end">
      <s-text type="strong">{ids.length} selected</s-text>
      <s-select label="Set status" value="" disabled={busy} onChange={(event) => { if (event.currentTarget.value) apply({ status: event.currentTarget.value }); }}>
        <s-option value="">Set status</s-option>
        {ticketStatuses.map((value) => <s-option key={value} value={value}>{value}</s-option>)}
      </s-select>
      <s-select label="Set priority" value="" disabled={busy} onChange={(event) => { if (event.currentTarget.value) apply({ priority: event.currentTarget.value }); }}>
        <s-option value="">Set priority</s-option>
        {priorities.map((value) => <s-option key={value} value={value}>{value}</s-option>)}
      </s-select>
      <s-select label="Set category" value="" disabled={busy} onChange={(event) => { if (event.currentTarget.value) apply({ category: event.currentTarget.value }); }}>
        <s-option value="">Set category</s-option>
        {categoryNames.map((value) => <s-option key={value} value={value}>{value}</s-option>)}
      </s-select>
      {team.length > 0 && <s-select label="Assign to" value="" disabled={busy} onChange={(event) => {
        const value = event.currentTarget.value;
        if (value) apply({ assignee: value === "-" ? "" : value });
      }}>
        <s-option value="">Assign to</s-option>
        <s-option value="-">Unassigned</s-option>
        {team.map((name) => <s-option key={name} value={name}>{name}</s-option>)}
      </s-select>}
      <s-button tone="critical" icon="delete" disabled={busy} onClick={() => setConfirming(true)}>Delete</s-button>
      <s-button variant="tertiary" disabled={busy} onClick={onDone}>Clear selection</s-button>
    </s-stack>
    {confirming && <DeleteConfirm count={ids.length} busy={busy} onCancel={() => setConfirming(false)} onConfirm={() => { setConfirming(false); remove(ids); }} />}
  </s-box>;
}

// Views as tabs with a count each; the first four are what a team works in daily.
const VIEW_ORDER: View[] = ["open", "waiting", "resolved", "all", "unassigned", "urgent", "flagged"];

function ViewTabs({ current, counts, onSelect }: { current: View; counts: Record<View, number>; onSelect: (view: View) => void }) {
  return <div role="tablist" aria-label="Ticket views" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
    {VIEW_ORDER.map((key, index) => {
      const active = current === key;
      const alert = (key === "open" || key === "flagged") && counts[key] > 0;
      return <span key={key} style={{ display: "contents" }}>
        {index === 4 && <span aria-hidden="true" style={{ width: 1, alignSelf: "stretch", margin: "4px 4px", background: "#E3E3E3" }} />}
        <button type="button" role="tab" aria-selected={active} onClick={() => onSelect(key)} style={{
          display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: 10, cursor: "pointer", font: "inherit", fontSize: 13,
          fontWeight: active ? 650 : 500, color: active ? "#fff" : "#303030", background: active ? "#172351" : "#fff",
          border: `1px solid ${active ? "#172351" : "#E3E3E3"}`,
        }}>
          {VIEWS[key].label}
          <span style={{
            minWidth: 20, padding: "1px 7px", borderRadius: 20, fontSize: 12, fontWeight: 700, textAlign: "center",
            background: active ? "#ffffff2e" : alert ? TONES[key === "flagged" ? "amber" : "red"].soft : "#F1F2F4",
            color: active ? "#fff" : alert ? TONES[key === "flagged" ? "amber" : "red"].ink : "#4A4F5C",
          }}>{counts[key]}</span>
        </button>
      </span>;
    })}
  </div>;
}

function TicketList({ screen }: { screen: InboxData }) {
  const { tickets, count, page, views, filters, team, metrics } = screen;
  const listLink = useInboxLink();
  const navigate = useNavigate();
  const [search, setSearch] = useState(filters.q);
  const [selected, setSelected] = useState<string[]>([]);
  const activeFilters = [
    filters.topic && { key: "topic", label: filters.topic },
    filters.priority && { key: "priority", label: `${filters.priority} priority` },
    filters.category && { key: "category", label: filters.subcategory ? `${filters.category} › ${filters.subcategory}` : filters.category },
    filters.rootCause && { key: "rootCause", label: `Cause: ${filters.rootCause}` },
    filters.assignee && { key: "assignee", label: `Assigned to ${filters.assignee}` },
    filters.period && { key: "period", label: `Created: ${PERIODS[filters.period as keyof typeof PERIODS] ?? filters.period}` },
  ].filter(Boolean) as { key: string; label: string }[];
  const [showFilters, setShowFilters] = useState(activeFilters.length > 0);
  useEffect(() => setSearch(filters.q), [filters.q]);
  useEffect(() => setSelected([]), [tickets]);
  const clearSelection = useRef(() => setSelected([])).current;
  const filtered = Boolean(activeFilters.length || filters.q);
  const allSelected = tickets.length > 0 && tickets.every((ticket) => selected.includes(ticket.id));
  const toggle = (id: string, on: boolean) => setSelected((current) => on ? [...new Set([...current, id])] : current.filter((value) => value !== id));
  useLiveRefresh({ paused: selected.length > 0 });
  const steps = setupSteps(screen);
  const remaining = steps.filter((step) => !step.done);
  const view = filters.view as View;
  const tiles: { view: View; tone: "red" | "amber" | "blue" | "green"; icon: "notification" | "alert-triangle" | "clock" | "image"; label: string; detail: string }[] = [
    { view: "open", tone: "red", icon: "notification", label: "Needs attention", detail: `${views.unassigned} unassigned` },
    { view: "waiting", tone: "blue", icon: "clock", label: "Waiting on customer", detail: metrics.avgResponse === null ? "Your reply was sent" : `Avg. first reply ${duration(metrics.avgResponse)}` },
    { view: "urgent", tone: "amber", icon: "alert-triangle", label: "High priority", detail: "High and urgent, not resolved" },
    { view: "flagged", tone: "amber", icon: "image", label: "Flagged photos", detail: "AI-made or reused photos" },
  ];
  return <s-page heading="Customer support" inlineSize="large">
    <s-paragraph>Manage customer conversations, prioritize replies, and keep every request moving.</s-paragraph>
    <s-button slot="secondary-actions" icon="image" href="/app/photo-checks">Photo checks</s-button>

    <HelpDeskNavigation current="tickets" />

    {remaining.length > 0 && <s-banner tone="info" heading={`Finish setting up: ${steps.length - remaining.length} of ${steps.length} done`}>
      <s-stack gap="small-200">
        <s-text>Still to do: {remaining.map((step) => step.title.toLowerCase()).join(" · ")}.</s-text>
        <s-stack direction="inline"><s-button href="/app/help-desk/overview">Continue setup</s-button></s-stack>
      </s-stack>
    </s-banner>}

    <s-section padding="base">
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
        {tiles.map((tile) => <s-clickable key={tile.view} borderRadius="base" accessibilityLabel={`Show ${tile.label.toLowerCase()}`} onClick={() => navigate(listLink({ view: tile.view === "open" ? "" : tile.view }))}>
          <div style={{ borderRadius: 12, boxShadow: view === tile.view ? `0 0 0 2px ${TONES[tile.tone].accent}` : "none", transition: "box-shadow .15s ease" }}>
            <StatTile tone={tile.tone} icon={tile.icon} label={tile.label} value={String(views[tile.view])} detail={tile.detail} />
          </div>
        </s-clickable>)}
      </s-grid>
    </s-section>

    <s-section padding="none">
      <s-box padding="base">
        <s-stack gap="base">
          <div style={{ paddingBottom: 12, borderBottom: "1px solid #EAECF0" }}><ViewTabs current={view} counts={views} onSelect={(key) => navigate(listLink({ view: key === "open" ? "" : key }))} /></div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
            <form style={{ flex: "1 1 320px", minWidth: 0, margin: 0 }} onSubmit={(event) => { event.preventDefault(); navigate(listLink({ q: search.trim() })); }}>
              <s-search-field label="Search tickets" labelAccessibilityVisibility="exclusive" placeholder="Search by #number, name, email, order or tag"
                value={search} onInput={(event) => setSearch(event.currentTarget.value ?? "")} />
            </form>
            <s-button icon="filter" variant={showFilters ? "secondary" : "tertiary"} onClick={() => setShowFilters(!showFilters)}>
              {activeFilters.length ? `Filters (${activeFilters.length})` : "Filters"}
            </s-button>
            <div style={{ flex: "0 1 190px", minWidth: 150 }}>
              <s-select label="Sort" labelAccessibilityVisibility="exclusive" value={filters.sort} onChange={(event) => navigate(listLink({ sort: event.currentTarget.value === "activity" ? "" : event.currentTarget.value ?? "" }))}>
                {Object.entries(SORTS).map(([value, label]) => <s-option key={value} value={value}>Sort: {label}</s-option>)}
              </s-select>
            </div>
          </div>
          {showFilters && <s-box padding="base" background="subdued" borderRadius="base">
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(170px, 1fr))" gap="base">
              <s-select label="Topic" value={filters.topic} onChange={(event) => navigate(listLink({ topic: event.currentTarget.value ?? "" }))}>
                <s-option value="">All topics</s-option>
                {TOPICS.map((topic) => <s-option key={topic} value={topic}>{topic}</s-option>)}
              </s-select>
              <s-select label="Category" value={filters.category} onChange={(event) => navigate(listLink({ category: event.currentTarget.value ?? "", subcategory: "" }))}>
                <s-option value="">All categories</s-option>
                {categoryNames.map((value) => <s-option key={value} value={value}>{value}</s-option>)}
              </s-select>
              {filters.category && <s-select label="Sub-category" value={filters.subcategory} onChange={(event) => navigate(listLink({ subcategory: event.currentTarget.value ?? "" }))}>
                <s-option value="">All sub-categories</s-option>
                {subcategoriesOf(filters.category).map((value) => <s-option key={value} value={value}>{value}</s-option>)}
              </s-select>}
              <s-select label="Root cause" value={filters.rootCause} onChange={(event) => navigate(listLink({ rootCause: event.currentTarget.value ?? "" }))}>
                <s-option value="">Any root cause</s-option>
                {rootCauses.map((value) => <s-option key={value} value={value}>{value}</s-option>)}
              </s-select>
              <s-select label="Priority" value={filters.priority} onChange={(event) => navigate(listLink({ priority: event.currentTarget.value ?? "" }))}>
                <s-option value="">Any priority</s-option>
                {priorities.map((value) => <s-option key={value} value={value}>{value}</s-option>)}
              </s-select>
              {team.length > 0 && <s-select label="Assignee" value={filters.assignee} onChange={(event) => navigate(listLink({ assignee: event.currentTarget.value ?? "" }))}>
                <s-option value="">Anyone</s-option>
                {team.map((name) => <s-option key={name} value={name}>{name}</s-option>)}
              </s-select>}
              <s-select label="Created" value={filters.period} onChange={(event) => navigate(listLink({ period: event.currentTarget.value ?? "" }))}>
                {Object.entries(PERIODS).map(([value, label]) => <s-option key={value} value={value}>{label}</s-option>)}
              </s-select>
            </s-grid>
          </s-box>}
          {filtered && <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-text color="subdued">{count} matching ticket{count === 1 ? "" : "s"}</s-text>
            {filters.q && <s-clickable-chip removable onRemove={() => { setSearch(""); navigate(listLink({ q: "" })); }}>&ldquo;{filters.q}&rdquo;</s-clickable-chip>}
            {activeFilters.map((filter) => <s-clickable-chip key={filter.key} removable onRemove={() => navigate(listLink({ [filter.key]: "", ...(filter.key === "category" ? { subcategory: "" } : {}) }))}>{filter.label}</s-clickable-chip>)}
            <s-button variant="tertiary" onClick={() => { setSearch(""); navigate(listLink({ q: "", topic: "", priority: "", category: "", subcategory: "", rootCause: "", assignee: "", period: "" })); }}>Clear all</s-button>
          </s-stack>}
        </s-stack>
      </s-box>

      {selected.length > 0 && <BulkBar ids={selected} team={team} onDone={clearSelection} />}

      {tickets.length === 0 ? (
        <s-box padding="large-200">
          <s-stack gap="small-200" alignItems="center">
            <s-icon type={filtered ? "search" : "check-circle"} tone={filtered ? "neutral" : "success"} />
            <s-heading>{filtered ? "No tickets match these filters" : view === "open" ? "You're all caught up" : "No tickets here"}</s-heading>
            <s-paragraph color="subdued">{filtered ? "Try a different search or clear the filters."
              : views.all ? "New requests and customer replies appear in Needs attention." : "Requests customers send from the storefront Help Desk form appear here."}</s-paragraph>
          </s-stack>
        </s-box>
      ) : (
        <div style={{ border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden", background: "#FFFFFF" }}><s-table>
          <s-table-header-row>
            <s-table-header>
              <s-checkbox accessibilityLabel={allSelected ? "Deselect all on this page" : "Select all on this page"} checked={allSelected}
                onChange={() => setSelected(allSelected ? [] : tickets.map((ticket) => ticket.id))} />
            </s-table-header>
            <s-table-header listSlot="primary">Ticket</s-table-header>
            <s-table-header>Customer</s-table-header>
            <s-table-header listSlot="secondary">Status</s-table-header>
            <s-table-header>Assignee</s-table-header>
            <s-table-header>Last activity</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {tickets.map((ticket) => (
              <s-table-row key={ticket.id} clickDelegate={`ticket-${ticket.id}`}>
                <s-table-cell>
                  <div onClick={(event) => event.stopPropagation()} role="presentation">
                    <s-checkbox accessibilityLabel={`Select ticket #${ticket.number}`} checked={selected.includes(ticket.id)}
                      onChange={(event) => toggle(ticket.id, Boolean(event.currentTarget.checked))} />
                  </div>
                </s-table-cell>
                <s-table-cell>
                  <s-stack gap="small-100">
                    <s-stack direction="inline" gap="small-100" alignItems="center">
                      {ticket.unread && <s-badge tone="info">New</s-badge>}
                      {ticket.channel === "chat" && <s-icon type="chat" tone="neutral" size="small" />}
                      <s-link id={`ticket-${ticket.id}`} href={ticketHref(ticket.id)}>
                        {ticket.unread ? <strong>#{ticket.number} {ticket.topic}</strong> : `#${ticket.number} ${ticket.topic}`}
                      </s-link>
                    </s-stack>
                    {ticket.category && <s-text color="subdued">{ticket.subcategory ? `${ticket.category} › ${ticket.subcategory}` : ticket.category}</s-text>}
                    {(ticket.photoFlag || ticket.cancelStatus || ticket.addressStatus || ticket.priority === "High" || ticket.priority === "Urgent") && <s-stack direction="inline" gap="small-100">
                      {(ticket.priority === "High" || ticket.priority === "Urgent") && <PriorityBadge priority={ticket.priority} />}
                      <CancelBadge status={ticket.cancelStatus} />
                      <AddressBadge status={ticket.addressStatus} />
                      {ticket.photoFlag && <s-badge tone={ticket.photoFlag === "likely_ai" ? "critical" : "warning"} icon="image">{ticket.photoFlag === "likely_ai" ? "AI photo" : "Reused photo"}</s-badge>}
                    </s-stack>}
                    {[ticket.reference, ticket.images ? `${ticket.images} image${ticket.images === 1 ? "" : "s"}` : "", ticket.tags].filter(Boolean).length > 0
                      && <s-text color="subdued">{[ticket.reference, ticket.images ? `${ticket.images} image${ticket.images === 1 ? "" : "s"}` : "", ticket.tags].filter(Boolean).join(" · ")}</s-text>}
                  </s-stack>
                </s-table-cell>
                <s-table-cell>
                  <s-stack gap="none">
                    <s-text>{ticket.name}</s-text>
                    <s-text color="subdued">{ticket.email}</s-text>
                  </s-stack>
                </s-table-cell>
                <s-table-cell><StatusBadge status={ticket.status} /></s-table-cell>
                <s-table-cell>{ticket.assignee || <s-text color="subdued">Unassigned</s-text>}</s-table-cell>
                <s-table-cell>
                  <s-stack gap="none">
                    <span suppressHydrationWarning>{ago(ticket.lastActivityAt ?? ticket.createdAt)}</span>
                    {!ticket.firstResponseAt && ticket.status !== "Resolved" && <s-text tone="critical"><span suppressHydrationWarning>No reply yet · {duration(Date.now() - new Date(ticket.createdAt).getTime())}</span></s-text>}
                  </s-stack>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table></div>
      )}

      <s-box padding="base">
        <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
          <s-text color="subdued">{count} ticket{count === 1 ? "" : "s"}{count > PAGE_SIZE ? ` · page ${page} of ${Math.ceil(count / PAGE_SIZE)}` : ""} · select tickets to change or delete several at once</s-text>
          {count > PAGE_SIZE && <s-stack direction="inline" gap="small-200">
            <s-button icon="chevron-left" accessibilityLabel="Previous page" disabled={page <= 1} onClick={() => navigate(listLink({ page: String(page - 1) }))} />
            <s-button icon="chevron-right" accessibilityLabel="Next page" disabled={page * PAGE_SIZE >= count} onClick={() => navigate(listLink({ page: String(page + 1) }))} />
          </s-stack>}
        </s-stack>
      </s-box>
    </s-section>
  </s-page>;
}


export default function HelpDeskInbox() {
  return <TicketList screen={useLoaderData<typeof loader>()} />;
}
