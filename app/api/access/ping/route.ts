import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function adminEmails() {
  return (process.env.ERNESTO_ADMIN_EMAILS || "")
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);
}

export async function POST(req: Request) {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "server_not_configured" }, { status: 500 });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const authHeader = req.headers.get("authorization") || "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!bearer) return NextResponse.json({ error: "auth_required" }, { status: 401 });

    const { data: userData, error: userError } = await supabase.auth.getUser(bearer);
    const user = userData?.user;
    if (userError || !user) return NextResponse.json({ error: "invalid_session" }, { status: 401 });

    const email = normalizeEmail(user.email);
    const isAdmin = adminEmails().includes(email);

    if (!isAdmin) {
      const { data: allowed, error: allowedError } = await supabase
        .from("epppn_allowed_emails")
        .select("active,access_ends_at,blocked_at,paused_at")
        .eq("email", email)
        .maybeSingle();

      if (allowedError) return NextResponse.json({ error: "access_lookup_failed" }, { status: 500 });

      const expired = Boolean(allowed?.access_ends_at) && new Date(allowed.access_ends_at).getTime() <= Date.now();
      if (!allowed || allowed.active !== true || allowed.blocked_at || allowed.paused_at || expired) {
        return NextResponse.json({ ok: false, tracked: false }, { status: 200 });
      }
    }

    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from("ernesto_access_events")
      .select("id,created_at")
      .eq("user_id", user.id)
      .gte("created_at", thirtyMinutesAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!recent) {
      const { error: insertError } = await supabase.from("ernesto_access_events").insert({
        user_id: user.id,
        email: email || null,
      });
      if (insertError) {
        console.warn("Ernesto access tracking insert failed:", insertError.message);
      }
    }

    if (email && !isAdmin) {
      await supabase
        .from("epppn_allowed_emails")
        .update({ last_login_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("email", email);
    }

    return NextResponse.json({ ok: true, tracked: !recent });
  } catch (error) {
    console.error("Ernesto access ping failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
