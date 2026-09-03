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

    const authHeader = req.headers.get("authorization") || "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!bearer) {
      return NextResponse.json({ error: "auth_required" }, { status: 401 });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const { data: userData, error: userError } = await supabase.auth.getUser(bearer);
    const user = userData?.user;

    if (userError || !user) {
      return NextResponse.json({ error: "invalid_session" }, { status: 401 });
    }

    const email = normalizeEmail(user.email);
    const [{ data: profile, error: profileError }, { data: allowed, error: allowedError }] = await Promise.all([
      supabase
        .from("profiles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("epppn_allowed_emails")
        .select("app_role")
        .eq("email", email)
        .maybeSingle(),
    ]);

    if (profileError) {
      console.error("Admin check profile lookup failed:", profileError.message);
      return NextResponse.json({ error: "profile_lookup_failed" }, { status: 500 });
    }
    if (allowedError) {
      console.warn("Admin check allowlist role lookup failed:", allowedError.message);
    }

    const assignedAdmin = allowed?.app_role === "admin";
    const isAdmin = profile?.role === "admin" || assignedAdmin || envAdminEmails().includes(email);

    if (!isAdmin) {
      return NextResponse.json({ error: "admin_required" }, { status: 403 });
    }

    if (assignedAdmin && profile?.role !== "admin") {
      await supabase
        .from("profiles")
        .upsert({ user_id: user.id, role: "admin" }, { onConflict: "user_id" });
    }

    return NextResponse.json({ ok: true, role: "admin", email });
  } catch (error) {
    console.error("Admin check failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
