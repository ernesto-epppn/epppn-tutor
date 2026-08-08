import OpenAI from "openai";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type ChatInput = { role: "user" | "ernesto"; text: string };

function serverSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function authenticatedUser(req: Request, supabase: ReturnType<typeof createClient>) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

function cleanText(value: unknown, max: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanChat(value: unknown): ChatInput[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item: any) => item && (item.role === "user" || item.role === "ernesto"))
    .map((item: any) => ({
      role: item.role as "user" | "ernesto",
      text: cleanText(item.text, 1800),
    }))
    .filter((item) => item.text)
    .slice(-12);
}

function parseMemoryJson(raw: string) {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    const summary = cleanText(parsed?.summary, 850);
    const facts = Array.isArray(parsed?.facts)
      ? parsed.facts
          .slice(0, 10)
          .map((fact: any) => ({
            category: cleanText(fact?.category, 60) || "Repère",
            fact: cleanText(fact?.fact, 260),
            confidence: fact?.confidence === "medium" ? "medium" : "high",
          }))
          .filter((fact: any) => fact.fact)
      : [];
    const openQuestions = Array.isArray(parsed?.open_questions)
      ? parsed.open_questions.map((q: unknown) => cleanText(q, 220)).filter(Boolean).slice(0, 3)
      : [];
    return { summary, facts, openQuestions };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const supabase = serverSupabase();
  if (!supabase) return NextResponse.json({ error: "server_not_configured" }, { status: 500 });
  const user = await authenticatedUser(req, supabase);
  if (!user) return NextResponse.json({ error: "auth_required" }, { status: 401 });

  const { data, error } = await supabase
    .from("ernesto_dossier_memory")
    .select("project_id,title,objective,summary,facts,open_questions,turn_count,summarized_turn_count,updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) {
    console.warn("v14.4 dossier memory GET:", error.message);
    return NextResponse.json({ memories: [], available: false }, { status: 503 });
  }

  return NextResponse.json({ memories: data || [], available: true });
}

export async function POST(req: Request) {
  const supabase = serverSupabase();
  if (!supabase) return NextResponse.json({ error: "server_not_configured" }, { status: 500 });
  const user = await authenticatedUser(req, supabase);
  if (!user) return NextResponse.json({ error: "auth_required" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const projectId = cleanText(body?.projectId, 120);
  const title = cleanText(body?.title, 120) || "Dossier général";
  const objective = cleanText(body?.objective, 600);
  const chat = cleanChat(body?.chat);
  if (!projectId) return NextResponse.json({ error: "missing_project_id" }, { status: 400 });

  const recentAssistantCount = chat.filter((item) => item.role === "ernesto").length;
  const reportedTurnCountRaw = Number(body?.turnCount);
  const reportedTurnCount = Number.isFinite(reportedTurnCountRaw)
    ? Math.max(recentAssistantCount, Math.floor(reportedTurnCountRaw))
    : recentAssistantCount;
  const chatHash = createHash("sha256").update(JSON.stringify(chat)).digest("hex");

  const { data: existing, error: existingError } = await supabase
    .from("ernesto_dossier_memory")
    .select("summary,facts,open_questions,turn_count,summarized_turn_count,last_chat_hash")
    .eq("user_id", user.id)
    .eq("project_id", projectId)
    .maybeSingle();

  if (existingError) {
    console.warn("v14.4 dossier memory lookup:", existingError.message);
    return NextResponse.json({ error: "memory_unavailable" }, { status: 503 });
  }

  const turnCount = Math.max(reportedTurnCount, Number(existing?.turn_count || 0));
  const baseRow = {
    user_id: user.id,
    project_id: projectId,
    title,
    objective,
    turn_count: turnCount,
    last_chat_hash: chatHash,
    updated_at: new Date().toISOString(),
  };

  if (!chat.length || !recentAssistantCount) {
    const { data, error } = await supabase
      .from("ernesto_dossier_memory")
      .upsert(baseRow, { onConflict: "user_id,project_id" })
      .select("project_id,title,objective,summary,facts,open_questions,turn_count,summarized_turn_count,updated_at")
      .single();
    if (error) return NextResponse.json({ error: "memory_unavailable" }, { status: 503 });
    return NextResponse.json({ memory: data, summarized: false });
  }

  if (existing?.last_chat_hash === chatHash && turnCount === Number(existing?.turn_count || 0)) {
    return NextResponse.json({ memory: existing, summarized: false, unchanged: true });
  }

  const summarizedTurns = Number(existing?.summarized_turn_count || 0);
  const shouldSummarize = summarizedTurns === 0 || turnCount - summarizedTurns >= 2;

  if (!shouldSummarize) {
    const { data, error } = await supabase
      .from("ernesto_dossier_memory")
      .upsert(baseRow, { onConflict: "user_id,project_id" })
      .select("project_id,title,objective,summary,facts,open_questions,turn_count,summarized_turn_count,updated_at")
      .single();
    if (error) return NextResponse.json({ error: "memory_unavailable" }, { status: 503 });
    return NextResponse.json({ memory: data, summarized: false });
  }

  if (!process.env.OPENAI_API_KEY) {
    const { data, error } = await supabase
      .from("ernesto_dossier_memory")
      .upsert(baseRow, { onConflict: "user_id,project_id" })
      .select("project_id,title,objective,summary,facts,open_questions,turn_count,summarized_turn_count,updated_at")
      .single();
    if (error) return NextResponse.json({ error: "memory_unavailable" }, { status: 503 });
    return NextResponse.json({ memory: data, summarized: false });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const transcript = chat
    .map((item) => `${item.role === "user" ? "UTILISATEUR" : "ERNESTO"}: ${item.text}`)
    .join("\n\n");

  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: `Tu construis la mémoire durable d'un dossier pédagogique Ernesto. Retourne uniquement un JSON valide avec cette forme : {"summary":"...","facts":[{"category":"...","fact":"...","confidence":"high|medium"}],"open_questions":["..."]}.\n\nRègles :\n- mémorise seulement 5 à 10 faits qui seront réellement utiles à de futures réponses : farine, hydratation, températures, durées, levain/levure, four, matériel, contraintes de service, objectif, problème récurrent, décisions déjà testées et résultat observé ;\n- distingue les faits de l'utilisateur des hypothèses d'Ernesto ; ne transforme jamais une hypothèse en fait ;\n- n'enregistre pas de bavardage, formules de politesse, données d'authentification ni contenu personnel sans intérêt pédagogique ;\n- summary : 4 à 7 phrases courtes maximum ;\n- open_questions : maximum 3 informations manquantes qui changeraient réellement le diagnostic ;\n- écris dans la langue dominante de l'échange.`,
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Titre du dossier : ${title}\nObjectif déclaré : ${objective || "(non renseigné)"}\nNombre total de réponses Ernesto dans ce dossier : ${turnCount}\n\nÉchanges récents :\n${transcript}`,
          },
        ],
      },
    ],
  });

  const parsed = parseMemoryJson(response.output_text || "");
  if (!parsed) {
    const { data, error } = await supabase
      .from("ernesto_dossier_memory")
      .upsert(baseRow, { onConflict: "user_id,project_id" })
      .select("project_id,title,objective,summary,facts,open_questions,turn_count,summarized_turn_count,updated_at")
      .single();
    if (error) return NextResponse.json({ error: "memory_unavailable" }, { status: 503 });
    return NextResponse.json({ memory: data, summarized: false });
  }

  const row = {
    ...baseRow,
    summary: parsed.summary,
    facts: parsed.facts,
    open_questions: parsed.openQuestions,
    summarized_turn_count: turnCount,
  };

  const { data, error } = await supabase
    .from("ernesto_dossier_memory")
    .upsert(row, { onConflict: "user_id,project_id" })
    .select("project_id,title,objective,summary,facts,open_questions,turn_count,summarized_turn_count,updated_at")
    .single();

  if (error) {
    console.warn("v14.4 dossier memory upsert:", error.message);
    return NextResponse.json({ error: "memory_unavailable" }, { status: 503 });
  }

  return NextResponse.json({ memory: data, summarized: true });
}
