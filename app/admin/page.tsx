"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";

type TraineeStatus = "active" | "invited" | "paused" | "blocked" | "expired";

type Trainee = {
  email: string;
  full_name?: string | null;
  status: TraineeStatus;
  active: boolean;
  access_ends_at?: string | null;
  activated_at?: string | null;
  invited_at?: string | null;
  last_access_at?: string | null;
  last_sign_in_at?: string | null;
  access_count?: number;
  dossier_count?: number;
  dossier_turns?: number;
  days_remaining?: number | null;
};

type KnowledgeDocument = {
  id: number;
  title: string;
  source: string;
  url?: string | null;
  created_at?: string | null;
  chunks: number;
};

type TopUser = {
  user_id: string;
  email?: string | null;
  access_count: number;
  last_access_at?: string | null;
};

type Stats = {
  users_total: number;
  active_users: number;
  users_last_7d: number;
  users_last_30d: number;
  accesses_total: number;
  accesses_last_7d: number;
  accesses_last_30d: number;
  total_queries: number;
  dossier_memories: number;
  knowledge_documents: number;
  knowledge_chunks: number;
  avg_chunks_per_document: number;
  last_knowledge_update?: string | null;
  top_users: TopUser[];
};

const STATUS_LABELS: Record<TraineeStatus, string> = {
  active: "Actif",
  invited: "Invité",
  paused: "En pause",
  blocked: "Accès retiré",
  expired: "Expiré",
};

function formatDate(value?: string | null, withTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("fr-FR", withTime
    ? { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "short", year: "numeric" });
}

function fileTitle(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function errorText(error: unknown, fallback: string) {
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
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | TraineeStatus>("all");

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [months, setMonths] = useState("4");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMessage, setInviteMessage] = useState("");

  const [updatingEmail, setUpdatingEmail] = useState("");

  const [knowledgeFile, setKnowledgeFile] = useState<File | null>(null);
  const [knowledgeTitle, setKnowledgeTitle] = useState("");
  const [knowledgeSource, setKnowledgeSource] = useState("EPPPN — document officiel");
  const [knowledgeUrl, setKnowledgeUrl] = useState("");
  const [knowledgeBusy, setKnowledgeBusy] = useState(false);
  const [knowledgeMessage, setKnowledgeMessage] = useState("");
  const [knowledgeError, setKnowledgeError] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function token() {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const accessToken = await token();
      if (!accessToken) throw new Error("Session administrateur introuvable.");
      const headers = { Authorization: `Bearer ${accessToken}` };
      const [traineeRes, statsRes, knowledgeRes] = await Promise.all([
        fetch("/api/admin/trainees", { headers, cache: "no-store" }),
        fetch("/api/admin/stats", { headers, cache: "no-store" }),
        fetch("/api/admin/knowledge", { headers, cache: "no-store" }),
      ]);
      const [traineeData, statsData, knowledgeData] = await Promise.all([
        traineeRes.json().catch(() => ({})),
        statsRes.json().catch(() => ({})),
        knowledgeRes.json().catch(() => ({})),
      ]);
      if (!traineeRes.ok) throw new Error(traineeData?.error || "Chargement des stagiaires impossible.");
      if (!statsRes.ok) throw new Error(statsData?.error || "Chargement des statistiques impossible.");
      if (!knowledgeRes.ok) throw new Error(knowledgeData?.error || "Chargement de la base EPPPN impossible.");
      setTrainees(traineeData.trainees || []);
      setStats(statsData as Stats);
      setDocuments(knowledgeData.documents || []);
    } catch (err) {
      setError(errorText(err, "Erreur de chargement."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setInviteMessage("");
    const accessToken = await token();
    if (!accessToken) return;
    setInviteBusy(true);
    try {
      const response = await fetch("/api/admin/invite-user", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ email, full_name: fullName, access_months: Number(months) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.message || result?.error || "Invitation impossible.");
      setInviteMessage(`Accès autorisé pour ${result.email}.`);
      setEmail("");
      setFullName("");
      setMonths("4");
      await refresh();
    } catch (err) {
      setInviteMessage(errorText(err, "Invitation impossible."));
    } finally {
      setInviteBusy(false);
    }
  }

  async function traineeAction(target: Trainee, action: "pause" | "block" | "reactivate" | "extend") {
    const messages: Record<string, string> = {
      pause: `Mettre en pause l’accès de ${target.email} ?`,
      block: `Retirer l’accès Ernesto de ${target.email} ?`,
      reactivate: `Réactiver l’accès de ${target.email} ?`,
      extend: `Prolonger l’accès de ${target.email} de 30 jours ?`,
    };
    if (!window.confirm(messages[action])) return;
    const accessToken = await token();
    if (!accessToken) return;
    setUpdatingEmail(target.email);
    try {
      const response = await fetch("/api/admin/trainees", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ email: target.email, action, days: 30 }),
      });
      if (!response.ok) throw new Error("Modification impossible.");
      await refresh();
    } catch (err) {
      setError(errorText(err, "Modification impossible."));
    } finally {
      setUpdatingEmail("");
    }
  }

  async function indexDocument(event: React.FormEvent) {
    event.preventDefault();
    setKnowledgeMessage("");
    setKnowledgeError("");
    if (!knowledgeFile) {
      setKnowledgeError("Choisissez un PDF, TXT ou Markdown.");
      return;
    }
    const accessToken = await token();
    if (!accessToken) return;
    const title = knowledgeTitle.trim() || fileTitle(knowledgeFile.name) || "Document EPPPN";
    const source = knowledgeSource.trim() || "EPPPN — document officiel";
    const form = new FormData();
    form.append("title", title);
    form.append("source", source);
    form.append("url", knowledgeUrl.trim());
    form.append("content", "");
    form.append("confirmedOfficial", "true");
    form.append("file", knowledgeFile);

    setKnowledgeBusy(true);
    try {
      const response = await fetch("/api/admin/knowledge", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const labels: Record<string, string> = {
          document_already_exists: "Ce document est déjà indexé.",
          unsupported_file_type: "Format non pris en charge.",
          file_too_large: "Le fichier dépasse 8 Mo.",
          document_content_too_short: "Le PDF ne contient pas assez de texte exploitable.",
          embedding_count_mismatch: "L’indexation a été interrompue. Réessayez.",
        };
        throw new Error(labels[result?.error] || result?.error || "Indexation impossible.");
      }
      setKnowledgeMessage(`« ${result.document?.title || title} » est maintenant dans la base Ernesto · ${result.document?.chunks || 0} fragments indexés.`);
      setKnowledgeFile(null);
      setKnowledgeTitle("");
      setKnowledgeSource("EPPPN — document officiel");
      setKnowledgeUrl("");
      const input = document.getElementById("epppn-file-input") as HTMLInputElement | null;
      if (input) input.value = "";
      await refresh();
    } catch (err) {
      setKnowledgeError(errorText(err, "Indexation impossible."));
    } finally {
      setKnowledgeBusy(false);
    }
  }

  async function removeDocument(document: KnowledgeDocument) {
    if (!window.confirm(`Retirer « ${document.title} » de la base de connaissances ?`)) return;
    const accessToken = await token();
    if (!accessToken) return;
    setDeletingId(document.id);
    try {
      const response = await fetch(`/api/admin/knowledge?id=${document.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error("Suppression impossible.");
      await refresh();
    } catch (err) {
      setKnowledgeError(errorText(err, "Suppression impossible."));
    } finally {
      setDeletingId(null);
    }
  }

  const counts = useMemo(() => {
    return trainees.reduce(
      (acc, item) => {
        acc.total += 1;
        acc[item.status] += 1;
        return acc;
      },
      { total: 0, active: 0, invited: 0, paused: 0, blocked: 0, expired: 0 }
    );
  }, [trainees]);

  const visibleTrainees = useMemo(() => {
    const q = query.trim().toLowerCase();
    return trainees.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (!q) return true;
      return `${item.full_name || ""} ${item.email}`.toLowerCase().includes(q);
    });
  }, [trainees, query, statusFilter]);

  const ragHealthy = Boolean(stats?.knowledge_documents && stats?.knowledge_chunks);

  return (
    <main className="ernestoAdmin">
      <style>{adminCss}</style>

      <header className="adminHero">
        <div>
          <div className="adminEyebrow">Administration EPPPN</div>
          <h1>Ernesto · centre de contrôle</h1>
          <p>Accès stagiaires, activité et base de connaissances EPPPN utilisée par Ernesto.</p>
        </div>
        <div className="heroActions">
          <span className={`health ${ragHealthy ? "healthy" : "warning"}`}>
            <span /> {ragHealthy ? "RAG EPPPN opérationnel" : "Base EPPPN à compléter"}
          </span>
          <button className="secondary" onClick={refresh} disabled={loading}>{loading ? "Actualisation…" : "Actualiser"}</button>
        </div>
      </header>

      {error ? <div className="notice error">{error}</div> : null}

      <section className="metrics">
        <Metric label="Stagiaires autorisés" value={counts.total} note={`${counts.active} actifs`} />
        <Metric label="Accès · 7 jours" value={stats?.accesses_last_7d ?? 0} note={`${stats?.users_last_7d ?? 0} utilisateurs`} />
        <Metric label="Dossiers suivis" value={stats?.dossier_memories ?? 0} note={`${stats?.total_queries ?? 0} échanges suivis`} />
        <Metric label="Documents EPPPN" value={stats?.knowledge_documents ?? 0} note={`${stats?.knowledge_chunks ?? 0} fragments RAG`} />
      </section>

      <section className="adminGrid">
        <article className="adminCard accessCard">
          <div className="cardHead">
            <div>
              <div className="sectionKicker">Accès</div>
              <h2>Stagiaires autorisés</h2>
              <p>Ajoutez une adresse, mettez l’accès en pause, retirez-le ou prolongez-le.</p>
            </div>
            <div className="statusSummary">
              <span className="mini active">{counts.active} actifs</span>
              <span className="mini paused">{counts.paused} pause</span>
              <span className="mini muted">{counts.invited} invités</span>
            </div>
          </div>

          <form className="inviteForm" onSubmit={invite}>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@exemple.fr" required />
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nom — facultatif" />
            <select value={months} onChange={(e) => setMonths(e.target.value)} aria-label="Durée d’accès">
              <option value="1">1 mois</option>
              <option value="3">3 mois</option>
              <option value="4">4 mois</option>
              <option value="6">6 mois</option>
            </select>
            <button className="primary" disabled={inviteBusy}>{inviteBusy ? "Ajout…" : "Autoriser"}</button>
          </form>
          {inviteMessage ? <div className="notice success">{inviteMessage}</div> : null}

          <div className="tableTools">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un stagiaire…" />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | TraineeStatus)}>
              <option value="all">Tous les statuts</option>
              <option value="active">Actifs</option>
              <option value="invited">Invités</option>
              <option value="paused">En pause</option>
              <option value="expired">Expirés</option>
              <option value="blocked">Accès retirés</option>
            </select>
          </div>

          <div className="tableScroll">
            <table>
              <thead>
                <tr>
                  <th>Stagiaire</th>
                  <th>Statut</th>
                  <th>Dernier accès</th>
                  <th>Accès</th>
                  <th>Dossiers</th>
                  <th>Fin d’accès</th>
                  <th>Gestion</th>
                </tr>
              </thead>
              <tbody>
                {visibleTrainees.map((item) => (
                  <tr key={item.email}>
                    <td>
                      <strong>{item.full_name || "—"}</strong>
                      <small>{item.email}</small>
                    </td>
                    <td><Status status={item.status} /></td>
                    <td>{formatDate(item.last_access_at || item.last_sign_in_at, true)}</td>
                    <td><strong>{item.access_count || 0}</strong></td>
                    <td><strong>{item.dossier_count || 0}</strong></td>
                    <td>
                      {formatDate(item.access_ends_at)}
                      {typeof item.days_remaining === "number" && item.status === "active" ? <small>{item.days_remaining} j restants</small> : null}
                    </td>
                    <td>
                      <div className="rowActions">
                        {item.status === "active" || item.status === "invited" ? (
                          <button onClick={() => traineeAction(item, "pause")} disabled={updatingEmail === item.email}>Pause</button>
                        ) : null}
                        {item.status === "paused" || item.status === "blocked" ? (
                          <button className="resume" onClick={() => traineeAction(item, "reactivate")} disabled={updatingEmail === item.email}>Réactiver</button>
                        ) : null}
                        <button onClick={() => traineeAction(item, "extend")} disabled={updatingEmail === item.email}>+30 j</button>
                        {item.status !== "blocked" ? (
                          <button className="danger" onClick={() => traineeAction(item, "block")} disabled={updatingEmail === item.email}>Retirer</button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {!visibleTrainees.length ? <tr><td colSpan={7} className="empty">Aucun stagiaire correspondant.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </article>

        <aside className="adminCard insightCard">
          <div className="sectionKicker">Activité</div>
          <h2>Vue rapide</h2>
          <div className="insightRows">
            <Insight label="Accès cumulés" value={stats?.accesses_total ?? 0} />
            <Insight label="Utilisateurs · 30 j" value={stats?.users_last_30d ?? 0} />
            <Insight label="Accès · 30 j" value={stats?.accesses_last_30d ?? 0} />
            <Insight label="Moy. fragments / document" value={stats?.avg_chunks_per_document ?? 0} />
          </div>
          <h3>Utilisateurs les plus actifs</h3>
          <div className="topUsers">
            {(stats?.top_users || []).slice(0, 5).map((user) => (
              <div key={user.user_id}>
                <span>{user.email || "Utilisateur"}</span>
                <strong>{user.access_count}</strong>
              </div>
            ))}
            {!stats?.top_users?.length ? <p className="mutedText">Les statistiques apparaîtront après les prochains accès.</p> : null}
          </div>
        </aside>
      </section>

      <section className="adminCard knowledgeCard">
        <div className="cardHead knowledgeHead">
          <div>
            <div className="sectionKicker">Connaissances</div>
            <h2>Base documentaire EPPPN</h2>
            <p>Déposez un PDF : Ernesto extrait le texte, le découpe, crée les embeddings et l’ajoute automatiquement au RAG.</p>
          </div>
          <div className="ragNumbers">
            <strong>{stats?.knowledge_documents ?? 0}</strong><span>documents</span>
            <strong>{stats?.knowledge_chunks ?? 0}</strong><span>fragments</span>
          </div>
        </div>

        <form className="knowledgeUpload" onSubmit={indexDocument}>
          <label className={`dropZone ${knowledgeFile ? "selected" : ""}`}>
            <input
              id="epppn-file-input"
              type="file"
              accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                setKnowledgeFile(file);
                if (file && !knowledgeTitle.trim()) setKnowledgeTitle(fileTitle(file.name));
              }}
            />
            <span className="uploadIcon">PDF</span>
            <div>
              <strong>{knowledgeFile ? knowledgeFile.name : "Choisir un document EPPPN"}</strong>
              <small>{knowledgeFile ? `${(knowledgeFile.size / 1024 / 1024).toFixed(2)} Mo` : "PDF, TXT ou Markdown · 8 Mo max."}</small>
            </div>
          </label>

          <div className="knowledgeMeta">
            <input value={knowledgeTitle} onChange={(e) => setKnowledgeTitle(e.target.value)} placeholder="Titre — déduit automatiquement du fichier" />
            <input value={knowledgeSource} onChange={(e) => setKnowledgeSource(e.target.value)} placeholder="Source EPPPN" />
            <input type="url" value={knowledgeUrl} onChange={(e) => setKnowledgeUrl(e.target.value)} placeholder="Lien de référence — facultatif" />
            <button className="primary knowledgeButton" disabled={!knowledgeFile || knowledgeBusy}>{knowledgeBusy ? "Indexation en cours…" : "Ajouter à Ernesto"}</button>
          </div>
        </form>

        <p className="adminHint">Tout document importé depuis cette page administrateur est considéré comme validé pour la base de connaissances EPPPN.</p>
        {knowledgeMessage ? <div className="notice success">{knowledgeMessage}</div> : null}
        {knowledgeError ? <div className="notice error">{knowledgeError}</div> : null}

        <div className="documentsGrid">
          {documents.map((document) => (
            <article className="documentRow" key={document.id}>
              <div className="docIcon">E</div>
              <div className="docBody">
                <strong>{document.title}</strong>
                <span>{document.source}</span>
                <small>Indexé le {formatDate(document.created_at)} · {document.chunks} fragments</small>
              </div>
              <span className="indexed">Indexé</span>
              <button className="removeDoc" onClick={() => removeDocument(document)} disabled={deletingId === document.id}>{deletingId === document.id ? "…" : "Retirer"}</button>
            </article>
          ))}
          {!documents.length ? <div className="emptyPanel">Aucun document indexé pour le moment.</div> : null}
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value, note }: { label: string; value: number; note: string }) {
  return <article className="metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function Insight({ label, value }: { label: string; value: number }) {
  return <div className="insight"><span>{label}</span><strong>{value}</strong></div>;
}

function Status({ status }: { status: TraineeStatus }) {
  return <span className={`status status-${status}`}><i />{STATUS_LABELS[status]}</span>;
}

const adminCss = `
  .ernestoAdmin{min-height:100svh;background:#f6f7f4;color:#172132;padding:38px clamp(18px,4vw,58px) 70px;font-family:var(--font-geist-sans),system-ui,sans-serif}
  .adminHero{max-width:1380px;margin:0 auto 24px;display:flex;justify-content:space-between;align-items:flex-end;gap:24px}.adminEyebrow,.sectionKicker{font-size:11px;font-weight:900;letter-spacing:.11em;text-transform:uppercase;color:#6f7d3c}.adminHero h1{margin:6px 0 5px;font-size:clamp(29px,4vw,46px);letter-spacing:-.045em}.adminHero p,.cardHead p{margin:0;color:#64748b;max-width:700px;line-height:1.55}.heroActions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}.health{display:inline-flex;align-items:center;gap:7px;padding:8px 11px;border-radius:999px;font-size:11px;font-weight:850;background:#fff;border:1px solid #dde3d8}.health span{width:8px;height:8px;border-radius:99px}.health.healthy span{background:#6f7d3c;box-shadow:0 0 0 4px rgba(111,125,60,.12)}.health.warning span{background:#b88a35}
  button,input,select{font:inherit}.primary,.secondary,.rowActions button,.removeDoc{border:0;cursor:pointer;font-weight:850}.primary{background:#435331;color:#fff;border-radius:12px;padding:11px 15px;box-shadow:0 6px 16px rgba(67,83,49,.18)}.secondary{background:#fff;border:1px solid #d9dfd5;border-radius:12px;padding:10px 14px;color:#435331}.primary:disabled,.secondary:disabled,.rowActions button:disabled,.removeDoc:disabled{opacity:.5;cursor:not-allowed}
  .metrics{max-width:1380px;margin:0 auto 22px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.metric{background:#fff;border:1px solid #e4e8e1;border-radius:17px;padding:17px 18px;box-shadow:0 6px 18px rgba(23,33,50,.035)}.metric span{display:block;font-size:11px;font-weight:800;color:#75806f;text-transform:uppercase;letter-spacing:.045em}.metric strong{display:block;margin-top:7px;font-size:29px;letter-spacing:-.04em}.metric small{display:block;margin-top:2px;color:#8a9389}
  .adminGrid{max-width:1380px;margin:0 auto 22px;display:grid;grid-template-columns:minmax(0,1fr) 285px;gap:18px;align-items:start}.adminCard{background:#fff;border:1px solid #e3e7df;border-radius:21px;box-shadow:0 10px 32px rgba(23,33,50,.045);padding:22px}.cardHead{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.cardHead h2,.insightCard h2,.knowledgeCard h2{margin:4px 0 4px;font-size:21px;letter-spacing:-.025em}.statusSummary{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.mini{font-size:10px;font-weight:850;padding:5px 8px;border-radius:999px;background:#f3f5f2;color:#697269}.mini.active{background:#edf3e6;color:#56683f}.mini.paused{background:#fff6df;color:#9c7629}
  .inviteForm{display:grid;grid-template-columns:1.2fr 1fr 110px auto;gap:8px;margin:18px 0 10px}.inviteForm input,.inviteForm select,.tableTools input,.tableTools select,.knowledgeMeta input{border:1px solid #dce2d9;background:#fbfcfa;border-radius:11px;padding:10px 11px;color:#172132;outline:none}.inviteForm input:focus,.tableTools input:focus,.knowledgeMeta input:focus{border-color:#6f7d3c;box-shadow:0 0 0 3px rgba(111,125,60,.09)}.notice{margin:10px 0;padding:10px 12px;border-radius:11px;font-size:12px;font-weight:700}.notice.success{background:#edf5e9;color:#4f6338}.notice.error{max-width:1380px;margin:0 auto 16px;background:#fff0ed;color:#9f4e3f}
  .tableTools{display:flex;gap:8px;margin:15px 0 10px}.tableTools input{flex:1}.tableScroll{overflow:auto;border:1px solid #edf0eb;border-radius:14px}table{width:100%;border-collapse:collapse;min-width:900px}th{text-align:left;background:#f7f8f6;color:#798279;font-size:10px;text-transform:uppercase;letter-spacing:.055em;padding:10px 12px}td{padding:12px;border-top:1px solid #edf0eb;font-size:12px;vertical-align:middle}td strong{font-size:12px}td small{display:block;color:#8a9389;margin-top:2px}.status{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:850;padding:5px 8px;border-radius:999px;background:#f2f4f1;color:#697269;white-space:nowrap}.status i{width:6px;height:6px;border-radius:99px;background:currentColor}.status-active{background:#edf4e7;color:#58703b}.status-paused{background:#fff5dc;color:#9d7422}.status-blocked{background:#fff0ed;color:#a55646}.status-expired{background:#f2f2f2;color:#777}.rowActions{display:flex;gap:5px;flex-wrap:wrap}.rowActions button,.removeDoc{background:#f4f6f2;color:#5a6653;border:1px solid #e1e6de;border-radius:8px;padding:6px 8px;font-size:10px}.rowActions .resume{background:#edf4e7;color:#52663a}.rowActions .danger,.removeDoc{background:#fff4f1;color:#a45b4b;border-color:#f0d8d2}.empty{text-align:center;color:#8a9389;padding:25px}
  .insightCard{position:sticky;top:18px}.insightRows{display:grid;gap:7px;margin:14px 0 22px}.insight{display:flex;justify-content:space-between;align-items:center;padding:10px 11px;border-radius:11px;background:#f6f8f4}.insight span{font-size:11px;color:#6e7868}.insight strong{font-size:17px}.insightCard h3{font-size:12px;margin:0 0 8px;color:#53604d}.topUsers{display:grid;gap:6px}.topUsers>div{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid #edf0eb;font-size:10px}.topUsers span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#687168}.mutedText{font-size:11px;color:#8a9389;line-height:1.5}
  .knowledgeCard{max-width:1380px;margin:0 auto}.knowledgeHead{align-items:center}.ragNumbers{display:grid;grid-template-columns:auto auto;gap:0 8px;align-items:baseline;background:#f4f7f0;padding:10px 13px;border-radius:13px;color:#53623e}.ragNumbers strong{font-size:21px}.ragNumbers span{font-size:10px;color:#7d8876}.knowledgeUpload{display:grid;grid-template-columns:minmax(280px,.8fr) minmax(360px,1.2fr);gap:14px;margin-top:18px}.dropZone{display:flex;align-items:center;gap:13px;border:1.5px dashed #bfc9b7;background:#f9fbf7;border-radius:15px;padding:18px;cursor:pointer;transition:.15s}.dropZone:hover,.dropZone.selected{border-color:#6f7d3c;background:#f2f6ed}.dropZone input{display:none}.uploadIcon{display:grid;place-items:center;width:46px;height:46px;border-radius:12px;background:#435331;color:white;font-size:11px;font-weight:950}.dropZone strong,.dropZone small{display:block}.dropZone small{margin-top:3px;color:#899285;font-size:10px}.knowledgeMeta{display:grid;grid-template-columns:1fr 1fr;gap:8px}.knowledgeMeta input:nth-child(3){grid-column:1 / -1}.knowledgeButton{grid-column:1 / -1}.adminHint{font-size:10px;color:#8a9389;margin:10px 0 0}.documentsGrid{display:grid;gap:8px;margin-top:16px}.documentRow{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:12px;padding:12px;border:1px solid #e8ece5;border-radius:13px}.docIcon{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:#edf3e7;color:#5c6f43;font-weight:950}.docBody{min-width:0}.docBody strong,.docBody span,.docBody small{display:block}.docBody strong{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.docBody span{font-size:10px;color:#6f796b;margin-top:2px}.docBody small{font-size:9px;color:#99a094;margin-top:3px}.indexed{font-size:9px;font-weight:900;color:#617344;background:#edf4e7;border-radius:999px;padding:5px 8px}.emptyPanel{padding:25px;text-align:center;border:1px dashed #dce2d8;border-radius:13px;color:#8a9389;font-size:11px}
  @media(max-width:1050px){.metrics{grid-template-columns:repeat(2,1fr)}.adminGrid{grid-template-columns:1fr}.insightCard{position:static}.inviteForm{grid-template-columns:1fr 1fr}.knowledgeUpload{grid-template-columns:1fr}}
  @media(max-width:650px){.ernestoAdmin{padding:24px 12px 55px}.adminHero,.cardHead{display:block}.heroActions,.statusSummary{justify-content:flex-start;margin-top:12px}.metrics{grid-template-columns:1fr 1fr;gap:8px}.metric{padding:13px}.metric strong{font-size:24px}.adminCard{padding:15px;border-radius:17px}.inviteForm{grid-template-columns:1fr}.tableTools{display:grid}.knowledgeMeta{grid-template-columns:1fr}.knowledgeMeta input:nth-child(3),.knowledgeButton{grid-column:auto}.documentRow{grid-template-columns:auto minmax(0,1fr) auto}.indexed{display:none}.removeDoc{grid-column:3}.ragNumbers{margin-top:12px;width:fit-content}}
`;
