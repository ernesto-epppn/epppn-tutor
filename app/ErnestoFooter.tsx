"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function ErnestoFooter() {
  const pathname = usePathname();
  if (pathname !== "/") return null;

  return (
    <footer
      aria-label="Informations et confidentialité Ernesto"
      style={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        padding: "13px 18px calc(17px + env(safe-area-inset-bottom, 0px))",
        borderTop: "1px solid rgba(67,83,49,.10)",
        background: "transparent",
        fontSize: 11,
        lineHeight: 1.5,
        color: "#7a817b",
        textAlign: "center",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 8 }}>
        <Link href="/aide" style={linkStyle}>Aide</Link>
        <span aria-hidden="true" style={{ opacity: .38 }}>·</span>
        <Link href="/confidentialite" style={linkStyle}>Confidentialité</Link>
        <span aria-hidden="true" style={{ opacity: .38 }}>·</span>
        <Link href="/contact" style={linkStyle}>Contact</Link>
      </div>
      <div style={{ maxWidth: 760 }}>
        <span style={{ fontWeight: 650, color: "#62716b" }}>Ernesto · Version V14.5</span>
        <span style={{ display: "block", fontSize: 10, marginTop: 2 }}>
          Conçu et développé par la section « Apprentissage et Informatisation » de l’EPPPN.
        </span>
      </div>
    </footer>
  );
}

const linkStyle: React.CSSProperties = {
  color: "inherit",
  textDecoration: "none",
  fontWeight: 650,
};
