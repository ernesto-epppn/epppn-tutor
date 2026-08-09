"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";

type Stats = {
  users_total: number;
  users_last_7d: number;
  total_queries: number;
  useful_feedbacks: number;
  feedback_last_7d: number;
  dossier_memories: number;
  action_plans: number;
  completed_action_plans: number;
  knowledge_documents: number;
  knowledge_chunks: number;
  top_users: Array<{
    user_id: string;
    free_queries_used: number;
    updated_at?: string | null;
  }>;
};

type KnowledgeDocument = {
  id: number;
  title: string;
  source: string;
  url?: string | null;
  created_at?: string | null;
  chunks: number;
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

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function AdminPage() {
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return url && anon ? createClient(url, anon) : null;
  }, []);

  const [stats, setStats] = useState<Stats | null>(null);
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocument[]>([]);
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

  const [knowledgeTitle, setKnowledgeTitle] = useState("");
  const [knowledgeSource, setKnowledgeSource] = useState("");
  const [knowledgeUrl, setKnowledgeUrl] = useState("");
  const [knowledgeContent, setKnowledgeContent] = useState("");
  const [knowledgeFile, setKnowledgeFile] = useState<File | null>(null);
  const [knowledgeConfirmed, setKnowledgeConfirmed] = useState(false);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeMessage, setKnowledgeMessage] = useState("");
  const [knowledgeError, setKnowledgeError] = useState("");
  const [deletingDocumentId, setDeletingDocumentId] = useState<number | null>(null);

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
      const [traineesResponse, statsResponse, knowledgeResponse] = await Promise.all([
        fetch("/api/admin/trainees", { headers, cache: "no-store" }),
        fetch("/api/admin/stats", { headers, cache: "no-store" }),
        fetch("/api/admin/knowledge", { headers, cache: "no-store" }),
      ]);

      const traineeData = await traineesResponse.json().catch(() => ({}));
      const statsData = await statsResponse.json().catch(() => ({}));
      const knowledgeData = await knowledgeResponse.json().catch(() => ({}));

      if (!traineesResponse.ok) throw new Error(traineeData?.error || "Impossible de charger les stagiaires.");
      if (!statsResponse.ok) throw new Error(statsData?.error || "Impossible de charger les statistiques.");
      if (!knowledgeResponse.ok) throw new Error(knowledgeData?.error || "Impossible de charger la base EPPPN.");

      setTrainees(traineeData.trainees || []);
      setStats(statsData as Stats);
      setKnowledgeDocuments(knowledgeData.documents || []);
    } catch (error: unknown) {
      setDashboardError(errorMessage(error, "Erreur de chargement."));
    } finally {
      setDashboardLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
    // The dashboard is loaded once; later refreshes are explicit after admin actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  async function uploadKnowledge(event: React.FormEvent) {
    event.preventDefault();
    setKnowledgeMessage("");
    setKnowledgeError("");
    const token = await getAccessToken();
    if (!token) {
      setKnowledgeError("Session administrateur introuvable.");
      return;
    }
    if (!knowledgeFile && !knowledgeContent.trim()) {
      setKnowledgeError("Ajoutez un fichier PDF/TXT/MD ou collez le texte officiel.");
      return;
    }

    const form = new FormData();
    form.append("title", knowledgeTitle);
    form.append("source", knowledgeSource);
    form.append("url", knowledgeUrl);
    form.append("content", knowledgeContent);
    form.append("confirmedOfficial", String(knowledgeConfirmed));
    if (knowledgeFile) form.append("file", knowledgeFile);

    setKnowledgeLoading(true);
    try {
      const response = await fetch("/api/admin/knowledge", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const messages: Record<string, string> = {
          official_confirmation_required: "Confirmez que le contenu est un document officiel EPPPN.",
          title_source_and_content_required: "Le titre, la source et le contenu sont obligatoires.",
          document_already_exists: "Ce document existe déjà dans la base.",
          unsupported_file_type: "Format non pris en charge. Utilisez PDF, TXT ou Markdown.",
          file_too_large: "Le fichier dépasse 8 Mo.",
          document_content_too_short: "Le document ne contient pas assez de texte exploitable.",
        };
        throw new Error(messages[result?.error] || result?.error || "Import impossible.");
      }
      setKnowledgeMessage(
        `« ${result.document?.title || knowledgeTitle} » ajouté avec ${result.document?.chunks || 0} fragments indexés.`
      );
      setKnowledgeTitle("");
      setKnowledgeSource("");
      setKnowledgeUrl("");
      setKnowledgeContent("");
      setKnowledgeFile(null);
      setKnowledgeConfirmed(false);
      await loadDashboard();
    } catch (error: unknown) {
      setKnowledgeError(errorMessage(error, "Import impossible."));
    } finally {
      setKnowledgeLoading(false);
    }
  }

  async function deleteKnowledgeDocument(document: KnowledgeDocument) {
    if (!window.confirm(`Retirer « ${document.title} » de la base de connaissances Ernesto ?`)) return;
    const token = await getAccessToken();
    if (!token) return;
    setDeletingDocumentId(document.id);
    setKnowledgeError("");
    try {
      const response = await fetch(`/api/admin/knowledge?id=${document.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || "Suppression impossible.");
      setKnowledgeMessage(`« ${document.title} » a été retiré de la base.`);
      await loadDashboard();
    } catch (error: unknown) {
      setKnowledgeError(errorMessage(error, "Suppression impossible."));
    } finally {
      setDeletingDocumentId(null);
    }
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
          <h1 style={styles.h1}>Ernesto v14.5</h1>
          <p style={styles.subtitle}>Accès, qualité pédagogique et base de connaissances officielle EPPPN.</p>
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
        <Metric title="Documents EPPPN" value={stats?.knowledge_documents ?? 0} />
        <Metric title="Fragments indexés" value={stats?.knowledge_chunks ?? 0} />
      </section>

      {dashboardError ? <p style={styles.error}>Erreur : {dashboardError}</p> : null}

      <section style={styles.card}>
        <div style={styles.sectionHeader}>
          <div>
            <h2 style={styles.h2}>Base de connaissances EPPPN</h2>
            <p style={styles.help}>
              Ajoutez uniquement des protocoles, supports et cas validés officiellement par l’EPPPN. Ernesto indexe le texte pour l’utiliser dans ses réponses.
            </p>
          </div>
          <span style={styles.countPill}>{knowledgeDocuments.length} document{knowledgeDocuments.length > 1 ? "s" : ""}</span>
        </div>

        <form onSubmit={uploadKnowledge} style={styles.knowledgeForm}>
          <label style={styles.label}>
            Titre du document *
            <input
              value={knowledgeTitle}
              onChange={(event) => setKnowledgeTitle(event.target.value)}
              required
              style={styles.input}
              placeholder="Ex. Protocole EPPPN — fermentation"
            />
          </label>
          <label style={styles.label}>
            Source officielle *
            <input
              value={knowledgeSource}
              onChange={(event) => setKnowledgeSource(event.target.value)}
              required
              style={styles.input}
              placeholder="EPPPN — support de formation 2026"
            />
          </label>
          <label style={styles.label}>
            Lien de référence — facultatif
            <input
              type="url"
              value={knowledgeUrl}
              onChange={(event) => setKnowledgeUrl(event.target.value)}
              style={styles.input}
              placeholder="https://…"
            />
          </label>
          <label style={styles.label}>
            Fichier officiel — PDF, TXT ou MD
            <input
              type="file"
              accept=".pdf,.txt,.md,text/plain,text/markdown,application/pdf"
              onChange={(event) => setKnowledgeFile(event.target.files?.[0] || null)}
              style={styles.fileInput}
            />
          </label>
          <label style={{ ...styles.label, gridColumn: "1 / -1" }}>
            Ou coller le texte officiel
            <textarea
              value={knowledgeContent}
              onChange={(event) => setKnowledgeContent(event.target.value)}
              style={styles.textarea}
              rows={7}
              placeholder="Contenu du protocole ou du cas validé…"
            />
          </label>
          <label style={styles.confirmationLabel}>
            <input
              type="checkbox"
              checked={knowledgeConfirmed}
              onChange={(event) => setKnowledgeConfirmed(event.target.checked)}
              required
            />
            Je confirme qu’il s’agit d’un contenu officiel ou validé par l’EPPPN.
          </label>
          <button type="submit" disabled={knowledgeLoading} style={styles.primaryButton}>
            {knowledgeLoading ? "Extraction et indexation…" : "Ajouter à la base Ernesto"}
          </button>
        </form>

        {knowledgeMessage ? <p style={styles.success}>{knowledgeMessage}</p> : null}
        {knowledgeError ? <p style={styles.error}>{knowledgeError}</p> : null}

        <div style={styles.documentList}>
          {knowledgeDocuments.map((document) => (
            <div key={document.id} style={styles.documentItem}>
              <div style={{ minWidth: 0 }}>
                <strong>{document.title}</strong>
                <div style={styles.documentMeta}>
                  {document.source} · {document.chunks} fragment{document.chunks > 1 ? "s" : ""} · {formatDate(document.created_at)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => deleteKnowledgeDocument(document)}
                disabled={deletingDocumentId === document.id}
                style={styles.dangerButton}
              >
                {deletingDocumentId === document.id ? "Suppression…" : "Retirer"}
              </button>
            </div>
          ))}
          {!dashboardLoading && knowledgeDocuments.length === 0 ? (
            <p style={styles.muted}>Aucun document indexé.</p>
          ) : null}
        </div>
      </section>

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
        <h2 style={styles.h2}>Utilisation et qualité pédagogique</h2>
        <p style={styles.help}>Indicateurs agrégés, accessibles uniquement avec votre session administrateur Ernesto.</p>
        <div style={styles.metricsGrid}>
          <Metric title="Utilisateurs avec activité" value={stats?.users_total ?? 0} />
          <Metric title="Actifs sur 7 jours" value={stats?.users_last_7d ?? 0} />
          <Metric title="Questions totales" value={stats?.total_queries ?? 0} />
          <Metric title="Réponses utiles" value={stats?.useful_feedbacks ?? 0} />
          <Metric title="Utiles sur 7 jours" value={stats?.feedback_last_7d ?? 0} />
          <Metric title="Dossiers mémorisés" value={stats?.dossier_memories ?? 0} />
          <Metric title="Plans suivis" value={stats?.action_plans ?? 0} />
          <Metric title="Plans terminés" value={stats?.completed_action_plans ?? 0} />
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
  knowledgeForm: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 16 },
  label: { display: "grid", gap: 7, fontWeight: 700 },
  input: { minHeight: 44, padding: "0 12px", border: "1px solid #cbd4c4", borderRadius: 11, background: "white", fontSize: 15 },
  fileInput: { minHeight: 44, padding: "9px 10px", border: "1px solid #cbd4c4", borderRadius: 11, background: "white", fontSize: 14 },
  textarea: { width: "100%", minHeight: 130, padding: 12, border: "1px solid #cbd4c4", borderRadius: 11, background: "white", fontSize: 15, lineHeight: 1.5, resize: "vertical" },
  confirmationLabel: { gridColumn: "1 / -1", display: "flex", gap: 9, alignItems: "flex-start", fontWeight: 750, lineHeight: 1.45 },
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
  documentList: { display: "grid", gap: 9, marginTop: 20 },
  documentItem: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, padding: 13, border: "1px solid #e5e9e0", borderRadius: 13, background: "#fbfcf9", flexWrap: "wrap" },
  documentMeta: { marginTop: 5, fontSize: 12, opacity: 0.68, lineHeight: 1.4 },
};
