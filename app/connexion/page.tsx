"use client";

import { createClient } from "@supabase/supabase-js";
import { useMemo, useState } from "react";

type AccessMode = "login" | "first" | null;

export default function LoginPage() {
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return url && anon ? createClient(url, anon) : null;
  }, []);

  const [mode, setMode] = useState<AccessMode>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  function chooseMode(nextMode: Exclude<AccessMode, null>) {
    setMode(nextMode);
    setMessage("");
    if (nextMode === "first") setPassword("");
  }

  function goBack() {
    setMode(null);
    setMessage("");
    setPassword("");
  }

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");

    if (!supabase) {
      setMessage("La configuration de connexion est incomplète.");
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (error || !data.session) {
      setLoading(false);
      setMessage("Connexion impossible. Vérifiez votre adresse et votre mot de passe.");
      return;
    }

    const activationResponse = await fetch("/api/auth/activate-account", {
      method: "POST",
      headers: { Authorization: `Bearer ${data.session.access_token}` },
    });

    const activation = await activationResponse.json().catch(() => ({}));
    setLoading(false);

    if (!activationResponse.ok) {
      await supabase.auth.signOut();
      if (activation?.error === "access_expired") {
        setMessage("Votre accès pédagogique EPPPN est arrivé à son terme.");
      } else if (activation?.error === "account_already_bound") {
        setMessage("Ce compte est déjà associé à un autre utilisateur. Contactez l’EPPPN.");
      } else {
        setMessage("Votre compte n’est pas autorisé à utiliser Ernesto.");
      }
      return;
    }

    window.location.assign("/");
  }

  async function sendPasswordLink(kind: "first" | "forgot") {
    setMessage("");
    if (!supabase || !email.trim()) {
      setMessage("Indiquez votre adresse email.");
      return;
    }

    setLoading(true);
    const siteUrl = window.location.origin;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${siteUrl}/auth/set-password`,
    });
    setLoading(false);

    if (error) {
      setMessage("La demande n’a pas pu être envoyée. Réessayez dans quelques instants.");
      return;
    }

    setMessage(
      kind === "first"
        ? "Si cette adresse correspond à un accès EPPPN autorisé, vous allez recevoir un lien pour créer votre mot de passe."
        : "Si cette adresse correspond à un compte autorisé, vous allez recevoir un lien pour choisir un nouveau mot de passe."
    );
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.brandRow}>
          <div style={styles.logo}>E</div>
          <div>
            <p style={styles.eyebrow}>EPPPN</p>
            <strong style={styles.brand}>Ernesto</strong>
          </div>
        </div>

        <h1 style={styles.title}>
          {mode === "login" ? "Se connecter" : mode === "first" ? "Première connexion" : "Bienvenue"}
        </h1>

        {mode === null ? (
          <>
            <p style={styles.text}>Choisissez simplement votre situation pour accéder à Ernesto.</p>

            <div style={styles.choiceGrid}>
              <button type="button" onClick={() => chooseMode("login")} style={styles.primaryChoice}>
                <span style={styles.choiceTitle}>Se connecter</span>
                <span style={styles.choiceText}>J’ai déjà créé mon mot de passe</span>
              </button>

              <button type="button" onClick={() => chooseMode("first")} style={styles.secondaryChoice}>
                <span style={styles.choiceTitleSecondary}>Première connexion</span>
                <span style={styles.choiceText}>Je suis autorisé par l’EPPPN et je crée mon accès</span>
              </button>
            </div>
          </>
        ) : null}

        {mode === "login" ? (
          <>
            <p style={styles.text}>Entrez l’adresse email et le mot de passe associés à votre accès Ernesto.</p>

            <form onSubmit={login} style={styles.form}>
              <label style={styles.label}>
                Adresse email
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  style={styles.input}
                  required
                  autoFocus
                />
              </label>

              <label style={styles.label}>
                Mot de passe
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  style={styles.input}
                  required
                />
              </label>

              <button type="submit" disabled={loading} style={styles.button}>
                {loading ? "Connexion…" : "Se connecter"}
              </button>
            </form>

            <div style={styles.inlineActions}>
              <button type="button" onClick={() => sendPasswordLink("forgot")} style={styles.linkButton}>
                Mot de passe oublié ?
              </button>
              <span style={styles.actionSeparator}>·</span>
              <button type="button" onClick={() => chooseMode("first")} style={styles.linkButton}>
                Première connexion
              </button>
            </div>
          </>
        ) : null}

        {mode === "first" ? (
          <>
            <p style={styles.text}>
              Saisissez l’adresse email communiquée à l’EPPPN. Vous recevrez un lien pour créer votre mot de passe.
            </p>

            <div style={styles.form}>
              <label style={styles.label}>
                Adresse email
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  style={styles.input}
                  required
                  autoFocus
                />
              </label>

              <button
                type="button"
                onClick={() => sendPasswordLink("first")}
                disabled={loading}
                style={styles.button}
              >
                {loading ? "Envoi…" : "Créer mon accès"}
              </button>
            </div>

            <p style={styles.firstHelp}>Le lien est envoyé uniquement si votre adresse est autorisée par l’EPPPN.</p>
          </>
        ) : null}

        {message ? <p style={styles.message}>{message}</p> : null}

        {mode !== null ? (
          <button type="button" onClick={goBack} style={styles.backButton}>
            ← Retour
          </button>
        ) : null}

        <p style={styles.note}>Accès réservé aux stagiaires et anciens stagiaires autorisés par l’EPPPN.</p>
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100svh",
    display: "grid",
    placeItems: "center",
    padding: 24,
    background: "linear-gradient(145deg, #10261a, #315d45)",
    fontFamily: "system-ui, sans-serif",
  },
  card: {
    width: "min(470px, 100%)",
    padding: 34,
    borderRadius: 28,
    background: "#fffdf8",
    boxShadow: "0 28px 90px rgba(0, 0, 0, 0.32)",
  },
  brandRow: { display: "flex", alignItems: "center", gap: 13 },
  logo: {
    width: 54,
    height: 54,
    display: "grid",
    placeItems: "center",
    borderRadius: 18,
    background: "#315d45",
    color: "white",
    fontSize: 28,
    fontWeight: 950,
  },
  eyebrow: {
    margin: 0,
    color: "#806631",
    fontSize: 11,
    fontWeight: 850,
    letterSpacing: ".15em",
  },
  brand: { display: "block", marginTop: 2, color: "#1d2a21", fontSize: 22 },
  title: { margin: "28px 0 8px", color: "#1d2a21", fontSize: 38, lineHeight: 1 },
  text: { color: "#667067", lineHeight: 1.55 },
  choiceGrid: { display: "grid", gap: 12, marginTop: 26 },
  primaryChoice: {
    display: "grid",
    gap: 5,
    width: "100%",
    padding: "18px 20px",
    border: 0,
    borderRadius: 15,
    background: "#315d45",
    color: "white",
    textAlign: "left",
    cursor: "pointer",
  },
  secondaryChoice: {
    display: "grid",
    gap: 5,
    width: "100%",
    padding: "18px 20px",
    border: "1px solid #b9c7bd",
    borderRadius: 15,
    background: "#f8faf6",
    color: "#244032",
    textAlign: "left",
    cursor: "pointer",
  },
  choiceTitle: { fontSize: 18, fontWeight: 850 },
  choiceTitleSecondary: { fontSize: 18, fontWeight: 850, color: "#315d45" },
  choiceText: { fontSize: 13, lineHeight: 1.4, opacity: 0.82 },
  form: { display: "grid", gap: 18, marginTop: 25 },
  label: { display: "grid", gap: 8, color: "#27382c", fontWeight: 750 },
  input: {
    minHeight: 49,
    padding: "0 14px",
    border: "1px solid #cdd5cd",
    borderRadius: 12,
    background: "white",
    fontSize: 16,
    outlineColor: "#315d45",
  },
  button: {
    minHeight: 50,
    border: 0,
    borderRadius: 13,
    background: "#315d45",
    color: "white",
    fontSize: 16,
    fontWeight: 850,
    cursor: "pointer",
  },
  inlineActions: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
  },
  linkButton: {
    padding: 0,
    border: 0,
    background: "transparent",
    color: "#315d45",
    fontWeight: 750,
    cursor: "pointer",
  },
  actionSeparator: { color: "#9ba59d" },
  firstHelp: { margin: "12px 0 0", color: "#7a817b", fontSize: 13, lineHeight: 1.45 },
  message: {
    margin: "18px 0 0",
    padding: "12px 14px",
    borderRadius: 12,
    background: "#f6f0e7",
    color: "#6c5142",
    fontSize: 14,
    lineHeight: 1.45,
  },
  backButton: {
    marginTop: 18,
    padding: 0,
    border: 0,
    background: "transparent",
    color: "#667067",
    fontWeight: 750,
    cursor: "pointer",
  },
  note: {
    margin: "24px 0 0",
    paddingTop: 18,
    borderTop: "1px solid #e5e7e2",
    color: "#7a817b",
    fontSize: 13,
    lineHeight: 1.45,
  },
};
