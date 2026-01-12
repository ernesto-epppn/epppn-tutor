"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
  ScatterChart,
  Scatter,
  ZAxis,
} from "recharts";

type Speed = "VITE" | "APPROFONDIE";

type Chart =
  | {
      type: "table";
      title: string;
      description: string;
      data: { columns: string[]; rows: (string | number)[][]; note?: string };
    }
  | {
      type: "bar";
      title: string;
      description: string;
      data: { labels: string[]; values: number[]; unit?: string; note?: string };
    }
  | {
      type: "timeline";
      title: string;
      description: string;
      data: { steps: { label: string; minutes: number; purpose: string }[]; note?: string };
    }
  | {
      type: "radar";
      title: string;
      description: string;
      data: { labels: string[]; values: number[]; note?: string };
    }
  | {
      type: "scatter";
      title: string;
      description: string;
      data: {
        x_label: string;
        y_label: string;
        points: { x: number; y: number; label?: string }[];
        note?: string;
      };
    };

type GraphJSON = {
  title: string;
  summary: string;
  confidence: number;
  charts: Chart[];
  checklist: Array<{ action: string; expected_effect: string; priority: "high" | "medium" | "low" }>;
  recap_table: { columns: string[]; rows: (string | number)[][]; note?: string };
  questions: string[];
};

type ChatMsg = {
  id: string;
  role: "user" | "ernesto";
  text: string;
  graph?: GraphJSON | null;
};

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

const QUICK_QUESTIONS: Array<{ label: string; text: string }> = [
  { label: "W260 vs W320", text: "Comparer W260 vs W320 pour fermentation 48h au froid : risques, choix et protocole de contrôle." },
  { label: "Cornicione serré", text: "Cornicione serré, pâte peu extensible : protocole de correction en 48h froid ?" },
  { label: "Levain trop acide", text: "Levain trop acide : comment stabiliser sans perdre la force ?" },
  { label: "Sole trop chaude", text: "Sole trop chaude et dessus pâle : comment équilibrer la cuisson dans un four électrique ?" },
  { label: "Choisir un four", text: "Choisir un four électrique : critères, risques, tests de contrôle à faire ?" },
  { label: "Marge Margherita", text: "Pourquoi une Margherita est souvent plus rentable qu’une pizza gourmet très garnie ?" },
  { label: "Hausse farine", text: "Impact d’une hausse de 10% du prix de la farine sur la marge : comment raisonner ?" },
  { label: "Plan service", text: "Proposer un plan de production (timeline) pour service du soir avec pâte au froid." },
];

function badgeStyle(p: "high" | "medium" | "low"): React.CSSProperties {
  const base: React.CSSProperties = {
    fontSize: 12,
    padding: "2px 8px",
    borderRadius: 999,
    border: "1px solid #ddd",
    display: "inline-flex",
    alignItems: "center",
    whiteSpace: "nowrap",
  };
  if (p === "high") return { ...base, borderColor: "#f0c0c0", background: "#fff6f6" };
  if (p === "medium") return { ...base, borderColor: "#f0e0b0", background: "#fffaf0" };
  return { ...base, borderColor: "#cfe7cf", background: "#f6fff6" };
}

const ui = {
  page: {
    maxWidth: 1050,
    margin: "0 auto",
    padding: 16,
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  } as React.CSSProperties,
  pill: {
    border: "1px solid #ddd",
    borderRadius: 999,
    padding: "8px 10px",
    background: "white",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 800,
  } as React.CSSProperties,
  btn: {
    padding: "12px 14px",
    borderRadius: 14,
    border: "1px solid #ddd",
    cursor: "pointer",
    background: "white",
    fontSize: 15,
    fontWeight: 900,
  } as React.CSSProperties,
  textarea: {
    width: "100%",
    padding: 12,
    borderRadius: 14,
    border: "1px solid #ddd",
    outline: "none",
    fontSize: 15,
  } as React.CSSProperties,
};

export default function Page() {
  const [speed, setSpeed] = useState<Speed>("VITE");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [chat, setChat] = useState<ChatMsg[]>([]);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const quickRowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, loading]);

  async function askTutor(text: string) {
    const userText = text.trim();
    if (!userText || loading) return;

    setChat((prev) => [...prev, { id: uid(), role: "user", text: userText }]);
    setLoading(true);

    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
          isFirstTurn: chat.length === 0,
          speed,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Erreur serveur (${res.status})`);

      const text_fr: string = data?.text_fr ?? "";
      const graph: GraphJSON | null = data?.graph ?? null;

      setChat((prev) => [...prev, { id: uid(), role: "ernesto", text: text_fr, graph }]);
      setMessage("");
    } catch (err: any) {
      setChat((prev) => [
        ...prev,
        { id: uid(), role: "ernesto", text: `Désolé — erreur technique : ${err?.message ?? "Erreur inconnue"}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function newConversation() {
    setChat([]);
    setMessage("");
  }

  function scrollQuick(dx: number) {
    if (!quickRowRef.current) return;
    quickRowRef.current.scrollBy({ left: dx, behavior: "smooth" });
  }

  return (
    <main style={ui.page}>
      <style>{`
        .bubbleWrap { display:flex; margin: 10px 0; }
        .bubble {
          max-width: 92%;
          border-radius: 18px;
          padding: 12px;
          border: 1px solid #eee;
          box-shadow: 0 2px 10px rgba(0,0,0,0.03);
          line-height: 1.55;
          white-space: pre-wrap;
          background: white;
        }
        .bubble.user { margin-left: auto; background: #f7f7f7; border-color: #e8e8e8; }
        .bubble.ernesto { margin-right: auto; background: #ffffff; }

        .quickWrap { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; }
        .quickNavBtn { border: 1px solid #ddd; background: white; width: 38px; height: 38px; border-radius: 12px; cursor: pointer; font-weight: 900; }
        .quickRow { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 8px; padding-left: 2px; padding-right: 2px; -webkit-overflow-scrolling: touch; scroll-snap-type: x mandatory; }
        .quickCard {
          flex: 0 0 auto; width: 250px; border-radius: 16px; padding: 12px 14px; cursor: pointer; text-align: left;
          border: 1px solid #e6e6f5;
          background: linear-gradient(180deg, rgba(79, 70, 229, 0.10), rgba(14, 165, 233, 0.08));
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
          transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease;
          scroll-snap-align: start;
        }
        .quickCard:hover { transform: translateY(-1px); border-color: #c7c7ff; box-shadow: 0 10px 24px rgba(0,0,0,0.08); }
        .quickLabel { font-weight: 950; font-size: 14px; line-height: 1.2; }
        .quickText { margin-top: 6px; font-size: 12px; line-height: 1.35; opacity: 0.8; }

        .sectionShell { border-radius: 16px; border: 1px solid #eee; overflow: hidden; background: white; }
        .sectionHeader { padding: 10px 12px; font-weight: 950; font-size: 13px; letter-spacing: 0.2px; }
        .sectionBody { padding: 12px; border-top: 1px solid #eee; }

        .hAnswer { background: rgba(148,163,184,0.16); border-bottom: 1px solid rgba(148,163,184,0.30); }
        .hSynth  { background: rgba(14,165,233,0.12); border-bottom: 1px solid rgba(14,165,233,0.25); }
        .hCheck  { background: rgba(34,197,94,0.12); border-bottom: 1px solid rgba(34,197,94,0.25); }
        .hRecap  { background: rgba(99,102,241,0.12); border-bottom: 1px solid rgba(99,102,241,0.25); }
        .hQues   { background: rgba(245,158,11,0.14); border-bottom: 1px solid rgba(245,158,11,0.28); }

        .composer {
          position: sticky; bottom: 0;
          background: rgba(255,255,255,0.92);
          backdrop-filter: blur(8px);
          border-top: 1px solid #eee;
          padding-top: 12px; padding-bottom: 10px;
          margin-top: 14px;
        }
      `}</style>

      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 28, margin: 0 }}>Ernesto — The Pizza, Explained</h1>
          <div style={{ marginTop: 6, opacity: 0.85 }}>
            <div style={{ fontWeight: 650 }}>
              Tuteur virtuel officiel de l’École Professionnelle de Pizza et Panification Naturelle (EPPPN)
            </div>
            <div style={{ marginTop: 2 }}>
              Pose une question → Ernesto répond avec diagnostic + actions + graphiques scientifiques.
            </div>
          </div>
        </div>

        <button onClick={newConversation} style={ui.pill}>Nouvelle conversation</button>
      </header>

      <section style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 950, marginBottom: 8 }}>Questions fréquentes (clicables)</div>
        <div className="quickWrap">
          <button className="quickNavBtn" onClick={() => scrollQuick(-320)}>‹</button>
          <div className="quickRow" ref={quickRowRef}>
            {QUICK_QUESTIONS.map((q, idx) => (
              <button key={idx} className="quickCard" onClick={() => setMessage(q.text)}>
                <div className="quickLabel">{q.label}</div>
                <div className="quickText">{q.text}</div>
              </button>
            ))}
          </div>
          <button className="quickNavBtn" onClick={() => scrollQuick(320)}>›</button>
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        {chat.length === 0 ? (
          <div style={{ opacity: 0.75, fontSize: 13 }}>Commence la conversation : elle grandira vers le bas.</div>
        ) : (
          chat.map((m) => (
            <div key={m.id} className="bubbleWrap" style={{ justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
              <div className={`bubble ${m.role}`}>
                {m.role === "user" ? <div>{m.text}</div> : null}

                {m.role === "ernesto" ? (
                  <div style={{ display: "grid", gap: 12 }}>
                    {m.text?.trim() ? (
                      <Section title="Réponse d’Ernesto" headerClass="hAnswer">
                        <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
                      </Section>
                    ) : null}

                    {m.graph ? <ErnestoPanels graph={m.graph} /> : null}
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </section>

      <div className="composer">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <label style={{ fontWeight: 900 }}>Vitesse de raisonnement</label>
          <select
            value={speed}
            onChange={(e) => setSpeed(e.target.value as Speed)}
            style={{ padding: 10, borderRadius: 14, border: "1px solid #ddd", fontSize: 14 }}
          >
            <option value="VITE">Vite : décision & priorités</option>
            <option value="APPROFONDIE">Approfondie : analyses & graphiques détaillés</option>
          </select>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            {loading ? "Ernesto réfléchit…" : "Entrée = envoyer · Shift+Entrée = nouvelle ligne"}
          </div>
        </div>

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              askTutor(message);
            }
          }}
          rows={3}
          placeholder="Écris ici… (Entrée pour envoyer)"
          style={ui.textarea}
        />

        <div style={{ marginTop: 10 }}>
          <button
            onClick={() => askTutor(message)}
            disabled={loading || !message.trim()}
            style={{
              ...ui.btn,
              opacity: loading || !message.trim() ? 0.6 : 1,
              cursor: loading || !message.trim() ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Ernesto réfléchit…" : "Envoyer"}
          </button>
        </div>
      </div>
    </main>
  );
}

function ErnestoPanels({ graph }: { graph: GraphJSON }) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Section title="Synthèse & graphiques" headerClass="hSynth">
        <div style={{ fontWeight: 950, fontSize: 15 }}>{graph.title}</div>
        <div style={{ marginTop: 6, opacity: 0.85 }}>{graph.summary}</div>

        <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
          {(graph.charts ?? []).map((c, idx) => (
            <ChartCard key={idx} chart={c} />
          ))}
          {(!graph.charts || graph.charts.length === 0) && (
            <div style={{ opacity: 0.75, fontSize: 13 }}>Pas de graphique fourni (cas rare).</div>
          )}
        </div>
      </Section>

      <Section title="Checklist (priorisée)" headerClass="hCheck">
        {graph.checklist?.length ? (
          <div style={{ display: "grid", gap: 10 }}>
            {graph.checklist.map((it, i) => (
              <div key={i} style={{ border: "1px solid #eee", borderRadius: 14, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontWeight: 900 }}>{it.action}</div>
                  <span style={badgeStyle(it.priority)}>{it.priority.toUpperCase()}</span>
                </div>
                <div style={{ marginTop: 6, opacity: 0.9 }}>
                  <strong>Effet attendu:</strong> {it.expected_effect}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ opacity: 0.75, fontSize: 13 }}>—</div>
        )}
      </Section>

      <Section title="Tableau récapitulatif" headerClass="hRecap">
        <TableChart data={graph.recap_table} />
      </Section>

      <Section title="Questions (si infos manquent)" headerClass="hQues">
        {graph.questions?.length ? (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {graph.questions.filter(Boolean).map((q, i) => (
              <li key={i} style={{ marginBottom: 8 }}>{q}</li>
            ))}
          </ul>
        ) : (
          <div style={{ opacity: 0.75, fontSize: 13 }}>—</div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, headerClass, children }: { title: string; headerClass: string; children: React.ReactNode }) {
  return (
    <div className="sectionShell">
      <div className={`sectionHeader ${headerClass}`}>{title}</div>
      <div className="sectionBody">{children}</div>
    </div>
  );
}

function ChartCard({ chart }: { chart: Chart }) {
  return (
    <div style={{ border: "1px solid #eee", borderRadius: 16, padding: 12 }}>
      <div style={{ fontWeight: 900 }}>{chart.title}</div>
      {chart.description && <div style={{ marginTop: 4, opacity: 0.8, fontSize: 13 }}>{chart.description}</div>}
      <div style={{ marginTop: 10 }}>
        {chart.type === "table" ? <TableChart data={chart.data} /> : null}
        {chart.type === "bar" ? <BarChartWidget data={chart.data} /> : null}
        {chart.type === "timeline" ? <TimelineChart data={chart.data} /> : null}
        {chart.type === "radar" ? <RadarChartWidget data={chart.data} /> : null}
        {chart.type === "scatter" ? <ScatterChartWidget data={chart.data} /> : null}
      </div>
    </div>
  );
}

function TableChart({ data }: { data: { columns: string[]; rows: (string | number)[][]; note?: string } }) {
  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {data.columns.map((c, i) => (
                <th key={i} style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} style={{ padding: 8, borderBottom: "1px solid #f2f2f2", whiteSpace: "nowrap" }}>
                    {String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.note ? <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}><strong>Note:</strong> {data.note}</div> : null}
    </div>
  );
}

function BarChartWidget({ data }: any) {
  const labels: string[] = Array.isArray(data?.labels) ? data.labels : [];
  const values: number[] = Array.isArray(data?.values) ? data.values : [];
  const rows = useMemo(() => labels.map((l, i) => ({ name: l, value: Number(values[i] ?? 0) })), [labels, values]);
  const safe = rows.filter((r) => Number.isFinite(r.value));

  if (!safe.length) return <div style={{ opacity: 0.75, fontSize: 13 }}>Données insuffisantes pour afficher ce graphique.</div>;

  return (
    <div>
      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={safe}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="value" fill="#4f46e5" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
        Unité: {data?.unit ?? "score"}
        {data?.note ? <> · <strong>Note:</strong> {data.note}</> : null}
      </div>
    </div>
  );
}

function RadarChartWidget({ data }: any) {
  const labels: string[] = Array.isArray(data?.labels) ? data.labels : [];
  const values: number[] = Array.isArray(data?.values) ? data.values : [];
  const rows = useMemo(() => labels.map((l, i) => ({ axis: l, score: Number(values[i] ?? 0) })), [labels, values]);
  const safe = rows.filter((r) => Number.isFinite(r.score));

  if (!safe.length) return <div style={{ opacity: 0.75, fontSize: 13 }}>Données insuffisantes pour afficher ce radar.</div>;

  return (
    <div>
      <div style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={safe}>
            <PolarGrid />
            <PolarAngleAxis dataKey="axis" />
            <PolarRadiusAxis angle={30} domain={[0, 100]} />
            <Radar name="Score" dataKey="score" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.25} />
            <Legend />
            <Tooltip />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      {data?.note ? <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}><strong>Note:</strong> {data.note}</div> : null}
    </div>
  );
}

function ScatterChartWidget({ data }: any) {
  const pts = Array.isArray(data?.points) ? data.points : [];
  const safe = pts.filter((p: any) => Number.isFinite(Number(p?.x)) && Number.isFinite(Number(p?.y)))
    .map((p: any) => ({ x: Number(p.x), y: Number(p.y), label: p.label ?? "" }));

  if (!safe.length) return <div style={{ opacity: 0.75, fontSize: 13 }}>Données insuffisantes pour afficher ce scatter.</div>;

  return (
    <div>
      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="x" name={data?.x_label ?? "x"} />
            <YAxis dataKey="y" name={data?.y_label ?? "y"} domain={[0, 100]} />
            <ZAxis range={[60, 60]} />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} />
            <Scatter data={safe} fill="#f59e0b" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
        {data?.note ? <><strong>Note:</strong> {data.note}</> : null}
      </div>
    </div>
  );
}

function TimelineChart({ data }: any) {
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  const total = Math.max(1, ...steps.map((s: any) => (Number.isFinite(Number(s?.minutes)) ? Number(s.minutes) : 0)));

  if (!steps.length) return <div style={{ opacity: 0.75, fontSize: 13 }}>Données insuffisantes pour afficher une timeline.</div>;

  return (
    <div>
      <div style={{ display: "grid", gap: 10 }}>
        {steps.map((s: any, i: number) => {
          const mins = Number.isFinite(Number(s?.minutes)) ? Number(s.minutes) : 0;
          const width = Math.max(6, Math.round((mins / total) * 100));
          return (
            <div key={i} style={{ border: "1px solid #f0f0f0", borderRadius: 14, padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontWeight: 900 }}>{s?.label ?? "Étape"}</div>
                <div style={{ fontSize: 12, opacity: 0.75 }}>{mins} min</div>
              </div>
              <div style={{ marginTop: 6, height: 8, background: "#f3f3f3", borderRadius: 999 }}>
                <div style={{ width: `${width}%`, height: 8, borderRadius: 999, background: "#22c55e" }} />
              </div>
              <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>{s?.purpose ?? ""}</div>
            </div>
          );
        })}
      </div>
      {data?.note ? <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}><strong>Note:</strong> {data.note}</div> : null}
    </div>
  );
}
