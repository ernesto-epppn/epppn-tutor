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

export async function GET(req: Request) {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "server_not_configured" }, { status: 500 });
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const authHeader = req.headers.get("authorization") || "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!bearer) return NextResponse.json({ error: "auth_required" }, { status: 401 });

    const { data: userData, error: userError } = await supabase.auth.getUser(bearer);
    const user = userData?.user;
    if (userError || !user) return NextResponse.json({ error: "invalid_session" }, { status: 401 });

    const email = normalizeEmail(user.email);
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    const isAdmin = profile?.role === "admin" || envAdminEmails().includes(email);
    if (!isAdmin) return NextResponse.json({ error: "admin_required" }, { status: 403 });

    const [
      allowlistResult,
      accessResult,
      memoryResult,
      feedbackResult,
      progressResult,
      documentsResult,
      chunksResult,
      authUsersResult,
    ] = await Promise.all([
      supabase
        .from("epppn_allowed_emails")
        .select("email,active,activated_user_id,access_ends_at,blocked_at,paused_at"),
      supabase
        .from("ernesto_access_events")
        .select("user_id,email,created_at")
        .order("created_at", { ascending: false })
        .limit(20000),
      supabase
        .from("ernesto_dossier_memory")
        .select("user_id,project_id,turn_count,updated_at"),
      supabase
        .from("ernesto_answer_feedback")
        .select("created_at,rating"),
      supabase
        .from("ernesto_action_plan_progress")
        .select("step_count,completed_count,updated_at"),
      supabase
        .from("documents")
        .select("id,created_at")
        .order("created_at", { ascending: false }),
      supabase.from("document_chunks").select("id", { count: "exact", head: true }),
      supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);

    const results = [
      allowlistResult,
      accessResult,
      memoryResult,
      feedbackResult,
      progressResult,
      documentsResult,
      chunksResult,
    ];
    const hardError = results.find((result: any) => result.error)?.error;
    if (hardError) return NextResponse.json({ error: hardError.message }, { status: 500 });

    const now = Date.now();
    const sevenDaysAgo = now - 7 * 86400000;
    const thirtyDaysAgo = now - 30 * 86400000;

    const allowlist = allowlistResult.data || [];
    const activeTrainees = allowlist.filter((row: any) => {
      const expired = Boolean(row.access_ends_at) && new Date(row.access_ends_at).getTime() <= now;
      return row.active === true && !row.blocked_at && !row.paused_at && !expired;
    }).length;

    const accessRows = accessResult.data || [];
    const accessLast7d = accessRows.filter((row: any) => new Date(row.created_at).getTime() >= sevenDaysAgo);
    const accessLast30d = accessRows.filter((row: any) => new Date(row.created_at).getTime() >= thirtyDaysAgo);
    const usersLast7d = new Set(accessLast7d.map((row: any) => row.user_id)).size;
    const usersLast30d = new Set(accessLast30d.map((row: any) => row.user_id)).size;

    const memoryRows = memoryResult.data || [];
    const totalQueries = memoryRows.reduce((sum: number, row: any) => sum + Number(row.turn_count || 0), 0);

    const feedbackRows = feedbackResult.data || [];
    const positiveFeedbacks = feedbackRows.filter((row: any) => Number(row.rating) === 1).length;
    const feedbackLast7d = feedbackRows.filter(
      (row: any) => row.created_at && new Date(row.created_at).getTime() >= sevenDaysAgo
    ).length;

    const progressRows = progressResult.data || [];
    const completedActionPlans = progressRows.filter(
      (row: any) => Number(row.step_count || 0) > 0 && Number(row.completed_count || 0) >= Number(row.step_count || 0)
    ).length;

    const authUsers = authUsersResult.data?.users || [];
    const authById = new Map(authUsers.map((item: any) => [item.id, item]));
    const accessByUser = new Map<string, { count: number; last: string | null; email: string | null }>();
    for (const row of accessRows) {
      const key = String(row.user_id || "");
      if (!key) continue;
      const current = accessByUser.get(key) || { count: 0, last: null, email: null };
      current.count += 1;
      if (!current.last) current.last = row.created_at || null;
      if (!current.email) current.email = row.email || null;
      accessByUser.set(key, current);
    }

    const topUsers = Array.from(accessByUser.entries())
      .map(([userId, value]) => ({
        user_id: userId,
        email: value.email || normalizeEmail(authById.get(userId)?.email) || null,
        access_count: value.count,
        last_access_at: value.last,
      }))
      .sort((a, b) => b.access_count - a.access_count)
      .slice(0, 10);

    const documents = documentsResult.data || [];
    const knowledgeDocuments = documents.length;
    const knowledgeChunks = chunksResult.count || 0;

    return NextResponse.json({
      users_total: allowlist.length,
      active_users: activeTrainees,
      users_last_7d: usersLast7d,
      users_last_30d: usersLast30d,
      accesses_total: accessRows.length,
      accesses_last_7d: accessLast7d.length,
      accesses_last_30d: accessLast30d.length,
      total_queries: totalQueries,
      dossier_memories: memoryRows.length,
      useful_feedbacks: positiveFeedbacks,
      feedback_total: feedbackRows.length,
      feedback_last_7d: feedbackLast7d,
      action_plans: progressRows.length,
      completed_action_plans: completedActionPlans,
      knowledge_documents: knowledgeDocuments,
      knowledge_chunks: knowledgeChunks,
      avg_chunks_per_document: knowledgeDocuments ? Math.round(knowledgeChunks / knowledgeDocuments) : 0,
      last_knowledge_update: documents[0]?.created_at || null,
      top_users: topUsers,
    });
  } catch (error) {
    console.error("Admin stats route failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
