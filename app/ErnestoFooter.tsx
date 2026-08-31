"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function ErnestoFooter() {
  const pathname = usePathname();
  if (pathname !== "/") return null;

  return (
    <footer
      aria-label="Aide et confidentialité Ernesto"
      style={{
        position: "fixed",
        right: 20,
        bottom: 10,
        zIndex: 70,
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "7px 11px",
        borderRadius: 999,
        border: "1px solid rgba(67,83,49,.14)",
        background: "rgba(255,255,255,.88)",
        boxShadow: "0 8px 24px rgba(15,23,42,.06)",
        backdropFilter: "blur(10px)",
        fontSize: 11,
        color: "#64748b",
      }}
    >
      <Link href="/aide" style={linkStyle}>Aide</Link>
      <span aria-hidden="true" style={{ opacity: .42 }}>·</span>
      <Link href="/confidentialite" style={linkStyle}>Confidentialité</Link>
      <span aria-hidden="true" style={{ opacity: .42 }}>·</span>
      <Link href="/contact" style={linkStyle}>Contact</Link>
    </footer>
  );
}

const linkStyle: React.CSSProperties = {
  color: "inherit",
  textDecoration: "none",
  fontWeight: 750,
};
