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
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "12px 20px 16px",
        borderTop: "1px solid rgba(67,83,49,.10)",
        background: "transparent",
        fontSize: 11,
        color: "#7a817b",
      }}
    >
      <Link href="/aide" style={linkStyle}>Aide</Link>
      <span aria-hidden="true" style={{ opacity: .38 }}>·</span>
      <Link href="/confidentialite" style={linkStyle}>Confidentialité</Link>
      <span aria-hidden="true" style={{ opacity: .38 }}>·</span>
      <Link href="/contact" style={linkStyle}>Contact</Link>
    </footer>
  );
}

const linkStyle: React.CSSProperties = {
  color: "inherit",
  textDecoration: "none",
  fontWeight: 750,
};
