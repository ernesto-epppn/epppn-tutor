import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function envAdminEmails() {
  return (process.env.ERNESTO_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => normalizeEmail(email))
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

    const { data: usageRows, error: usageError } = await supabase
      .from("user_usage")
      .select("user_id,free_queries_used,trial_started_at,updated_at");

    if (usageError) return NextResponse.json({ error: usageError.message }, { status: 500 });

    const totalQueries = (usageRows || []).reduce(
      (sum: number, row: any) => sum + Number(row.free_queries_used || 0),
      0
    );

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const usersLast7d = (usageRows || []).filter((row: any) => {
      const ts = row.updated_at ? new Date(row.updated_at).getTime() : 0;
      return ts >= sevenDaysAgo;
    }).length;

    const topUsers = (usageRows || [])
      .slice()
      .sort((a: any, b: any) => Number(b.free_queries_used || 0) - Number(a.free_queries_used || 0))
      .slice(0, 20);

    return NextResponse.json({
      users_total: (usageRows || []).length,
      users_last_7d: usersLast7d,
      total_queries: totalQueries,
      top_users: topUsers,
    });
  } catch (error) {
    console.error("Admin stats route failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
