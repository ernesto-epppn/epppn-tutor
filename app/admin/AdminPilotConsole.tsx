"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import AdminManualBenchmark from "./AdminManualBenchmark";

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
  daily_questions: number;
  daily_question_limit: number;
  daily_images: number;
  daily_image_limit: number;
  daily_cost_usd: number;
  rate_violations: number;
  quota_blocked_until?: string | null;
  never_connected: boolean;
  active_7d: boolean;
};

type BenchmarkCase = {
  id: string;
  category: string;
  question: string;
  risk: string;
  expected: string[];
  forbidden: string[];
  source_focus: "pizza" | "pain" | "general";
};

type BenchmarkCatalog = {
  total: number;
  categories: string[];
  cases: BenchmarkCase[];
  batch_limit: number;
  source_status: Array<{
    title: string;
    found: boolean;
    active: boolean;
    status: string;
    chunks: number;
  }>;
};

type BenchmarkResult = {
  id: string;
  category: string;
  question: string;
  risk: string;
  pass: boolean;
  score: number;
  answer: string;
  sources: string[];
  unsupported_numbers: string[];
  brand_hallucination: boolean;
  evaluation: {
    retrieval: number;
    grounding: number;
    technical_coherence: number;
    uncertainty_management: number;
    brand_safety: number;
    summary: string;
    issues: string[];
  };
};

type BenchmarkRun = {
  run_at: string;
  total: number;
  passed: number;
  failed: number;
  pass_rate: number;
  avg_score: number;
  results: BenchmarkResult[];
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
    quota_blocked: number;
    daily_query_limit: number;
    daily_image_limit: number;
    min_interval_seconds: number;
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
    grounding: {
      total: number;
      documented: number;
      contextualize: number;
      insufficient: number;
      documented_rate?: number | null;
    };
    safety: {
      prompt_guard_blocks: number;
      numeric_guard_interventions: number;
    };
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
  const [benchmark, setBenchmark] = useState<BenchmarkCatalog | null>(null);
  const [benchmarkFilter, setBenchmarkFilter] = useState("Tous");
  const [benchmarkBusy, setBenchmarkBusy] = useState("");
  const [benchmarkRun, setBenchmarkRun] = useState<BenchmarkRun | null>(null);
  const [benchmarkError, setBenchmarkError] = useState("");
  const [benchmarkProgress, setBenchmarkProgress] = useState({ done: 0, total: 0 });

  async function accessToken(forceRefresh = false) {
    if (!supabase) return null;

    if (forceRefresh) {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) return null;
      return data.session?.access_token || null;
    }

    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) return null;

    const expiresAtMs = Number(data.session.expires_at || 0) * 1000;
    if (expiresAtMs && expiresAtMs - Date.now() < 120_000) {
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.error) return null;
      return refreshed.data.session?.access_token || null;
    }

    return data.session.access_token;
  }

  async function benchmarkRequest(caseIds: string[]) {
    if (!supabase) throw new Error("Client Supabase indisponible.");

    async function send(forceRefresh = false) {
      const token = await accessToken(forceRefresh);
      if (!token) {
        throw new Error("Session administrateur expirée. Reconnectez-vous puis relancez le benchmark.");
      }

      const response = await fetch("/api/admin/benchmark", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ case_ids: caseIds }),
      });
      const payload = await response.json().catch(() => ({}));
      return { response, payload };
    }

    let attempt = await send(false);
    if (
      attempt.response.status === 401 &&
      (attempt.payload?.error === "invalid_session" || attempt.payload?.error === "auth_required")
    ) {
      attempt = await send(true);
    }

    if (!attempt.response.ok) {
      throw new Error(attempt.payload?.error || "Exécution du benchmark impossible.");
    }
    return attempt.payload as BenchmarkRun;
  }

  function buildBenchmarkRun(results: BenchmarkResult[]): BenchmarkRun {
    const passed = results.filter((item) => item.pass).length;
    const avgScore = results.length
      ? Math.round(results.reduce((sum, item) => sum + item.score, 0) / results.length)
      : 0;

    return {
      run_at: new Date().toISOString(),
      total: results.length,
      passed,
      failed: results.length - passed,
      pass_rate: results.length ? passed / results.length : 0,
      avg_score: avgScore,
      results: [...results],
    };
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

  async function loadBenchmark() {
    if (!supabase) return;
    setBenchmarkError("");
    try {
      const token = await accessToken();
      if (!token) throw new Error("Session administrateur introuvable.");
      const response = await fetch("/api/admin/benchmark", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Benchmark indisponible.");
      setBenchmark(payload as BenchmarkCatalog);
    } catch (err) {
      setBenchmarkError(err instanceof Error ? err.message : "Benchmark indisponible.");
    }
  }

  async function runBenchmark(caseIds: string[]) {
    if (!supabase || !caseIds.length) return;
    const ids = caseIds.slice(0, 3);
    setBenchmarkBusy(ids.join(","));
    setBenchmarkError("");
    try {
      const payload = await benchmarkRequest(ids);
      setBenchmarkRun(payload);
      await loadBenchmark();
    } catch (err) {
      setBenchmarkError(err instanceof Error ? err.message : "Exécution du benchmark impossible.");
    } finally {
      setBenchmarkBusy("");
    }
  }

  async function runFullBenchmark() {
    if (!supabase || !benchmark?.cases?.length) return;
    if (!window.confirm(`Lancer les ${benchmark.cases.length} cas du benchmark technique ? L'opération effectue plusieurs appels OpenAI.`)) return;

    setBenchmarkBusy("ALL");
    setBenchmarkError("");
    setBenchmarkProgress({ done: 0, total: benchmark.cases.length });
    const allResults: BenchmarkResult[] = [];

    try {
      for (let index = 0; index < benchmark.cases.length; index += 3) {
        const batch = benchmark.cases.slice(index, index + 3).map((item) => item.id);
        const payload = await benchmarkRequest(batch);
        allResults.push(...(payload.results || []));

        const done = Math.min(index + batch.length, benchmark.cases.length);
        setBenchmarkProgress({ done, total: benchmark.cases.length });

        // Preserve completed batches immediately, so a later auth/network error
        // never hides the diagnostic results already obtained.
        setBenchmarkRun(buildBenchmarkRun(allResults));
      }

      await loadBenchmark();
    } catch (err) {
      if (allResults.length) setBenchmarkRun(buildBenchmarkRun(allResults));
      setBenchmarkError(err instanceof Error ? err.message : "Exécution complète impossible.");
    } finally {
      setBenchmarkBusy("");
    }
  }

  useEffect(() => {
    void load();
    void loadBenchmark();
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

  const visibleBenchmarkCases = useMemo(() => {
    const cases = benchmark?.cases || [];
    if (benchmarkFilter === "Tous") return cases;
    return cases.filter((item) => item.category === benchmarkFilter);
  }, [benchmark, benchmarkFilter]);

  const benchmarkCategorySummary = useMemo(() => {
    const results = benchmarkRun?.results || [];
    const byCategory = new Map<string, BenchmarkResult[]>();
    for (const result of results) {
      const rows = byCategory.get(result.category) || [];
      rows.push(result);
      byCategory.set(result.category, rows);
    }
    return Array.from(byCategory.entries())
      .map(([category, rows]) => {
        const passed = rows.filter((row) => row.pass).length;
        const average = (key: keyof BenchmarkResult["evaluation"]) => {
          const values = rows
            .map((row) => Number(row.evaluation[key]))
            .filter((value) => Number.isFinite(value));
          return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        };
        const dimensions = [
          { key: "retrieval", label: "retrieval", value: average("retrieval") },
          { key: "grounding", label: "grounding", value: average("grounding") },
          { key: "technical_coherence", label: "cohérence", value: average("technical_coherence") },
          { key: "uncertainty_management", label: "incertitude", value: average("uncertainty_management") },
          { key: "brand_safety", label: "marques", value: average("brand_safety") },
        ].sort((a, b) => a.value - b.value);
        return {
          category,
          total: rows.length,
          passed,
          passRate: rows.length ? passed / rows.length : 0,
          avgScore: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.score, 0) / rows.length) : 0,
          weakest: dimensions[0],
        };
      })
      .sort((a, b) => a.passRate - b.passRate || a.avgScore - b.avgScore);
  }, [benchmarkRun]);

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
          <MiniMetric label="Quota / jour" value={`${data.pilot.daily_query_limit} questions`} />
          <MiniMetric label="Images / jour" value={`${data.pilot.daily_image_limit} demandes`} />
        </div>

        <div className="traineeTableWrap">
          <table className="pilotTable">
            <thead><tr><th>Stagiaire</th><th>Statut</th><th>1er accès</th><th>Dernier accès</th><th>Aujourd’hui</th><th>Accès</th><th>Dossiers</th><th>Questions</th><th>Feedback</th></tr></thead>
            <tbody>
              {visible.map((row) => {
                const quotaBlocked = Boolean(row.quota_blocked_until && new Date(row.quota_blocked_until).getTime() > Date.now());
                const quotaWarning = row.daily_questions >= Math.floor(row.daily_question_limit * 0.8);
                return (
                  <tr key={row.email}>
                    <td><strong>{row.full_name || row.email.split("@")[0]}</strong><small>{row.email}</small></td>
                    <td>
                      <span className={`statusPill status-${row.status}`}>{statusLabel(row.status)}</span>
                      {quotaBlocked ? <small className="quotaBlocked">Anti-abus actif</small> : null}
                    </td>
                    <td>{date(row.first_access_at)}</td>
                    <td>{date(row.last_access_at)}</td>
                    <td>
                      <strong className={quotaWarning ? "quotaWarn" : ""}>{row.daily_questions}/{row.daily_question_limit}</strong>
                      <small>{row.daily_images}/{row.daily_image_limit} images · {money(row.daily_cost_usd)}</small>
                    </td>
                    <td><strong>{row.access_count}</strong><small>{row.accesses_7d ? `${row.accesses_7d} cette semaine` : "—"}</small></td>
                    <td>{row.dossier_count}</td>
                    <td><strong>{row.question_count}</strong>{row.low_rag_questions ? <small className="attention">{row.low_rag_questions} à faible RAG</small> : null}</td>
                    <td><span className="fbGood">+{row.feedback_positive}</span> <span className={row.feedback_negative ? "fbBad" : "fbNeutral"}>−{row.feedback_negative}</span></td>
                  </tr>
                );
              })}
              {!visible.length ? <tr><td colSpan={9} className="tableEmpty">Aucun stagiaire dans ce filtre.</td></tr> : null}
            </tbody>
          </table>
        </div>

        <div className="qualityEmergencyGrid">
          <article className="controlCard qualityCard">
            <div className="cardKicker">Qualité des réponses · 30 jours</div>
            <h3>Ce qu’il faut surveiller</h3>
            <div className="qualityMetrics">
              <MiniMetric label="Réponses suivies" value={data.quality.responses} />
              <MiniMetric label="Documentées" value={pct(data.quality.grounding?.documented_rate)} />
              <MiniMetric label="À contextualiser" value={data.quality.grounding?.contextualize || 0} />
              <MiniMetric label="Référence insuffisante" value={data.quality.grounding?.insufficient || 0} />
            </div>
            <div className="qualityMetrics qualityMetricsSecondary">
              <MiniMetric label="RAG EPPPN utilisé" value={pct(data.quality.retrieval_rate)} />
              <MiniMetric label="Garde-fou numérique" value={data.quality.safety?.numeric_guard_interventions || 0} />
              <MiniMetric label="Prompt injection bloquée" value={data.quality.safety?.prompt_guard_blocks || 0} />
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

        <article className="benchmarkCard">
          <div className="benchmarkHead">
            <div>
              <div className="cardKicker">Benchmark technique EPPPN</div>
              <h3>Contrôle interne des connaissances</h3>
              <p>Tests en français sur levure, hydratation, farine, fermentation, pré-ferments, four, cuisson et diagnostic. Les valeurs non fondées et les marques inventées font échouer le cas.</p>
            </div>
            <div className="benchmarkHeadActions">
              <span className="benchmarkCount">{benchmark?.total || 0} cas</span>
              <button
                type="button"
                className="benchmarkFullButton"
                disabled={!benchmark?.cases?.length || Boolean(benchmarkBusy)}
                onClick={() => void runFullBenchmark()}
              >
                {benchmarkBusy === "ALL"
                  ? `Batterie ${benchmarkProgress.done}/${benchmarkProgress.total}`
                  : "Lancer les 36 cas"}
              </button>
              <button
                type="button"
                disabled={!visibleBenchmarkCases.length || Boolean(benchmarkBusy)}
                onClick={() => void runBenchmark(visibleBenchmarkCases.slice(0, 3).map((item) => item.id))}
              >
                {benchmarkBusy && benchmarkBusy !== "ALL" ? "Test en cours…" : "Tester 3 cas visibles"}
              </button>
            </div>
          </div>

          {benchmarkError ? <div className="benchmarkError">{benchmarkError}</div> : null}

          <div className="sourceStatusGrid">
            {(benchmark?.source_status || []).map((source, index) => (
              <div key={source.title} className={`sourceStatus ${source.active && source.status === "indexed" ? "ready" : source.found ? "pending" : "missing"}`}>
                <span>{index + 1}</span>
                <div><strong>{source.title}</strong><small>{source.active && source.status === "indexed" ? `${source.chunks} fragments · actif` : `${source.status} · ${source.chunks} fragments`}</small></div>
              </div>
            ))}
          </div>

          <div className="benchmarkFilters">
            {["Tous", ...(benchmark?.categories || [])].map((category) => (
              <button
                key={category}
                type="button"
                className={benchmarkFilter === category ? "active" : ""}
                onClick={() => setBenchmarkFilter(category)}
              >
                {category}
              </button>
            ))}
          </div>

          <div className="benchmarkCaseList">
            {visibleBenchmarkCases.map((item) => (
              <div className="benchmarkCase" key={item.id}>
                <div className="benchmarkCaseCode">{item.id}</div>
                <div className="benchmarkCaseBody">
                  <strong>{item.question}</strong>
                  <small>{item.risk}</small>
                </div>
                <button
                  type="button"
                  disabled={Boolean(benchmarkBusy)}
                  onClick={() => void runBenchmark([item.id])}
                >
                  {benchmarkBusy === item.id ? "…" : "Tester"}
                </button>
              </div>
            ))}
            {!visibleBenchmarkCases.length ? <div className="quietState">Aucun cas disponible.</div> : null}
          </div>

          {benchmarkRun ? (
            <div className="benchmarkResults">
              <div className="benchmarkRunSummary">
                <div><span>Réussite</span><strong>{Math.round(benchmarkRun.pass_rate * 100)} %</strong></div>
                <div><span>Score moyen</span><strong>{benchmarkRun.avg_score}/100</strong></div>
                <div><span>PASS</span><strong>{benchmarkRun.passed}</strong></div>
                <div><span>FAIL</span><strong className={benchmarkRun.failed ? "bad" : ""}>{benchmarkRun.failed}</strong></div>
              </div>

              {benchmarkCategorySummary.length > 1 ? (
                <div className="benchmarkDiagnosis">
                  <div className="benchmarkDiagnosisHead">
                    <strong>Diagnostic du corpus</strong>
                    <span>Les catégories les plus faibles apparaissent en premier.</span>
                  </div>
                  <div className="benchmarkDiagnosisGrid">
                    {benchmarkCategorySummary.map((item) => (
                      <div key={item.category} className={item.passRate < 0.75 ? "weak" : item.passRate < 0.9 ? "watch" : "good"}>
                        <strong>{item.category}</strong>
                        <span>{Math.round(item.passRate * 100)} % PASS · {item.avgScore}/100</span>
                        <small>Point le plus faible : {item.weakest.label} · {item.weakest.value.toFixed(1)}/5</small>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {benchmarkRun.results.map((result) => (
                <details key={result.id} className={`benchmarkResult ${result.pass ? "pass" : "fail"}`} open={!result.pass}>
                  <summary>
                    <span>{result.pass ? "PASS" : "FAIL"}</span>
                    <strong>{result.id} · {result.score}/100</strong>
                    <small>{result.evaluation.summary}</small>
                  </summary>
                  <div className="benchmarkResultBody">
                    <p><b>Question</b>{result.question}</p>
                    <p><b>Sources récupérées</b>{result.sources.length ? result.sources.join(" → ") : "Aucune"}</p>
                    {result.unsupported_numbers.length ? <p className="benchmarkAlert"><b>Valeurs non fondées</b>{result.unsupported_numbers.join(", ")}</p> : null}
                    {result.brand_hallucination ? <p className="benchmarkAlert"><b>Marque inventée</b>Détection d’une référence matériel absente du contexte.</p> : null}
                    {result.evaluation.issues.length ? (
                      <div className="benchmarkIssues"><b>Points à corriger</b>{result.evaluation.issues.map((issue, index) => <span key={index}>{issue}</span>)}</div>
                    ) : null}
                    <div className="benchmarkScores">
                      <span>Retrieval {result.evaluation.retrieval}/5</span>
                      <span>Grounding {result.evaluation.grounding}/5</span>
                      <span>Cohérence {result.evaluation.technical_coherence}/5</span>
                      <span>Incertitude {result.evaluation.uncertainty_management}/5</span>
                      <span>Marques {result.evaluation.brand_safety}/5</span>
                    </div>
                    <details className="benchmarkAnswer"><summary>Voir la réponse testée</summary><p>{result.answer}</p></details>
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <div className="benchmarkEmpty">Aucun benchmark exécuté dans cette session admin.</div>
          )}
        </article>

        <AdminManualBenchmark />

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
.traineeTableWrap{margin-top:10px;border:1px solid #e2e7df;border-radius:17px;overflow:auto;background:#fff}.pilotTable{width:100%;border-collapse:collapse;min-width:1120px}.pilotTable th{font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#778174;text-align:left;background:#f8faf7;padding:9px 11px;border-bottom:1px solid #e5e9e2}.pilotTable td{font-size:11px;padding:10px 11px;border-bottom:1px solid #edf0eb;vertical-align:middle}.pilotTable tbody tr:last-child td{border-bottom:0}.pilotTable td strong{font-size:11px}.pilotTable td small{display:block;margin-top:2px;color:#839083;font-size:9px}.pilotTable td small.attention{color:#a0632d}.pilotTable .quotaWarn{color:#a0632d}.pilotTable td small.quotaBlocked{color:#a34d39;font-weight:900}.statusPill{display:inline-flex;padding:5px 7px;border-radius:999px;font-size:9px;font-weight:900}.status-active{background:#edf5e8;color:#435331}.status-invited{background:#f1f3f5;color:#66717a}.status-paused{background:#fff5df;color:#8d6619}.status-blocked,.status-expired{background:#fff0eb;color:#9a503b}.fbGood{color:#536c3a;font-weight:900}.fbBad{color:#a34d39;font-weight:900}.fbNeutral{color:#9aa19a}.tableEmpty{text-align:center!important;color:#7f897d;padding:24px!important}
.qualityEmergencyGrid{display:grid;grid-template-columns:1.15fr .85fr;gap:12px;margin-top:16px}.controlCard,.costCard{background:#fff;border:1px solid #e3e8df;border-radius:18px;padding:18px}.controlCard h3,.costCard h3{margin:5px 0 0;font-size:20px;letter-spacing:-.035em}.cardIntro,.costHead p{margin:6px 0 0;color:#778174;font-size:11px;line-height:1.5}.qualityMetrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin-top:13px}.qualityMetricsSecondary{margin-top:7px}.qualityMetrics .miniMetric{background:#f9fbf8}.qualityBar{height:6px;background:#edf0eb;border-radius:999px;overflow:hidden;margin-top:12px}.qualityBar span{display:block;height:100%;background:#6f7d3c;border-radius:999px}.qualityCaption{font-size:10px;color:#768174;margin-top:6px}.negativeList{margin-top:14px;border-top:1px solid #e8ece5;padding-top:11px}.negativeList>strong{font-size:10px;text-transform:uppercase;letter-spacing:.05em}.negativeList>div{padding:8px 0;border-bottom:1px solid #edf0eb}.negativeList>div:last-child{border-bottom:0}.negativeList span{font-size:9px;color:#899188}.negativeList p{margin:3px 0;font-size:11px;line-height:1.4}.negativeList small{font-size:9px;color:#a06146}.quietState{margin-top:13px;padding:12px;background:#f7f9f6;border-radius:11px;font-size:10px;color:#748072}
.emergencyCard.activeEmergency{border-color:#e8c3b6;background:#fffaf8}.controlRow{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid #edf0eb}.controlRow:last-child{border-bottom:0}.controlRow>div{display:grid;gap:2px}.controlRow>div strong{font-size:11px}.controlRow>div span{font-size:9px;color:#7c8779;line-height:1.35;max-width:430px}.controlRow>button{min-width:78px;border:0;border-radius:999px;padding:7px 9px;font-size:9px;font-weight:900;display:flex;align-items:center;justify-content:center;gap:5px;cursor:pointer}.controlRow>button i{width:7px;height:7px;border-radius:50%}.controlRow>button.on{background:#edf5e8;color:#435331}.controlRow>button.on i{background:#6f7d3c}.controlRow>button.off{background:#eef1f3;color:#69747b}.controlRow>button.off i{background:#9ba4aa}.controlRow>button.danger{background:#fff0eb;color:#9a503b}.controlRow>button.danger i{background:#b85e43}
.benchmarkCard{margin-top:16px;background:#fff;border:1px solid #e3e8df;border-radius:18px;padding:18px}.benchmarkHead{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.benchmarkHead h3{margin:5px 0 0;font-size:20px;letter-spacing:-.035em}.benchmarkHead p{margin:6px 0 0;max-width:790px;color:#778174;font-size:11px;line-height:1.5}.benchmarkHeadActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}.benchmarkCount{border-radius:999px;background:#eef3e9;color:#53653d;padding:7px 10px;font-size:10px;font-weight:900}.benchmarkHeadActions button,.benchmarkCase>button{border:0;background:#435331;color:#fff;border-radius:9px;padding:8px 10px;font-size:9px;font-weight:900;cursor:pointer}.benchmarkHeadActions .benchmarkFullButton{background:#172132}.benchmarkDiagnosis{margin-top:10px;border:1px solid #e2e8df;border-radius:12px;padding:10px;background:#fafbf9}.benchmarkDiagnosisHead{display:flex;justify-content:space-between;gap:10px;align-items:center}.benchmarkDiagnosisHead strong{font-size:10px}.benchmarkDiagnosisHead span{font-size:8px;color:#7d877c}.benchmarkDiagnosisGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:8px}.benchmarkDiagnosisGrid>div{border-radius:9px;padding:8px;border:1px solid #e3e7e1;background:#fff}.benchmarkDiagnosisGrid>div.weak{border-color:#eccdc4;background:#fff7f4}.benchmarkDiagnosisGrid>div.watch{border-color:#eadfca;background:#fffbf3}.benchmarkDiagnosisGrid>div.good{border-color:#d8e5d1;background:#f8fbf6}.benchmarkDiagnosisGrid strong{display:block;font-size:9px}.benchmarkDiagnosisGrid span{display:block;margin-top:3px;font-size:9px;font-weight:850}.benchmarkDiagnosisGrid small{display:block;margin-top:3px;font-size:8px;color:#778174}.benchmarkHeadActions button:disabled,.benchmarkCase>button:disabled{opacity:.55;cursor:default}.benchmarkError{margin-top:12px;padding:10px 12px;border-radius:11px;background:#fff0eb;color:#99513d;font-size:10px;font-weight:800}.sourceStatusGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin-top:14px}.sourceStatus{display:flex;gap:8px;align-items:center;border:1px solid #e4e9e1;border-radius:12px;padding:9px;background:#fafbf9;min-width:0}.sourceStatus>span{width:22px;height:22px;display:grid;place-items:center;border-radius:50%;background:#edf1ea;font-size:9px;font-weight:950}.sourceStatus>div{min-width:0}.sourceStatus strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:9px}.sourceStatus small{display:block;margin-top:2px;font-size:8px;color:#7b8579}.sourceStatus.ready{border-color:#d6e4ce;background:#f8fbf6}.sourceStatus.ready>span{background:#e5f0df;color:#486039}.sourceStatus.pending{border-color:#eadfca;background:#fffaf2}.sourceStatus.pending>span{background:#f6ead6;color:#8a6323}.sourceStatus.missing{border-color:#ead8d2;background:#fff8f5}.sourceStatus.missing>span{background:#f5e4df;color:#98523e}.benchmarkFilters{display:flex;gap:5px;overflow:auto;padding:12px 0 5px}.benchmarkFilters button{white-space:nowrap;border:1px solid #dce2d8;background:#fff;color:#657064;border-radius:999px;padding:6px 9px;font-size:9px;font-weight:850;cursor:pointer}.benchmarkFilters button.active{background:#435331;color:#fff;border-color:#435331}.benchmarkCaseList{margin-top:6px;border:1px solid #e5e9e2;border-radius:14px;overflow:auto;max-height:360px}.benchmarkCase{display:grid;grid-template-columns:54px 1fr auto;gap:10px;align-items:center;padding:10px 11px;border-bottom:1px solid #edf0eb}.benchmarkCase:last-child{border-bottom:0}.benchmarkCaseCode{font-size:9px;font-weight:950;color:#637243;background:#eef3e9;border-radius:7px;padding:5px 6px;text-align:center}.benchmarkCaseBody{min-width:0}.benchmarkCaseBody strong{display:block;font-size:10px;line-height:1.35}.benchmarkCaseBody small{display:block;margin-top:3px;color:#818a81;font-size:8px}.benchmarkResults{margin-top:14px;border-top:1px solid #e8ece5;padding-top:13px}.benchmarkRunSummary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.benchmarkRunSummary>div{background:#f8faf7;border-radius:10px;padding:9px}.benchmarkRunSummary span{display:block;font-size:8px;text-transform:uppercase;font-weight:900;color:#7b8578}.benchmarkRunSummary strong{display:block;margin-top:3px;font-size:17px}.benchmarkRunSummary strong.bad{color:#a6533d}.benchmarkResult{margin-top:8px;border:1px solid #e3e8df;border-radius:12px;overflow:hidden}.benchmarkResult.pass{border-left:4px solid #6f7d3c}.benchmarkResult.fail{border-left:4px solid #b65c43}.benchmarkResult>summary{cursor:pointer;display:grid;grid-template-columns:48px 110px 1fr;gap:8px;align-items:center;padding:9px 10px;background:#fafbf9}.benchmarkResult>summary>span{font-size:8px;font-weight:950}.benchmarkResult.pass>summary>span{color:#526a3b}.benchmarkResult.fail>summary>span{color:#a4513c}.benchmarkResult>summary>strong{font-size:10px}.benchmarkResult>summary>small{font-size:9px;color:#778174}.benchmarkResultBody{padding:11px}.benchmarkResultBody p{margin:0 0 8px;font-size:10px;line-height:1.45}.benchmarkResultBody p b,.benchmarkIssues>b{display:block;font-size:8px;text-transform:uppercase;letter-spacing:.05em;color:#758174;margin-bottom:2px}.benchmarkAlert{background:#fff5f1;border-radius:8px;padding:8px!important;color:#914d3a}.benchmarkIssues{display:grid;gap:4px;margin-top:7px}.benchmarkIssues span{font-size:9px;background:#f6f8f5;border-radius:7px;padding:6px 7px}.benchmarkScores{display:flex;gap:5px;flex-wrap:wrap;margin-top:9px}.benchmarkScores span{background:#eef2ed;border-radius:999px;padding:4px 6px;font-size:8px;font-weight:850;color:#5f6c5d}.benchmarkAnswer{margin-top:9px;border-top:1px solid #edf0eb;padding-top:8px}.benchmarkAnswer summary{font-size:9px;font-weight:900;cursor:pointer}.benchmarkAnswer p{white-space:pre-wrap;margin-top:7px!important}.benchmarkEmpty{margin-top:12px;background:#f8faf7;border-radius:10px;padding:11px;color:#788376;font-size:9px}
.costCard{margin-top:12px}.costHead{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.budgetBadge{border-radius:999px;padding:7px 10px;font-size:10px;font-weight:900;white-space:nowrap}.budgetBadge.good{background:#edf5e8;color:#435331}.budgetBadge.watch{background:#f4f5df;color:#6d7128}.budgetBadge.warning{background:#fff4df;color:#8b641e}.budgetBadge.danger{background:#fff0eb;color:#a0503a}.providerGrid{display:grid;grid-template-columns:1.2fr .9fr .9fr;gap:9px;margin-top:14px}.provider{border:1px solid #e3e8df;border-radius:14px;background:#fafbf9;padding:14px;min-width:0}.openaiProvider{background:#f8fafc;border-color:#dce4ea}.providerTop{display:flex;justify-content:space-between;gap:8px;align-items:center}.providerTop strong{font-size:12px}.providerTop span{font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:.05em;color:#7f8b82;background:#eef1ed;border-radius:999px;padding:4px 6px}.providerPrice{font-size:28px;font-weight:950;letter-spacing:-.045em;margin-top:8px}.providerPlan{margin-top:12px;font-size:12px}.provider p{font-size:10px;color:#7a8578;line-height:1.45;min-height:29px}.provider>small{font-size:9px;color:#7e8990}.budgetTrack{height:6px;border-radius:999px;background:#e9edf0;overflow:hidden;margin-top:10px}.budgetTrack span{display:block;height:100%}.budgetTrack span.good{background:#6f7d3c}.budgetTrack span.watch{background:#9a9c45}.budgetTrack span.warning{background:#c58a38}.budgetTrack span.danger{background:#b45e45}.budgetEdit{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:10px}.budgetEdit label{font-size:9px;font-weight:800;color:#647168}.budgetEdit input{width:64px;border:1px solid #dbe2dc;border-radius:8px;padding:5px 6px;font-size:10px}.budgetEdit button{border:0;background:#435331;color:#fff;border-radius:8px;padding:6px 8px;font-size:9px;font-weight:850;cursor:pointer}.providerLinks{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}.providerLinks a{text-decoration:none;border:1px solid #dce2dc;background:#fff;color:#4e6047;border-radius:9px;padding:6px 8px;font-size:9px;font-weight:850}.costFoot{font-size:9px;color:#818b80;line-height:1.5;margin-top:10px}
@media(max-width:980px){.healthGrid,.opsStrip,.pilotSummary{grid-template-columns:repeat(2,minmax(0,1fr))}.sourceStatusGrid{grid-template-columns:repeat(2,minmax(0,1fr))}.benchmarkDiagnosisGrid{grid-template-columns:repeat(2,minmax(0,1fr))}.benchmarkHead{display:grid}.benchmarkHeadActions{justify-content:flex-start}.benchmarkResult>summary{grid-template-columns:45px 95px 1fr}.qualityEmergencyGrid,.providerGrid{grid-template-columns:1fr}.qualityMetrics{grid-template-columns:repeat(2,minmax(0,1fr))}.pilotHead,.pilotSectionHead,.costHead{display:grid}.pilotHeadActions{justify-content:flex-start}.opsStrip>div:nth-child(2){border-right:0}.opsStrip>div{border-bottom:1px solid #e8ece5}.opsStrip>div:nth-last-child(-n+2){border-bottom:0}}
@media(max-width:600px){.pilotShell{padding:16px 12px}.benchmarkDiagnosisGrid{grid-template-columns:1fr}.benchmarkDiagnosisHead{display:grid}.pilotHead h2{font-size:24px}.healthGrid,.pilotSummary{grid-template-columns:1fr 1fr}.opsStrip{grid-template-columns:1fr 1fr}.pilotFilters{overflow:auto;flex-wrap:nowrap;padding-bottom:2px}.pilotFilters button{white-space:nowrap}.qualityMetrics{grid-template-columns:1fr 1fr}.providerGrid{grid-template-columns:1fr}.controlCard,.costCard{padding:14px}.pilotHeadActions{flex-wrap:wrap}}
`;
