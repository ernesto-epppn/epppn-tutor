import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type StepStatus = "pending" | "ok" | "retry";

function serverSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function cleanText(value: unknown, maxLength: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanStatuses(value: unknown): StepStatus[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).map((status) =>
    status === "ok" || status === "retry" ? status : "pending"
  );
}

async function authenticatedUser(req: Request, supabase: NonNullable<ReturnType<typeof serverSupabase>>) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  return error ? null : data.user || null;
}

export async function GET(req: Request) {
  const supabase = serverSupabase();
  if (!supabase) return NextResponse.json({ error: "server_not_configured" }, { status: 500 });
  const user = await authenticatedUser(req, supabase);
  if (!user) return NextResponse.json({ error: "auth_required" }, { status: 401 });

  const url = new URL(req.url);
  const projectId = cleanText(url.searchParams.get("projectId"), 120);
  const messageId = cleanText(url.searchParams.get("messageId"), 120);
  if (!projectId || !messageId) {
    return NextResponse.json({ error: "invalid_progress_key" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("ernesto_action_plan_progress")
    .select("project_id,message_id,statuses,step_count,completed_count,retry_count,updated_at")
    .eq("user_id", user.id)
    .eq("project_id", projectId)
    .eq("message_id", messageId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "progress_unavailable" }, { status: 503 });
  return NextResponse.json({ progress: data || null });
}

export async function POST(req: Request) {
  const supabase = serverSupabase();
  if (!supabase) return NextResponse.json({ error: "server_not_configured" }, { status: 500 });
  const user = await authenticatedUser(req, supabase);
  if (!user) return NextResponse.json({ error: "auth_required" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const projectId = cleanText(body?.projectId, 120);
  const messageId = cleanText(body?.messageId, 120);
  const planTitle = cleanText(body?.planTitle, 160) || "Plan d’action";
  const statuses = cleanStatuses(body?.statuses);
  if (!projectId || !messageId || !statuses.length) {
    return NextResponse.json({ error: "invalid_progress" }, { status: 400 });
  }

  const completedCount = statuses.filter((status) => status === "ok").length;
  const retryCount = statuses.filter((status) => status === "retry").length;
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("ernesto_action_plan_progress")
    .upsert(
      {
        user_id: user.id,
        project_id: projectId,
        message_id: messageId,
        plan_title: planTitle,
        step_count: statuses.length,
        completed_count: completedCount,
        retry_count: retryCount,
        statuses,
        updated_at: now,
      },
      { onConflict: "user_id,project_id,message_id" }
    )
    .select("project_id,message_id,step_count,completed_count,retry_count,updated_at")
    .single();

  if (error) {
    console.warn("v14.5 action plan progress:", error.message);
    return NextResponse.json({ error: "progress_unavailable" }, { status: 503 });
  }

  return NextResponse.json({ progress: data });
}
