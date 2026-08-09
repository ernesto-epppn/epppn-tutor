"use client";

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

// Kept for backwards-compatible imports in the v14.5 page. The visual plan is
// intentionally no longer interactive in v14.5.1.
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

function FlowConnector() {
  return <div className="v144-flow-connector" aria-hidden="true" />;
}

export function ActionFlowchart({ data }: ActionFlowchartProps) {
  const steps = Array.isArray(data.steps) ? data.steps.slice(0, 5) : [];
  if (!steps.length) return null;

  const clarificationOptions = Array.isArray(data.clarification_options)
    ? data.clarification_options
        .map((option) => String(option || "").trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const hasClarification = Boolean(
    data.clarification_required && data.clarification_question?.trim()
  );

  return (
    <section className="v144-flowchart" aria-label={`Plan d’action : ${data.title || "Plan d’action"}`}>
      <div className="v144-flowchart-kicker">Plan d’action</div>
      <h3 className="v144-flowchart-title">{data.title || "Plan d’action"}</h3>

      {hasClarification ? (
        <div className="v145-flow-clarification">
          <span className="v145-flow-clarification-label">À confirmer</span>
          <strong>{data.clarification_question}</strong>
          {clarificationOptions.length ? (
            <div className="v145-flow-clarification-waiting">
              Repères possibles : {clarificationOptions.join(" · ")}. Le parcours ci-dessous reste une base prudente à ajuster avec cette information.
            </div>
          ) : (
            <div className="v145-flow-clarification-waiting">
              Le parcours ci-dessous reste une base prudente à ajuster lorsque cette information sera connue.
            </div>
          )}
        </div>
      ) : null}

      <div className="v144-flowchart-track">
        <div className="v144-flow-node v144-flow-node--terminal">
          <span className="v144-flow-node-label">Point de départ</span>
          <span>{data.start}</span>
        </div>

        {steps.map((step, index) => (
          <div className="v144-flow-step" key={`${index}-${step.action}`}>
            <FlowConnector />

            <div className="v144-flow-node v144-flow-node--action">
              <span className="v144-flow-step-number">{index + 1}</span>
              <span>{step.action}</span>
            </div>

            <FlowConnector />

            <div className="v144-flow-node v144-flow-node--decision">
              <span className="v144-flow-decision-mark" aria-hidden="true">?</span>
              <span>
                <span className="v144-flow-node-label">Vérifier</span>
                {step.control}
              </span>
            </div>

            <div className="v144-flow-branches">
              <div className="v144-flow-branch v144-flow-branch--ok">
                <span className="v144-flow-branch-label">
                  Si oui · {index === steps.length - 1 ? "résultat" : "continuer"}
                </span>
                <span>{step.if_ok}</span>
              </div>
              <div className="v144-flow-branch v144-flow-branch--retry">
                <span className="v144-flow-branch-label">Sinon · ajuster puis vérifier</span>
                <span>{step.if_not}</span>
              </div>
            </div>
          </div>
        ))}

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
    </section>
  );
}
