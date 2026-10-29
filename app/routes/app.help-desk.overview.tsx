import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { adminContext, helpDeskAction, loadOverview } from "../services/help-desk-admin.server";
import { DASHBOARD_RANGES } from "../services/help-desk-dashboard";
import { categoryNames, teamFor } from "../services/help-desk-taxonomy";
import { SetupChecklist } from "../components/HelpDeskUi";
import { BarList, hoursLabel, KpiCard, TrendChart } from "../components/HelpDeskDashboard";
import { Card, duration, HelpDeskNavigation, inboxHref, setupSteps, ticketHref } from "../components/help-desk/shared";

// The Help Desk overview: /app/help-desk/overview, with ?range= for the period.
export const loader = async ({ request }: LoaderFunctionArgs) => loadOverview(await adminContext(request), new URL(request.url));

export const action = helpDeskAction;

type OverviewData = ReturnType<typeof useLoaderData<typeof loader>>;

// The Help Desk dashboard, like Shopify's analytics: the period's numbers
// against the one before, trends per day, and what needs someone now.
// Root causes added up by the team that can prevent them.
function byTeam(items: { label: string; value: number }[]) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(teamFor(item.label) || "Support", (counts.get(teamFor(item.label) || "Support") ?? 0) + item.value);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
}

function HelpDeskOverview({ screen }: { screen: OverviewData }) {
  const navigate = useNavigate();
  const steps = setupSteps(screen);
  const dashboard = screen.dashboard;
  if (!dashboard) return null;
  const { created, resolved, response, open, photos } = dashboard;
  // Everything on the overview opens the matching tickets in the inbox.
  const go = (changes: Record<string, string>) => navigate(changes.ticket ? ticketHref(changes.ticket) : inboxHref(changes));
  const flagged = photos.likelyAi + photos.reused;
  return <>
    <s-section padding="base">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <s-stack gap="none">
          <s-heading>How your Help Desk is doing</s-heading>
          <s-text color="subdued">Compared with the {dashboard.range} days before</s-text>
        </s-stack>
        <div style={{ minWidth: 180 }}>
          <s-select label="Date range" labelAccessibilityVisibility="exclusive" value={String(dashboard.range)}
            onChange={(event) => navigate(event.currentTarget.value === "30" ? "/app/help-desk/overview" : `/app/help-desk/overview?range=${event.currentTarget.value}`)}>
            {DASHBOARD_RANGES.map((value) => <s-option key={value} value={String(value)}>Last {value} days</s-option>)}
          </s-select>
        </div>
      </div>
    </s-section>

    {steps.some((step) => !step.done) && <SetupChecklist items={steps} />}

    <s-section padding="base">
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
        <KpiCard label="New tickets" value={String(created.total)} current={created.total} previous={created.previous} series={created.series} color="#334FB4" />
        <KpiCard label="Resolved" value={String(resolved.total)} current={resolved.total} previous={resolved.previous} series={resolved.series} color="#EB6834" />
        <KpiCard label="Avg. first reply" value={hoursLabel(response.hours)} current={response.hours} previous={response.previous} lowerIsBetter series={response.series} color="#334FB4"
          detail={response.hours === null ? "No replies in this period" : undefined} />
        <KpiCard label="Open right now" value={String(open.total)} current={null} previous={null}
          detail={`${open.unassigned} unassigned · ${open.waiting} waiting on customer`} onClick={() => go({ view: "" })} />
      </s-grid>
    </s-section>

    <s-section padding="base">
      <Card title="Tickets over time">
        <TrendChart dashboard={dashboard} />
      </Card>
    </s-section>

    <s-section padding="base">
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))" gap="base">
        <Card title="Waiting longest for a reply" action={open.noReply.length > 0 ? <s-link onClick={() => go({ view: "" })}>View all</s-link> : undefined}>
          {open.noReply.length === 0 ? <s-stack direction="inline" gap="small-200" alignItems="center"><s-icon type="check-circle" tone="success" /><s-text>Every open request has a reply. Nice work!</s-text></s-stack>
            : <div style={{ display: "grid" }}>
              {open.noReply.map((ticket, index) => <s-clickable key={ticket.id} onClick={() => go({ ticket: ticket.id })} accessibilityLabel={`Open ticket ${ticket.number}`}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "9px 0", borderTop: index ? "1px solid #F1F1F1" : "none" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#303030" }}>#{ticket.number} {ticket.topic}</div>
                    <div style={{ fontSize: 12.5, color: "#616161" }}>{ticket.name}</div>
                  </div>
                  <span style={{ flex: "none", fontSize: 12.5, fontWeight: 600, color: "#B3261E" }} suppressHydrationWarning>{duration(Date.now() - new Date(ticket.createdAt).getTime())}</span>
                </div>
              </s-clickable>)}
            </div>}
        </Card>
        <Card title="Tickets by category">
          <BarList items={dashboard.categories} empty="No new tickets in this period." share limit={8}
            onSelect={(category) => { if (categoryNames.includes(category)) go({ category, view: "all" }); }} />
        </Card>
        <Card title="Top issues">
          <BarList items={dashboard.issues} empty="No sub-categories set in this period." share color="#EB6834" limit={8}
            onSelect={(label) => { const [category, subcategory] = label.split(" › "); go({ category, subcategory, view: "all" }); }} />
        </Card>
        <Card title="Root causes">
          <BarList items={dashboard.rootCauses} empty="Set a root cause on tickets to see why problems happen." share color="#B3261E" limit={8}
            onSelect={(rootCause) => go({ rootCause, view: "all" })} />
        </Card>
        <Card title="Delivery & damage by carrier">
          <BarList items={dashboard.carriers} empty="Carriers appear here once tickets with a shipped order come in." share color="#334FB4" limit={6} />
        </Card>
        <Card title="Who can fix it" action={<s-link href="/app/help-desk/settings/categories">How this works</s-link>}>
          <BarList items={byTeam(dashboard.rootCauses)} empty="Set root causes on tickets to see which team can prevent them." share color="#6B7FD7" />
        </Card>
        <Card title="How tickets were resolved">
          <BarList items={dashboard.resolutions} empty="No tickets resolved in this period." share color="#2E7D32" limit={8} />
          {dashboard.unclassifiedResolved > 0 && <s-text color="subdued">{dashboard.unclassifiedResolved} resolved ticket{dashboard.unclassifiedResolved === 1 ? " has" : "s have"} no resolution recorded.</s-text>}
        </Card>
        <Card title="Open tickets by person">
          <BarList items={dashboard.workload} empty="Nothing open right now." color="#6B7FD7"
            onSelect={(name) => go(name === "Unassigned" ? { view: "unassigned" } : { assignee: name })} />
        </Card>
        <Card title="AI photo check" action={<s-link href="/app/photo-checks">Review photos</s-link>}>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 24, fontWeight: 700, color: "#303030" }}>{photos.checked}</span>
              <s-text color="subdued">photos checked</s-text>
            </div>
            {[
              { label: "Likely AI-generated", value: photos.likelyAi, tone: "critical" as const },
              { label: "Reused photo", value: photos.reused, tone: "warning" as const },
              { label: "Can't confirm", value: photos.uncertain, tone: "caution" as const },
              { label: "Likely genuine", value: photos.genuine, tone: "success" as const },
            ].map((row) => <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <s-badge tone={row.tone}>{row.label}</s-badge><b style={{ fontSize: 13 }}>{row.value}</b>
            </div>)}
            {flagged > 0 && <s-link onClick={() => go({ view: "flagged" })}>See {flagged} flagged ticket{flagged === 1 ? "" : "s"}</s-link>}
          </div>
        </Card>
      </s-grid>
    </s-section>
  </>;
}


export default function HelpDeskOverviewRoute() {
  return <s-page heading="Help Desk overview" inlineSize="large">
    <s-button slot="secondary-actions" icon="image" href="/app/photo-checks">Photo checks</s-button>
    <HelpDeskNavigation current="overview" />
    <HelpDeskOverview screen={useLoaderData<typeof loader>()} />
  </s-page>;
}
