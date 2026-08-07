"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";

type Stats = {
  users_total: number;
  users_last_7d: number;
  total_queries: number;
  top_users: Array<{
    user_id: string;
    free_queries_used: number;
    updated_at?: string | null;
  }>;
};

type TraineeStatus = "active" | "invited" | "blocked" | "expired";

type Trainee = {
  email: string;
  full_name?: string | null;
  active: boolean;
  access_months?: number | null;
  invited_at?: string | null;
  activated_at?: string | null;
  access_ends_at?: string | null;
  activated_user_id?: string | null;
  blocked_at?: string | null;
  blocked_reason?: string | null;
  last_login_at?: string | null;
  status: TraineeStatus;
};

type InviteResult = {
  ok?: boolean;
  email?: string;
  access_ends_at?: string;
  error?: string;
  message?: string;
};

const STATUS_LABELS: Record<TraineeStatus, string> = {
  active: "Actif",
  invited: "Invitation envoyée",
  blocked: "Bloqué",
  expired: "Expiré",
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("fr-FR");
}

export default function AdminPage() {
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return url && anon ? createClient(url, anon) : null;
  }, []);

  const [stats, setStats] = useState<Stats | null>(null);
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState("");

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [months, setMonths] = useState("4");
  const [endDate, setEndDate] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [updatingEmail, setUpdatingEmail] = useState("");

  async function getAccessToken() {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function loadDashboard() {
    setDashboardLoading(true);
    setDashboardError("");

    const token = await getAccessToken();
    if (!token) {
      setDashboardLoading(false);
      setDashboardError("Session administrateur introuvable.");
      return;
    }

    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [traineesResponse, statsResponse] = await Promise.all([
        fetch("/api/admin/trainees", { headers, cache: "no-store" }),
        fetch("/api/admin/stats", { headers, cache: "no-store" }),
      ]);

      const traineeData = await traineesResponse.json().catch(() => ({}));
      const statsData = await statsResponse.json().catch(() => ({}));

      if (!traineesResponse.ok) throw new Error(traineeData?.error || "Impossible de charger les stagiaires.");
      if (!statsResponse.ok) throw new Error(statsData?.error || "Impossible de charger les statistiques.");

      setTrainees(traineeData.trainees || []);
      setStats(statsData as Stats);
    } catch (error: any) {
      setDashboardError(error?.message || "Erreur de chargement.");
    } finally {
      setDashboardLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  async function inviteTrainee(event: React.FormEvent) {
    event.preventDefault();
    setInviteMessage("");
    setInviteError("");

    const token = await getAccessToken();
    if (!token) {
      setInviteError("Connectez-vous d’abord avec un compte administrateur Ernesto.");
      return;
    }

    setInviteLoading(true);
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

    setInviteMessage(
      `Invitation envoyée à ${result.email}${result.access_ends_at ? ` · accès jusqu’au ${formatDate(result.access_ends_at)}` : ""}.`
    );
    setEmail("");
    setFullName("");
    setMonths("4");
    setEndDate("");
    await loadDashboard();
  }

  async function updateTrainee(targetEmail: string, action: "block" | "reactivate") {
    const token = await getAccessToken();
    if (!token) return;

    const confirmText = action === "block"
      ? `Bloquer l’accès Ernesto de ${targetEmail} ?`
      : `Réactiver l’accès Ernesto de ${targetEmail} ?`;
    if (!window.confirm(confirmText)) return;

    setUpdatingEmail(targetEmail);
    const response = await fetch("/api/admin/trainees", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email: targetEmail, action }),
    });
    setUpdatingEmail("");

    if (!response.ok) {
      setDashboardError("La modification du compte a échoué.");
      return;
    }

    await loadDashboard();
  }

  const counts = trainees.reduce(
    (acc, trainee) => {
      acc.total += 1;
      acc[trainee.status] += 1;
      return acc;
    },
    { total: 0, active: 0, invited: 0, blocked: 0, expired: 0 }
  );

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Administration EPPPN</p>
          <h1 style={styles.h1}>Ernesto v14.2.3</h1>
          <p style={styles.subtitle}>Pilotage des accès stagiaires et suivi de l’utilisation.</p>
        </div>
        <button onClick={loadDashboard} disabled={dashboardLoading} style={styles.secondaryButton}>
          {dashboardLoading ? "Actualisation…" : "Actualiser"}
        </button>
      </header>

      <section style={styles.metricsGrid}>
        <Metric title="Comptes autorisés" value={counts.total} />
        <Metric title="Actifs" value={counts.active} />
        <Metric title="Invitations en attente" value={counts.invited} />
        <Metric title="Bloqués / expirés" value={counts.blocked + counts.expired} />
        <Metric title="Questions totales" value={stats?.total_queries ?? 0} />
      </section>

      {dashboardError ? <p style={styles.error}>Erreur : {dashboardError}</p> : null}

      <section style={styles.card}>
        <h2 style={styles.h2}>Inviter un stagiaire</h2>
        <p style={styles.help}>
          L’adresse est autorisée côté EPPPN, puis l’utilisateur reçoit un lien unique pour créer son mot de passe personnel.
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
        <div style={styles.sectionHeader}>
          <div>
            <h2 style={styles.h2}>Stagiaires autorisés</h2>
            <p style={styles.help}>La liste ci-dessous reflète directement les autorisations enregistrées dans Supabase.</p>
          </div>
          <span style={styles.countPill}>{trainees.length} compte{trainees.length > 1 ? "s" : ""}</span>
        </div>

        <div style={styles.tableBox}>
          <table style={styles.table}>
            <thead>
              <tr style={styles.tableHeadRow}>
                <th style={styles.th}>Stagiaire</th>
                <th style={styles.th}>Email</th>
                <th style={styles.th}>Statut</th>
                <th style={styles.th}>Fin d’accès</th>
                <th style={styles.th}>Dernière connexion</th>
                <th style={styles.th}>Action</th>
              </tr>
            </thead>
            <tbody>
              {trainees.map((trainee) => (
                <tr key={trainee.email} style={styles.tr}>
                  <td style={styles.td}><strong>{trainee.full_name || "—"}</strong></td>
                  <td style={styles.td}>{trainee.email}</td>
                  <td style={styles.td}><StatusBadge status={trainee.status} /></td>
                  <td style={styles.td}>{formatDate(trainee.access_ends_at)}</td>
                  <td style={styles.td}>{formatDate(trainee.last_login_at)}</td>
                  <td style={styles.td}>
                    {trainee.status === "blocked" ? (
                      <button
                        onClick={() => updateTrainee(trainee.email, "reactivate")}
                        disabled={updatingEmail === trainee.email}
                        style={styles.smallButton}
                      >
                        Réactiver
                      </button>
                    ) : trainee.status !== "expired" ? (
                      <button
                        onClick={() => updateTrainee(trainee.email, "block")}
                        disabled={updatingEmail === trainee.email}
                        style={styles.dangerButton}
                      >
                        Bloquer
                      </button>
                    ) : (
                      <span style={styles.muted}>Réinviter pour prolonger</span>
                    )}
                  </td>
                </tr>
              ))}
              {!dashboardLoading && trainees.length === 0 ? (
                <tr><td colSpan={6} style={{ ...styles.td, textAlign: "center", padding: 28 }}>Aucun compte autorisé.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section style={styles.card}>
        <h2 style={styles.h2}>Utilisation</h2>
        <p style={styles.help}>Statistiques accessibles uniquement avec votre session administrateur Ernesto.</p>
        <div style={styles.metricsGrid}>
          <Metric title="Utilisateurs avec activité" value={stats?.users_total ?? 0} />
          <Metric title="Actifs sur 7 jours" value={stats?.users_last_7d ?? 0} />
          <Metric title="Questions totales" value={stats?.total_queries ?? 0} />
        </div>
      </section>
    </main>
  );
}

function Metric({ title, value }: { title: string; value: number }) {
  return (
    <div style={styles.metric}>
      <div style={styles.metricLabel}>{title}</div>
      <div style={styles.metricValue}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: TraineeStatus }) {
  const style = status === "active"
    ? styles.statusActive
    : status === "invited"
      ? styles.statusInvited
      : status === "expired"
        ? styles.statusExpired
        : styles.statusBlocked;
  return <span style={{ ...styles.status, ...style }}>{STATUS_LABELS[status]}</span>;
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1180, margin: "24px auto", padding: 18, fontFamily: "system-ui, sans-serif", color: "#24301f" },
  header: { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-end", marginBottom: 18, flexWrap: "wrap" },
  eyebrow: { margin: "0 0 6px", color: "#526533", fontSize: 12, fontWeight: 850, letterSpacing: ".12em", textTransform: "uppercase" },
  h1: { margin: 0, fontSize: 38 },
  h2: { margin: 0, fontSize: 23 },
  subtitle: { margin: "7px 0 0", opacity: 0.7 },
  help: { margin: "8px 0 20px", maxWidth: 780, opacity: 0.72, lineHeight: 1.5 },
  card: { marginBottom: 18, padding: 24, border: "1px solid #dfe5d8", borderRadius: 20, background: "#fff", boxShadow: "0 12px 38px rgba(50,65,37,.06)" },
  form: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 16 },
  label: { display: "grid", gap: 7, fontWeight: 700 },
  input: { minHeight: 44, padding: "0 12px", border: "1px solid #cbd4c4", borderRadius: 11, background: "white", fontSize: 15 },
  primaryButton: { minHeight: 46, alignSelf: "end", border: 0, borderRadius: 12, background: "#526533", color: "white", fontWeight: 800, cursor: "pointer", padding: "0 16px" },
  secondaryButton: { minHeight: 42, padding: "0 14px", border: "1px solid #cbd4c4", borderRadius: 11, background: "white", color: "#3f5128", fontWeight: 750, cursor: "pointer" },
  smallButton: { minHeight: 34, padding: "0 11px", border: "1px solid #b8c5ad", borderRadius: 9, background: "#f7faf4", color: "#41562c", fontWeight: 750, cursor: "pointer" },
  dangerButton: { minHeight: 34, padding: "0 11px", border: "1px solid #e3c4c4", borderRadius: 9, background: "#fff8f8", color: "#8e4141", fontWeight: 750, cursor: "pointer" },
  success: { marginTop: 16, color: "#526533", fontWeight: 700 },
  error: { margin: "14px 0", color: "#a13d40", fontWeight: 650 },
  metricsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 18 },
  metric: { border: "1px solid #e2e7dd", borderRadius: 15, padding: 15, background: "#fbfcf9" },
  metricLabel: { fontSize: 12, opacity: 0.68, fontWeight: 700 },
  metricValue: { fontSize: 28, fontWeight: 900, marginTop: 5, color: "#42542a" },
  sectionHeader: { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" },
  countPill: { padding: "6px 10px", borderRadius: 999, background: "#eff3e9", color: "#4d6031", fontWeight: 800, fontSize: 12 },
  tableBox: { border: "1px solid #e5e9e0", borderRadius: 14, overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 900 },
  tableHeadRow: { background: "#f6f8f3", textAlign: "left" },
  th: { padding: "11px 12px", fontSize: 12, opacity: 0.72 },
  tr: { borderTop: "1px solid #edf0ea" },
  td: { padding: "12px", fontSize: 13, verticalAlign: "middle" },
  muted: { fontSize: 12, opacity: 0.58 },
  status: { display: "inline-flex", padding: "4px 9px", borderRadius: 999, fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" },
  statusActive: { background: "#e9f2e2", color: "#3f5f2b" },
  statusInvited: { background: "#f5f0df", color: "#765f27" },
  statusBlocked: { background: "#f8e8e8", color: "#8d3f42" },
  statusExpired: { background: "#ececec", color: "#626262" },
};
