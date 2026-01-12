import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Speed = "VITE" | "APPROFONDIE";

function extractGraphJsonBlock(raw: string) {
  const m = raw.match(/<GRAPH_JSON>\s*([\s\S]*?)\s*<\/GRAPH_JSON>/i);
  if (!m?.[1]) return { text: raw.trim(), json: null as string | null };
  const json = m[1].trim();
  const text = raw.replace(m[0], "").trim();
  return { text, json };
}

// --- Heuristics: detect variables & values
function getSignals(message: string) {
  const msg = (message || "").toLowerCase();

  // numbers + common units / markers
  const numberMatches = msg.match(/-?\d+(?:[.,]\d+)?/g) ?? [];
  const nums = numberMatches
    .map((s) => Number(String(s).replace(",", ".")))
    .filter((n) => Number.isFinite(n));

  const hasUnits =
    /%|°c|c\b|w\d+|w\s*\d+|h\b|heures?|min\b|minutes?|€|eur|kg\b|g\b|gr\b|t°|temp/i.test(msg);

  const hasVariables = nums.length > 0 && (hasUnits || msg.includes("w260") || msg.includes("w320"));

  const isComparison =
    msg.includes("comparer") ||
    msg.includes("comparaison") ||
    msg.includes("vs") ||
    msg.includes("versus") ||
    msg.includes("w260") ||
    msg.includes("w320") ||
    /\bou\b/.test(msg);

  const isProtocol =
    msg.includes("protocole") ||
    msg.includes("planning") ||
    msg.includes("timeline") ||
    msg.includes("pointage") ||
    msg.includes("apprêt") ||
    msg.includes("appret") ||
    msg.includes("frigo") ||
    msg.includes("48h") ||
    msg.includes("48 h") ||
    msg.includes("24h") ||
    msg.includes("24 h") ||
    msg.includes("72h") ||
    msg.includes("72 h") ||
    /(\d+)\s*h\b/.test(msg) ||
    /(\d+)\s*min\b/.test(msg);

  // thematic detection for radar axes
  const topic =
    msg.includes("farine") || /w\d+/.test(msg)
      ? "farines"
      : msg.includes("four") || msg.includes("cuisson") || msg.includes("sole") || msg.includes("voûte") || msg.includes("voute")
      ? "fours"
      : msg.includes("marge") || msg.includes("rentable") || msg.includes("coût") || msg.includes("cout") || msg.includes("€")
      ? "economie"
      : msg.includes("concurrence") || msg.includes("positionnement") || msg.includes("usp")
      ? "concurrence"
      : msg.includes("organisation") || msg.includes("process") || msg.includes("rush") || msg.includes("service")
      ? "organisation"
      : "general";

  return { msg, nums, hasVariables, hasUnits, isComparison, isProtocol, topic };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function buildRadar(topic: string, hint?: { isComparison?: boolean }) {
  // “scientific-looking” radar axes + default mid scores
  if (topic === "farines") {
    return {
      labels: ["Force (W)", "Tolérance froid", "Extensibilité", "Absorption", "Régularité", "Risques (tenace)"],
      values: [70, 75, 60, 65, 70, 55],
      note: "Radar qualitatif (0–100). Ajustable dès que tu fournis % hydratation, T°, inoculation et durée.",
    };
  }
  if (topic === "fours") {
    return {
      labels: ["Stabilité T°", "Récupération", "Sole (homog.)", "Puissance", "Consommation", "Budget/ROI"],
      values: [70, 70, 65, 75, 55, 60],
      note: "Radar qualitatif (0–100) pour comparer des options de fours.",
    };
  }
  if (topic === "economie") {
    return {
      labels: ["Coût matière", "Temps prep", "Prix perçu", "Marge", "Complexité", "Vitesse service"],
      values: [65, 60, 70, 70, 55, 65],
      note: "Radar qualitatif (0–100). Fournis 2-3 coûts pour le rendre chiffré.",
    };
  }
  if (topic === "organisation") {
    return {
      labels: ["Mise en place", "Flux", "Standardisation", "Qualité", "Stress", "Débit"],
      values: [65, 60, 65, 70, 55, 60],
      note: "Radar qualitatif (0–100) sur l'efficacité opérationnelle.",
    };
  }
  if (topic === "concurrence") {
    return {
      labels: ["Différenciation", "Lisibilité offre", "Prix", "Localisation", "Preuves qualité", "Répétabilité"],
      values: [65, 60, 60, 55, 70, 60],
      note: "Radar qualitatif (0–100) pour structurer un positionnement.",
    };
  }
  return {
    labels: ["Fermentation", "Hydratation", "Pétrissage", "Façonnage", "Cuisson", "Organisation"],
    values: [60, 60, 60, 60, 60, 60],
    note: "Radar générique (0–100). Donne 3 paramètres pour le personnaliser.",
  };
}

function ensureGenericChartsAlways(
  graph: any,
  speed: Speed,
  message: string
) {
  if (!graph || typeof graph !== "object") return graph;

  const { nums, hasVariables, isComparison, isProtocol, topic } = getSignals(message);

  // Ensure required structure exists
  graph.charts = Array.isArray(graph.charts) ? graph.charts : [];
  graph.checklist = Array.isArray(graph.checklist) ? graph.checklist : [];
  graph.questions = Array.isArray(graph.questions) ? graph.questions : [];

  // recap_table should exist; if empty, create minimal
  if (!graph.recap_table || typeof graph.recap_table !== "object") {
    graph.recap_table = {
      columns: ["Levier", "Action", "Indicateur"],
      rows: [],
      note: "Tableau créé automatiquement (structure).",
    };
  }

  // In APPROFONDIE: if variables in play -> ALWAYS charts
  const needCharts = speed === "APPROFONDIE" && (hasVariables || isComparison || isProtocol);

  if (!needCharts) return graph;

  // If model already gave charts, keep them
  if (graph.charts.length > 0) return graph;

  const charts: any[] = [];

  // 1) Radar preferred
  const radar = buildRadar(topic);
  charts.push({
    type: "radar",
    title: "Radar (auto) — lecture scientifique",
    description: "Scores qualitatifs (0–100) pour visualiser compromis / risques / leviers.",
    data: radar,
  });

  // 2) Timeline if protocol/time present
  if (isProtocol) {
    charts.push({
      type: "timeline",
      title: "Timeline (auto) — structure du protocole",
      description: "Étapes typiques (à ajuster selon T° frigo, inoculation, force farine).",
      data: {
        steps: [
          { label: "Pétrissage", minutes: 15, purpose: "Développer réseau sans chauffer (viser T° pâte stable)" },
          { label: "Pointage", minutes: 60, purpose: "Démarrage fermentation (observer volume/tension)" },
          { label: "Boulage", minutes: 10, purpose: "Créer tension de surface (pâtons homogènes)" },
          { label: "Froid", minutes: 2880, purpose: "48h frigo (maturation/tenue)" },
          { label: "Remise T°", minutes: 120, purpose: "Réactiver fermentation avant cuisson" },
        ],
        note: "Timeline indicative. Donne T° frigo + inoculation (% levure/levain) pour calibrer.",
      },
    });
  }

  // 3) Bar if comparison present (even qualitative)
  if (isComparison) {
    charts.push({
      type: "bar",
      title: "Comparaison (auto) — scores relatifs",
      description: "Plus haut = plus adapté au cas décrit (qualitatif).",
      data: {
        labels: topic === "farines" ? ["Option A (W260)", "Option B (W320)"] : ["Option A", "Option B"],
        values: topic === "farines" ? [60, 78] : [65, 70],
        unit: "score",
        note: "Scores indicatifs (qualitatifs). Ajoute 2–3 paramètres pour quantifier.",
      },
    });
  }

  // 4) Scatter if we have >=2 numeric values: build a qualitative sensitivity sweep
  if (nums.length >= 2) {
    const x = Array.from(new Set(nums.slice(0, 6))).slice(0, 6); // up to 6 unique values
    const points = x.map((v, i) => ({
      x: v,
      y: clamp(55 + i * 6, 40, 90),
      label: String(v),
    }));
    charts.push({
      type: "scatter",
      title: "Scatter (auto) — sensibilité (qualitative)",
      description: "Projection qualitative : comment une variable (x) peut influencer un score (y).",
      data: {
        x_label: "Valeur détectée",
        y_label: "Score qualitatif",
        points,
        note: "Scatter qualitatif (démonstration). Pour du chiffré: précise la variable (hydratation, T°, inoculation) et la mesure cible.",
      },
    });
  }

  // If still empty (rare), create a table from recap_table structure
  if (charts.length === 0) {
    charts.push({
      type: "table",
      title: "Tableau (auto) — synthèse",
      description: "Généré automatiquement (structure).",
      data: graph.recap_table,
    });
  }

  graph.charts = charts;

  // Also ensure recap_table not empty: populate minimal rows if needed
  if (!Array.isArray(graph.recap_table.rows) || graph.recap_table.rows.length === 0) {
    graph.recap_table.columns = ["Levier", "Action", "Indicateur"];
    graph.recap_table.rows = [
      ["Température", "Stabiliser T° pâte et T° frigo", "T° pâte (sonde) + tenue pâtons"],
      ["Temps", "Ajuster 1 variable à la fois", "Volume + extensibilité + bullage"],
      ["Inoculation", "Réduire/augmenter levure/levain selon T°", "Odeur + vitesse de pousse"],
    ];
    graph.recap_table.note = "Tableau auto (à personnaliser dès que tu donnes 3 paramètres).";
  }

  return graph;
}

export async function POST(req: Request) {
  const { message, isFirstTurn, speed } = (await req.json()) as {
    message: string;
    isFirstTurn?: boolean;
    speed?: Speed;
  };

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
  }
  if (!message?.trim()) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  const sp: Speed = speed ?? "VITE";
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const systemPrompt = `
IDENTITE :
Tu t'appelles Ernesto. Tuteur scientifique virtuel officiel de l'EPPPN.

PUBLIC :
Exclusivement les eleves de l'EPPPN.

STYLE :
Collaboratif, bienveillant, rigoureux, scientifique. Hypotheses explicites, variables, mesures.
Proposer des tests (1 variable a la fois).

RITUELS :
- Si premiere reponse: commence par "Bonjour, je suis Ernesto, le tuteur scientifique virtuel de l'EPPPN..."
- Fin obligatoire: "Est-ce que tu veux que je t'aide sur autre chose (recette, farine, fermentation, cuisson, organisation) ?"

ANTI-DUPLICATION :
- Le TEXTE = uniquement narratif/explicatif.
- NE PAS recopier checklist/recap/questions en liste dans le texte.

VITESSE :
- VITE: 4-7 lignes, priorites, 1 risque majeur, 1 mesure simple.
- APPROFONDIE: 10-18 lignes, raisonnement dense, compromis, criteres, mini-protocole.

CHARTS (0 a 3) :
Types: table, bar, timeline, radar, scatter.
En APPROFONDIE, si variables/valeurs ou comparaison ou protocole -> fournir des charts pertinents.

SORTIE OBLIGATOIRE :
1) TEXTE
2) JSON strict entre balises :

<GRAPH_JSON>
{ ... }
</GRAPH_JSON>

SCHEMA JSON (tous champs present) :
{
  "title": "string",
  "summary": "string",
  "confidence": 0-100,
  "charts": [
    { "type": "table|bar|timeline|radar|scatter", "title": "string", "description": "string", "data": {} }
  ],
  "checklist": [
    { "action": "string", "expected_effect": "string", "priority": "high|medium|low" }
  ],
  "recap_table": { "columns": ["a","b","c"], "rows": [["x","y","z"]], "note": "string" },
  "questions": ["string","string"]
}

DATA scatter:
{ "x_label":"string","y_label":"string","points":[{"x":number,"y":number,"label":"string"}], "note":"string" }
`;

  const userPrompt = `
Parametres UI :
- Vitesse: ${sp}
- Premiere reponse ? ${isFirstTurn ? "OUI" : "NON"}

Question :
${message}
`;

  const r1 = await client.responses.create({
    model: "gpt-4.1-mini",
    input: [
      { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
      { role: "user", content: [{ type: "input_text", text: userPrompt }] },
    ],
  });

  const raw1 = r1.output_text ?? "";
  const { text: text1, json: json1 } = extractGraphJsonBlock(raw1);

  let graph: any = null;
  let text_fr = text1;

  if (json1) {
    try {
      graph = JSON.parse(json1);
    } catch {
      graph = null;
    }
  }

  // Repair pass if JSON missing/invalid
  if (!graph) {
    const repairPrompt = `
Tu es un validateur JSON strict.
Retourne UNIQUEMENT un JSON valide (sans texte). Respecte schema:

{
  "title":"string",
  "summary":"string",
  "confidence":0-100,
  "charts":[{"type":"table|bar|timeline|radar|scatter","title":"string","description":"string","data":{}}],
  "checklist":[{"action":"string","expected_effect":"string","priority":"high|medium|low"}],
  "recap_table":{"columns":["a","b","c"],"rows":[["x","y","z"]],"note":"string"},
  "questions":["string","string"]
}

Vitesse=${sp}
Question=${message}

Si le JSON fourni est vide/invalide, reconstruis-le.
JSON a reparer:
${json1 ?? "(vide)"}
`;

    const r2 = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [{ role: "user", content: [{ type: "input_text", text: repairPrompt }] }],
    });

    const raw2 = (r2.output_text ?? "").trim();
    try {
      graph = JSON.parse(raw2);
    } catch {
      graph = {
        title: "Synthèse",
        summary: "Données structurées indisponibles (erreur JSON).",
        confidence: 40,
        charts: [],
        checklist: [],
        recap_table: { columns: ["Levier", "Action", "Indicateur"], rows: [], note: "JSON non récupérable." },
        questions: [],
      };
    }
  }

  // ✅ Guarantee generic charts in APPROFONDIE when variables/values exist
  graph = ensureGenericChartsAlways(graph, sp, message);

  return NextResponse.json({ text_fr, graph });
}
