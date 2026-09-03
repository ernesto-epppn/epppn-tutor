import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function envAdminEmails() {
  return (process.env.ERNESTO_ADMIN_EMAILS || "")
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);
}

function serverSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireAdmin(req: Request) {
  const supabase = serverSupabase();
  if (!supabase) return { response: NextResponse.json({ error: "server_not_configured" }, { status: 500 }) };

  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!bearer) return { response: NextResponse.json({ error: "auth_required" }, { status: 401 }) };

  const { data: userData, error: userError } = await supabase.auth.getUser(bearer);
  const user = userData?.user;
  if (userError || !user) return { response: NextResponse.json({ error: "invalid_session" }, { status: 401 }) };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  const isAdmin = profile?.role === "admin" || envAdminEmails().includes(normalizeEmail(user.email));
  if (!isAdmin) return { response: NextResponse.json({ error: "admin_required" }, { status: 403 }) };

  return { supabase };
}

type RagSource = {
  document_id?: number;
  title?: string;
  source?: string;
  chunk_index?: number | null;
  similarity?: number;
};

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if ("response" in auth) return auth.response;

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [latestResult, periodResult] = await Promise.all([
    auth.supabase
      .from("ernesto_rag_usage_events")
      .select("id,user_email,project_title,question,response_index,mode,rag_used,top_similarity,sources,created_at")
      .order("created_at", { ascending: false })
      .limit(120),
    auth.supabase
      .from("ernesto_rag_usage_events")
      .select("rag_used,top_similarity,sources,created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5000),
  ]);

  if (latestResult.error) return NextResponse.json({ error: latestResult.error.message }, { status: 500 });
  if (periodResult.error) return NextResponse.json({ error: periodResult.error.message }, { status: 500 });

  const period = periodResult.data || [];
  const withRag = period.filter((row) => Number(row.rag_used || 0) > 0);
  const similarities = withRag
    .map((row) => Number(row.top_similarity))
    .filter((value) => Number.isFinite(value));

  const documentCounts = new Map<string, { title: string; source: string; count: number }>();
  period.forEach((row) => {
    const sources: RagSource[] = Array.isArray(row.sources) ? row.sources : [];
    const seen = new Set<string>();
    sources.forEach((source) => {
      const key = String(source.document_id || source.title || "");
      if (!key || seen.has(key)) return;
      seen.add(key);
      const current = documentCounts.get(key) || {
        title: String(source.title || "Document EPPPN"),
        source: String(source.source || "EPPPN"),
        count: 0,
      };
      current.count += 1;
      documentCounts.set(key, current);
    });
  });

  const topDocuments = [...documentCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return NextResponse.json({
    events: latestResult.data || [],
    summary: {
      period_days: 30,
      responses: period.length,
      responses_with_rag: withRag.length,
      retrieval_rate: period.length ? withRag.length / period.length : 0,
      avg_top_similarity: similarities.length
        ? similarities.reduce((sum, value) => sum + value, 0) / similarities.length
        : null,
      top_documents: topDocuments,
    },
  });
}
