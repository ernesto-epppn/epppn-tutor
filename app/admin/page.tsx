"use client";

import { createClient } from "@supabase/supabase-js";
import { useMemo, useState } from "react";

type Stats = {
  users_total: number;
  users_last_7d: number;
  total_queries: number;
  top_users: Array<{
    user_id: string;
    free_queries_used: number;
    trial_started_at?: string | null;
    updated_at?: string | null;
  }>;
};

type InviteResult = {
  ok?: boolean;
  email?: string;
  access_ends_at?: string;
  error?: string;
  message?: string;
};

export default function AdminPage() {
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return url && anon ? createClient(url, anon) : null;
  }, []);

  const [key, setKey] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [months, setMonths] = useState("4");
  const [endDate, setEndDate] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteError, setInviteError] = useState("");

  async function loadStats() {
    setStatsLoading(true);
    setStatsError(null);
    setStats(null);
    try {
      const res = await fetch("/api/admin/stats", {
        headers: { "x-admin-key": key },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Erreur");
      setStats(data);
    } catch (error: any) {
      setStatsError(error?.message ?? "Erreur");
    } finally {
      setStatsLoading(false);
    }
  }

  async function inviteTrainee(event: React.FormEvent) {
    event.preventDefault();
    setInviteMessage("");
    setInviteError("");

    if (!supabase) {
      setInviteError("Configuration Supabase incomplète.");
      return;
    }

    setInviteLoading(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (!token) {
      setInviteLoading(false);
      setInviteError("Connectez-vous d’abord avec un compte administrateur Ernesto.");
      return;
    }

    const response = await fetch("/api/admin/invite-user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        email,
        full_name: fullName,
        access_months: Number(months),
        access_ends_at: endDate || undefined,
      }),
    });

    const result = (await response.json().catch(() => ({}))) as InviteResult;
    setInviteLoading(false);

    if (!response.ok) {
      setInviteError(result.message || result.error || "Invitation impossible.");
      return;
    }

    const formattedEnd = result.access_ends_at
      ? new Date(result.access_ends_at).toLocaleDateString("fr-FR")
      : "";

    setInviteMessage(`Invitation envoyée à ${result.email}${formattedEnd ? ` · accès jusqu’au ${formattedEnd}` : ""}.`);
    setEmail("");
    setFullName("");
    setMonths("4");
    setEndDate("");
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Administration</p>
          <h1 style={styles.h1}>Ernesto v14.2</h1>
          <p style={styles.subtitle}>Pilotage des accès stagiaires EPPPN.</p>
        </div>
      </header>

      <section style={styles.card}>
        <h2 style={styles.h2}>Inviter un stagiaire</h2>
        <p style={styles.help}>
          L’adresse doit être connue et validée par l’EPPPN. L’élève reçoit un lien unique pour créer son mot de passe.
        </p>

        <form onSubmit={inviteTrainee} style={styles.form}>
          <label style={styles.label}>
            Adresse email *
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              style={styles.input}
              placeholder="stagiaire@exemple.fr"
            />
          </label>

          <label style={styles.label}>
            Nom et prénom
            <input
              type="text"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              style={styles.input}
              placeholder="Marie Dupont"
            />
          </label>

          <label style={styles.label}>
            Durée en mois
            <select value={months} onChange={(event) => setMonths(event.target.value)} style={styles.input}>
              <option value="3">3 mois</option>
              <option value="4">4 mois</option>
              <option value="5">5 mois</option>
              <option value="6">6 mois maximum</option>
            </select>
          </label>

          <label style={styles.label}>
            Date de fin fixe — facultatif
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              style={styles.input}
            />
          </label>

          <button type="submit" disabled={inviteLoading} style={styles.primaryButton}>
            {inviteLoading ? "Envoi…" : "Autoriser et envoyer l’invitation"}
          </button>
        </form>

        {inviteMessage ? <p style={styles.success}>{inviteMessage}</p> : null}
        {inviteError ? <p style={styles.error}>{inviteError}</p> : null}
      </section>

      <section style={styles.card}>
        <h2 style={styles.h2}>Statistiques</h2>
        <p style={styles.help}>Le contrôle historique par ADMIN_KEY reste disponible.</p>

        <div style={styles.inlineForm}>
          <input
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="ADMIN_KEY"
            type="password"
            style={{ ...styles.input, minWidth: 280 }}
          />
          <button
            onClick={loadStats}
            disabled={!key || statsLoading}
            style={styles.secondaryButton}
          >
            {statsLoading ? "Chargement…" : "Charger"}
          </button>
        </div>

        {statsError ? <p style={styles.error}>Erreur : {statsError}</p> : null}

        {stats ? (
          <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
            <div style={styles.statsGrid}>
              <Card title="Utilisateurs" value={stats.users_total} />
              <Card title="Utilisateurs sur 7 jours" value={stats.users_last_7d} />
              <Card title="Questions totales" value={stats.total_queries} />
            </div>

            <div style={styles.tableBox}>
              <div style={styles.tableTitle}>Utilisateurs les plus actifs</div>
              <div style={{ padding: 12, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", opacity: 0.7 }}>
                      <th style={{ padding: "6px 0" }}>user_id</th>
                      <th style={{ padding: "6px 0" }}>requêtes</th>
                      <th style={{ padding: "6px 0" }}>mise à jour</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.top_users.map((user) => (
                      <tr key={user.user_id} style={{ borderTop: "1px solid #f0f0f0" }}>
                        <td style={{ padding: "8px 0", fontFamily: "monospace", fontSize: 12 }}>{user.user_id}</td>
                        <td style={{ padding: "8px 0" }}>{user.free_queries_used ?? 0}</td>
                        <td style={{ padding: "8px 0", fontSize: 12, opacity: 0.75 }}>{user.updated_at ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function Card({ title, value }: { title: string; value: number }) {
  return (
    <div style={styles.metric}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{title}</div>
      <div style={{ fontSize: 26, fontWeight: 900, marginTop: 6 }}>{value}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 1080,
    margin: "24px auto",
    padding: 18,
    fontFamily: "system-ui, sans-serif",
    color: "#1d2a21",
  },
  header: { display: "flex", justifyContent: "space-between", marginBottom: 20 },
  eyebrow: {
    margin: "0 0 6px",
    color: "#806631",
    fontSize: 12,
    fontWeight: 850,
    letterSpacing: ".12em",
    textTransform: "uppercase",
  },
  h1: { margin: 0, fontSize: 38 },
  h2: { margin: 0, fontSize: 24 },
  subtitle: { margin: "7px 0 0", opacity: 0.72 },
  help: { margin: "8px 0 20px", maxWidth: 760, opacity: 0.74, lineHeight: 1.5 },
  card: {
    marginBottom: 18,
    padding: 24,
    border: "1px solid #dfe5df",
    borderRadius: 20,
    background: "#fff",
    boxShadow: "0 12px 38px rgba(29, 42, 33, 0.06)",
  },
  form: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 16 },
  label: { display: "grid", gap: 7, fontWeight: 700 },
  input: {
    minHeight: 44,
    padding: "0 12px",
    border: "1px solid #cdd5cd",
    borderRadius: 11,
    background: "white",
    fontSize: 15,
  },
  primaryButton: {
    minHeight: 46,
    alignSelf: "end",
    border: 0,
    borderRadius: 12,
    background: "#315d45",
    color: "white",
    fontWeight: 800,
    cursor: "pointer",
    padding: "0 16px",
  },
  secondaryButton: {
    minHeight: 44,
    padding: "0 16px",
    border: "1px solid #cdd5cd",
    borderRadius: 11,
    background: "white",
    fontWeight: 750,
    cursor: "pointer",
  },
  inlineForm: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
  success: { marginTop: 16, color: "#315d45", fontWeight: 700 },
  error: { marginTop: 16, color: "#a63d40", fontWeight: 650 },
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 },
  metric: { border: "1px solid #e8ece8", borderRadius: 14, padding: 14 },
  tableBox: { border: "1px solid #e8ece8", borderRadius: 14, overflow: "hidden" },
  tableTitle: { padding: 12, fontWeight: 800, background: "#f7f8f6" },
};
