import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function serverSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function cleanText(value: unknown, maxLength: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

type RagTop = {
  similarity?: number;
  chunk_index?: number;
  document_id?: number;
};

export async function POST(req: Request) {
  const supabase = serverSupabase();
  if (!supabase) return NextResponse.json({ error: "server_not_configured" }, { status: 500 });

  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!bearer) return NextResponse.json({ error: "auth_required" }, { status: 401 });

  const { data: userData, error: userError } = await supabase.auth.getUser(bearer);
  const user = userData?.user;
  if (userError || !user) return NextResponse.json({ error: "invalid_session" }, { status: 401 });

  try {
    const body = await req.json();
    const question = cleanText(body?.question, 1200);
    if (!question) return NextResponse.json({ error: "question_required" }, { status: 400 });

    const rawTop: RagTop[] = Array.isArray(body?.rag?.top) ? body.rag.top.slice(0, 6) : [];
    const top = rawTop
      .map((item) => ({
        document_id: Number(item?.document_id),
        chunk_index: Number(item?.chunk_index),
        similarity: Number(item?.similarity),
      }))
      .filter((item) => Number.isInteger(item.document_id) && item.document_id > 0 && Number.isFinite(item.similarity));

    const documentIds = [...new Set(top.map((item) => item.document_id))];
    const documentMap = new Map<number, { title: string; source: string }>();

    if (documentIds.length) {
      const { data: documents } = await supabase
        .from("documents")
        .select("id,title,source")
        .in("id", documentIds);
      (documents || []).forEach((document) => {
        documentMap.set(Number(document.id), {
          title: cleanText(document.title, 180),
          source: cleanText(document.source, 220),
        });
      });
    }

    const sources = top.map((item) => {
      const document = documentMap.get(item.document_id);
      return {
        document_id: item.document_id,
        title: document?.title || `Document ${item.document_id}`,
        source: document?.source || "EPPPN",
        chunk_index: Number.isInteger(item.chunk_index) ? item.chunk_index : null,
        similarity: Math.max(0, Math.min(1, item.similarity)),
      };
    });

    const ragUsedRaw = Number(body?.rag?.used ?? sources.length);
    const ragUsed = Number.isFinite(ragUsedRaw) ? Math.max(0, Math.min(20, Math.round(ragUsedRaw))) : sources.length;
    const topSimilarity = sources.length ? Math.max(...sources.map((item) => item.similarity)) : null;
    const responseIndexRaw = Number(body?.responseIndex);

    const { error } = await supabase.from("ernesto_rag_usage_events").insert({
      user_id: user.id,
      user_email: cleanText(user.email, 320) || null,
      project_title: cleanText(body?.projectTitle, 180) || null,
      question,
      response_index: Number.isFinite(responseIndexRaw) ? Math.max(1, Math.round(responseIndexRaw)) : null,
      mode: cleanText(body?.mode, 30) || null,
      rag_used: ragUsed,
      top_similarity: topSimilarity,
      sources,
    });

    if (error) {
      console.warn("RAG usage telemetry insert failed:", error.message);
      return NextResponse.json({ error: "telemetry_insert_failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.warn("RAG usage telemetry failed:", error);
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
}
