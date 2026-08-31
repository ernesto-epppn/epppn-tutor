import Link from "next/link";

export default function AidePage() {
  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.kicker}>Ernesto · Aide</div>
        <h1 style={styles.title}>Bien utiliser Ernesto</h1>
        <p style={styles.intro}>
          Ernesto est plus utile lorsque vous partez d’une situation réelle et que vous lui donnez quelques repères concrets.
        </p>

        <div style={styles.grid}>
          <div style={styles.block}>
            <div style={styles.number}>1</div>
            <div>
              <h2 style={styles.heading}>Décrivez le problème</h2>
              <p style={styles.text}>Expliquez ce que vous observez et à quel moment : pâte collante, levain peu actif, cuisson irrégulière, problème au service…</p>
            </div>
          </div>
          <div style={styles.block}>
            <div style={styles.number}>2</div>
            <div>
              <h2 style={styles.heading}>Ajoutez des faits</h2>
              <p style={styles.text}>Temps, température, farine, hydratation, matériel ou changement récent permettent une analyse beaucoup plus ciblée.</p>
            </div>
          </div>
          <div style={styles.block}>
            <div style={styles.number}>3</div>
            <div>
              <h2 style={styles.heading}>Utilisez les dossiers</h2>
              <p style={styles.text}>Gardez un problème dans le même dossier, testez une modification puis revenez avec le résultat pour poursuivre le raisonnement.</p>
            </div>
          </div>
          <div style={styles.block}>
            <div style={styles.number}>4</div>
            <div>
              <h2 style={styles.heading}>Ajoutez une photo si utile</h2>
              <p style={styles.text}>Une photo de pizza, de mie ou de cornicione peut compléter le diagnostic. Ajoutez aussi les conditions de cuisson et le problème observé.</p>
            </div>
          </div>
        </div>

        <div style={styles.example}>
          <strong>Exemple de bonne question</strong>
          <p style={{ ...styles.text, marginTop: 8 }}>
            « Après 48 h à 4°C, mes pâtons deviennent collants au service. Hydratation 64 %, 2 h à température ambiante avant utilisation. Que vérifier d’abord ? »
          </p>
        </div>

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
  grid: { display: "grid", gap: 14, marginTop: 28 },
  block: { display: "grid", gridTemplateColumns: "42px 1fr", gap: 14, padding: 18, borderRadius: 18, background: "#fafbf7", border: "1px solid rgba(67,83,49,.12)" },
  number: { width: 34, height: 34, borderRadius: 999, display: "grid", placeItems: "center", background: "#eaf0df", color: "#435331", fontWeight: 900 },
  heading: { margin: 0, fontSize: 18 },
  text: { margin: "5px 0 0", fontSize: 15, lineHeight: 1.5, color: "#475569" },
  example: { marginTop: 22, padding: 18, borderRadius: 18, borderLeft: "4px solid #b38a44", background: "#fbfaf6" },
  back: { display: "inline-block", marginTop: 26, color: "#435331", fontWeight: 800, textDecoration: "none" },
};
