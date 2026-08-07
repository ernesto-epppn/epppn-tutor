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

function serverClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireAdmin(req: Request, supabase: ReturnType<typeof createClient>) {
  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!bearer) return { error: "auth_required", status: 401 } as const;

  const { data, error } = await supabase.auth.getUser(bearer);
  const user = data?.user;
  if (error || !user) return { error: "invalid_session", status: 401 } as const;

  const email = normalizeEmail(user.email);
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  const isAdmin = profile?.role === "admin" || envAdminEmails().includes(email);
  if (!isAdmin) return { error: "admin_required", status: 403 } as const;
  return { user } as const;
}

export async function GET(req: Request) {
  try {
    const supabase = serverClient();
    if (!supabase) return NextResponse.json({ error: "server_not_configured" }, { status: 500 });

    const auth = await requireAdmin(req, supabase);
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { data, error } = await supabase
      .from("epppn_allowed_emails")
      .select("email,full_name,active,access_months,invited_at,activated_at,access_ends_at,activated_user_id,blocked_at,blocked_reason,last_login_at")
      .order("invited_at", { ascending: false, nullsFirst: false });

    if (error) {
      console.error("Admin trainees lookup failed:", error.message);
      return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
    }

    const now = Date.now();
    const trainees = (data || []).map((row: any) => {
      const expired = Boolean(row.access_ends_at) && new Date(row.access_ends_at).getTime() <= now;
      let status: "active" | "invited" | "blocked" | "expired" = "invited";
      if (row.blocked_at || row.active !== true) status = "blocked";
      else if (expired) status = "expired";
      else if (row.activated_user_id) status = "active";

      return { ...row, status };
    });

    return NextResponse.json({ ok: true, trainees });
  } catch (error) {
    console.error("Admin trainees route failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = serverClient();
    if (!supabase) return NextResponse.json({ error: "server_not_configured" }, { status: 500 });

    const auth = await requireAdmin(req, supabase);
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = (await req.json().catch(() => ({}))) as { email?: string; action?: string };
    const email = normalizeEmail(body.email);
    if (!email) return NextResponse.json({ error: "invalid_email" }, { status: 400 });

    const now = new Date().toISOString();
    if (body.action === "block") {
      const { error } = await supabase
        .from("epppn_allowed_emails")
        .update({ active: false, blocked_at: now, blocked_reason: "blocked_by_admin", updated_at: now })
        .eq("email", email);
      if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });
      return NextResponse.json({ ok: true, status: "blocked" });
    }

    if (body.action === "reactivate") {
      const { error } = await supabase
        .from("epppn_allowed_emails")
        .update({ active: true, blocked_at: null, blocked_reason: null, updated_at: now })
        .eq("email", email);
      if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });
      return NextResponse.json({ ok: true, status: "reactivated" });
    }

    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  } catch (error) {
    console.error("Admin trainee update failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
