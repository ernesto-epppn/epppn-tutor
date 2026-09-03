import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const APP_ROLES = ["user", "formateur", "admin"] as const;
type AppRole = (typeof APP_ROLES)[number];

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
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  const isAdmin = profile?.role === "admin" || envAdminEmails().includes(email);
  if (!isAdmin) {
    return { response: NextResponse.json({ error: "admin_required" }, { status: 403 }) };
  }

  return { user, email };
}

export async function GET(req: Request) {
  try {
    const supabase = serverClient();
    if (!supabase) return NextResponse.json({ error: "server_not_configured" }, { status: 500 });

    const auth = await requireAdmin(req, supabase);
    if ("response" in auth) return auth.response;

    const { data: rows, error } = await supabase
      .from("epppn_allowed_emails")
      .select("email,full_name,app_role,active,activated_user_id,invited_at,activated_at")
      .order("email", { ascending: true });

    if (error) {
      console.error("Admin roles lookup failed:", error.message);
      return NextResponse.json({ error: "roles_lookup_failed" }, { status: 500 });
    }

    const systemAdmins = new Set(envAdminEmails());
    const roles = (rows || []).map((row: any) => ({
      email: normalizeEmail(row.email),
      full_name: row.full_name || null,
      role: systemAdmins.has(normalizeEmail(row.email)) ? "admin" : (row.app_role || "user"),
      system_admin: systemAdmins.has(normalizeEmail(row.email)),
      active: row.active === true,
      linked: Boolean(row.activated_user_id),
      invited_at: row.invited_at || null,
      activated_at: row.activated_at || null,
    }));

    return NextResponse.json({
      roles,
      current_email: auth.email,
      available_roles: APP_ROLES,
    });
  } catch (error) {
    console.error("Admin roles GET failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = serverClient();
    if (!supabase) return NextResponse.json({ error: "server_not_configured" }, { status: 500 });

    const auth = await requireAdmin(req, supabase);
    if ("response" in auth) return auth.response;

    const body = (await req.json().catch(() => ({}))) as { email?: string; role?: string };
    const email = normalizeEmail(body.email);
    const role = String(body.role || "") as AppRole;

    if (!email || !APP_ROLES.includes(role)) {
      return NextResponse.json({ error: "invalid_role_update" }, { status: 400 });
    }

    const systemAdmins = new Set(envAdminEmails());
    if (systemAdmins.has(email) && role !== "admin") {
      return NextResponse.json(
        { error: "system_admin_locked", message: "Cet administrateur système ne peut pas être rétrogradé ici." },
        { status: 400 }
      );
    }

    if (email === auth.email && role !== "admin") {
      return NextResponse.json(
        { error: "cannot_demote_self", message: "Un administrateur ne peut pas retirer son propre rôle." },
        { status: 400 }
      );
    }

    const { data: target, error: targetError } = await supabase
      .from("epppn_allowed_emails")
      .select("email,activated_user_id")
      .eq("email", email)
      .maybeSingle();

    if (targetError) return NextResponse.json({ error: "role_lookup_failed" }, { status: 500 });
    if (!target) return NextResponse.json({ error: "email_not_authorized" }, { status: 404 });

    let targetUserId = target.activated_user_id as string | null;

    if (!targetUserId) {
      const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (!usersError) {
        const authUser = (usersData?.users || []).find((user: any) => normalizeEmail(user.email) === email);
        targetUserId = authUser?.id || null;
      }
    }

    const updatePayload: Record<string, unknown> = {
      app_role: role,
      updated_at: new Date().toISOString(),
    };
    if (!target.activated_user_id && targetUserId) updatePayload.activated_user_id = targetUserId;

    const { error: updateError } = await supabase
      .from("epppn_allowed_emails")
      .update(updatePayload)
      .eq("email", email);

    if (updateError) {
      console.error("Admin role update failed:", updateError.message);
      return NextResponse.json({ error: "role_update_failed" }, { status: 500 });
    }

    if (targetUserId) {
      const { error: profileError } = await supabase
        .from("profiles")
        .upsert({ user_id: targetUserId, role }, { onConflict: "user_id" });
      if (profileError) {
        console.error("Admin role profile sync failed:", profileError.message);
        return NextResponse.json({ error: "profile_role_sync_failed" }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, email, role, linked: Boolean(targetUserId) });
  } catch (error) {
    console.error("Admin roles POST failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
