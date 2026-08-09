"use client";

export type DossierMemoryFact = {
  category?: string;
  fact?: string;
  confidence?: "high" | "medium" | string;
};

export type DossierMemoryData = {
  project_id: string;
  title: string;
  objective?: string;
  summary?: string;
  facts?: DossierMemoryFact[];
  open_questions?: string[];
  turn_count?: number;
  updated_at?: string;
};

type DossierSummaryProps = {
  data: DossierMemoryData | null;
  loading: boolean;
  error?: string;
  onClose: () => void;
  onRefresh: () => void;
  onCopy: () => void;
};

export function DossierSummary({
  data,
  loading,
  error,
  onClose,
  onRefresh,
  onCopy,
}: DossierSummaryProps) {
  const facts = Array.isArray(data?.facts)
    ? data.facts.filter((item) => String(item?.fact || "").trim()).slice(0, 10)
    : [];
  const questions = Array.isArray(data?.open_questions)
    ? data.open_questions.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 3)
    : [];

  return (
    <section className="v145-dossier-summary" aria-label="Bilan du dossier">
      <div className="v145-dossier-summary-header">
        <div>
          <div className="v145-dossier-summary-kicker">Continuité pédagogique</div>
          <h2>Bilan du dossier</h2>
        </div>
        <button type="button" className="v145-dossier-summary-close" onClick={onClose} aria-label="Fermer le bilan">
          ×
        </button>
      </div>

      {loading ? <div className="v145-dossier-summary-state">Mise à jour du bilan…</div> : null}
      {!loading && error ? <div className="v145-dossier-summary-error">{error}</div> : null}

      {!loading && data ? (
        <>
          <div className="v145-dossier-summary-grid">
            <div className="v145-dossier-summary-main">
              <span className="v145-dossier-summary-label">Dossier</span>
              <strong>{data.title || "Dossier général"}</strong>
              {data.objective ? <p><b>Objectif :</b> {data.objective}</p> : null}
              <p>{data.summary || "Le bilan se précisera après les prochains échanges avec Ernesto."}</p>
            </div>

            <div className="v145-dossier-summary-next">
              <span className="v145-dossier-summary-label">Prochain contrôle utile</span>
              <strong>{questions[0] || "Poursuivre le prochain essai en notant les paramètres et le résultat observé."}</strong>
            </div>
          </div>

          {facts.length ? (
            <div className="v145-dossier-facts">
              <span className="v145-dossier-summary-label">Repères mémorisés</span>
              <div className="v145-dossier-facts-grid">
                {facts.map((item, index) => (
                  <div className="v145-dossier-fact" key={`${index}-${item.fact}`}>
                    <span>{item.category || "Repère"}</span>
                    <strong>{item.fact}</strong>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {questions.length > 1 ? (
            <div className="v145-dossier-questions">
              <span className="v145-dossier-summary-label">Informations encore décisives</span>
              <ul>{questions.map((question) => <li key={question}>{question}</li>)}</ul>
            </div>
          ) : null}

          <div className="v145-dossier-summary-actions">
            <button type="button" onClick={onRefresh}>Actualiser</button>
            <button type="button" onClick={onCopy}>Copier le bilan</button>
          </div>
        </>
      ) : null}
    </section>
  );
}
