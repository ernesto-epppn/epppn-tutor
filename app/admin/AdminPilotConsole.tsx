"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";

type HealthItem = { ok: boolean; detail?: string; documents?: number; chunks?: number; enabled?: boolean };
type PilotTrainee = {
  email: string;
  full_name?: string | null;
  role?: string;
  status: string;
  first_access_at?: string | null;
  last_access_at?: string | null;
  access_count: number;
  accesses_7d: number;
  dossier_count: number;
  question_count: number;
  feedback_positive: number;
  feedback_negative: number;
  low_rag_questions: number;
  never_connected: boolean;
  active_7d: boolean;
};

type PilotData = {
  settings: {
    maintenance_mode: boolean;
    suspend_trainees: boolean;
    rag_enabled: boolean;
    images_enabled: boolean;
    monthly_openai_budget_usd: number;
    pilot_target_count: number;
    maintenance_message?: string | null;
  };
  health: {
    overall: "healthy" | "warning";
    supabase: HealthItem;
    openai: HealthItem;
    rag: HealthItem;
    vercel: HealthItem & { commit?: string | null };
    errors_24h: number;
    knowledge_failures_24h: number;
    avg_latency_ms_24h?: number | null;
    requests_24h: number;
    error_rate_24h: number;
  };
  pilot: {
    target: number;
    trainees: PilotTrainee[];
    total: number;
    connected: number;
    active_7d: number;
    never_connected: number;
    paused: number;
  };
  quality: {
    responses: number;
    retrieval_rate: number;
    low_rag_count: number;
    low_rag_rate: number;
    feedback_total: number;
    feedback_positive: number;
    feedback_negative: number;
    positive_rate?: number | null;
    negative_recent: Array<{
      created_at: string;
      email?: string | null;
      project_title?: string | null;
      question: string;
      reason?: string | null;
      rag_used: number;
    }>;
  };
  costs: {
    openai: {
      actual_available: boolean;
      actual_usd?: number | null;
      estimated_usd: number;
      displayed_usd: number;
      input_tokens: number;
      output_tokens: number;
      embedding_tokens: number;
      model_requests: number;
      model: string;
      embedding_model: string;
      tracking_started_at?: string | null;
      budget_usd: number;
      budget_ratio: number;
    };
    vercel: { plan: string; deployment: string };
    supabase: { plan: string; project_status: string; region: string };
  };
  links: Record<string, string>;
  notes?: { cost_estimate?: string; telemetry?: string };
};

function date(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function pct(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)} %`;
}

function money(value?: number | null) {
  const amount = Number(value || 0);
  return `${amount.toLocaleString("fr-FR", { minimumFractionDigits: amount < 1 ? 3 : 2, maximumFractionDigits: amount < 1 ? 3 : 2 })} $`;
}

function compact(value: number) {
  return new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    active: "Actif",
    invited: "Jamais connecté",
    paused: "En pause",
    blocked: "Retiré",
    expired: "Expiré",
  };
  return labels[status] || status;
}

export default function AdminPilotConsole() {
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return url && anon ? createClient(url, anon) : null;
  }, []);

  const [data, setData] = useState<PilotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "never" | "inactive" | "paused">("all");
  const [busyControl, setBusyControl] = useState("");
  const [budgetDraft, setBudgetDraft] = useState("50");

  async function accessToken() {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function load() {
    if (!supabase) return;
    setLoading(true);
    setError("");
    try {
      const token = await accessToken();
      if (!token) throw new Error("Session administrateur introuvable.");
      const response = await fetch("/api/admin/pilot", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Chargement du pilotage impossible.");
      setData(payload as PilotData);
      setBudgetDraft(String(Number(payload?.settings?.monthly_openai_budget_usd || 50)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement du pilotage impossible.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function updateSettings(update: Record<string, unknown>, controlName: string, confirmText?: string) {
    if (!supabase) return;
    if (confirmText && !window.confirm(confirmText)) return;
    setBusyControl(controlName);
    setError("");
    try {
      const token = await accessToken();
      if (!token) throw new Error("Session administrateur introuvable.");
      const response = await fetch("/api/admin/pilot", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(update),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Modification impossible.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Modification impossible.");
    } finally {
      setBusyControl("");
    }
  }

  const visible = useMemo(() => {
    const rows = data?.pilot?.trainees || [];
    if (filter === "active") return rows.filter((row) => row.active_7d);
    if (filter === "never") return rows.filter((row) => row.never_connected);
    if (filter === "inactive") return rows.filter((row) => !row.never_connected && !row.active_7d && row.status === "active");
    if (filter === "paused") return rows.filter((row) => row.status === "paused" || row.status === "blocked");
    return rows;
  }, [data, filter]);

  if (!data && loading) {
    return <section className="pilotShell"><style>{pilotCss}</style><div className="pilotLoading">Préparation de la console de pilotage…</div></section>;
  }

  if (!data) {
    return <section className="pilotShell"><style>{pilotCss}</style><div className="pilotError">{error || "Console indisponible."}</div></section>;
  }

  const health = data.health;
  const costs = data.costs.openai;
  const budgetPct = Math.min(999, Math.round(Number(costs.budget_ratio || 0) * 100));
  const budgetTone = budgetPct >= 90 ? "danger" : budgetPct >= 75 ? "warning" : budgetPct >= 50 ? "watch" : "good";
  const emergencyActive = data.settings.maintenance_mode || data.settings.suspend_trainees || !data.settings.rag_enabled || !data.settings.images_enabled;

  return (
    <section className="pilotShell">
      <style>{pilotCss}</style>
      <div className="pilotConsole">
        <div className="pilotHead">
          <div>
            <div className="pilotEyebrow">Pilotage · lancement EPPPN</div>
            <h2>Console opérationnelle Ernesto</h2>
            <p>État du service, suivi des stagiaires, qualité, coûts et commandes d’urgence au même endroit.</p>
          </div>
          <div className="pilotHeadActions">
            <span className={`globalState ${health.overall === "healthy" && !emergencyActive ? "ok" : "warn"}`}>
              <i /> {emergencyActive ? "Mode spécial actif" : health.overall === "healthy" ? "Ernesto opérationnel" : "À surveiller"}
            </span>
            <button type="button" onClick={() => void load()} disabled={loading}>{loading ? "Actualisation…" : "Actualiser"}</button>
          </div>
        </div>

        {error ? <div className="pilotNotice">{error}</div> : null}

        <div className="healthGrid">
          <HealthCard title="OpenAI" item={health.openai} detail={health.openai.detail || "Modèle"} />
          <HealthCard title="Supabase" item={health.supabase} detail={health.supabase.detail || "Base"} />
          <HealthCard title="RAG EPPPN" item={health.rag} detail={`${health.rag.documents || 0} docs · ${health.rag.chunks || 0} fragments`} />
          <HealthCard title="Vercel / API" item={health.vercel} detail={health.vercel.detail || "Production"} />
        </div>

        <div className="opsStrip">
          <div><span>Requêtes · 24 h</span><strong>{health.requests_24h}</strong></div>
          <div><span>Temps moyen</span><strong>{health.avg_latency_ms_24h ? `${(health.avg_latency_ms_24h / 1000).toFixed(1)} s` : "—"}</strong></div>
          <div><span>Erreurs · 24 h</span><strong className={health.errors_24h ? "bad" : ""}>{health.errors_24h}</strong></div>
          <div><span>Imports documentaires en échec</span><strong className={health.knowledge_failures_24h ? "bad" : ""}>{health.knowledge_failures_24h}</strong></div>
        </div>

        <div className="pilotSectionHead">
          <div><span>Pilot EPPPN</span><h3>{data.pilot.total}/{data.pilot.target} stagiaires préparés</h3></div>
          <div className="pilotFilters">
            <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Tous</button>
            <button className={filter === "active" ? "active" : ""} onClick={() => setFilter("active")}>Actifs 7 j</button>
            <button className={filter === "never" ? "active" : ""} onClick={() => setFilter("never")}>Jamais connectés</button>
            <button className={filter === "inactive" ? "active" : ""} onClick={() => setFilter("inactive")}>Inactifs</button>
            <button className={filter === "paused" ? "active" : ""} onClick={() => setFilter("paused")}>Pause / retirés</button>
          </div>
        </div>

        <div className="pilotSummary">
          <MiniMetric label="Connectés" value={data.pilot.connected} />
          <MiniMetric label="Actifs · 7 j" value={data.pilot.active_7d} />
          <MiniMetric label="Jamais connectés" value={data.pilot.never_connected} />
          <MiniMetric label="En pause" value={data.pilot.paused} />
        </div>

        <div className="traineeTableWrap">
          <table className="pilotTable">
            <thead><tr><th>Stagiaire</th><th>Statut</th><th>1er accès</th><th>Dernier accès</th><th>Accès</th><th>Dossiers</th><th>Questions</th><th>Feedback</th></tr></thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.email}>
                  <td><strong>{row.full_name || row.email.split("@")[0]}</strong><small>{row.email}</small></td>
                  <td><span className={`statusPill status-${row.status}`}>{statusLabel(row.status)}</span></td>
                  <td>{date(row.first_access_at)}</td>
                  <td>{date(row.last_access_at)}</td>
                  <td><strong>{row.access_count}</strong><small>{row.accesses_7d ? `${row.accesses_7d} cette semaine` : "—"}</small></td>
                  <td>{row.dossier_count}</td>
                  <td><strong>{row.question_count}</strong>{row.low_rag_questions ? <small className="attention">{row.low_rag_questions} à faible RAG</small> : null}</td>
                  <td><span className="fbGood">+{row.feedback_positive}</span> <span className={row.feedback_negative ? "fbBad" : "fbNeutral"}>−{row.feedback_negative}</span></td>
                </tr>
              ))}
              {!visible.length ? <tr><td colSpan={8} className="tableEmpty">Aucun stagiaire dans ce filtre.</td></tr> : null}
            </tbody>
          </table>
        </div>

        <div className="qualityEmergencyGrid">
          <article className="controlCard qualityCard">
            <div className="cardKicker">Qualité des réponses · 30 jours</div>
            <h3>Ce qu’il faut surveiller</h3>
            <div className="qualityMetrics">
              <MiniMetric label="Réponses suivies" value={data.quality.responses} />
              <MiniMetric label="RAG EPPPN utilisé" value={pct(data.quality.retrieval_rate)} />
              <MiniMetric label="Couverture RAG faible" value={data.quality.low_rag_count} />
              <MiniMetric label="Feedback positif" value={pct(data.quality.positive_rate)} />
            </div>
            <div className="qualityBar"><span style={{ width: `${Math.round((data.quality.positive_rate || 0) * 100)}%` }} /></div>
            <div className="qualityCaption">{data.quality.feedback_total ? `${data.quality.feedback_positive} positifs · ${data.quality.feedback_negative} négatifs` : "Les feedbacks apparaîtront ici pendant le pilot."}</div>
            {data.quality.negative_recent.length ? (
              <div className="negativeList">
                <strong>Derniers retours à revoir</strong>
                {data.quality.negative_recent.slice(0, 4).map((item, index) => (
                  <div key={`${item.created_at}-${index}`}><span>{item.email || "Utilisateur"} · {date(item.created_at)}</span><p>{item.question}</p>{item.reason ? <small>{item.reason}</small> : null}</div>
                ))}
              </div>
            ) : <div className="quietState">Aucun feedback négatif récent.</div>}
          </article>

          <article className={`controlCard emergencyCard ${emergencyActive ? "activeEmergency" : ""}`}>
            <div className="cardKicker">Contrôle d’urgence</div>
            <h3>Commandes immédiates</h3>
            <p className="cardIntro">Les administrateurs restent accessibles. Chaque commande demande une confirmation lorsqu’elle réduit le service.</p>
            <ControlRow label="Mode maintenance" description="Bloque les réponses Ernesto pour les utilisateurs." active={data.settings.maintenance_mode} busy={busyControl === "maintenance"} onClick={() => void updateSettings({ maintenance_mode: !data.settings.maintenance_mode }, "maintenance", !data.settings.maintenance_mode ? "Activer le mode maintenance pour Ernesto ?" : undefined)} danger />
            <ControlRow label="Suspendre tous les stagiaires" description="Stoppe temporairement le pilot sans modifier les comptes individuellement." active={data.settings.suspend_trainees} busy={busyControl === "trainees"} onClick={() => void updateSettings({ suspend_trainees: !data.settings.suspend_trainees }, "trainees", !data.settings.suspend_trainees ? "Suspendre temporairement tous les accès stagiaires ?" : undefined)} danger />
            <ControlRow label="RAG EPPPN" description="Désactivation réservée au diagnostic technique." active={data.settings.rag_enabled} busy={busyControl === "rag"} onClick={() => void updateSettings({ rag_enabled: !data.settings.rag_enabled }, "rag", data.settings.rag_enabled ? "Désactiver temporairement le RAG EPPPN ?" : undefined)} />
            <ControlRow label="Analyse d’images" description="Autorise l’envoi et l’analyse des photos." active={data.settings.images_enabled} busy={busyControl === "images"} onClick={() => void updateSettings({ images_enabled: !data.settings.images_enabled }, "images", data.settings.images_enabled ? "Désactiver temporairement l’analyse d’images ?" : undefined)} />
          </article>
        </div>

        <article className="costCard">
          <div className="costHead">
            <div><div className="cardKicker">Infrastructure & coûts</div><h3>Consommation Ernesto</h3><p>Suivi interne + accès direct aux portails officiels pour facturation et changement de plan.</p></div>
            <div className={`budgetBadge ${budgetTone}`}>{budgetPct}% du budget OpenAI</div>
          </div>

          <div className="providerGrid">
            <div className="provider openaiProvider">
              <div className="providerTop"><strong>OpenAI API</strong><span>{costs.actual_available ? "Coût facturé" : "Estimation Ernesto"}</span></div>
              <div className="providerPrice">{money(costs.displayed_usd)}</div>
              <small>{compact(costs.input_tokens)} tokens entrée · {compact(costs.output_tokens)} sortie · {compact(costs.embedding_tokens)} embeddings</small>
              <div className="budgetTrack"><span className={budgetTone} style={{ width: `${Math.min(100, budgetPct)}%` }} /></div>
              <div className="budgetEdit"><label>Budget mensuel <input type="number" min="1" max="10000" step="1" value={budgetDraft} onChange={(event) => setBudgetDraft(event.target.value)} /> $</label><button onClick={() => void updateSettings({ monthly_openai_budget_usd: Number(budgetDraft) }, "budget") } disabled={busyControl === "budget"}>Enregistrer</button></div>
              <div className="providerLinks"><a href={data.links.openai_usage} target="_blank" rel="noreferrer">Usage</a><a href={data.links.openai_billing} target="_blank" rel="noreferrer">Facturation / crédits</a></div>
            </div>

            <div className="provider">
              <div className="providerTop"><strong>Vercel</strong><span>{data.costs.vercel.deployment}</span></div>
              <div className="providerPlan">Plan connu · <strong>{data.costs.vercel.plan}</strong></div>
              <p>Hébergement et déploiements d’Ernesto.</p>
              <div className="providerLinks"><a href={data.links.vercel_project} target="_blank" rel="noreferrer">Projet</a><a href={data.links.vercel_usage} target="_blank" rel="noreferrer">Usage / plan</a></div>
            </div>

            <div className="provider">
              <div className="providerTop"><strong>Supabase</strong><span>{data.costs.supabase.project_status}</span></div>
              <div className="providerPlan">Plan connu · <strong>{data.costs.supabase.plan}</strong></div>
              <p>Base, authentification, RAG et données du pilot · {data.costs.supabase.region}.</p>
              <div className="providerLinks"><a href={data.links.supabase_project} target="_blank" rel="noreferrer">Projet</a><a href={data.links.supabase_billing} target="_blank" rel="noreferrer">Facturation / plan</a></div>
            </div>
          </div>
          <div className="costFoot">{data.notes?.telemetry} {costs.actual_available ? "Le coût OpenAI provient de l’API de facturation." : "Le coût OpenAI affiché est une estimation interne ; la facturation OpenAI reste la référence."}</div>
        </article>
      </div>
    </section>
  );
}

function HealthCard({ title, item, detail }: { title: string; item: HealthItem; detail: string }) {
  return <div className={`healthCard ${item.ok ? "ok" : "warn"}`}><div><i /><span>{title}</span></div><strong>{item.ok ? "OK" : "À vérifier"}</strong><small>{detail}</small></div>;
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return <div className="miniMetric"><span>{label}</span><strong>{value}</strong></div>;
}

function ControlRow({ label, description, active, busy, onClick, danger = false }: { label: string; description: string; active: boolean; busy: boolean; onClick: () => void; danger?: boolean }) {
  return <div className="controlRow"><div><strong>{label}</strong><span>{description}</span></div><button type="button" className={`${active ? "on" : "off"} ${danger && active ? "danger" : ""}`} onClick={onClick} disabled={busy} aria-pressed={active}><i />{busy ? "…" : active ? "Actif" : "Inactif"}</button></div>;
}

const pilotCss = `
.pilotShell{background:#f6f7f4;padding:24px clamp(18px,4vw,58px);font-family:var(--font-geist-sans),system-ui,sans-serif;color:#172132}.pilotConsole{max-width:1380px;margin:0 auto}.pilotLoading,.pilotError{max-width:1380px;margin:0 auto;padding:20px;border:1px solid #dde4d8;border-radius:18px;background:#fff;font-weight:800}.pilotError{color:#9a503b;background:#fff6f3}
.pilotHead{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}.pilotEyebrow,.cardKicker{font-size:10px;font-weight:950;letter-spacing:.11em;text-transform:uppercase;color:#6f7d3c}.pilotHead h2{margin:5px 0 5px;font-size:28px;letter-spacing:-.04em}.pilotHead p{margin:0;color:#64748b;font-size:13px;max-width:720px}.pilotHeadActions{display:flex;align-items:center;gap:8px}.pilotHeadActions button{border:1px solid #dce2d8;background:#fff;color:#435331;border-radius:11px;padding:9px 12px;font-weight:850;cursor:pointer}.globalState{display:inline-flex;align-items:center;gap:7px;border-radius:999px;padding:8px 11px;font-size:11px;font-weight:900}.globalState i,.healthCard i{width:7px;height:7px;border-radius:50%;display:inline-block}.globalState.ok{background:#edf5e8;color:#435331}.globalState.ok i{background:#6f7d3c}.globalState.warn{background:#fff4e8;color:#965e25}.globalState.warn i{background:#c17a2f}.pilotNotice{margin-top:12px;background:#fff2ee;border:1px solid #f1d0c6;color:#9b523c;border-radius:12px;padding:10px 12px;font-size:12px;font-weight:750}
.healthGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:18px}.healthCard{border:1px solid #e3e8df;background:#fff;border-radius:16px;padding:14px;display:grid;gap:5px}.healthCard>div{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:850;color:#667160}.healthCard.ok i{background:#6f7d3c}.healthCard.warn i{background:#c07839}.healthCard strong{font-size:18px;letter-spacing:-.03em}.healthCard small{font-size:10px;color:#7b8577}.opsStrip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin-top:10px;border:1px solid #e3e8df;border-radius:16px;background:#fff;overflow:hidden}.opsStrip>div{padding:12px 14px;border-right:1px solid #e8ece5}.opsStrip>div:last-child{border-right:0}.opsStrip span{display:block;font-size:9px;text-transform:uppercase;font-weight:900;letter-spacing:.06em;color:#778273}.opsStrip strong{display:block;margin-top:4px;font-size:17px}.opsStrip strong.bad{color:#a5543d}
.pilotSectionHead{display:flex;justify-content:space-between;align-items:end;gap:18px;margin-top:24px}.pilotSectionHead>div:first-child>span{font-size:10px;font-weight:950;text-transform:uppercase;letter-spacing:.09em;color:#6f7d3c}.pilotSectionHead h3{margin:3px 0 0;font-size:21px;letter-spacing:-.035em}.pilotFilters{display:flex;gap:5px;flex-wrap:wrap}.pilotFilters button{border:1px solid #dce2d8;background:#fff;color:#647064;border-radius:999px;padding:6px 9px;font-size:10px;font-weight:850;cursor:pointer}.pilotFilters button.active{background:#435331;color:#fff;border-color:#435331}.pilotSummary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:10px}.miniMetric{border:1px solid #e4e9e1;background:#fff;border-radius:13px;padding:11px}.miniMetric span{display:block;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.05em;color:#7b8578}.miniMetric strong{display:block;margin-top:4px;font-size:19px;letter-spacing:-.03em}
.traineeTableWrap{margin-top:10px;border:1px solid #e2e7df;border-radius:17px;overflow:auto;background:#fff}.pilotTable{width:100%;border-collapse:collapse;min-width:980px}.pilotTable th{font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#778174;text-align:left;background:#f8faf7;padding:9px 11px;border-bottom:1px solid #e5e9e2}.pilotTable td{font-size:11px;padding:10px 11px;border-bottom:1px solid #edf0eb;vertical-align:middle}.pilotTable tbody tr:last-child td{border-bottom:0}.pilotTable td strong{font-size:11px}.pilotTable td small{display:block;margin-top:2px;color:#839083;font-size:9px}.pilotTable td small.attention{color:#a0632d}.statusPill{display:inline-flex;padding:5px 7px;border-radius:999px;font-size:9px;font-weight:900}.status-active{background:#edf5e8;color:#435331}.status-invited{background:#f1f3f5;color:#66717a}.status-paused{background:#fff5df;color:#8d6619}.status-blocked,.status-expired{background:#fff0eb;color:#9a503b}.fbGood{color:#536c3a;font-weight:900}.fbBad{color:#a34d39;font-weight:900}.fbNeutral{color:#9aa19a}.tableEmpty{text-align:center!important;color:#7f897d;padding:24px!important}
.qualityEmergencyGrid{display:grid;grid-template-columns:1.15fr .85fr;gap:12px;margin-top:16px}.controlCard,.costCard{background:#fff;border:1px solid #e3e8df;border-radius:18px;padding:18px}.controlCard h3,.costCard h3{margin:5px 0 0;font-size:20px;letter-spacing:-.035em}.cardIntro,.costHead p{margin:6px 0 0;color:#778174;font-size:11px;line-height:1.5}.qualityMetrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin-top:13px}.qualityMetrics .miniMetric{background:#f9fbf8}.qualityBar{height:6px;background:#edf0eb;border-radius:999px;overflow:hidden;margin-top:12px}.qualityBar span{display:block;height:100%;background:#6f7d3c;border-radius:999px}.qualityCaption{font-size:10px;color:#768174;margin-top:6px}.negativeList{margin-top:14px;border-top:1px solid #e8ece5;padding-top:11px}.negativeList>strong{font-size:10px;text-transform:uppercase;letter-spacing:.05em}.negativeList>div{padding:8px 0;border-bottom:1px solid #edf0eb}.negativeList>div:last-child{border-bottom:0}.negativeList span{font-size:9px;color:#899188}.negativeList p{margin:3px 0;font-size:11px;line-height:1.4}.negativeList small{font-size:9px;color:#a06146}.quietState{margin-top:13px;padding:12px;background:#f7f9f6;border-radius:11px;font-size:10px;color:#748072}
.emergencyCard.activeEmergency{border-color:#e8c3b6;background:#fffaf8}.controlRow{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid #edf0eb}.controlRow:last-child{border-bottom:0}.controlRow>div{display:grid;gap:2px}.controlRow>div strong{font-size:11px}.controlRow>div span{font-size:9px;color:#7c8779;line-height:1.35;max-width:430px}.controlRow>button{min-width:78px;border:0;border-radius:999px;padding:7px 9px;font-size:9px;font-weight:900;display:flex;align-items:center;justify-content:center;gap:5px;cursor:pointer}.controlRow>button i{width:7px;height:7px;border-radius:50%}.controlRow>button.on{background:#edf5e8;color:#435331}.controlRow>button.on i{background:#6f7d3c}.controlRow>button.off{background:#eef1f3;color:#69747b}.controlRow>button.off i{background:#9ba4aa}.controlRow>button.danger{background:#fff0eb;color:#9a503b}.controlRow>button.danger i{background:#b85e43}
.costCard{margin-top:12px}.costHead{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.budgetBadge{border-radius:999px;padding:7px 10px;font-size:10px;font-weight:900;white-space:nowrap}.budgetBadge.good{background:#edf5e8;color:#435331}.budgetBadge.watch{background:#f4f5df;color:#6d7128}.budgetBadge.warning{background:#fff4df;color:#8b641e}.budgetBadge.danger{background:#fff0eb;color:#a0503a}.providerGrid{display:grid;grid-template-columns:1.2fr .9fr .9fr;gap:9px;margin-top:14px}.provider{border:1px solid #e3e8df;border-radius:14px;background:#fafbf9;padding:14px;min-width:0}.openaiProvider{background:#f8fafc;border-color:#dce4ea}.providerTop{display:flex;justify-content:space-between;gap:8px;align-items:center}.providerTop strong{font-size:12px}.providerTop span{font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:.05em;color:#7f8b82;background:#eef1ed;border-radius:999px;padding:4px 6px}.providerPrice{font-size:28px;font-weight:950;letter-spacing:-.045em;margin-top:8px}.providerPlan{margin-top:12px;font-size:12px}.provider p{font-size:10px;color:#7a8578;line-height:1.45;min-height:29px}.provider>small{font-size:9px;color:#7e8990}.budgetTrack{height:6px;border-radius:999px;background:#e9edf0;overflow:hidden;margin-top:10px}.budgetTrack span{display:block;height:100%}.budgetTrack span.good{background:#6f7d3c}.budgetTrack span.watch{background:#9a9c45}.budgetTrack span.warning{background:#c58a38}.budgetTrack span.danger{background:#b45e45}.budgetEdit{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:10px}.budgetEdit label{font-size:9px;font-weight:800;color:#647168}.budgetEdit input{width:64px;border:1px solid #dbe2dc;border-radius:8px;padding:5px 6px;font-size:10px}.budgetEdit button{border:0;background:#435331;color:#fff;border-radius:8px;padding:6px 8px;font-size:9px;font-weight:850;cursor:pointer}.providerLinks{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}.providerLinks a{text-decoration:none;border:1px solid #dce2dc;background:#fff;color:#4e6047;border-radius:9px;padding:6px 8px;font-size:9px;font-weight:850}.costFoot{font-size:9px;color:#818b80;line-height:1.5;margin-top:10px}
@media(max-width:980px){.healthGrid,.opsStrip,.pilotSummary{grid-template-columns:repeat(2,minmax(0,1fr))}.qualityEmergencyGrid,.providerGrid{grid-template-columns:1fr}.qualityMetrics{grid-template-columns:repeat(2,minmax(0,1fr))}.pilotHead,.pilotSectionHead,.costHead{display:grid}.pilotHeadActions{justify-content:flex-start}.opsStrip>div:nth-child(2){border-right:0}.opsStrip>div{border-bottom:1px solid #e8ece5}.opsStrip>div:nth-last-child(-n+2){border-bottom:0}}
@media(max-width:600px){.pilotShell{padding:16px 12px}.pilotHead h2{font-size:24px}.healthGrid,.pilotSummary{grid-template-columns:1fr 1fr}.opsStrip{grid-template-columns:1fr 1fr}.pilotFilters{overflow:auto;flex-wrap:nowrap;padding-bottom:2px}.pilotFilters button{white-space:nowrap}.qualityMetrics{grid-template-columns:1fr 1fr}.providerGrid{grid-template-columns:1fr}.controlCard,.costCard{padding:14px}.pilotHeadActions{flex-wrap:wrap}}
`;
