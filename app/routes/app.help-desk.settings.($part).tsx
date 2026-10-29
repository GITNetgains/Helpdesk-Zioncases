import { useEffect, useState } from "react";
import type { LoaderFunctionArgs, ShouldRevalidateFunction } from "react-router";
import { useFetcher, useLoaderData, useParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { countries, macroPlaceholders, MAX_MESSAGE_LENGTH, PROVINCES } from "../services/help-desk";
import { describeRate, parseDays, processingDays, rateTransit, shippingAnswer, type TransitSource } from "../services/help-desk-shipping";
import { adminContext, helpDeskAction, loadSettings } from "../services/help-desk-admin.server";
import { categories, categoryNames, describeCategory, resolutionTypes, rootCauses, rootCauseTeams, subcategoriesOf } from "../services/help-desk-taxonomy";
import { IconTile, since } from "../components/HelpDeskUi";
import SectionNavigation from "../components/SectionNavigation";
import { DAY, HelpDeskNavigation, useResultToast } from "../components/help-desk/shared";

// Help Desk settings: /app/help-desk/settings/:part (emails by default).
const SETTINGS_PARTS = ["email", "team", "replies", "categories", "photos", "shipping", "storefront"];

export const loader = async ({ request }: LoaderFunctionArgs) => loadSettings(await adminContext(request));

export const action = helpDeskAction;

// Switching settings tabs must not reload saved values over unsaved edits.
export const shouldRevalidate: ShouldRevalidateFunction = ({ formMethod, currentUrl, nextUrl, defaultShouldRevalidate }) =>
  !formMethod && currentUrl.pathname !== nextUrl.pathname && currentUrl.search === nextUrl.search ? false : defaultShouldRevalidate;

type SettingsData = ReturnType<typeof useLoaderData<typeof loader>>;

// ---------- Settings ----------

type Macro = SettingsData["macros"][number];

function MacroEditor({ macro, onDone }: { macro?: Macro; onDone?: () => void }) {
  const fetcher = useFetcher<typeof action>();
  const [title, setTitle] = useState(macro?.title ?? "");
  const [body, setBody] = useState(macro?.body ?? "");
  const [category, setCategory] = useState(macro?.category ?? "");
  const [subcategory, setSubcategory] = useState(macro?.subcategory ?? "");
  useResultToast(fetcher, macro ? "Saved reply updated" : "Saved reply added");
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || Object.keys(fetcher.data.errors).length) return;
    if (!macro) { setTitle(""); setBody(""); setCategory(""); setSubcategory(""); }
    onDone?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);
  return <s-stack gap="base">
    <s-text-field label="Name" value={title} maxLength={80} error={fetcher.data?.errors.title} onInput={(event) => setTitle(event.currentTarget.value ?? "")} />
    <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
      <s-select label="Use for" value={category} details={category ? `Suggested first on ${category} tickets.` : "Offered on every ticket."}
        onChange={(event) => { setCategory(event.currentTarget.value ?? ""); setSubcategory(""); }}>
        <s-option value="">Any ticket (general reply)</s-option>
        {categoryNames.map((value) => <s-option key={value} value={value}>{value}</s-option>)}
      </s-select>
      {category && <s-select label="Sub-category" value={subcategory} details="Optional. Pick one to suggest it only for that issue."
        onChange={(event) => setSubcategory(event.currentTarget.value ?? "")}>
        <s-option value="">Whole category</s-option>
        {subcategoriesOf(category).map((value) => <s-option key={value} value={value}>{value}</s-option>)}
      </s-select>}
    </s-grid>
    <s-text-area label="Reply" rows={6} value={body} maxLength={MAX_MESSAGE_LENGTH} error={fetcher.data?.errors.body}
      details={`Placeholders: ${macroPlaceholders.map(([key]) => `{{ ${key} }}`).join(", ")}`} onInput={(event) => setBody(event.currentTarget.value ?? "")} />
    <s-stack direction="inline" gap="small-200">
      <s-button variant="primary" loading={fetcher.state !== "idle"} disabled={!title.trim() || !body.trim()}
        onClick={() => void fetcher.submit({ intent: "macro-save", id: macro?.id ?? "", title, body, category, subcategory }, { method: "post" })}>{macro ? "Save" : "Add saved reply"}</s-button>
      {onDone && <s-button variant="tertiary" onClick={onDone}>Cancel</s-button>}
    </s-stack>
  </s-stack>;
}

// General replies first, then categories in the taxonomy's order.
function groupsByCategory(macros: Macro[]) {
  return ["General", ...categoryNames]
    .map((group) => [group, macros.filter((macro) => (macro.category || "General") === group)] as const)
    .filter(([, list]) => list.length);
}

function SavedReplies({ macros }: { macros: SettingsData["macros"] }) {
  const [editing, setEditing] = useState("");
  const [adding, setAdding] = useState(macros.length === 0);
  const remove = useFetcher<typeof action>();
  useResultToast(remove, "Saved reply deleted");
  return <s-section heading="Saved replies">
    <s-stack gap="base">
      <s-paragraph color="subdued">Give each reply the category it answers. On a ticket, replies for its category are suggested first, above the general ones. These placeholders fill in by themselves: {macroPlaceholders.map(([key]) => `{{ ${key} }}`).join(", ")}.</s-paragraph>
      {groupsByCategory(macros).map(([group, list]) => <s-stack key={group} gap="small-200">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-heading>{group}</s-heading>
        <s-badge>{list.length}</s-badge>
      </s-stack>
      {group !== "General" && <s-text color="subdued">{describeCategory(group)}</s-text>}
      {list.map((macro) => editing === macro.id
        ? <s-box key={macro.id} border="base" borderRadius="base" padding="base"><MacroEditor macro={macro} onDone={() => setEditing("")} /></s-box>
        : <s-box key={macro.id} border="base" borderRadius="base" padding="base">
          <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
            <s-stack gap="none">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text type="strong">{macro.title}</s-text>
                {macro.subcategory && <s-badge tone="info">{macro.subcategory}</s-badge>}
              </s-stack>
              <s-text color="subdued">{macro.body.replace(/\s+/g, " ").slice(0, 110)}{macro.body.length > 110 ? "..." : ""}</s-text>
            </s-stack>
            <s-stack direction="inline" gap="small-100">
              <s-button variant="tertiary" icon="edit" accessibilityLabel={`Edit ${macro.title}`} onClick={() => setEditing(macro.id)} />
              <s-button variant="tertiary" tone="critical" icon="delete" accessibilityLabel={`Delete ${macro.title}`} disabled={remove.state !== "idle"}
                onClick={() => void remove.submit({ intent: "macro-delete", id: macro.id }, { method: "post" })} />
            </s-stack>
          </s-stack>
        </s-box>)}
      </s-stack>)}
      {adding ? <s-box border="base" borderRadius="base" padding="base" background="subdued">
        <s-stack gap="base">
          <s-heading>New saved reply</s-heading>
          <MacroEditor onDone={() => setAdding(false)} />
        </s-stack>
      </s-box> : <s-stack direction="inline"><s-button icon="plus" onClick={() => setAdding(true)}>Add saved reply</s-button></s-stack>}
    </s-stack>
  </s-section>;
}

const DETECTOR_MODE_LABELS: Record<string, { label: string; details: string }> = {
  always: { label: "Every photo the free checks can't settle (recommended)", details: "Layers 1-4 (Content Credentials, watermarks, metadata, known-image match) run first and free; any photo they can't settle goes to your AI detector." },
  suspicious: { label: "Skip clear camera originals", details: "Saves checks: photos with intact, consistent camera data aren't sent. Everything else the free checks can't settle is." },
  manual: { label: "Only when I click \"Check with AI detector\"", details: "No checks are used automatically." },
};

function AiSettings({ ai }: { ai: SettingsData["ai"] }) {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [values, setValues] = useState({ enabled: ai.enabled, mode: ai.mode, provider: ai.provider, sightengineUser: ai.sightengineUser, sightengineSecret: "", truthscanKey: "" });
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (Object.keys(fetcher.data.errors).length) shopify.toast.show(Object.values(fetcher.data.errors)[0], { isError: true });
    else {
      shopify.toast.show(fetcher.data.notice || "AI photo check saved", { isError: Boolean(fetcher.data.notice) });
      setValues((current) => ({ ...current, sightengineSecret: "", truthscanKey: "" }));
    }
  }, [fetcher.state, fetcher.data, shopify]);
  const set = (key: keyof typeof values, value: string | boolean) => setValues((current) => ({ ...current, [key]: value }));
  const truthscan = values.provider === "truthscan";
  const connected = truthscan ? ai.hasTruthscanKey : Boolean(ai.sightengineUser && ai.hasSightengineSecret);
  return <s-section heading="AI photo check">
    <s-stack gap="base">
      <s-paragraph color="subdued">
        Every photo customers send is checked for signs it was made with AI or reused from another request: Content Credentials, AI watermarks
        (including Gemini&apos;s), generator metadata, duplicate photos and signs of editing. These checks are free. Photos they can&apos;t settle can also go
        to a dedicated AI-image detector on your own account.
      </s-paragraph>
      <s-switch label="Check customer photos" checked={values.enabled} onChange={(event) => set("enabled", event.currentTarget.checked ?? false)} />
      <s-select label="AI detector" value={values.provider} disabled={!values.enabled} onChange={(event) => set("provider", event.currentTarget.value || "sightengine")}>
        <s-option value="sightengine">Sightengine (free plan: 2,000 checks a month)</s-option>
        <s-option value="truthscan">TruthScan (the engine behind ZeroGPT; free plan: 25 a month)</s-option>
      </s-select>
      {truthscan ? (
        <s-password-field label="TruthScan API key" value={values.truthscanKey} disabled={!values.enabled} autocomplete="off"
          placeholder={ai.hasTruthscanKey ? "Saved. Enter a new key to replace it" : "Paste your API key"}
          error={fetcher.data?.errors.credentials} onInput={(event) => set("truthscanKey", event.currentTarget.value ?? "")} />
      ) : <>
        <s-text-field label="Sightengine API user" value={values.sightengineUser} disabled={!values.enabled} autocomplete="off" onInput={(event) => set("sightengineUser", event.currentTarget.value ?? "")} />
        <s-password-field label="Sightengine API secret" value={values.sightengineSecret} disabled={!values.enabled} autocomplete="off"
          placeholder={ai.hasSightengineSecret ? "Saved. Enter a new secret to replace it" : "Paste your API secret"}
          error={fetcher.data?.errors.credentials} onInput={(event) => set("sightengineSecret", event.currentTarget.value ?? "")} />
      </>}
      <s-text color="subdued">{connected ? "Detector connected. Keys are checked with the provider when you save." : "Without a key the free checks still run; photos they can't settle show as \"Can't confirm\"."}</s-text>
      <s-select label="When to use the AI detector" value={values.mode} disabled={!values.enabled}
        details={DETECTOR_MODE_LABELS[values.mode]?.details} onChange={(event) => set("mode", event.currentTarget.value || "always")}>
        {Object.entries(DETECTOR_MODE_LABELS).map(([value, { label }]) => <s-option key={value} value={value}>{label}</s-option>)}
      </s-select>
      <s-stack direction="inline">
        <s-button variant="primary" loading={fetcher.state !== "idle"}
          onClick={() => void fetcher.submit({ intent: "ai-settings", ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])) }, { method: "post" })}>Save AI photo check</s-button>
      </s-stack>
    </s-stack>
  </s-section>;
}

// Shopify staff who have opened the Help Desk, each one assignable or not.
function StaffList({ staff, me }: { staff: SettingsData["staff"]; me: string }) {
  const fetcher = useFetcher<typeof action>();
  useResultToast(fetcher, "Team updated");
  return <s-section heading="Shopify staff">
    <s-stack gap="base">
      <s-paragraph color="subdued">
        Everyone with access to your Shopify admin is added here the first time they open the Help Desk, so you can assign tickets to them.
        Replies are sent as the person who is signed in. Ask a staff member to open Apps → Zion App → Help Desk once to add them.
      </s-paragraph>
      {staff.length === 0 ? <s-paragraph>No staff yet. They appear here after opening the Help Desk.</s-paragraph>
        : staff.map((member) => (
          <s-box key={member.id} border="base" borderRadius="base" padding="base">
            <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-avatar initials={member.name.slice(0, 2).toUpperCase()} alt={member.name} size="small" />
                <s-stack gap="none">
                  <s-stack direction="inline" gap="small-100" alignItems="center">
                    <s-text type="strong">{member.name}</s-text>
                    {member.name === me && <s-badge tone="info">You</s-badge>}
                    {member.accountOwner && <s-badge>Store owner</s-badge>}
                    {member.hidden && <s-badge tone="neutral">Not assignable</s-badge>}
                  </s-stack>
                  <s-text color="subdued">{[member.email, `last opened ${since(member.lastSeenAt)}`].filter(Boolean).join(" · ")}</s-text>
                </s-stack>
              </s-stack>
              <s-switch label="Can be assigned tickets" labelAccessibilityVisibility="exclusive" checked={!member.hidden} disabled={fetcher.state !== "idle"}
                onChange={(event) => void fetcher.submit({ intent: "staff-visibility", id: member.id, hidden: String(!event.currentTarget.checked) }, { method: "post" })} />
            </s-stack>
          </s-box>
        ))}
    </s-stack>
  </s-section>;
}

// The top of each settings tab: what it's for and how it stands right now.
function SettingsIntro({ icon, tone, title, description, status, statusTone }: {
  icon: "email" | "team" | "chat" | "image" | "store" | "flag" | "clock"; tone: "blue" | "navy" | "green" | "red" | "amber"; title: string; description: string; status: string; statusTone: "success" | "warning" | "info" | "neutral";
}) {
  return <s-section>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", gap: 14, alignItems: "center", flex: "1 1 320px", minWidth: 0 }}>
        <IconTile icon={icon} tone={tone} size={46} />
        <s-stack gap="small-100">
          <s-heading>{title}</s-heading>
          <s-text color="subdued">{description}</s-text>
        </s-stack>
      </div>
      <s-badge tone={statusTone}>{status}</s-badge>
    </div>
  </s-section>;
}

// How the team classifies tickets: what each category means, which team owns
// each root cause, and what to record when a ticket is resolved.
function CategoriesGuide() {
  const teams = [...new Set(Object.values(rootCauseTeams))];
  return <>
    <SettingsIntro icon="flag" tone="navy" title="Categories" description="Every ticket gets a category, a sub-category, a root cause and a resolution. That turns support into product insight: which problems are most common, why they happen and who can prevent them."
      status={`${categories.length} categories`} statusTone="success" />

    <s-section heading="How it works">
      <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 10 }}>
        <li><s-text><b>The customer picks a topic and an issue</b> on the storefront form, like &ldquo;Missing Items › Missing Risers&rdquo;. That sets the category and sub-category directly.</s-text></li>
        <li><s-text><b>The app sets the category and sub-category</b> from what they chose and wrote. A customer who picks Product issue › Risers and writes &ldquo;one riser came broken&rdquo; becomes Product Damage › Broken risers.</s-text></li>
        <li><s-text><b>You check it</b> in the Classification panel on the ticket, and add the <b>root cause</b> once you know why it happened.</s-text></li>
        <li><s-text><b>When you resolve the ticket</b>, record the <b>resolution</b>: refund, replacement, instructions sent and so on.</s-text></li>
        <li><s-text><b>The overview adds it all up</b>: top issues, root causes and which team can fix them.</s-text></li>
      </ol>
    </s-section>

    <s-section heading="Categories and sub-categories">
      <s-stack gap="base">
        <s-text color="subdued">Pick the category for what the problem <i>is</i>, not what the customer asked for. A broken case they want refunded is Product Damage, with Refund as the resolution.</s-text>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {categories.map((category) => <div key={category.name} style={{ border: "1px solid #E3E3E3", borderRadius: 12, padding: 14, display: "grid", gap: 8, alignContent: "start" }}>
            <s-text type="strong">{category.name}</s-text>
            <s-text color="subdued">{category.description}</s-text>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {category.subcategories.map((sub) => <s-badge key={sub}>{sub}</s-badge>)}
            </div>
            <s-link href={`/app/help-desk?view=all&category=${encodeURIComponent(category.name)}`}>See tickets</s-link>
          </div>)}
        </div>
      </s-stack>
    </s-section>

    <s-section heading="Root causes: who can fix it">
      <s-stack gap="base">
        <s-text color="subdued">The root cause is <i>why</i> it happened. Each one belongs to the team that can stop it happening again, so the overview can tell them what to fix.</s-text>
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Team</s-table-header>
            <s-table-header>Root causes</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {teams.map((team) => <s-table-row key={team}>
              <s-table-cell><s-text type="strong">{team}</s-text></s-table-cell>
              <s-table-cell>{rootCauses.filter((cause) => rootCauseTeams[cause] === team).join(" · ")}</s-table-cell>
            </s-table-row>)}
          </s-table-body>
        </s-table>
      </s-stack>
    </s-section>

    <s-section heading="Resolutions">
      <s-stack gap="base">
        <s-text color="subdued">What you did for the customer. Record one on every resolved ticket; the overview shows your refund, replacement and store credit rates.</s-text>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {resolutionTypes.map((value) => <s-badge key={value}>{value}</s-badge>)}
        </div>
      </s-stack>
    </s-section>

    <s-section heading="Examples">
      <s-table>
        <s-table-header-row>
          <s-table-header listSlot="primary">Customer says</s-table-header>
          <s-table-header>Category › Sub-category</s-table-header>
          <s-table-header>Root cause</s-table-header>
          <s-table-header>Resolution</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {[
            ["Horizontal display case arrived without risers", "Missing Parts › Risers missing", "Item not packed (warehouse)", "Replacement part"],
            ["Upon peeling the wrappers there seem to be scratches", "Manufacturing Defect › Scratches", "Manufacturing or QC defect", "Replacement"],
            ["Free sling bag is missing from my order", "Missing Parts › Free gift missing", "Free gift not added", "Replacement part"],
            ["During our flight one of the wheels fell off", "Manufacturing Defect › Wheel or handle failed", "Design weakness (lid, lock, wheels)", "Replacement"],
            ["Red instead of black display case", "Wrong Item Received › Wrong colour or variant", "Wrong item or variant packed", "Exchange"],
            ["Does the XL work with graded guards?", "Product Compatibility › Graded guards fit", "Product page unclear (size or fit)", "Recommended the right product"],
            ["Ordered on Oct 7, no updates", "Shipping & Delivery › Track My Order", "Fulfilment delay or backorder", "Tracking shared"],
          ].map(([says, category, cause, resolution]) => <s-table-row key={says}>
            <s-table-cell>&ldquo;{says}&rdquo;</s-table-cell>
            <s-table-cell>{category}</s-table-cell>
            <s-table-cell>{cause}</s-table-cell>
            <s-table-cell>{resolution}</s-table-cell>
          </s-table-row>)}
        </s-table-body>
      </s-table>
    </s-section>
  </>;
}

// Shipping Times on the storefront form: the store's own Shopify zones and
// rates, with the transit days Shopify doesn't store for custom rates.
const SOURCE_LABELS: Record<TransitSource, string> = {
  setting: "Set here", rate: "From the rate's name in Shopify", unknown: "Not set: customers see \"Shown at checkout\"",
};
const dayText = (range: [number, number]) => `${range[0] === range[1] ? range[0] : range.join("-")} business day${range[1] === 1 ? "" : "s"}`;

function ShippingTimes({ shipping }: { shipping: SettingsData["shipping"] }) {
  const fetcher = useFetcher<typeof action>();
  const [processing, setProcessing] = useState(shipping.times.processing);
  const [rates, setRates] = useState(shipping.times.rates);
  const [note, setNote] = useState(shipping.times.note);
  const [country, setCountry] = useState(shipping.setup?.home || "US");
  const [province, setProvince] = useState("");
  useResultToast(fetcher, "Shipping times saved");
  const { setup } = shipping;
  const current = { processing, rates, note };
  const shopifyProcessing = processingDays({ processing: "", rates: {}, note: "" }, setup?.processingTime);
  // Each rate once, with the zones it's offered in.
  const rateList = [...(setup?.zones ?? []).flatMap((zone) => zone.rates.map((rate) => ({ rate, zone: zone.name })))
    .reduce((map, { rate, zone }) => {
      const entry = map.get(rate.name) ?? { rate, zones: [] as string[] };
      if (!entry.zones.includes(zone)) entry.zones.push(zone);
      return map.set(rate.name, entry);
    }, new Map<string, { rate: (typeof setup & {})["zones"][number]["rates"][number]; zones: string[] }>()).values()];
  const preview = setup ? shippingAnswer(setup, current, country, province) : null;
  const day = (value: string) => new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value));
  const dates = (range: [string, string]) => range[0] === range[1] ? day(range[0]) : `${day(range[0])} – ${day(range[1])}`;
  const invalid = (processing.trim() && !parseDays(processing)) || Object.values(rates).some((days) => days.trim() && !parseDays(days));

  return <>
    <SettingsIntro icon="clock" tone="amber" title="Shipping times" description="What customers see when they pick Orders › Shipping Times: your shipping options for their country, prices and expected delivery dates."
      status={!shipping.access ? "Permission needed" : setup ? `${rateList.length} ${rateList.length === 1 ? "rate" : "rates"} from Shopify` : "Shopify unavailable"}
      statusTone={!shipping.access ? "warning" : setup ? "success" : "warning"} />
    {!shipping.access && <s-banner tone="warning" heading="Allow the app to read your shipping settings">
      Shipping times use the zones and rates in Settings › Shipping and delivery. Open the app again from Shopify admin and approve the new &ldquo;shipping&rdquo; permission when Shopify asks. Until then, customers can still send a question.
    </s-banner>}
    {shipping.access && !setup && <s-banner tone="warning">Shopify couldn&apos;t be reached just now. Reload the page to try again.</s-banner>}

    <s-section heading="Processing time">
      <s-stack gap="base">
        <s-text-field label="Business days to pack and ship an order" value={processing} maxLength={10}
          placeholder={shopifyProcessing.days ? shopifyProcessing.days.join("-") : "e.g. 1-2"}
          details={shopifyProcessing.days ? `Leave blank to use your Shopify processing time (${dayText(shopifyProcessing.days)}). Use a range like 1-2.`
            : "Not set in Shopify (Settings › Shipping and delivery › Processing time). Until it's set here or there, customers see no delivery dates."}
          error={processing.trim() && !parseDays(processing) ? "Enter business days like 1-2." : fetcher.data?.errors.processing}
          onInput={(event) => setProcessing(event.currentTarget.value ?? "")} />
      </s-stack>
    </s-section>

    <s-section heading="Delivery time for each rate">
      <s-stack gap="base">
        <s-paragraph color="subdued">
          Prices always come live from Shopify. Shopify doesn&apos;t store how long a custom rate takes, so set the business days in transit for each one;
          rates named like &ldquo;Standard (3-5 business days)&rdquo; are read from their name. Without a time, customers see the price and &ldquo;Shown at checkout&rdquo;.
          Rates with the same name share a time. To add or change rates themselves,
          use <s-link href="shopify://admin/settings/shipping" target="_blank">Shopify&apos;s shipping settings</s-link>.
        </s-paragraph>
        {setup && !rateList.length && <s-text>No shipping rates found in Shopify yet.</s-text>}
        {rateList.map(({ rate, zones }) => {
          const transit = rateTransit(rate.name, rate.description, current);
          const { price, condition } = describeRate(rate);
          const value = rates[rate.name] ?? "";
          const auto = rateTransit(rate.name, rate.description, { processing: "", rates: {}, note: "" });
          return <s-box key={rate.name} border="base" borderRadius="base" padding="base">
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base" alignItems="center">
              <s-stack gap="small-100">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-text type="strong">{rate.name}</s-text>
                  <s-badge tone={transit.source === "unknown" ? "warning" : "success"}>{transit.days ? dayText(transit.days) : "No time set"}</s-badge>
                </s-stack>
                <s-text color="subdued">{[price, condition].filter(Boolean).join(" · ")}</s-text>
                <s-text color="subdued">Zones: {zones.join(", ")}</s-text>
              </s-stack>
              <s-text-field label={`Days in transit for ${rate.name}`} value={value} maxLength={10} placeholder={auto.days ? auto.days.join("-") : "e.g. 3-5"}
                details={SOURCE_LABELS[transit.source]} error={value.trim() && !parseDays(value) ? "Enter days like 3-5." : undefined}
                onInput={(event) => { const next = event.currentTarget.value ?? ""; setRates((all) => ({ ...all, [rate.name]: next })); }} />
            </s-grid>
          </s-box>;
        })}
      </s-stack>
    </s-section>

    <s-section heading="Note for customers">
      <s-text-area label="Shown under the shipping options" rows={3} value={note} maxLength={500}
        placeholder="For example: orders placed after 2 pm Eastern ship the next business day. We don't ship on public holidays."
        error={fetcher.data?.errors.note} onInput={(event) => setNote(event.currentTarget.value ?? "")} />
    </s-section>

    {preview && <s-section heading="Preview">
      <s-stack gap="base">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
          <s-select label="Customer ships to" value={country} onChange={(event) => { setCountry(event.currentTarget.value || "US"); setProvince(""); }}>
            {countries.map((entry) => <s-option key={entry.code} value={entry.code}>{entry.name}</s-option>)}
          </s-select>
          {PROVINCES[country] && <s-select label="State or province" value={province} onChange={(event) => setProvince(event.currentTarget.value ?? "")}>
            <s-option value="">Any</s-option>
            {PROVINCES[country].map(([code, name]) => <s-option key={code} value={code}>{name}</s-option>)}
          </s-select>}
        </s-grid>
        {!preview.ships ? <s-banner tone="warning">No shipping zone covers {preview.countryName}, so customers there are told you don&apos;t ship to them yet.</s-banner> : <>
          {preview.processing && preview.shipsBy ? <s-text>Orders ship within {dayText(preview.processing)}: an order placed today leaves by {dates(preview.shipsBy)}.</s-text>
            : <s-text color="subdued">No processing time set, so no delivery dates are shown.</s-text>}
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Rate</s-table-header>
              <s-table-header>Price</s-table-header>
              <s-table-header>In transit</s-table-header>
              <s-table-header>Arrives (ordered today)</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {preview.rates.map((rate) => <s-table-row key={`${rate.name}|${rate.price}|${rate.condition}`}>
                <s-table-cell>{rate.name}</s-table-cell>
                <s-table-cell>{[rate.price, rate.condition].filter(Boolean).join(" · ")}</s-table-cell>
                <s-table-cell>{rate.days ? dayText(rate.days) : "Not set"}</s-table-cell>
                <s-table-cell>{rate.arrives ? dates(rate.arrives) : "Shown at checkout"}</s-table-cell>
              </s-table-row>)}
            </s-table-body>
          </s-table>
          {note.trim() && <s-text color="subdued">{note.trim()}</s-text>}
        </>}
      </s-stack>
    </s-section>}

    <s-stack direction="inline">
      <s-button variant="primary" loading={fetcher.state !== "idle"} disabled={Boolean(invalid)}
        onClick={() => void fetcher.submit({ intent: "shipping-times", processing, note, rates: JSON.stringify(rates) }, { method: "post" })}>Save shipping times</s-button>
    </s-stack>
  </>;
}

function SettingsScreen({ screen }: { screen: SettingsData }) {
  const { part: requested = "email" } = useParams();
  const part = SETTINGS_PARTS.includes(requested) ? requested : "email";
  const { settings, storeEmail, configured } = screen;
  const save = useFetcher<typeof action>();
  const test = useFetcher<typeof action>();
  const [values, setValues] = useState(settings);
  useEffect(() => setValues(settings), [settings]);
  const recipient = values.notifyEmail.trim() || storeEmail;
  useResultToast(save, "Help Desk settings saved");
  useResultToast(test, `Test email sent to ${recipient}`);
  const dirty = (Object.keys(settings) as (keyof typeof settings)[]).some((key) => settings[key] !== values[key]);
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => setValues((current) => ({ ...current, [key]: value }));
  const detectorConnected = screen.ai.provider === "truthscan" ? screen.ai.hasTruthscanKey : Boolean(screen.ai.sightengineUser && screen.ai.hasSightengineSecret);
  const formLive = Boolean(screen.storefront.formLastSeenAt && Date.now() - new Date(screen.storefront.formLastSeenAt).getTime() < 30 * DAY);
  return <s-page heading="Help Desk settings" inlineSize="large">
    <s-link slot="breadcrumb-actions" href="/app/help-desk">Help Desk</s-link>
    {(part === "email" || part === "team") && <s-button slot="primary-action" variant="primary" disabled={!dirty} loading={save.state !== "idle"}
      onClick={() => void save.submit({ intent: "settings", ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])) }, { method: "post" })}>Save</s-button>}

    <HelpDeskNavigation current="settings" />
    <SectionNavigation label="Settings categories" current={part} items={[
      { id: "email", label: "Emails", href: "/app/help-desk/settings" },
      { id: "team", label: "Team", href: "/app/help-desk/settings/team" },
      { id: "replies", label: "Saved replies", href: "/app/help-desk/settings/replies" },
      { id: "categories", label: "Categories", href: "/app/help-desk/settings/categories" },
      { id: "photos", label: "AI photo check", href: "/app/help-desk/settings/photos" },
      { id: "shipping", label: "Shipping times", href: "/app/help-desk/settings/shipping" },
      { id: "storefront", label: "Storefront form", href: "/app/help-desk/settings/storefront" },
    ]} />
    {part === "email" && <>
    <SettingsIntro icon="email" tone="blue" title="Emails" description="Who gets alerts about new requests, and what customers receive by email."
      status={configured ? "Sending on" : "Not set up yet"} statusTone={configured ? "success" : "warning"} />
    {!configured && <s-banner tone="info" heading="Emails aren't being sent yet">
      The app server needs a mailbox login (Gmail or Brevo) before it can send email. Until then, everything still works in the app and in the customer&apos;s chat on their request page. The Channels setup guide lists what&apos;s needed.
    </s-banner>}

    <s-section heading="Team notifications">
      <s-stack gap="base">
        <s-switch label="Email me about new requests and customer replies" checked={values.notify} onChange={(event) => set("notify", event.currentTarget.checked ?? false)} />
        <s-email-field label="Send notifications to" value={values.notifyEmail} placeholder={storeEmail || "name@example.com"}
          details={storeEmail ? `Leave blank to use your store email (${storeEmail}).` : "Leave blank to use your store email."}
          error={save.data?.errors.notifyEmail} disabled={!values.notify} onInput={(event) => set("notifyEmail", event.currentTarget.value ?? "")} />
        <s-stack direction="inline">
          <s-button disabled={!configured || !recipient} loading={test.state !== "idle"} onClick={() => void test.submit({ intent: "test-email", to: recipient }, { method: "post" })}>Send test email</s-button>
        </s-stack>
      </s-stack>
    </s-section>

    <s-section heading="Customer emails">
      <s-stack gap="base">
        <s-switch label="Send customers a confirmation with their ticket number" details="Includes a private link where they can follow their request and reply."
          checked={values.autoReply} onChange={(event) => set("autoReply", event.currentTarget.checked ?? false)} />
        <s-switch label="Email customers when their ticket is In progress or Resolved" details="Sent when your team changes the status. Replies are always emailed."
          checked={values.statusEmails} onChange={(event) => set("statusEmails", event.currentTarget.checked ?? false)} />
        <s-text-area label="Reply signature" rows={3} value={values.signature} maxLength={2000} placeholder={"Best regards,\nThe support team"}
          details="Added to the end of every reply emailed to a customer." error={save.data?.errors.signature} onInput={(event) => set("signature", event.currentTarget.value ?? "")} />
      </s-stack>
    </s-section>

    </>}
    {part === "team" && <>
      <SettingsIntro icon="team" tone="navy" title="Team" description="People who can be assigned tickets and chosen in Reply as."
        status={`${screen.team.length} ${screen.team.length === 1 ? "person" : "people"}`} statusTone={screen.team.length ? "success" : "warning"} />
      <StaffList staff={screen.staff} me={screen.me} />
      <s-section heading="Other names">
        <s-text-field label="Extra team members" value={values.team} placeholder="e.g. Priya, Warehouse team"
          details="For people who don't have a Shopify login. Separate names with commas. They can be assigned tickets and chosen in Reply as." onInput={(event) => set("team", event.currentTarget.value ?? "")} />
      </s-section>
    </>}

    {part === "categories" && <CategoriesGuide />}

    {part === "photos" && <>
      <SettingsIntro icon="image" tone="green" title="AI photo check" description="Checks every customer photo for AI generation, reuse from another request and editing."
        status={!screen.ai.enabled ? "Off" : detectorConnected ? "Detector connected" : "Detector not connected"}
        statusTone={!screen.ai.enabled ? "neutral" : detectorConnected ? "success" : "warning"} />
      <AiSettings ai={screen.ai} />
    </>}

    {part === "replies" && <>
      <SettingsIntro icon="chat" tone="green" title="Saved replies" description="Ready answers your team can insert into any reply with one click."
        status={`${screen.macros.length} saved`} statusTone={screen.macros.length ? "success" : "warning"} />
      <SavedReplies macros={screen.macros} />
    </>}

    {part === "shipping" && <ShippingTimes shipping={screen.shipping} />}

    {part === "storefront" && <>
      <SettingsIntro icon="store" tone="red" title="Storefront form" description="The form customers use to send requests, and their private chat page."
        status={formLive ? "Live on your store" : "Not added yet"} statusTone={formLive ? "success" : "warning"} />
      <s-section heading="Add the form to your store">
        <s-stack gap="base">
          <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8 }}>
            <li><s-text>Create a page, such as Contact or Support.</s-text></li>
            <li><s-text>Add the Help Desk form block to it in the theme editor, then save.</s-text></li>
            <li><s-text>Send a test request with a photo. It appears in your inbox within a few seconds.</s-text></li>
          </ol>
          <s-stack direction="inline" gap="small-200">
            <s-button href="shopify://admin/pages/new" target="_blank" icon="page">Create page</s-button>
            <s-button variant="primary" target="_blank" icon="theme-edit"
              href={`shopify://admin/themes/current/editor?template=page&addAppBlockId=${screen.storefront.apiKey}/help_desk&target=newAppsSection`}>Add form block</s-button>
          </s-stack>
          {screen.storefront.formLastSeenAt && <s-text color="subdued">Last opened by a customer {since(screen.storefront.formLastSeenAt)}.</s-text>}
        </s-stack>
      </s-section>
      <s-section heading="What customers get">
        <s-unordered-list>
          <s-list-item>A request number and a private page where they chat with your team, live.</s-list-item>
          <s-list-item>Signed-in customers pick from their own orders and see their past requests.</s-list-item>
          <s-list-item>Their photos are checked automatically by the AI photo check.</s-list-item>
        </s-unordered-list>
      </s-section>
    </>}
  </s-page>;
}


export default function HelpDeskSettings() {
  return <SettingsScreen screen={useLoaderData<typeof loader>()} />;
}
