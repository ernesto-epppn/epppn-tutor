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

function serverClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireAdmin(req: Request, supabase: any) {
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

    const [allowlistResult, authUsersResult, accessResult, memoryResult] = await Promise.all([
      supabase
        .from("epppn_allowed_emails")
        .select("email,full_name,active,access_months,invited_at,activated_at,access_ends_at,activated_user_id,blocked_at,blocked_reason,paused_at,paused_reason,last_login_at")
        .order("invited_at", { ascending: false }),
      supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      supabase
        .from("ernesto_access_events")
        .select("user_id,created_at")
        .order("created_at", { ascending: false })
        .limit(10000),
      supabase
        .from("ernesto_dossier_memory")
        .select("user_id,project_id,turn_count"),
    ]);

    if (allowlistResult.error) {
      console.error("Admin trainees lookup failed:", allowlistResult.error.message);
      return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
    }

    if (authUsersResult.error) console.warn("Admin auth user lookup failed:", authUsersResult.error.message);
    if (accessResult.error) console.warn("Admin access metrics unavailable:", accessResult.error.message);
    if (memoryResult.error) console.warn("Admin dossier metrics unavailable:", memoryResult.error.message);

    const users = authUsersResult.data?.users || [];
    const usersById = new Map(users.map((user: any) => [user.id, user]));
    const usersByEmail = new Map(users.map((user: any) => [normalizeEmail(user.email), user]));

    const accessByUser = new Map<string, { count: number; last: string | null }>();
    for (const event of accessResult.data || []) {
      const key = String(event.user_id || "");
      if (!key) continue;
      const current = accessByUser.get(key) || { count: 0, last: null };
      current.count += 1;
      if (!current.last) current.last = event.created_at || null;
      accessByUser.set(key, current);
    }

    const dossierByUser = new Map<string, { count: number; turns: number }>();
    for (const row of memoryResult.data || []) {
      const key = String(row.user_id || "");
      if (!key) continue;
      const current = dossierByUser.get(key) || { count: 0, turns: 0 };
      current.count += 1;
      current.turns += Number(row.turn_count || 0);
      dossierByUser.set(key, current);
    }

    const now = Date.now();
    const trainees = (allowlistResult.data || []).map((row: any) => {
      const authUser = row.activated_user_id
        ? usersById.get(row.activated_user_id)
        : usersByEmail.get(normalizeEmail(row.email));
      const userId = row.activated_user_id || authUser?.id || null;
      const access = userId ? accessByUser.get(userId) : undefined;
      const dossiers = userId ? dossierByUser.get(userId) : undefined;
      const expired = Boolean(row.access_ends_at) && new Date(row.access_ends_at).getTime() <= now;

      let status: "active" | "invited" | "paused" | "blocked" | "expired" = "invited";
      if (row.blocked_at) status = "blocked";
      else if (row.paused_at) status = "paused";
      else if (expired) status = "expired";
      else if (row.active === true && (row.activated_user_id || authUser?.last_sign_in_at)) status = "active";
      else if (row.active !== true) status = "blocked";

      const endMs = row.access_ends_at ? new Date(row.access_ends_at).getTime() : 0;
      const daysRemaining = endMs ? Math.max(0, Math.ceil((endMs - now) / 86400000)) : null;

      return {
        ...row,
        status,
        user_id: userId,
        last_sign_in_at: authUser?.last_sign_in_at || null,
        auth_created_at: authUser?.created_at || null,
        last_access_at: access?.last || row.last_login_at || authUser?.last_sign_in_at || null,
        access_count: access?.count || 0,
        dossier_count: dossiers?.count || 0,
        dossier_turns: dossiers?.turns || 0,
        days_remaining: daysRemaining,
      };
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

    const body = (await req.json().catch(() => ({}))) as {
      email?: string;
      action?: string;
      days?: number;
    };
    const email = normalizeEmail(body.email);
    if (!email) return NextResponse.json({ error: "invalid_email" }, { status: 400 });

    const now = new Date();
    const nowIso = now.toISOString();

    if (body.action === "pause") {
      const { error } = await supabase
        .from("epppn_allowed_emails")
        .update({
          active: false,
          paused_at: nowIso,
          paused_reason: "paused_by_admin",
          blocked_at: null,
          blocked_reason: null,
          updated_at: nowIso,
        })
        .eq("email", email);
      if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });
      return NextResponse.json({ ok: true, status: "paused" });
    }

    if (body.action === "block") {
      const { error } = await supabase
        .from("epppn_allowed_emails")
        .update({
          active: false,
          blocked_at: nowIso,
          blocked_reason: "revoked_by_admin",
          paused_at: null,
          paused_reason: null,
          updated_at: nowIso,
        })
        .eq("email", email);
      if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });
      return NextResponse.json({ ok: true, status: "blocked" });
    }

    if (body.action === "reactivate") {
      const { error } = await supabase
        .from("epppn_allowed_emails")
        .update({
          active: true,
          blocked_at: null,
          blocked_reason: null,
          paused_at: null,
          paused_reason: null,
          updated_at: nowIso,
        })
        .eq("email", email);
      if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });
      return NextResponse.json({ ok: true, status: "reactivated" });
    }

    if (body.action === "extend") {
      const days = Math.min(365, Math.max(1, Number(body.days || 30)));
      const { data: current, error: lookupError } = await supabase
        .from("epppn_allowed_emails")
        .select("access_ends_at")
        .eq("email", email)
        .maybeSingle();
      if (lookupError || !current) return NextResponse.json({ error: "lookup_failed" }, { status: 500 });

      const currentEnd = current.access_ends_at ? new Date(current.access_ends_at) : now;
      const base = currentEnd > now ? currentEnd : now;
      const next = new Date(base.getTime() + days * 86400000);
      const { error } = await supabase
        .from("epppn_allowed_emails")
        .update({ access_ends_at: next.toISOString(), active: true, updated_at: nowIso })
        .eq("email", email);
      if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });
      return NextResponse.json({ ok: true, status: "extended", access_ends_at: next.toISOString() });
    }

    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  } catch (error) {
    console.error("Admin trainee update failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
