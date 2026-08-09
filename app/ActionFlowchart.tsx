"use client";

import { useEffect, useState } from "react";

export type ActionFlowchartStep = {
  action: string;
  control: string;
  if_ok: string;
  if_not: string;
};

export type ActionFlowchartData = {
  title: string;
  start: string;
  steps: ActionFlowchartStep[];
  outcome: string;
  caution: string;
  clarification_required?: boolean;
  clarification_question?: string;
  clarification_options?: string[];
};

export type ActionFlowchartStepStatus = "pending" | "ok" | "retry";

export type ActionFlowchartProgress = {
  statuses: ActionFlowchartStepStatus[];
  completed_count: number;
  retry_count: number;
  step_count: number;
};

type ActionFlowchartProps = {
  data: ActionFlowchartData;
  progressKey?: string;
  remoteProgress?: {
    accessToken: string;
    projectId: string;
    messageId: string;
  };
  onClarify?: (option: string) => void;
  onProgress?: (progress: ActionFlowchartProgress) => void;
};

const PROGRESS_STORAGE_PREFIX = "ernesto_v145_action_progress:";

function normalizeStatuses(value: unknown, stepCount: number): ActionFlowchartStepStatus[] {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: stepCount }, (_, index) => {
    const status = source[index];
    return status === "ok" || status === "retry" ? status : "pending";
  });
}

function FlowConnector() {
  return <div className="v144-flow-connector" aria-hidden="true" />;
}

export function ActionFlowchart({
  data,
  progressKey,
  remoteProgress,
  onClarify,
  onProgress,
}: ActionFlowchartProps) {
  const steps = Array.isArray(data.steps) ? data.steps.slice(0, 5) : [];
  const stepCount = steps.length;
  const [statuses, setStatuses] = useState<ActionFlowchartStepStatus[]>([]);
  const remoteAccessToken = remoteProgress?.accessToken || "";
  const remoteProjectId = remoteProgress?.projectId || "";
  const remoteMessageId = remoteProgress?.messageId || "";

  useEffect(() => {
    let cancelled = false;
    let stored: unknown = [];
    if (progressKey) {
      try {
        const raw = window.localStorage.getItem(`${PROGRESS_STORAGE_PREFIX}${progressKey}`);
        stored = raw ? JSON.parse(raw) : [];
      } catch {
        stored = [];
      }
    }
    const timer = window.setTimeout(() => {
      if (!cancelled) setStatuses(normalizeStatuses(stored, stepCount));
    }, 0);

    if (remoteAccessToken && remoteProjectId && remoteMessageId) {
      const query = new URLSearchParams({ projectId: remoteProjectId, messageId: remoteMessageId });
      void fetch(`/api/action-plan-progress?${query.toString()}`, {
        headers: { Authorization: `Bearer ${remoteAccessToken}` },
        cache: "no-store",
      })
        .then((response) => response.json())
        .then((result) => {
          if (cancelled || !Array.isArray(result?.progress?.statuses)) return;
          const remoteStatuses = normalizeStatuses(result.progress.statuses, stepCount);
          setStatuses(remoteStatuses);
          if (progressKey) {
            try {
              window.localStorage.setItem(
                `${PROGRESS_STORAGE_PREFIX}${progressKey}`,
                JSON.stringify(remoteStatuses)
              );
            } catch {
              // Remote progress still remains available.
            }
          }
        })
        .catch(() => {
          // The locally stored progress remains usable offline.
        });
    }

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [progressKey, remoteAccessToken, remoteMessageId, remoteProjectId, stepCount]);

  if (!steps.length) return null;

  const normalizedStatuses = normalizeStatuses(statuses, stepCount);
  const completedCount = normalizedStatuses.filter((status) => status === "ok").length;
  const retryCount = normalizedStatuses.filter((status) => status === "retry").length;
  const clarificationOptions = Array.isArray(data.clarification_options)
    ? data.clarification_options.map((option) => String(option || "").trim()).filter(Boolean).slice(0, 3)
    : [];
  const showsClarification = Boolean(
    data.clarification_required && data.clarification_question?.trim() && clarificationOptions.length >= 2
  );

  if (showsClarification) {
    return (
      <section className="v144-flowchart" aria-label={`Précision pour le plan : ${data.title || "Plan d’action"}`}>
        <div className="v144-flowchart-kicker">Avant le plan d’action</div>
        <h3 className="v144-flowchart-title">Une précision change le parcours</h3>
        <div className="v145-flow-clarification">
          <span className="v145-flow-clarification-label">Précision décisive</span>
          <strong>{data.clarification_question}</strong>
          <div className="v145-flow-clarification-options">
            {clarificationOptions.map((option) => (
              <button type="button" key={option} onClick={() => onClarify?.(option)} disabled={!onClarify}>
                {option}
              </button>
            ))}
          </div>
        </div>
        <div className="v145-flow-clarification-waiting">
          Le diagramme final sera construit après cette réponse pour éviter un plan trop générique.
        </div>
      </section>
    );
  }

  function saveStatuses(next: ActionFlowchartStepStatus[]) {
    setStatuses(next);
    if (progressKey) {
      try {
        window.localStorage.setItem(`${PROGRESS_STORAGE_PREFIX}${progressKey}`, JSON.stringify(next));
      } catch {
        // The plan remains interactive even if private browsing blocks storage.
      }
    }
    onProgress?.({
      statuses: next,
      completed_count: next.filter((status) => status === "ok").length,
      retry_count: next.filter((status) => status === "retry").length,
      step_count: stepCount,
    });
  }

  function setStepStatus(index: number, status: ActionFlowchartStepStatus) {
    const next = normalizeStatuses(normalizedStatuses, stepCount);
    next[index] = next[index] === status ? "pending" : status;
    saveStatuses(next);
  }

  function resetProgress() {
    saveStatuses(Array.from({ length: stepCount }, () => "pending"));
  }

  return (
    <section className="v144-flowchart" aria-label={`Diagramme de flux : ${data.title || "Plan d’action"}`}>
      <div className="v144-flowchart-kicker">Plan d’action visuel</div>
      <h3 className="v144-flowchart-title">{data.title || "Plan d’action"}</h3>

      <div className="v145-flow-progress" aria-live="polite">
        <div>
          <strong>{completedCount}/{stepCount} étapes conformes</strong>
          {retryCount ? <span> · {retryCount} à reprendre</span> : null}
        </div>
        <div className="v145-flow-progress-bar" aria-hidden="true">
          <span style={{ width: `${stepCount ? (completedCount / stepCount) * 100 : 0}%` }} />
        </div>
        {completedCount || retryCount ? (
          <button type="button" className="v145-flow-reset" onClick={resetProgress}>Réinitialiser</button>
        ) : null}
      </div>

      <div className="v144-flowchart-track">
        <div className="v144-flow-node v144-flow-node--terminal">
          <span className="v144-flow-node-label">Départ</span>
          <span>{data.start}</span>
        </div>

        {steps.map((step, index) => {
          const status = normalizedStatuses[index];
          return (
            <div className={`v144-flow-step v145-flow-step--${status}`} key={`${index}-${step.action}`}>
              <FlowConnector />

              <div className="v144-flow-node v144-flow-node--action">
                <span className="v144-flow-step-number">{index + 1}</span>
                <span>{step.action}</span>
                {status === "ok" ? <span className="v145-flow-status">Conforme</span> : null}
                {status === "retry" ? <span className="v145-flow-status">À reprendre</span> : null}
              </div>

              <FlowConnector />

              <div className="v144-flow-node v144-flow-node--decision">
                <span className="v144-flow-decision-mark" aria-hidden="true">?</span>
                <span>
                  <span className="v144-flow-node-label">Contrôle</span>
                  {step.control}
                </span>
              </div>

              <div className="v144-flow-branches">
                <div className="v144-flow-branch v144-flow-branch--ok">
                  <span className="v144-flow-branch-label">
                    Oui · {index === steps.length - 1 ? "résultat" : "étape suivante"}
                  </span>
                  <span>{step.if_ok}</span>
                </div>
                <div className="v144-flow-branch v144-flow-branch--retry">
                  <span className="v144-flow-branch-label">Non · corriger puis recontrôler</span>
                  <span>{step.if_not}</span>
                </div>
              </div>

              <div className="v145-flow-controls" aria-label={`Résultat du contrôle ${index + 1}`}>
                <button
                  type="button"
                  className="v145-flow-control-ok"
                  aria-pressed={status === "ok"}
                  onClick={() => setStepStatus(index, "ok")}
                >
                  ✓ Conforme
                </button>
                <button
                  type="button"
                  className="v145-flow-control-retry"
                  aria-pressed={status === "retry"}
                  onClick={() => setStepStatus(index, "retry")}
                >
                  ↺ À reprendre
                </button>
              </div>
            </div>
          );
        })}

        <FlowConnector />

        <div className="v144-flow-node v144-flow-node--terminal v144-flow-node--outcome">
          <span className="v144-flow-node-label">Résultat attendu</span>
          <span>{data.outcome}</span>
        </div>
      </div>

      {data.caution ? (
        <div className="v144-flowchart-caution">
          <strong>Point de vigilance</strong>
          <span>{data.caution}</span>
        </div>
      ) : null}

      {completedCount === stepCount ? (
        <div className="v145-flow-complete">Plan terminé · tous les contrôles sont conformes.</div>
      ) : null}
    </section>
  );
}
