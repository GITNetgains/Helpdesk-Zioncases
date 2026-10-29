import { Link } from "react-router";

export type SectionLink = { id: string; label: string; href: string };

export default function SectionNavigation({ label, current, items }: { label: string; current: string; items: SectionLink[] }) {
  return <nav aria-label={label} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, margin: "0 0 24px", padding: "6px", border: "1px solid #e5e7eb", borderRadius: 12, background: "#f7f8fa", width: "fit-content", maxWidth: "100%" }}>
    {items.map((item) => <Link key={item.id} to={item.href} aria-current={current === item.id ? "page" : undefined}
      style={{ display: "inline-flex", alignItems: "center", minHeight: 36, padding: "8px 14px", border: current === item.id ? "1px solid #d8dce4" : "1px solid transparent", borderRadius: 8, textDecoration: "none", fontSize: 13, fontWeight: current === item.id ? 650 : 500,
        color: current === item.id ? "#172351" : "#596273", background: current === item.id ? "#fff" : "transparent", boxShadow: current === item.id ? "0 1px 2px rgba(16,24,40,.08)" : "none", whiteSpace: "nowrap" }}>
      {item.label}
    </Link>)}
  </nav>;
}
