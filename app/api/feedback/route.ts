import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function serverSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function authenticatedUser(req: Request, supabase: any) {
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

export async function POST(req: Request) {
  const supabase = serverSupabase();
  if (!supabase) return NextResponse.json({ error: "server_not_configured" }, { status: 500 });
  const user = await authenticatedUser(req, supabase);
  if (!user) return NextResponse.json({ error: "auth_required" }, { status: 401 });

  const body: any = await req.json().catch(() => ({}));
  const rating = Number(body?.rating);
  if (rating !== 1 && rating !== -1) {
    return NextResponse.json({ error: "invalid_rating" }, { status: 400 });
  }

  const modeRaw = cleanText(body?.mode, 20).toUpperCase();
  const mode = modeRaw === "ACTION" || modeRaw === "ANALYSE" ? modeRaw : null;
  const reasonRaw = cleanText(body?.reason, 30);
  const allowedReasons = new Set(["too_vague", "incorrect", "not_practical", "other"]);
  const reason = rating === -1 && allowedReasons.has(reasonRaw) ? reasonRaw : null;
  const answer = cleanText(body?.answer, 8000);
  if (!answer) return NextResponse.json({ error: "missing_answer" }, { status: 400 });

  const ragUsedRaw = Number(body?.ragUsed);
  const ragUsed = Number.isFinite(ragUsedRaw) ? Math.max(0, Math.min(20, Math.floor(ragUsedRaw))) : null;

  const row = {
    user_id: user.id,
    project_id: cleanText(body?.projectId, 120) || null,
    project_title: cleanText(body?.projectTitle, 120) || null,
    question: cleanText(body?.question, 2200) || null,
    answer,
    mode,
    rating,
    reason,
    rag_used: ragUsed,
  };

  const { data, error } = await supabase
    .from("ernesto_answer_feedback")
    .insert(row)
    .select("id,created_at")
    .single();

  if (error) {
    console.warn("v14.4 feedback insert:", error.message);
    return NextResponse.json({ error: "feedback_unavailable" }, { status: 503 });
  }

  return NextResponse.json({ ok: true, feedback: data });
}
