"use client";

import { createClient } from "@supabase/supabase-js";
import { useMemo, useState } from "react";

class StepTimeoutError extends Error {
  constructor(public step: string) {
    super(`timeout:${step}`);
    this.name = "StepTimeoutError";
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, step: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new StepTimeoutError(step)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export default function SetPasswordPage() {
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return null;
    return createClient(url, anon, {
      auth: {
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }, []);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("Activation…");
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

    let passwordSaved = false;

    try {
      setLoadingLabel("Vérification…");
      const { data: sessionData, error: sessionError } = await withTimeout(
        supabase.auth.getSession(),
        8000,
        "session"
      );

      const invitationSession = sessionData.session;
      if (sessionError || !invitationSession?.access_token) {
        setMessage("Le lien d’invitation est invalide ou expiré. Demandez une nouvelle invitation à l’EPPPN.");
        return;
      }

      setLoadingLabel("Enregistrement…");
      const { error: passwordError } = await withTimeout(
        supabase.auth.updateUser({ password }),
        12000,
        "password"
      );

      if (passwordError) {
        const weakPassword = /password|weak|characters|caract/i.test(passwordError.message || "");
        setMessage(
          weakPassword
            ? "Ce mot de passe n’est pas accepté. Choisissez-en un autre d’au moins 10 caractères."
            : "Le lien d’invitation est invalide ou expiré. Demandez une nouvelle invitation à l’EPPPN."
        );
        return;
      }

      passwordSaved = true;
      setLoadingLabel("Activation…");

      const controller = new AbortController();
      const activationTimer = window.setTimeout(() => controller.abort(), 12000);
      let activationResponse: Response;
      try {
        activationResponse = await fetch("/api/auth/activate-account", {
          method: "POST",
          headers: { Authorization: `Bearer ${invitationSession.access_token}` },
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(activationTimer);
      }

      const activation = await activationResponse.json().catch(() => ({}));

      if (!activationResponse.ok) {
        if (activation?.error === "account_already_bound") {
          setMessage("Ce compte EPPPN est déjà associé à un autre utilisateur. Contactez l’EPPPN.");
        } else if (activation?.error === "access_expired") {
          setMessage("Votre période d’accès pédagogique est arrivée à son terme.");
        } else if (activation?.error === "invalid_session") {
          setMessage("Le mot de passe est enregistré. Connectez-vous depuis la page de connexion Ernesto pour terminer l’activation.");
        } else {
          setMessage("Le mot de passe est enregistré. Connectez-vous depuis la page de connexion Ernesto pour terminer l’activation.");
        }
        return;
      }

      setDone(true);
      setMessage("Votre accès Ernesto est activé.");
    } catch (error) {
      if (error instanceof StepTimeoutError) {
        if (passwordSaved) {
          setMessage("Le mot de passe est enregistré. L’activation a pris trop de temps : connectez-vous maintenant à Ernesto avec ce mot de passe.");
        } else {
          setMessage("La connexion prend trop de temps. Rechargez la page et réessayez une fois.");
        }
      } else if (error instanceof DOMException && error.name === "AbortError") {
        setMessage("Le mot de passe est enregistré. L’activation a pris trop de temps : connectez-vous maintenant à Ernesto avec ce mot de passe.");
      } else {
        setMessage(
          passwordSaved
            ? "Le mot de passe est enregistré. Connectez-vous maintenant à Ernesto pour terminer l’activation."
            : "L’activation n’a pas abouti. Rechargez la page et réessayez."
        );
      }
    } finally {
      setLoading(false);
      setLoadingLabel("Activation…");
    }
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
                disabled={loading}
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
                disabled={loading}
              />
            </label>

            <button type="submit" disabled={loading} style={styles.button}>
              {loading ? loadingLabel : "Activer mon compte"}
            </button>
          </form>
        ) : (
          <a href="/" style={styles.buttonLink}>Ouvrir Ernesto</a>
        )}

        {message ? <p style={styles.message}>{message}</p> : null}
        {!done && message.includes("mot de passe est enregistré") ? (
          <a href="/connexion" style={styles.secondaryLink}>Se connecter à Ernesto</a>
        ) : null}
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
  secondaryLink: {
    display: "inline-block",
    marginTop: 12,
    color: "#315d45",
    fontSize: 14,
    fontWeight: 800,
    textDecoration: "none",
  },
  message: { marginTop: 18, color: "#7b3e46", lineHeight: 1.45 },
  note: { margin: "22px 0 0", color: "#7a817b", fontSize: 13, lineHeight: 1.45 },
};
