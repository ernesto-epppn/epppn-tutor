import Link from "next/link";

export default function ConfidentialitePage() {
  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.kicker}>Ernesto · Confidentialité</div>
        <h1 style={styles.title}>Vos données et Ernesto</h1>
        <p style={styles.intro}>
          Ernesto est conçu pour limiter la conservation des données au nécessaire pour son fonctionnement et la continuité de vos dossiers.
        </p>

        <div style={styles.section}>
          <h2 style={styles.heading}>Données conservées sur votre appareil</h2>
          <p style={styles.text}>
            Vos dossiers, l’historique de travail affiché dans l’interface, votre profil et votre contexte de travail sont principalement enregistrés dans le stockage local de votre navigateur afin que vous puissiez les retrouver lors d’une prochaine visite.
          </p>
        </div>

        <div style={styles.section}>
          <h2 style={styles.heading}>Mémoire synthétique des dossiers</h2>
          <p style={styles.text}>
            Pour assurer la continuité d’un dossier, Ernesto peut conserver côté serveur une synthèse limitée : objectif du dossier, paramètres utiles, observations importantes, questions encore ouvertes et état d’avancement. Cette mémoire n’a pas vocation à reproduire l’intégralité de la conversation.
          </p>
        </div>

        <div style={styles.section}>
          <h2 style={styles.heading}>Génération des réponses</h2>
          <p style={styles.text}>
            Pour produire une réponse, la question, le contexte nécessaire et, le cas échéant, les images jointes sont transmis au fournisseur du modèle d’intelligence artificielle utilisé par Ernesto. Les conditions de traitement applicables dépendent de la configuration technique et contractuelle de ce service.
          </p>
        </div>

        <div style={styles.notice}>
          <strong>Conseil</strong>
          <p style={{ ...styles.text, marginTop: 6 }}>
            N’envoyez pas à Ernesto de mots de passe, données bancaires, documents d’identité ou informations personnelles sans rapport avec votre apprentissage et votre situation professionnelle.
          </p>
        </div>

        <p style={styles.disclaimer}>
          Cette page décrit le fonctionnement technique actuel d’Ernesto. Elle ne remplace pas les mentions légales et obligations applicables à l’EPPPN en matière de protection des données.
        </p>

        <Link href="/" style={styles.back}>← Retour à Ernesto</Link>
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", padding: "42px 20px", background: "#f6f4ed", color: "#172132", fontFamily: "Arial, Helvetica, sans-serif" },
  card: { maxWidth: 900, margin: "0 auto", background: "white", border: "1px solid rgba(67,83,49,.16)", borderRadius: 28, padding: "36px", boxShadow: "0 20px 50px rgba(23,33,50,.08)" },
  kicker: { fontSize: 12, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: "#6f7f43" },
  title: { margin: "10px 0 12px", fontSize: 40, letterSpacing: "-.03em" },
  intro: { margin: 0, fontSize: 18, lineHeight: 1.55, color: "#475569" },
  section: { marginTop: 24, paddingTop: 20, borderTop: "1px solid rgba(67,83,49,.12)" },
  heading: { margin: 0, fontSize: 19 },
  text: { margin: "8px 0 0", fontSize: 15, lineHeight: 1.55, color: "#475569" },
  notice: { marginTop: 24, padding: 18, borderRadius: 18, background: "#f5f7ef", border: "1px solid rgba(67,83,49,.14)" },
  disclaimer: { marginTop: 20, fontSize: 12, lineHeight: 1.5, color: "#7b8492" },
  back: { display: "inline-block", marginTop: 26, color: "#435331", fontWeight: 800, textDecoration: "none" },
};
