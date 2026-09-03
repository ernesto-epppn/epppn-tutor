"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";

type RagSource = {
  document_id?: number;
  title?: string;
  source?: string;
  chunk_index?: number | null;
  similarity?: number;
};

type RagEvent = {
  id: number;
  user_email?: string | null;
  project_title?: string | null;
  question: string;
  response_index?: number | null;
  mode?: string | null;
  rag_used: number;
  top_similarity?: number | null;
  sources?: RagSource[] | null;
  created_at: string;
};

type RagSummary = {
  period_days: number;
  responses: number;
  responses_with_rag: number;
  retrieval_rate: number;
  avg_top_similarity?: number | null;
  top_documents?: Array<{ title: string; source: string; count: number }>;
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function pct(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)} %`;
}

function scoreClass(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "none";
  if (value >= 0.55) return "strong";
  if (value >= 0.35) return "medium";
  return "weak";
}

export default function AdminRagUsagePanel() {
  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return url && anon ? createClient(url, anon) : null;
  }, []);

  const [events, setEvents] = useState<RagEvent[]>([]);
  const [summary, setSummary] = useState<RagSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [onlyWithoutRag, setOnlyWithoutRag] = useState(false);

  async function load() {
    if (!supabase) return;
    setLoading(true);
    setError("");
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Session administrateur introuvable.");
      const response = await fetch("/api/admin/rag-usage", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || "Lecture du contrôle RAG impossible.");
      setEvents(Array.isArray(result?.events) ? result.events : []);
      setSummary(result?.summary || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lecture du contrôle RAG impossible.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = onlyWithoutRag ? events.filter((event) => Number(event.rag_used || 0) === 0) : events;

  return (
    <section className="ragAuditShell">
      <style>{ragCss}</style>
      <div className="ragAuditCard">
        <div className="ragAuditHead">
          <div>
            <div className="ragEyebrow">Contrôle interne · RAG</div>
            <h2>Utilisation réelle de la base EPPPN</h2>
            <p>Pour chaque réponse, vous voyez ici si Ernesto a réellement retrouvé des passages EPPPN, leur niveau de similarité et les documents mobilisés. Rien de ce panneau n’est visible par les stagiaires.</p>
          </div>
          <button className="ragRefresh" type="button" onClick={() => void load()} disabled={loading}>
            {loading ? "Actualisation…" : "Actualiser"}
          </button>
        </div>

        {error ? <div className="ragNotice">{error}</div> : null}

        <div className="ragMetrics">
          <Metric label="Réponses observées · 30 j" value={summary?.responses ?? 0} />
          <Metric label="Avec passages EPPPN" value={summary?.responses_with_rag ?? 0} />
          <Metric label="Taux de retrieval" value={pct(summary?.retrieval_rate)} />
          <Metric label="Similarité max. moyenne" value={pct(summary?.avg_top_similarity)} />
        </div>

        <div className="ragAuditToolbar">
          <label>
            <input type="checkbox" checked={onlyWithoutRag} onChange={(event) => setOnlyWithoutRag(event.target.checked)} />
            Montrer uniquement les réponses sans passage EPPPN retrouvé
          </label>
          <span>{visible.length} réponses affichées</span>
        </div>

        <div className="ragEventList">
          {visible.map((event) => {
            const sources = Array.isArray(event.sources) ? event.sources : [];
            const bestClass = scoreClass(event.top_similarity);
            return (
              <article className="ragEvent" key={event.id}>
                <div className="ragEventMeta">
                  <span>{formatDate(event.created_at)}</span>
                  <span>{event.user_email || "Utilisateur"}</span>
                  {event.project_title ? <span>Dossier · {event.project_title}</span> : null}
                  {event.mode ? <span>{String(event.mode).toUpperCase()}</span> : null}
                </div>
                <div className="ragQuestion">{event.question}</div>
                <div className="ragResultRow">
                  <span className={`ragUsed ${event.rag_used > 0 ? "yes" : "no"}`}>
                    {event.rag_used > 0 ? `${event.rag_used} passage${event.rag_used > 1 ? "s" : ""} EPPPN` : "Aucun passage EPPPN"}
                  </span>
                  <span className={`ragScore ${bestClass}`}>
                    meilleure similarité · {pct(event.top_similarity)}
                  </span>
                </div>
                {sources.length ? (
                  <div className="ragSources">
                    {sources.map((source, index) => (
                      <div className="ragSource" key={`${event.id}-${source.document_id || source.title}-${source.chunk_index}-${index}`}>
                        <strong>{source.title || "Document EPPPN"}</strong>
                        <span>{source.source || "EPPPN"}</span>
                        <small>
                          fragment {typeof source.chunk_index === "number" ? source.chunk_index + 1 : "—"} · similarité {pct(source.similarity)}
                        </small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="ragNoSource">Cette réponse a été générée sans fragment EPPPN dépassant le seuil de retrieval actuel.</div>
                )}
              </article>
            );
          })}
          {!loading && !visible.length ? <div className="ragEmpty">Les données apparaîtront à partir des prochaines réponses Ernesto.</div> : null}
        </div>

        {summary?.top_documents?.length ? (
          <div className="ragTopDocs">
            <div className="ragTopDocsTitle">Documents les plus mobilisés · 30 jours</div>
            <div>
              {summary.top_documents.map((document) => (
                <span key={`${document.title}-${document.source}`}>{document.title} · {document.count}</span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="ragMetric"><span>{label}</span><strong>{value}</strong></div>;
}

const ragCss = `
  .ragAuditShell{background:#f6f7f4;padding:0 clamp(18px,4vw,58px) 70px;font-family:var(--font-geist-sans),system-ui,sans-serif;color:#172132}
  .ragAuditCard{max-width:1380px;margin:0 auto;background:#fff;border:1px solid #e3e7df;border-radius:21px;box-shadow:0 10px 32px rgba(23,33,50,.045);padding:22px}
  .ragAuditHead{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.ragEyebrow{font-size:11px;font-weight:900;letter-spacing:.11em;text-transform:uppercase;color:#6f7d3c}.ragAuditHead h2{margin:5px 0 6px;font-size:25px;letter-spacing:-.035em}.ragAuditHead p{margin:0;max-width:820px;color:#64748b;line-height:1.55;font-size:14px}
  .ragRefresh{border:1px solid #d9dfd5;background:#fff;color:#435331;border-radius:12px;padding:10px 14px;font-weight:850;cursor:pointer}.ragRefresh:disabled{opacity:.5;cursor:not-allowed}.ragNotice{margin-top:14px;padding:11px 13px;border-radius:12px;background:#fff1f2;color:#9f1239;border:1px solid #fecdd3;font-size:13px}
  .ragMetrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:18px}.ragMetric{border:1px solid #e5e9e2;border-radius:15px;padding:14px;background:#fafbf9}.ragMetric span{display:block;color:#778275;font-size:10px;font-weight:850;text-transform:uppercase;letter-spacing:.05em}.ragMetric strong{display:block;margin-top:6px;font-size:23px;letter-spacing:-.035em}
  .ragAuditToolbar{margin-top:17px;padding:11px 12px;border:1px solid #e5e9e2;border-radius:13px;background:#fafbf9;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;color:#586357;font-size:12px}.ragAuditToolbar label{display:flex;align-items:center;gap:8px;font-weight:750}.ragAuditToolbar input{accent-color:#6f7d3c}
  .ragEventList{display:grid;gap:10px;margin-top:12px}.ragEvent{border:1px solid #e6e9e4;border-radius:16px;padding:15px;background:#fff}.ragEventMeta{display:flex;gap:7px;flex-wrap:wrap}.ragEventMeta span{font-size:10px;font-weight:800;color:#6b756a;background:#f4f6f2;border-radius:999px;padding:4px 7px}.ragQuestion{font-weight:850;font-size:14px;line-height:1.45;margin-top:10px}.ragResultRow{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}.ragUsed,.ragScore{font-size:11px;font-weight:850;padding:6px 8px;border-radius:999px}.ragUsed.yes{background:#eef4e8;color:#435331}.ragUsed.no{background:#f6f6f6;color:#697068}.ragScore.strong{background:#edf5e8;color:#435331}.ragScore.medium{background:#fff7df;color:#8a6518}.ragScore.weak{background:#fff0ea;color:#9a543b}.ragScore.none{background:#f5f5f5;color:#7b817b}
  .ragSources{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px;margin-top:11px}.ragSource{border-left:3px solid #6f7d3c;background:#f8faf6;border-radius:9px;padding:9px 10px;display:grid;gap:2px}.ragSource strong{font-size:12px}.ragSource span,.ragSource small{font-size:10px;color:#697368}.ragNoSource{margin-top:10px;color:#7b817b;font-size:11px;font-style:italic}.ragEmpty{padding:24px;border:1px dashed #d6dcd2;border-radius:14px;color:#7a8477;text-align:center;font-size:13px}
  .ragTopDocs{margin-top:18px;padding-top:15px;border-top:1px solid #e7ebe4}.ragTopDocsTitle{font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;color:#707a6e}.ragTopDocs>div{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px}.ragTopDocs span{font-size:11px;background:#f4f6f2;color:#53604f;padding:6px 9px;border-radius:999px;font-weight:750}
  @media(max-width:860px){.ragAuditShell{padding:0 12px 50px}.ragAuditCard{padding:16px;border-radius:18px}.ragAuditHead{display:grid}.ragMetrics{grid-template-columns:repeat(2,minmax(0,1fr))}.ragSources{grid-template-columns:1fr}}
`;
