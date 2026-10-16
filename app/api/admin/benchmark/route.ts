import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  EPPPN_TECHNICAL_BENCHMARK,
  benchmarkCaseById,
  type EpppnBenchmarkCase,
} from "../../../lib/epppnTechnicalBenchmark";
import {
  findUnsupportedOperationalNumbers,
  retrieveEpppnKnowledge,
  secureTechnicalNumericAdvice,
} from "../../../lib/epppnKnowledge";

export const runtime = "nodejs";
export const maxDuration = 120;

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function envAdminEmails() {
  return (process.env.ERNESTO_ADMIN_EMAILS || "")
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);
}

function serverClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireAdmin(req: Request, supabase: any) {
  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!bearer) return { response: NextResponse.json({ error: "auth_required" }, { status: 401 }) };

  const { data, error } = await supabase.auth.getUser(bearer);
  const user = data?.user;
  if (error || !user) {
    return { response: NextResponse.json({ error: "invalid_session" }, { status: 401 }) };
  }

  const email = normalizeEmail(user.email);
  const [{ data: profile }, { data: allowed }] = await Promise.all([
    supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle(),
    supabase.from("epppn_allowed_emails").select("app_role").eq("email", email).maybeSingle(),
  ]);

  const isAdmin =
    profile?.role === "admin" ||
    allowed?.app_role === "admin" ||
    envAdminEmails().includes(email);

  if (!isAdmin) {
    return { response: NextResponse.json({ error: "admin_required" }, { status: 403 }) };
  }
  return { user, email };
}

const EVALUATION_FORMAT = {
  type: "json_schema" as const,
  name: "epppn_technical_benchmark_evaluation",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      pass: { type: "boolean" },
      score: { type: "integer", minimum: 0, maximum: 100 },
      retrieval: { type: "integer", minimum: 0, maximum: 5 },
      grounding: { type: "integer", minimum: 0, maximum: 5 },
      technical_coherence: { type: "integer", minimum: 0, maximum: 5 },
      uncertainty_management: { type: "integer", minimum: 0, maximum: 5 },
      brand_safety: { type: "integer", minimum: 0, maximum: 5 },
      summary: { type: "string" },
      issues: {
        type: "array",
        items: { type: "string" },
        maxItems: 6,
      },
    },
    required: [
      "pass",
      "score",
      "retrieval",
      "grounding",
      "technical_coherence",
      "uncertainty_management",
      "brand_safety",
      "summary",
      "issues",
    ],
  },
};

function parseStrictJson(raw: string) {
  const clean = String(raw || "")
    .trim()
    .replace(/^\`\`\`json\s*/i, "")
    .replace(/^\`\`\`\s*/i, "")
    .replace(/\`\`\`$/i, "")
    .trim();
  const first = clean.indexOf("{");
  const last = clean.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try {
    return JSON.parse(clean.slice(first, last + 1));
  } catch {
    return null;
  }
}

function generationPrompt(test: EpppnBenchmarkCase, context: string) {
  return [
    "Tu es Ernesto, tuteur scientifique EPPPN. Réponds en français, de façon professionnelle et directement exploitable.",
    "",
    "PRIORITÉ DES CONNAISSANCES :",
    "1. Cookbook Pizza Home made 5 - Marino",
    "2. Ricettario Pizza home made",
    "3. pane - Fulvio Marino",
    "4. Manuel EPPPN 2026",
    "puis les autres contenus EPPPN validés.",
    "",
    "RÈGLES TECHNIQUES :",
    "- Diagnostic avant protocole.",
    "- Toute valeur précise concernant levure, hydratation, farine/W, P/L, pH, température, temps, pré-ferment ou cuisson doit être soutenue par les connaissances internes ci-dessous ou par les données de la question.",
    "- Une valeur calculée est admise uniquement si elle découle d'une quantité fournie par l'utilisateur et d'une proportion ou conversion explicitement documentée dans les connaissances internes.",
    "- N'utilise jamais un chiffre simplement plausible ou connu par le modèle.",
    "- Si le contexte manque, reste qualitatif : indique ce qui manque et ce qu'il faut contrôler.",
    "- Ne transpose pas une valeur d'un produit ou procédé à un autre sans justification.",
    "- N'invente aucune marque ni modèle de matériel. Moretti / Serie S ne doit apparaître que si la question ou les connaissances internes le mentionnent.",
    "- Ne cite pas les sources internes dans la réponse.",
    "",
    "CONNAISSANCES INTERNES :",
    context,
    "",
    "QUESTION DE TEST :",
    test.question,
  ].join("\n");
}

function evaluationPrompt(params: {
  test: EpppnBenchmarkCase;
  context: string;
  answer: string;
  unsupportedNumbers: string[];
  sources: string[];
  brandHallucination: boolean;
}) {
  const { test, context, answer, unsupportedNumbers, sources, brandHallucination } = params;
  return [
    "Évalue strictement une réponse technique d'Ernesto.",
    "Ne récompense pas une réponse simplement plausible : elle doit être fondée sur les connaissances internes fournies.",
    "",
    "CAS : " + test.id + " · " + test.category,
    "QUESTION : " + test.question,
    "RISQUE CIBLÉ : " + test.risk,
    "COMPORTEMENTS ATTENDUS : " + test.expected.join(" | "),
    "COMPORTEMENTS INTERDITS : " + test.forbidden.join(" | "),
    "FOCUS : " + test.source_focus,
    "",
    "SOURCES RETROUVÉES : " + (sources.join(" > ") || "aucune"),
    "NOMBRES OPÉRATIONNELS POTENTIELLEMENT NON SOUTENUS : " + (unsupportedNumbers.join(", ") || "aucun détecté"),
    "MARQUE INVENTÉE DÉTECTÉE : " + (brandHallucination ? "oui" : "non"),
    "",
    "CONNAISSANCES INTERNES :",
    context,
    "",
    "RÉPONSE À ÉVALUER :",
    answer,
    "",
    "CRITÈRES :",
    "- retrieval : pertinence et priorité des sources ; pour le pain, la source pane est prioritaire dès qu'elle est disponible et pertinente.",
    "- grounding : chiffres, seuils et réglages soutenus par le contexte.",
    "- technical_coherence : cohérence entre farine, eau, levure/levain, temps, température, fermentation et cuisson.",
    "- uncertainty_management : pas de fausse précision quand des données décisives manquent.",
    "- brand_safety : aucune marque inventée ; Moretti est autorisé seulement si la question le fournit.",
    "- pass=true seulement si aucune erreur technique importante ni valeur opératoire non fondée n'est détectée.",
  ].join("\n");
}


async function runCase(params: {
  test: EpppnBenchmarkCase;
  openai: OpenAI;
  supabase: any;
}) {
  const { test, openai, supabase } = params;
  const knowledge = await retrieveEpppnKnowledge({
    supabase,
    openai,
    message: test.question,
    candidateCount: 80,
    resultCount: 8,
    minSimilarity: 0.2,
  });

  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "Tu produis la réponse technique qui sera soumise au benchmark interne EPPPN.",
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: generationPrompt(test, knowledge.context) }],
      },
    ],
  });
  const rawAnswer = String(response.output_text || "").trim();
  const secured = await secureTechnicalNumericAdvice({
    openai,
    answer: rawAnswer,
    question: test.question,
    context: knowledge.context,
  });
  const answer = secured.answer;

  const unsupportedNumbers = findUnsupportedOperationalNumbers({
    answer,
    question: test.question,
    context: knowledge.context,
    allowDocumentedDerivations: true,
  });

  const lowerAnswer = answer.toLowerCase();
  const lowerQuestion = test.question.toLowerCase();
  const lowerContext = knowledge.context.toLowerCase();
  const brandHallucination =
    (lowerAnswer.includes("moretti") || lowerAnswer.includes("serie s")) &&
    !(lowerQuestion.includes("moretti") || lowerQuestion.includes("serie s")) &&
    !(lowerContext.includes("moretti") || lowerContext.includes("serie s"));

  const sources = [...new Set(
    knowledge.retrieved
      .map((item: any) => String(item.document_title || ""))
      .filter(Boolean)
  )];

  const evaluationResponse = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "Tu es un évaluateur interne strict de qualité technique. Retourne uniquement le JSON demandé.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: evaluationPrompt({
              test,
              context: knowledge.context,
              answer,
              unsupportedNumbers,
              sources,
              brandHallucination,
            }),
          },
        ],
      },
    ],
    text: { format: EVALUATION_FORMAT },
  });

  const parsed = parseStrictJson(evaluationResponse.output_text || "") || {
    pass: false,
    score: 0,
    retrieval: 0,
    grounding: 0,
    technical_coherence: 0,
    uncertainty_management: 0,
    brand_safety: 0,
    summary: "Évaluation automatique indisponible.",
    issues: ["JSON d'évaluation invalide."],
  };

  const dimensions = {
    retrieval: Number(parsed.retrieval || 0),
    grounding: Number(parsed.grounding || 0),
    technical_coherence: Number(parsed.technical_coherence || 0),
    uncertainty_management: Number(parsed.uncertainty_management || 0),
    brand_safety: brandHallucination ? 0 : 5,
  };
  const dimensionValues = Object.values(dimensions).map((value) =>
    Math.max(0, Math.min(5, Number(value) || 0))
  );
  let score = Math.round(
    (dimensionValues.reduce((sum, value) => sum + value, 0) / 25) * 100
  );

  // PASS is deterministic: good overall quality plus no weak critical dimension.
  let pass =
    score >= 70 &&
    dimensions.grounding >= 3 &&
    dimensions.technical_coherence >= 3 &&
    dimensions.uncertainty_management >= 3 &&
    dimensions.brand_safety >= 4 &&
    dimensions.retrieval >= 2;

  const issues = Array.isArray(parsed.issues) ? parsed.issues.map(String) : [];

  if (unsupportedNumbers.length) {
    pass = false;
    score = Math.min(score, 69);
    issues.unshift("Valeur(s) opératoire(s) non retrouvée(s) dans la question ou le contexte : " + unsupportedNumbers.join(", "));
  }
  if (brandHallucination) {
    pass = false;
    score = Math.min(score, 49);
    issues.unshift("Marque ou modèle de four introduit sans fondement interne.");
  }

  return {
    id: test.id,
    category: test.category,
    question: test.question,
    risk: test.risk,
    pass,
    score,
    answer,
    raw_answer: rawAnswer,
    numeric_guard_triggered: secured.initialUnsupported.length > 0,
    numeric_values_removed: [...new Set([...secured.initialUnsupported, ...secured.removed])],
    sources,
    top_matches: knowledge.retrieved.slice(0, 5).map((item: any) => ({
      document_title: item.document_title,
      similarity: Number(item.similarity || 0),
      retrieval_score: Number(item.retrieval_score || 0),
    })),
    unsupported_numbers: unsupportedNumbers,
    brand_hallucination: brandHallucination,
    evaluation: {
      retrieval: dimensions.retrieval,
      grounding: dimensions.grounding,
      technical_coherence: dimensions.technical_coherence,
      uncertainty_management: dimensions.uncertainty_management,
      brand_safety: dimensions.brand_safety,
      summary: String(parsed.summary || ""),
      issues: [...new Set(issues)].slice(0, 8),
    },
  };
}

export async function GET(req: Request) {
  try {
    const supabase = serverClient();
    if (!supabase) return NextResponse.json({ error: "server_not_configured" }, { status: 500 });
    const auth = await requireAdmin(req, supabase);
    if ("response" in auth) return auth.response;

    const categories = [...new Set(EPPPN_TECHNICAL_BENCHMARK.map((item) => item.category))];
    const priorityTitles = [
      "Cookbook Pizza Home made 5 - Marino",
      "Ricettario Pizza home made",
      "pane - Fulvio MArino",
      "MANUEL 2026 impression",
    ];

    const { data: documents } = await supabase
      .from("documents")
      .select("id,title,active,status")
      .in("title", priorityTitles);

    const ids = (documents || []).map((item: any) => item.id);
    const { data: chunks } = ids.length
      ? await supabase.from("document_chunks").select("document_id").in("document_id", ids)
      : { data: [] as any[] };

    const chunkCounts = new Map<number, number>();
    for (const row of chunks || []) {
      const id = Number(row.document_id);
      chunkCounts.set(id, (chunkCounts.get(id) || 0) + 1);
    }

    const sourceStatus = priorityTitles.map((title) => {
      const doc = (documents || []).find((item: any) => item.title === title);
      return {
        title,
        found: Boolean(doc),
        active: doc?.active === true,
        status: doc?.status || "missing",
        chunks: doc ? (chunkCounts.get(Number(doc.id)) || 0) : 0,
      };
    });

    return NextResponse.json({
      total: EPPPN_TECHNICAL_BENCHMARK.length,
      categories,
      cases: EPPPN_TECHNICAL_BENCHMARK,
      source_status: sourceStatus,
      batch_limit: 3,
    });
  } catch (error) {
    console.error("Benchmark GET failed:", error);
    return NextResponse.json({ error: "benchmark_lookup_failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = serverClient();
    if (!supabase) return NextResponse.json({ error: "server_not_configured" }, { status: 500 });
    const auth = await requireAdmin(req, supabase);
    if ("response" in auth) return auth.response;
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "openai_not_configured" }, { status: 500 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const ids = Array.isArray(body.case_ids) ? body.case_ids.map(String).slice(0, 3) : [];
    if (!ids.length) return NextResponse.json({ error: "case_ids_required" }, { status: 400 });

    const tests = ids.map(benchmarkCaseById).filter((item): item is EpppnBenchmarkCase => Boolean(item));
    if (!tests.length) return NextResponse.json({ error: "benchmark_cases_not_found" }, { status: 404 });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const results = [];
    for (const test of tests) {
      results.push(await runCase({ test, openai, supabase }));
    }

    const passed = results.filter((item) => item.pass).length;
    const avgScore = results.length
      ? Math.round(results.reduce((sum, item) => sum + item.score, 0) / results.length)
      : 0;

    return NextResponse.json({
      run_at: new Date().toISOString(),
      total: results.length,
      passed,
      failed: results.length - passed,
      pass_rate: results.length ? passed / results.length : 0,
      avg_score: avgScore,
      results,
    });
  } catch (error) {
    console.error("Benchmark POST failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "benchmark_run_failed" },
      { status: 500 }
    );
  }
}
