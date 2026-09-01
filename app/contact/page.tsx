import Link from "next/link";

export default function ContactPage() {
  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.kicker}>Ernesto · Assistance</div>
        <h1 style={styles.title}>Un problème technique ?</h1>
        <p style={styles.intro}>
          Si quelque chose ne fonctionne pas correctement, signalez-le-nous en quelques mots.
          Une capture d’écran peut être utile si le problème est visuel.
        </p>

        <a
          href="mailto:ernesto@epppn.fr?subject=Ernesto%20-%20Probl%C3%A8me%20technique"
          style={styles.button}
        >
          Signaler un problème
        </a>

        <div style={styles.hint}>
          Le bouton ouvre votre application de messagerie habituelle.
        </div>

        <Link href="/" style={styles.back}>← Retour à Ernesto</Link>
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: "28px 20px",
    background: "linear-gradient(145deg, #f3f1e9, #e8eddf)",
    color: "#172132",
    fontFamily: "Arial, Helvetica, sans-serif",
  },
  card: {
    width: "min(560px, 100%)",
    background: "rgba(255,255,255,.96)",
    border: "1px solid rgba(67,83,49,.16)",
    borderRadius: 26,
    padding: "34px",
    boxShadow: "0 22px 60px rgba(23,33,50,.09)",
  },
  kicker: {
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: ".13em",
    textTransform: "uppercase",
    color: "#6f7f43",
  },
  title: {
    margin: "10px 0 12px",
    fontSize: 36,
    lineHeight: 1.05,
    letterSpacing: "-.03em",
  },
  intro: {
    margin: 0,
    fontSize: 17,
    lineHeight: 1.55,
    color: "#52606d",
  },
  button: {
    display: "inline-block",
    marginTop: 24,
    padding: "12px 17px",
    borderRadius: 999,
    background: "linear-gradient(135deg, #52633c, #3f4f2f)",
    color: "white",
    textDecoration: "none",
    fontWeight: 850,
    fontSize: 14,
    boxShadow: "0 8px 20px rgba(67,83,49,.18)",
  },
  hint: {
    marginTop: 11,
    fontSize: 12,
    lineHeight: 1.45,
    color: "#7b8492",
  },
  back: {
    display: "inline-block",
    marginTop: 28,
    color: "#64748b",
    fontWeight: 750,
    fontSize: 13,
    textDecoration: "none",
  },
};
