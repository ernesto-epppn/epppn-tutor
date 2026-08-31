import Link from "next/link";

export default function ContactPage() {
  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.kicker}>Ernesto · Contact</div>
        <h1 style={styles.title}>Une question sur Ernesto ?</h1>
        <p style={styles.intro}>
          Pour une question sur votre accès, un problème technique, l’utilisation d’Ernesto
          ou une remarque sur l’outil, vous pouvez contacter directement l’équipe Ernesto.
        </p>

        <div style={styles.block}>
          <h2 style={styles.heading}>Nous écrire</h2>
          <p style={styles.text}>
            Envoyez-nous un message en décrivant simplement votre demande. Pour un problème
            technique, vous pouvez également préciser l’appareil et le navigateur utilisés,
            ainsi que joindre une capture d’écran si cela peut nous aider à comprendre la situation.
          </p>

          <a
            href="mailto:ernesto@epppn.fr?subject=Ernesto%20-%20Demande%20d%27aide"
            style={styles.button}
          >
            Envoyer un message à l’équipe Ernesto
          </a>

          <div style={styles.hint}>
            Le bouton ouvre votre application de messagerie habituelle.
          </div>
        </div>

        <div style={styles.secondaryBlock}>
          <h2 style={styles.heading}>EPPPN</h2>
          <p style={styles.text}>
            Pour les informations générales concernant l’école et ses formations, consultez le site officiel de l’EPPPN.
          </p>
          <a href="https://epppn.fr/" target="_blank" rel="noreferrer" style={styles.secondaryButton}>
            Ouvrir le site EPPPN ↗
          </a>
        </div>

        <Link href="/" style={styles.back}>← Retour à Ernesto</Link>
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    padding: "42px 20px",
    background: "#f6f4ed",
    color: "#172132",
    fontFamily: "Arial, Helvetica, sans-serif",
  },
  card: {
    maxWidth: 760,
    margin: "0 auto",
    background: "white",
    border: "1px solid rgba(67,83,49,.16)",
    borderRadius: 28,
    padding: "36px",
    boxShadow: "0 20px 50px rgba(23,33,50,.08)",
  },
  kicker: {
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: ".12em",
    textTransform: "uppercase",
    color: "#6f7f43",
  },
  title: {
    margin: "10px 0 12px",
    fontSize: 40,
    letterSpacing: "-.03em",
  },
  intro: {
    margin: 0,
    fontSize: 18,
    lineHeight: 1.55,
    color: "#475569",
  },
  block: {
    marginTop: 26,
    padding: 22,
    borderRadius: 20,
    background: "#fafbf7",
    border: "1px solid rgba(67,83,49,.14)",
  },
  secondaryBlock: {
    marginTop: 14,
    padding: 20,
    borderRadius: 18,
    background: "#ffffff",
    border: "1px solid rgba(67,83,49,.10)",
  },
  heading: {
    margin: 0,
    fontSize: 19,
  },
  text: {
    margin: "8px 0 0",
    fontSize: 15,
    lineHeight: 1.6,
    color: "#475569",
  },
  button: {
    display: "inline-block",
    marginTop: 18,
    padding: "11px 16px",
    borderRadius: 999,
    background: "#435331",
    color: "white",
    textDecoration: "none",
    fontWeight: 800,
    fontSize: 14,
  },
  secondaryButton: {
    display: "inline-block",
    marginTop: 15,
    padding: "9px 13px",
    borderRadius: 999,
    border: "1px solid rgba(67,83,49,.18)",
    color: "#435331",
    background: "white",
    textDecoration: "none",
    fontWeight: 800,
    fontSize: 13,
  },
  hint: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 1.45,
    color: "#7b8492",
  },
  back: {
    display: "inline-block",
    marginTop: 26,
    color: "#435331",
    fontWeight: 800,
    textDecoration: "none",
  },
};
