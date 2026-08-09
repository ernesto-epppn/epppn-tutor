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
};

function FlowConnector() {
  return <div className="v144-flow-connector" aria-hidden="true" />;
}

export function ActionFlowchart({ data }: { data: ActionFlowchartData }) {
  const steps = Array.isArray(data.steps) ? data.steps.slice(0, 5) : [];
  if (!steps.length) return null;

  return (
    <section className="v144-flowchart" aria-label={`Diagramme de flux : ${data.title || "Plan d’action"}`}>
      <div className="v144-flowchart-kicker">Plan d’action visuel</div>
      <h3 className="v144-flowchart-title">{data.title || "Plan d’action"}</h3>

      <div className="v144-flowchart-track">
        <div className="v144-flow-node v144-flow-node--terminal">
          <span className="v144-flow-node-label">Départ</span>
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
