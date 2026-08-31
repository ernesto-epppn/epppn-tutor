import Link from "next/link";

export default function ContactPage() {
  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.kicker}>Ernesto · Contact</div>
        <h1 style={styles.title}>Besoin d’aide ?</h1>
        <p style={styles.intro}>
          Pour une question sur votre accès, la formation ou l’utilisation d’Ernesto, contactez l’EPPPN par les canaux habituels de l’école.
        </p>

        <div style={styles.block}>
          <h2 style={styles.heading}>EPPPN</h2>
          <p style={styles.text}>
            Vous pouvez retrouver les coordonnées et informations de contact officielles sur le site de l’EPPPN.
          </p>
          <a href="https://epppn.fr/" target="_blank" rel="noreferrer" style={styles.button}>
            Ouvrir epppn.fr ↗
          </a>
        </div>

        <Link href="/" style={styles.back}>← Retour à Ernesto</Link>
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", padding: "42px 20px", background: "#f6f4ed", color: "#172132", fontFamily: "Arial, Helvetica, sans-serif" },
  card: { maxWidth: 760, margin: "0 auto", background: "white", border: "1px solid rgba(67,83,49,.16)", borderRadius: 28, padding: "36px", boxShadow: "0 20px 50px rgba(23,33,50,.08)" },
  kicker: { fontSize: 12, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: "#6f7f43" },
  title: { margin: "10px 0 12px", fontSize: 40, letterSpacing: "-.03em" },
  intro: { margin: 0, fontSize: 18, lineHeight: 1.55, color: "#475569" },
  block: { marginTop: 26, padding: 20, borderRadius: 18, background: "#fafbf7", border: "1px solid rgba(67,83,49,.12)" },
  heading: { margin: 0, fontSize: 19 },
  text: { margin: "8px 0 0", fontSize: 15, lineHeight: 1.55, color: "#475569" },
  button: { display: "inline-block", marginTop: 18, padding: "10px 14px", borderRadius: 999, background: "#435331", color: "white", textDecoration: "none", fontWeight: 800, fontSize: 14 },
  back: { display: "inline-block", marginTop: 26, color: "#435331", fontWeight: 800, textDecoration: "none" },
};
