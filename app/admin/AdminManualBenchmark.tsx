"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";

type ManualCase = {
  id: number;
  title?: string | null;
  category: string;
  mode: "ACTION" | "ANALYSE";
  question: string;
  reference_answer: string;
  required_points: string[];
  forbidden_points: string[];
  created_at: string;
  updated_at: string;
  last_run_at?: string | null;
  last_pass?: boolean | null;
  last_score?: number | null;
  last_reference_score?: number | null;
  last_reliability_score?: number | null;
  last_result?: ManualResult | null;
};

type ManualResult = {
  pass: boolean;
  score: number;
  reference_score: number;
  reliability_score: number;
  mode: "ACTION" | "ANALYSE";
  question: string;
  reference_answer: string;
  ernesto_answer: string;
  sources: string[];
  grounding_status?: string | null;
  grounding_source?: string | null;
  unsupported_numbers: string[];
  reference_unsupported_numbers: string[];
  numeric_guard_triggered: boolean;
  dimensions: {
    reference_concordance: number;
    essential_coverage: number;
    contradiction_safety: number;
    grounding: number;
    technical_coherence: number;
    uncertainty_management: number;
    numeric_safety: number;
    unsupported_additions_safety: number;
  };
  analysis: {
    summary: string;
    concordant_points: string[];
    missing_points: string[];
    contradictions: string[];
    unsupported_additions: string[];
    reference_tensions: string[];
  };
};

function lines(value: string) {
  return value
    .split("\n")
    .map((item) => item.replace(/^[-•]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

function formatDate(value?: string | null) {
  if (!value) return "Jamais testé";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Jamais testé";
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminManualBenchmark() {
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return url && anon ? createClient(url, anon) : null;
  }, []);

  const [cases, setCases] = useState<ManualCase[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Expert");
  const [mode, setMode] = useState<"ACTION" | "ANALYSE">("ACTION");
  const [question, setQuestion] = useState("");
  const [reference, setReference] = useState("");
  const [required, setRequired] = useState("");
  const [forbidden, setForbidden] = useState("");
  const [result, setResult] = useState<ManualResult | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [batch, setBatch] = useState({ done: 0, total: 0 });

  async function token(forceRefresh = false) {
    if (!supabase) return null;
    if (forceRefresh) {
      const refreshed = await supabase.auth.refreshSession();
      return refreshed.data.session?.access_token || null;
    }
    const session = await supabase.auth.getSession();
    const current = session.data.session;
    if (!current) return null;
    const expiresAt = Number(current.expires_at || 0) * 1000;
    if (expiresAt && expiresAt - Date.now() < 120_000) {
      const refreshed = await supabase.auth.refreshSession();
      return refreshed.data.session?.access_token || null;
    }
    return current.access_token;
  }

  async function request(body?: Record<string, unknown>, method = "POST") {
    async function send(refresh = false) {
      const accessToken = await token(refresh);
      if (!accessToken) throw new Error("Session administrateur expirée.");
      const response = await fetch("/api/admin/benchmark-manual", {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        ...(method === "POST" ? { body: JSON.stringify(body || {}) } : {}),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      return { response, payload };
    }

    let attempt = await send(false);
    if (attempt.response.status === 401) attempt = await send(true);
    if (!attempt.response.ok) {
      throw new Error(attempt.payload?.error || "Benchmark expert indisponible.");
    }
    return attempt.payload;
  }

  async function loadCases() {
    try {
      const payload = await request(undefined, "GET");
      setCases(Array.isArray(payload.cases) ? payload.cases : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    }
  }

  useEffect(() => {
    void loadCases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function formPayload(id = currentId) {
    return {
      ...(id ? { id } : {}),
      title: title.trim(),
      category: category.trim() || "Expert",
      mode,
      question: question.trim(),
      reference_answer: reference.trim(),
      required_points: lines(required),
      forbidden_points: lines(forbidden),
    };
  }

  async function runDraft() {
    if (!question.trim() || !reference.trim()) {
      setError("Ajoutez une question et une réponse de référence.");
      return;
    }
    setBusy("run");
    setError("");
    try {
      const payload = await request({ action: "run", ...formPayload() });
      setResult(payload.result as ManualResult);
      if (currentId) await loadCases();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test impossible.");
    } finally {
      setBusy("");
    }
  }

  async function saveCase() {
    if (!question.trim() || !reference.trim()) {
      setError("Ajoutez une question et une réponse de référence.");
      return;
    }
    setBusy("save");
    setError("");
    try {
      const payload = await request({
        action: "save",
        ...formPayload(),
        last_result: result,
      });
      const saved = payload.case as ManualCase;
      setCurrentId(Number(saved.id));
      await loadCases();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setBusy("");
    }
  }

  function editCase(item: ManualCase) {
    setCurrentId(item.id);
    setTitle(item.title || "");
    setCategory(item.category || "Expert");
    setMode(item.mode || "ACTION");
    setQuestion(item.question || "");
    setReference(item.reference_answer || "");
    setRequired((item.required_points || []).join("\n"));
    setForbidden((item.forbidden_points || []).join("\n"));
    setResult(item.last_result || null);
    setError("");
  }

  function clearForm() {
    setCurrentId(null);
    setTitle("");
    setCategory("Expert");
    setMode("ACTION");
    setQuestion("");
    setReference("");
    setRequired("");
    setForbidden("");
    setResult(null);
    setError("");
  }

  async function runSaved(item: ManualCase) {
    setBusy(`case-${item.id}`);
    setError("");
    try {
      const payload = await request({
        action: "run",
        id: item.id,
        title: item.title || "",
        category: item.category,
        mode: item.mode,
        question: item.question,
        reference_answer: item.reference_answer,
        required_points: item.required_points || [],
        forbidden_points: item.forbidden_points || [],
      });
      setResult(payload.result as ManualResult);
      editCase({ ...item, last_result: payload.result });
      await loadCases();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test impossible.");
    } finally {
      setBusy("");
    }
  }

  async function runAllExperts() {
    if (!cases.length) return;
    if (!window.confirm(`Tester les ${cases.length} cas experts permanents ?`)) return;
    setBusy("all");
    setError("");
    setBatch({ done: 0, total: cases.length });
    try {
      for (let index = 0; index < cases.length; index += 1) {
        const item = cases[index];
        await request({
          action: "run",
          id: item.id,
          title: item.title || "",
          category: item.category,
          mode: item.mode,
          question: item.question,
          reference_answer: item.reference_answer,
          required_points: item.required_points || [],
          forbidden_points: item.forbidden_points || [],
        });
        setBatch({ done: index + 1, total: cases.length });
      }
      await loadCases();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batterie expert interrompue.");
    } finally {
      setBusy("");
    }
  }

  async function removeCase(item: ManualCase) {
    if (!window.confirm(`Retirer « ${item.title || item.question.slice(0, 70)} » du benchmark permanent ?`)) {
      return;
    }
    setBusy(`delete-${item.id}`);
    setError("");
    try {
      await request({ action: "delete", id: item.id });
      if (currentId === item.id) clearForm();
      await loadCases();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible.");
    } finally {
      setBusy("");
    }
  }

  const expertStats = useMemo(() => {
    const tested = cases.filter((item) => item.last_score != null);
    const passed = tested.filter((item) => item.last_pass === true).length;
    const avg = tested.length
      ? Math.round(
          tested.reduce((sum, item) => sum + Number(item.last_score || 0), 0) / tested.length
        )
      : null;
    return { tested: tested.length, passed, avg };
  }, [cases]);

  return (
    <article className="manualBench">
      <style>{manualCss}</style>

      <div className="manualHead">
        <div>
          <span>Gold standard expert · backoffice</span>
          <h3>Tests manuels de cohérence</h3>
          <p>
            Comparez la réponse réelle d’Ernesto à votre réponse de référence. La formulation peut
            différer : le test évalue le sens technique, le grounding et les contradictions.
          </p>
        </div>
        <div className="manualHeadActions">
          <span className="manualCount">36 base + {cases.length} expert{cases.length === 1 ? "" : "s"}</span>
          <button type="button" className="dark" onClick={() => void runAllExperts()} disabled={!cases.length || Boolean(busy)}>
            {busy === "all" ? `Experts ${batch.done}/${batch.total}` : "Tester tous les experts"}
          </button>
          <button type="button" onClick={clearForm} disabled={Boolean(busy)}>Nouveau cas</button>
        </div>
      </div>

      {error ? <div className="manualError">{error}</div> : null}

      <div className="manualStats">
        <div><span>Cas experts</span><strong>{cases.length}</strong></div>
        <div><span>Testés</span><strong>{expertStats.tested}</strong></div>
        <div><span>PASS</span><strong>{expertStats.passed}</strong></div>
        <div><span>Score moyen</span><strong>{expertStats.avg == null ? "—" : `${expertStats.avg}/100`}</strong></div>
      </div>

      <div className="manualForm">
        <div className="manualMeta">
          <label>Titre<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ex. Biga trop mûre" /></label>
          <label>Catégorie<input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Expert" /></label>
          <label>Mode
            <select value={mode} onChange={(e) => setMode(e.target.value === "ANALYSE" ? "ANALYSE" : "ACTION")}>
              <option value="ACTION">Action</option>
              <option value="ANALYSE">Analyse</option>
            </select>
          </label>
        </div>

        <div className="manualMainFields">
          <label>
            <span>Question à Ernesto</span>
            <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Votre question technique…" />
          </label>
          <label>
            <span>Réponse de référence</span>
            <textarea value={reference} onChange={(e) => setReference(e.target.value)} placeholder="La réponse que vous considérez techniquement correcte…" />
          </label>
        </div>

        <div className="manualOptional">
          <label>
            <span>Éléments indispensables <small>optionnel · un par ligne</small></span>
            <textarea value={required} onChange={(e) => setRequired(e.target.value)} placeholder={"Contrôler la température réelle de pâte\nNe pas augmenter automatiquement la levure"} />
          </label>
          <label>
            <span>Éléments interdits <small>optionnel · un par ligne</small></span>
            <textarea value={forbidden} onChange={(e) => setForbidden(e.target.value)} placeholder={"Donner un dosage arbitraire\nAttribuer une cause unique sans contrôle"} />
          </label>
        </div>

        <div className="manualActions">
          <button type="button" className="primary" onClick={() => void runDraft()} disabled={Boolean(busy)}>
            {busy === "run" ? "Comparaison en cours…" : "Tester Ernesto"}
          </button>
          <button type="button" onClick={() => void saveCase()} disabled={Boolean(busy)}>
            {busy === "save" ? "Enregistrement…" : currentId ? "Mettre à jour le cas permanent" : "Ajouter au benchmark permanent"}
          </button>
          {currentId ? <span>Cas expert #{currentId}</span> : null}
        </div>
      </div>

      {result ? (
        <div className={`manualResult ${result.pass ? "pass" : "fail"}`}>
          <div className="manualScoreHead">
            <div className="manualVerdict"><span>{result.pass ? "PASS" : "FAIL"}</span><strong>{result.score}/100</strong></div>
            <div><span>Concordance référence</span><strong>{result.reference_score}/100</strong></div>
            <div><span>Fiabilité Ernesto</span><strong>{result.reliability_score}/100</strong></div>
            <div><span>Grounding interne</span><strong>{result.grounding_status || "—"}</strong></div>
          </div>

          <p className="manualSummary">{result.analysis.summary}</p>

          <div className="manualDimensions">
            <span>Concordance {result.dimensions.reference_concordance}/5</span>
            <span>Couverture {result.dimensions.essential_coverage}/5</span>
            <span>Contradictions {result.dimensions.contradiction_safety}/5</span>
            <span>Grounding {result.dimensions.grounding}/5</span>
            <span>Cohérence {result.dimensions.technical_coherence}/5</span>
            <span>Incertitude {result.dimensions.uncertainty_management}/5</span>
            <span>Sécurité numérique {result.dimensions.numeric_safety}/5</span>
            <span>Ajouts {result.dimensions.unsupported_additions_safety}/5</span>
          </div>

          <div className="manualCompare">
            <section><span>Réponse de référence</span><div>{result.reference_answer}</div></section>
            <section><span>Réponse Ernesto</span><div>{result.ernesto_answer}</div></section>
          </div>

          <div className="manualAnalysisGrid">
            <AnalysisBox title="Points concordants" items={result.analysis.concordant_points} tone="good" />
            <AnalysisBox title="Éléments manquants" items={result.analysis.missing_points} tone="watch" />
            <AnalysisBox title="Contradictions" items={result.analysis.contradictions} tone="bad" />
            <AnalysisBox title="Ajouts non fondés" items={result.analysis.unsupported_additions} tone="bad" />
          </div>

          {result.reference_unsupported_numbers.length || result.analysis.reference_tensions.length ? (
            <div className="referenceTension">
              <strong>Contrôle de la référence experte</strong>
              {result.reference_unsupported_numbers.length ? (
                <p>Valeurs absentes du corpus récupéré : {result.reference_unsupported_numbers.join(", ")}</p>
              ) : null}
              {result.analysis.reference_tensions.map((item, index) => <p key={index}>{item}</p>)}
            </div>
          ) : null}

          <div className="manualSources">
            <strong>Sources récupérées</strong>
            <span>{result.sources.length ? result.sources.join(" → ") : "Aucune source récupérée"}</span>
          </div>
        </div>
      ) : null}

      <div className="manualSavedHead">
        <div><span>Cas experts permanents</span><strong>{cases.length}</strong></div>
        <small>Ils restent séparés des 36 cas de base afin de conserver un benchmark standard stable.</small>
      </div>

      <div className="manualSavedList">
        {cases.map((item) => (
          <div key={item.id} className="manualSavedCase">
            <div className={`manualSavedStatus ${item.last_pass === true ? "pass" : item.last_pass === false ? "fail" : ""}`}>
              {item.last_score == null ? "—" : item.last_score}
            </div>
            <div className="manualSavedBody">
              <strong>{item.title || item.question}</strong>
              <span>{item.category} · {item.mode === "ANALYSE" ? "Analyse" : "Action"} · {formatDate(item.last_run_at)}</span>
              <p>{item.question}</p>
            </div>
            <div className="manualSavedScores">
              <span>Réf. {item.last_reference_score == null ? "—" : item.last_reference_score}</span>
              <span>Fiab. {item.last_reliability_score == null ? "—" : item.last_reliability_score}</span>
            </div>
            <div className="manualSavedActions">
              <button type="button" onClick={() => void runSaved(item)} disabled={Boolean(busy)}>
                {busy === `case-${item.id}` ? "…" : "Tester"}
              </button>
              <button type="button" onClick={() => editCase(item)} disabled={Boolean(busy)}>Éditer</button>
              <button type="button" className="remove" onClick={() => void removeCase(item)} disabled={Boolean(busy)}>
                {busy === `delete-${item.id}` ? "…" : "Retirer"}
              </button>
            </div>
          </div>
        ))}
        {!cases.length ? <div className="manualEmpty">Aucun cas expert permanent pour le moment.</div> : null}
      </div>
    </article>
  );
}

function AnalysisBox({ title, items, tone }: { title: string; items: string[]; tone: "good" | "watch" | "bad" }) {
  return (
    <div className={`analysisBox ${tone}`}>
      <strong>{title}</strong>
      {items.length ? items.map((item, index) => <p key={index}>{item}</p>) : <p>Aucun élément significatif.</p>}
    </div>
  );
}

const manualCss = `
.manualBench{margin-top:16px;background:#fff;border:1px solid #e3e8df;border-radius:18px;padding:18px;color:#172132}
.manualHead{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.manualHead>div:first-child>span,.manualSavedHead span{font-size:10px;font-weight:950;letter-spacing:.1em;text-transform:uppercase;color:#6f7d3c}.manualHead h3{margin:5px 0 0;font-size:20px;letter-spacing:-.035em}.manualHead p{margin:6px 0 0;max-width:800px;color:#778174;font-size:11px;line-height:1.5}.manualHeadActions{display:flex;gap:7px;align-items:center;flex-wrap:wrap;justify-content:flex-end}.manualHeadActions button,.manualActions button,.manualSavedActions button{border:1px solid #dce2d8;background:#fff;color:#435331;border-radius:9px;padding:8px 10px;font-size:9px;font-weight:900;cursor:pointer}.manualHeadActions button.dark,.manualActions button.primary{background:#172132;color:#fff;border-color:#172132}.manualHeadActions button:disabled,.manualActions button:disabled,.manualSavedActions button:disabled{opacity:.5;cursor:default}.manualCount{border-radius:999px;background:#eef3e9;color:#53653d;padding:7px 10px;font-size:10px;font-weight:900}.manualError{margin-top:12px;padding:10px 12px;border-radius:11px;background:#fff0eb;color:#99513d;font-size:10px;font-weight:800}
.manualStats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin-top:14px}.manualStats>div{background:#f8faf7;border-radius:10px;padding:9px}.manualStats span{display:block;font-size:8px;text-transform:uppercase;font-weight:900;color:#7b8578}.manualStats strong{display:block;margin-top:3px;font-size:17px}.manualForm{margin-top:13px;border:1px solid #e5e9e2;border-radius:14px;padding:13px;background:#fafbf9}.manualForm label{display:grid;gap:5px;font-size:9px;font-weight:900;color:#667160}.manualForm input,.manualForm textarea,.manualForm select{width:100%;border:1px solid #dce2d8;border-radius:9px;background:#fff;color:#172132;padding:9px;font:inherit;outline-color:#6f7d3c}.manualForm textarea{resize:vertical;min-height:110px;line-height:1.45;font-size:11px}.manualMeta{display:grid;grid-template-columns:1.4fr .7fr .5fr;gap:8px}.manualMainFields,.manualOptional{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:10px}.manualMainFields textarea{min-height:170px}.manualOptional textarea{min-height:80px}.manualOptional small{font-weight:600;color:#919991}.manualActions{display:flex;gap:7px;align-items:center;margin-top:10px;flex-wrap:wrap}.manualActions>span{font-size:9px;color:#7b8578;font-weight:850}
.manualResult{margin-top:14px;border:1px solid #e3e8df;border-left-width:4px;border-radius:14px;padding:13px}.manualResult.pass{border-left-color:#6f7d3c}.manualResult.fail{border-left-color:#b65c43}.manualScoreHead{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.manualScoreHead>div{background:#f8faf7;border-radius:10px;padding:9px}.manualScoreHead span{display:block;font-size:8px;text-transform:uppercase;font-weight:900;color:#7b8578}.manualScoreHead strong{display:block;margin-top:3px;font-size:16px}.manualVerdict strong{font-size:22px}.manualResult.pass .manualVerdict span{color:#526a3b}.manualResult.fail .manualVerdict span{color:#a4513c}.manualSummary{font-size:11px;line-height:1.5;margin:11px 0 0}.manualDimensions{display:flex;gap:5px;flex-wrap:wrap;margin-top:9px}.manualDimensions span{background:#eef2ed;border-radius:999px;padding:5px 7px;font-size:8px;font-weight:850;color:#5f6c5d}.manualCompare{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:12px}.manualCompare section{border:1px solid #e5e9e2;border-radius:11px;overflow:hidden}.manualCompare section>span{display:block;background:#f3f6f1;padding:7px 9px;font-size:8px;font-weight:950;text-transform:uppercase;color:#6d786b}.manualCompare section>div{white-space:pre-wrap;padding:10px;font-size:10px;line-height:1.55;max-height:360px;overflow:auto}.manualAnalysisGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:9px}.analysisBox{border-radius:10px;padding:9px;border:1px solid #e6eae4}.analysisBox.good{background:#f8fbf6;border-color:#d8e5d1}.analysisBox.watch{background:#fffbf3;border-color:#eadfca}.analysisBox.bad{background:#fff7f4;border-color:#eccdc4}.analysisBox strong{font-size:9px}.analysisBox p{margin:4px 0 0;font-size:9px;line-height:1.4}.referenceTension{margin-top:9px;padding:9px;border-radius:10px;background:#fffaf2;border:1px solid #eadfca}.referenceTension strong{font-size:9px}.referenceTension p{margin:4px 0 0;font-size:9px}.manualSources{display:flex;gap:8px;align-items:flex-start;margin-top:9px;padding-top:8px;border-top:1px solid #edf0eb;font-size:9px}.manualSources strong{white-space:nowrap}.manualSources span{color:#758074}
.manualSavedHead{display:flex;justify-content:space-between;gap:12px;align-items:end;margin-top:18px}.manualSavedHead>div{display:grid;gap:2px}.manualSavedHead>div>strong{font-size:18px}.manualSavedHead small{font-size:9px;color:#7d877c}.manualSavedList{margin-top:8px;border:1px solid #e5e9e2;border-radius:14px;overflow:hidden}.manualSavedCase{display:grid;grid-template-columns:50px minmax(0,1fr) auto auto;gap:10px;align-items:center;padding:10px 11px;border-bottom:1px solid #edf0eb}.manualSavedCase:last-child{border-bottom:0}.manualSavedStatus{width:38px;height:38px;display:grid;place-items:center;border-radius:10px;background:#f0f2ef;font-size:11px;font-weight:950}.manualSavedStatus.pass{background:#edf5e8;color:#526a3b}.manualSavedStatus.fail{background:#fff0eb;color:#a4513c}.manualSavedBody{min-width:0}.manualSavedBody strong{display:block;font-size:10px}.manualSavedBody span{display:block;margin-top:2px;font-size:8px;color:#808a80}.manualSavedBody p{margin:3px 0 0;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.manualSavedScores{display:flex;gap:5px}.manualSavedScores span{background:#f3f5f2;border-radius:999px;padding:4px 6px;font-size:8px;font-weight:850}.manualSavedActions{display:flex;gap:5px}.manualSavedActions button{padding:6px 8px}.manualSavedActions button.remove{color:#9b523c}.manualEmpty{padding:16px;text-align:center;font-size:10px;color:#7d877c}
@media(max-width:900px){.manualHead{display:grid}.manualHeadActions{justify-content:flex-start}.manualMeta,.manualMainFields,.manualOptional,.manualCompare,.manualAnalysisGrid{grid-template-columns:1fr}.manualScoreHead,.manualStats{grid-template-columns:1fr 1fr}.manualSavedCase{grid-template-columns:44px 1fr}.manualSavedScores,.manualSavedActions{grid-column:2}.manualSavedHead{align-items:flex-start;display:grid}}
`;
