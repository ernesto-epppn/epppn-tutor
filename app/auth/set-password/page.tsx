"use client";

import { createClient } from "@supabase/supabase-js";
import { useMemo, useState } from "react";

export default function SetPasswordPage() {
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return null;
    return createClient(url, anon);
  }, []);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");

    if (!supabase) {
      setMessage("La configuration de connexion est incomplète.");
      return;
    }

    if (password.length < 10) {
      setMessage("Choisissez un mot de passe d’au moins 10 caractères.");
      return;
    }

    if (password !== confirmPassword) {
      setMessage("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setLoading(true);

    // The invitation session is only used to identify the invited account and
    // authorize the one-time password creation. After the password changes we
    // explicitly sign in again to obtain a fresh session before activating the
    // Ernesto entitlement. This avoids reusing a stale invitation JWT.
    const { data: invitedUserData, error: invitedUserError } = await supabase.auth.getUser();
    const invitedEmail = invitedUserData.user?.email?.trim().toLowerCase();

    if (invitedUserError || !invitedEmail) {
      setLoading(false);
      setMessage("Le lien d’invitation est invalide ou expiré. Demandez une nouvelle invitation à l’EPPPN.");
      return;
    }

    const { error: passwordError } = await supabase.auth.updateUser({ password });
    if (passwordError) {
      setLoading(false);
      setMessage("Le lien d’invitation est invalide ou expiré. Demandez une nouvelle invitation à l’EPPPN.");
      return;
    }

    const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
      email: invitedEmail,
      password,
    });

    const token = loginData.session?.access_token;

    if (loginError || !token) {
      setLoading(false);
      setMessage("Le mot de passe est enregistré. Connectez-vous maintenant depuis la page de connexion Ernesto.");
      return;
    }

    const activationResponse = await fetch("/api/auth/activate-account", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    const activation = await activationResponse.json().catch(() => ({}));
    setLoading(false);

    if (!activationResponse.ok) {
      if (activation?.error === "account_already_bound") {
        setMessage("Ce compte EPPPN est déjà associé à un autre utilisateur. Contactez l’EPPPN.");
      } else if (activation?.error === "access_expired") {
        setMessage("Votre période d’accès pédagogique est arrivée à son terme.");
      } else if (activation?.error === "invalid_session") {
        setMessage("Votre mot de passe est enregistré. Reconnectez-vous depuis la page de connexion Ernesto pour terminer l’activation.");
      } else {
        setMessage("Le compte a été créé, mais son accès Ernesto n’a pas pu être activé. Contactez l’EPPPN.");
      }
      return;
    }

    setDone(true);
    setMessage("Votre mot de passe et votre accès Ernesto ont été activés.");
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.logo}>E</div>
        <p style={styles.eyebrow}>Accès stagiaire EPPPN</p>
        <h1 style={styles.title}>{done ? "Compte activé" : "Créer votre mot de passe"}</h1>
        <p style={styles.text}>
          {done
            ? "Votre compte personnel Ernesto est prêt."
            : "Cette étape n’est nécessaire qu’une seule fois après votre invitation."}
        </p>

        {!done ? (
          <form onSubmit={submit} style={styles.form}>
            <label style={styles.label}>
              Mot de passe
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                style={styles.input}
                required
              />
            </label>

            <label style={styles.label}>
              Confirmer le mot de passe
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                style={styles.input}
                required
              />
            </label>

            <button type="submit" disabled={loading} style={styles.button}>
              {loading ? "Activation…" : "Activer mon compte"}
            </button>
          </form>
        ) : (
          <a href="/" style={styles.buttonLink}>Ouvrir Ernesto</a>
        )}

        {message ? <p style={styles.message}>{message}</p> : null}
        <p style={styles.note}>Votre compte est nominatif et ne doit pas être partagé.</p>
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
    background: "linear-gradient(145deg, #efe8da, #d8dfd1)",
    fontFamily: "Arial, sans-serif",
  },
  card: {
    width: "min(480px, 100%)",
    padding: 34,
    borderRadius: 28,
    background: "#fffdf8",
    boxShadow: "0 24px 80px rgba(37, 52, 40, 0.18)",
  },
  logo: {
    width: 54,
    height: 54,
    display: "grid",
    placeItems: "center",
    borderRadius: 18,
    background: "#315d45",
    color: "white",
    fontSize: 28,
    fontWeight: 900,
  },
  eyebrow: {
    margin: "22px 0 8px",
    color: "#806631",
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: ".12em",
    textTransform: "uppercase",
  },
  title: { margin: 0, color: "#1d2a21", fontSize: 34, lineHeight: 1.05 },
  text: { color: "#667067", lineHeight: 1.55 },
  form: { display: "grid", gap: 18, marginTop: 24 },
  label: { display: "grid", gap: 8, color: "#27382c", fontWeight: 700 },
  input: {
    minHeight: 48,
    padding: "0 14px",
    border: "1px solid #cdd5cd",
    borderRadius: 12,
    fontSize: 16,
  },
  button: {
    minHeight: 50,
    border: 0,
    borderRadius: 13,
    background: "#315d45",
    color: "white",
    fontSize: 16,
    fontWeight: 800,
    cursor: "pointer",
  },
  buttonLink: {
    display: "grid",
    minHeight: 50,
    placeItems: "center",
    marginTop: 24,
    borderRadius: 13,
    background: "#315d45",
    color: "white",
    fontWeight: 800,
    textDecoration: "none",
  },
  message: { marginTop: 18, color: "#7b3e46", lineHeight: 1.45 },
  note: { margin: "22px 0 0", color: "#7a817b", fontSize: 13, lineHeight: 1.45 },
};
