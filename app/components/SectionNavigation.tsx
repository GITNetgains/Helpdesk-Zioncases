import { Link } from "react-router";

export type SectionLink = { id: string; label: string; href: string };

export default function SectionNavigation({ label, current, items }: { label: string; current: string; items: SectionLink[] }) {
  return <nav aria-label={label} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 18, margin: 0, padding: 0, borderBottom: "1px solid var(--hd-border, #e5e7eb)", background: "transparent", width: "100%", maxWidth: "100%" }}>
    {items.map((item) => <Link key={item.id} to={item.href} aria-current={current === item.id ? "page" : undefined}
      style={{ display: "inline-flex", alignItems: "center", minHeight: 40, padding: "8px 2px", border: 0, borderBottom: current === item.id ? "2px solid var(--hd-accent-line, #334fb4)" : "2px solid transparent", borderRadius: 0, textDecoration: "none", fontSize: 13, fontWeight: current === item.id ? 650 : 500,
        color: current === item.id ? "var(--hd-ink, #172351)" : "var(--hd-muted, #596273)", background: "transparent", boxShadow: "none", whiteSpace: "nowrap" }}>
      {item.label}
    </Link>)}
  </nav>;
}
