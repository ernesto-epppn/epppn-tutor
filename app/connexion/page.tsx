"use client";

import { createClient } from "@supabase/supabase-js";
import { useMemo, useState } from "react";

export default function LoginPage() {
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return url && anon ? createClient(url, anon) : null;
  }, []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

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

  async function resetPassword() {
    setMessage("");
    if (!supabase || !email.trim()) {
      setMessage("Indiquez d’abord votre adresse email.");
      return;
    }

    const siteUrl = window.location.origin;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${siteUrl}/auth/set-password`,
    });

    setMessage(
      error
        ? "La demande n’a pas pu être envoyée."
        : "Si cette adresse correspond à un compte autorisé, un message vient d’être envoyé."
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

        <h1 style={styles.title}>Connexion</h1>
        <p style={styles.text}>
          Accès réservé aux stagiaires et anciens stagiaires autorisés par l’EPPPN.
        </p>

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

        <div style={styles.secondaryActions}>
          <button type="button" onClick={resetPassword} style={styles.linkButton}>
            Première connexion ? Créer mon mot de passe
          </button>
          <button type="button" onClick={resetPassword} style={styles.linkButton}>
            Mot de passe oublié ?
          </button>
        </div>

        {message ? <p style={styles.message}>{message}</p> : null}
        <p style={styles.note}>
          L’accès à Ernesto est réservé aux personnes autorisées par l’EPPPN.
        </p>
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
  form: { display: "grid", gap: 18, marginTop: 25 },
  label: { display: "grid", gap: 8, color: "#27382c", fontWeight: 750 },
  input: {
    minHeight: 49,
    padding: "0 14px",
    border: "1px solid #cdd5cd",
    borderRadius: 12,
    background: "white",
    fontSize: 16,
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
  secondaryActions: {
    display: "grid",
    justifyItems: "start",
    gap: 10,
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
  message: { marginTop: 18, color: "#7b3e46", lineHeight: 1.45 },
  note: { margin: "22px 0 0", color: "#7a817b", fontSize: 13, lineHeight: 1.45 },
};
