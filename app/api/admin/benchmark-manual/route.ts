import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { findUnsupportedOperationalNumbers } from "../../../lib/epppnKnowledge";

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

  return { user, email, bearer };
}

function cleanList(value: unknown, maxItems = 12) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((item) => item.slice(0, 500));
}

function boundedText(value: unknown, max: number) {
  return String(value || "").trim().slice(0, max);
}

const MANUAL_EVALUATION_FORMAT = {
  type: "json_schema" as const,
  name: "ernesto_manual_gold_standard_evaluation",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      reference_concordance: { type: "integer", minimum: 0, maximum: 5 },
      essential_coverage: { type: "integer", minimum: 0, maximum: 5 },
      contradiction_safety: { type: "integer", minimum: 0, maximum: 5 },
      grounding: { type: "integer", minimum: 0, maximum: 5 },
      technical_coherence: { type: "integer", minimum: 0, maximum: 5 },
      uncertainty_management: { type: "integer", minimum: 0, maximum: 5 },
      unsupported_additions_safety: { type: "integer", minimum: 0, maximum: 5 },
      concordant_points: {
        type: "array",
        items: { type: "string" },
        maxItems: 6,
      },
      missing_points: {
        type: "array",
        items: { type: "string" },
        maxItems: 6,
      },
      contradictions: {
        type: "array",
        items: { type: "string" },
        maxItems: 6,
      },
      unsupported_additions: {
        type: "array",
        items: { type: "string" },
        maxItems: 6,
      },
      reference_tensions: {
        type: "array",
        items: { type: "string" },
        maxItems: 6,
      },
      summary: { type: "string" },
    },
    required: [
      "reference_concordance",
      "essential_coverage",
      "contradiction_safety",
      "grounding",
      "technical_coherence",
      "uncertainty_management",
      "unsupported_additions_safety",
      "concordant_points",
      "missing_points",
      "contradictions",
      "unsupported_additions",
      "reference_tensions",
      "summary"
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

function scoreTo100(values: number[]) {
  const clean = values.map((value) => Math.max(0, Math.min(5, Number(value) || 0)));
  return clean.length
    ? Math.round((clean.reduce((sum, value) => sum + value, 0) / (clean.length * 5)) * 100)
    : 0;
}

function evaluationPrompt(params: {
  question: string;
  referenceAnswer: string;
  requiredPoints: string[];
  forbiddenPoints: string[];
  ernestoAnswer: string;
  context: string;
  sources: string[];
  unsupportedNumbers: string[];
  referenceUnsupportedNumbers: string[];
}) {
  const {
    question,
    referenceAnswer,
    requiredPoints,
    forbiddenPoints,
    ernestoAnswer,
    context,
    sources,
    unsupportedNumbers,
    referenceUnsupportedNumbers,
  } = params;

  return [
    "Tu évalues la réponse d'Ernesto par rapport à une réponse de référence rédigée par un expert EPPPN.",
    "La réponse de référence est une cible sémantique, PAS un texte à recopier.",
    "Une reformulation différente est correcte si elle transmet la même décision technique.",
    "Le corpus interne reste la base de contrôle pour les valeurs chiffrées et le grounding.",
    "Si la réponse de référence contient une précision absente du corpus, signale-la dans reference_tensions mais ne pénalise pas Ernesto pour avoir refusé une précision non documentée.",
    "",
    "QUESTION :",
    question,
    "",
    "RÉPONSE DE RÉFÉRENCE :",
    referenceAnswer,
    "",
    "ÉLÉMENTS INDISPENSABLES :",
    requiredPoints.length ? requiredPoints.map((item) => "- " + item).join("\n") : "(aucun ajouté)",
    "",
    "ÉLÉMENTS INTERDITS :",
    forbiddenPoints.length ? forbiddenPoints.map((item) => "- " + item).join("\n") : "(aucun ajouté)",
    "",
    "RÉPONSE ERNESTO :",
    ernestoAnswer,
    "",
    "SOURCES RÉCUPÉRÉES :",
    sources.join(" > ") || "(aucune)",
    "",
    "CONNAISSANCES INTERNES :",
    context,
    "",
    "VALEURS NON SOUTENUES DANS ERNESTO :",
    unsupportedNumbers.join(", ") || "aucune",
    "",
    "VALEURS DE LA RÉFÉRENCE ABSENTES DU CORPUS :",
    referenceUnsupportedNumbers.join(", ") || "aucune",
    "",
    "NOTE CHAQUE DIMENSION DE 0 À 5 :",
    "- reference_concordance : même conclusion et même orientation que la référence.",
    "- essential_coverage : couvre les éléments essentiels de la référence et les éléments indispensables explicites.",
    "- contradiction_safety : 5 = aucune contradiction technique significative avec la référence ; 0 = contradiction grave.",
    "- grounding : affirmations techniques réellement soutenues par le corpus récupéré.",
    "- technical_coherence : cohérence entre paramètres, causes et recommandations.",
    "- uncertainty_management : distingue correctement certitude, hypothèse et données manquantes.",
    "- unsupported_additions_safety : 5 = aucun ajout technique important non soutenu ; 0 = ajouts importants ou dangereux.",
    "",
    "Dans contradictions, ne mets que les contradictions réelles, pas les différences de formulation.",
    "Dans missing_points, ne mets que les omissions qui changent réellement la qualité technique.",
    "Dans reference_tensions, signale seulement une tension entre la référence experte et le corpus récupéré.",
    "Retourne uniquement le JSON demandé.",
  ].join("\n");
}

async function runManualCase(params: {
  req: Request;
  openai: OpenAI;
  authorization: string;
  question: string;
  referenceAnswer: string;
  requiredPoints: string[];
  forbiddenPoints: string[];
  mode: "ACTION" | "ANALYSE";
}) {
  const {
    req,
    openai,
    authorization,
    question,
    referenceAnswer,
    requiredPoints,
    forbiddenPoints,
    mode,
  } = params;

  const origin = new URL(req.url).origin;
  const tutorResponse = await fetch(new URL("/api/tutor", origin), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authorization,
      "x-ernesto-benchmark": "1",
    },
    body: JSON.stringify({
      message: question,
      speed: mode === "ANALYSE" ? "ECOLE" : "BANCO",
      responseIndex: 1,
    }),
    cache: "no-store",
  });

  const tutorPayload = await tutorResponse.json().catch(() => ({}));
  if (!tutorResponse.ok) {
    throw new Error(
      String(tutorPayload?.error || tutorPayload?.message || "production_tutor_pipeline_failed")
    );
  }

  const ernestoAnswer = String(
    tutorPayload?.answer_fr ?? tutorPayload?.text_fr ?? tutorPayload?.text ?? ""
  ).trim();
  const context = String(tutorPayload?._benchmark?.context || "");
  const sources = Array.isArray(tutorPayload?._benchmark?.sources)
    ? tutorPayload._benchmark.sources.map(String).filter(Boolean)
    : [];

  const unsupportedNumbers = findUnsupportedOperationalNumbers({
    answer: ernestoAnswer,
    question,
    context,
    allowDocumentedDerivations: true,
  });
  const referenceUnsupportedNumbers = findUnsupportedOperationalNumbers({
    answer: referenceAnswer,
    question,
    context,
    allowDocumentedDerivations: true,
  });

  const evaluationResponse = await openai.responses.create({
    model: "gpt-4.1-mini",
    max_output_tokens: 1200,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "Tu es l'évaluateur expert interne d'Ernesto. Tu compares le sens technique, pas le style. Tu es strict sur les contradictions, le grounding et les valeurs opératoires.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: evaluationPrompt({
              question,
              referenceAnswer,
              requiredPoints,
              forbiddenPoints,
              ernestoAnswer,
              context,
              sources,
              unsupportedNumbers,
              referenceUnsupportedNumbers,
            }),
          },
        ],
      },
    ],
    text: { format: MANUAL_EVALUATION_FORMAT },
  });

  const parsed = parseStrictJson(evaluationResponse.output_text || "") || {
    reference_concordance: 0,
    essential_coverage: 0,
    contradiction_safety: 0,
    grounding: 0,
    technical_coherence: 0,
    uncertainty_management: 0,
    unsupported_additions_safety: 0,
    concordant_points: [],
    missing_points: [],
    contradictions: [],
    unsupported_additions: [],
    reference_tensions: [],
    summary: "Évaluation automatique indisponible.",
  };

  const numericSafety = unsupportedNumbers.length ? 0 : 5;
  const dimensions = {
    reference_concordance: Number(parsed.reference_concordance || 0),
    essential_coverage: Number(parsed.essential_coverage || 0),
    contradiction_safety: Number(parsed.contradiction_safety || 0),
    grounding: Number(parsed.grounding || 0),
    technical_coherence: Number(parsed.technical_coherence || 0),
    uncertainty_management: Number(parsed.uncertainty_management || 0),
    numeric_safety: numericSafety,
    unsupported_additions_safety: Number(parsed.unsupported_additions_safety || 0),
  };

  const referenceScore = scoreTo100([
    dimensions.reference_concordance,
    dimensions.essential_coverage,
    dimensions.contradiction_safety,
  ]);
  const reliabilityScore = scoreTo100([
    dimensions.grounding,
    dimensions.technical_coherence,
    dimensions.uncertainty_management,
    dimensions.numeric_safety,
    dimensions.unsupported_additions_safety,
  ]);
  let score = Math.round(referenceScore * 0.5 + reliabilityScore * 0.5);

  let pass =
    score >= 75 &&
    referenceScore >= 70 &&
    reliabilityScore >= 75 &&
    dimensions.contradiction_safety >= 4 &&
    dimensions.grounding >= 3 &&
    dimensions.technical_coherence >= 3 &&
    dimensions.numeric_safety >= 4;

  if (unsupportedNumbers.length) {
    pass = false;
    score = Math.min(score, 69);
  }

  const contradictions = Array.isArray(parsed.contradictions)
    ? parsed.contradictions.map(String)
    : [];
  const forbiddenHits = forbiddenPoints.filter((forbidden) =>
    ernestoAnswer.toLowerCase().includes(forbidden.toLowerCase())
  );
  if (forbiddenHits.length) {
    pass = false;
    score = Math.min(score, 69);
    contradictions.unshift(
      ...forbiddenHits.map((item) => "Élément interdit détecté : " + item)
    );
  }

  return {
    pass,
    score,
    reference_score: referenceScore,
    reliability_score: reliabilityScore,
    mode,
    question,
    reference_answer: referenceAnswer,
    ernesto_answer: ernestoAnswer,
    sources,
    grounding_status: tutorPayload?._benchmark?.grounding_status || null,
    grounding_source: tutorPayload?._benchmark?.grounding_source || null,
    unsupported_numbers: unsupportedNumbers,
    reference_unsupported_numbers: referenceUnsupportedNumbers,
    numeric_guard_triggered:
      tutorPayload?.rag?.numeric_safety_rewritten === true ||
      (Array.isArray(tutorPayload?.rag?.numeric_values_removed) &&
        tutorPayload.rag.numeric_values_removed.length > 0),
    dimensions,
    analysis: {
      summary: String(parsed.summary || ""),
      concordant_points: Array.isArray(parsed.concordant_points)
        ? parsed.concordant_points.map(String)
        : [],
      missing_points: Array.isArray(parsed.missing_points)
        ? parsed.missing_points.map(String)
        : [],
      contradictions: [...new Set(contradictions)].slice(0, 8),
      unsupported_additions: Array.isArray(parsed.unsupported_additions)
        ? parsed.unsupported_additions.map(String)
        : [],
      reference_tensions: Array.isArray(parsed.reference_tensions)
        ? parsed.reference_tensions.map(String)
        : [],
    },
  };
}

export async function GET(req: Request) {
  try {
    const supabase = serverClient();
    if (!supabase) {
      return NextResponse.json({ error: "server_not_configured" }, { status: 500 });
    }
    const auth = await requireAdmin(req, supabase);
    if ("response" in auth) return auth.response;

    const { data, error } = await supabase
      .from("ernesto_manual_benchmark_cases")
      .select(
        "id,title,category,mode,question,reference_answer,required_points,forbidden_points,active,created_at,updated_at,last_run_at,last_pass,last_score,last_reference_score,last_reliability_score,last_result"
      )
      .eq("active", true)
      .order("updated_at", { ascending: false })
      .limit(200);

    if (error) {
      return NextResponse.json({ error: "manual_cases_lookup_failed" }, { status: 500 });
    }

    return NextResponse.json({ total: data?.length || 0, cases: data || [] });
  } catch (error) {
    console.error("Manual benchmark GET failed:", error);
    return NextResponse.json({ error: "manual_benchmark_failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = serverClient();
    if (!supabase) {
      return NextResponse.json({ error: "server_not_configured" }, { status: 500 });
    }
    const auth = await requireAdmin(req, supabase);
    if ("response" in auth) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || "run");

    if (action === "delete") {
      const id = Number(body.id);
      if (!Number.isFinite(id)) {
        return NextResponse.json({ error: "invalid_case_id" }, { status: 400 });
      }
      const { error } = await supabase
        .from("ernesto_manual_benchmark_cases")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) {
        return NextResponse.json({ error: "manual_case_delete_failed" }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    const question = boundedText(body.question, 6000);
    const referenceAnswer = boundedText(body.reference_answer, 12000);
    const requiredPoints = cleanList(body.required_points);
    const forbiddenPoints = cleanList(body.forbidden_points);
    const title = boundedText(body.title, 140);
    const category = boundedText(body.category, 80) || "Expert";
    const mode: "ACTION" | "ANALYSE" =
      String(body.mode || "ACTION").toUpperCase() === "ANALYSE" ? "ANALYSE" : "ACTION";

    if (!question || !referenceAnswer) {
      return NextResponse.json(
        { error: "question_and_reference_required" },
        { status: 400 }
      );
    }

    if (action === "save") {
      const id = Number(body.id);
      const lastResult =
        body.last_result && typeof body.last_result === "object" ? body.last_result : null;
      const payload = {
        title: title || question.slice(0, 120),
        category,
        mode,
        question,
        reference_answer: referenceAnswer,
        required_points: requiredPoints,
        forbidden_points: forbiddenPoints,
        active: true,
        updated_at: new Date().toISOString(),
        ...(lastResult
          ? {
              last_run_at: new Date().toISOString(),
              last_pass: Boolean((lastResult as any).pass),
              last_score: Number((lastResult as any).score || 0),
              last_reference_score: Number((lastResult as any).reference_score || 0),
              last_reliability_score: Number((lastResult as any).reliability_score || 0),
              last_result: lastResult,
            }
          : {}),
      };

      if (Number.isFinite(id) && id > 0) {
        const { data, error } = await supabase
          .from("ernesto_manual_benchmark_cases")
          .update(payload)
          .eq("id", id)
          .select("*")
          .single();
        if (error) {
          return NextResponse.json({ error: "manual_case_update_failed" }, { status: 500 });
        }
        return NextResponse.json({ ok: true, case: data });
      }

      const { data, error } = await supabase
        .from("ernesto_manual_benchmark_cases")
        .insert({ ...payload, created_by: auth.user.id })
        .select("*")
        .single();
      if (error) {
        return NextResponse.json({ error: "manual_case_save_failed" }, { status: 500 });
      }
      return NextResponse.json({ ok: true, case: data });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "openai_not_configured" }, { status: 500 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const result = await runManualCase({
      req,
      openai,
      authorization: req.headers.get("authorization") || "",
      question,
      referenceAnswer,
      requiredPoints,
      forbiddenPoints,
      mode,
    });

    const caseId = Number(body.id);
    if (Number.isFinite(caseId) && caseId > 0) {
      await supabase
        .from("ernesto_manual_benchmark_cases")
        .update({
          last_run_at: new Date().toISOString(),
          last_pass: result.pass,
          last_score: result.score,
          last_reference_score: result.reference_score,
          last_reliability_score: result.reliability_score,
          last_result: result,
          updated_at: new Date().toISOString(),
        })
        .eq("id", caseId);
    }

    return NextResponse.json({ run_at: new Date().toISOString(), result });
  } catch (error) {
    console.error("Manual benchmark POST failed:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "manual_benchmark_run_failed",
      },
      { status: 500 }
    );
  }
}
