import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { EPPPN_RECIPES, EPPPN_RECIPE_COUNT } from "../../recipeData";

export const runtime = "nodejs";

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

function normalEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function adminEmails() {
  return (process.env.ERNESTO_ADMIN_EMAILS || "")
    .split(",").map(normalEmail).filter(Boolean);
}

export async function GET(req: Request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "server_not_configured" }, { status: 500, headers: privateHeaders });
  }

  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!bearer) {
    return NextResponse.json({ error: "auth_required" }, { status: 401, headers: privateHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.getUser(bearer);
    const user = data?.user;
    if (error || !user) {
      return NextResponse.json({ error: "invalid_session" }, { status: 401, headers: privateHeaders });
    }
    const email = normalEmail(user.email);
    const [profileLookup, accessLookup] = await Promise.all([
      supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle(),
      supabase.from("epppn_allowed_emails").select(
        "active,app_role,blocked_at,paused_at,access_ends_at,activated_user_id"
      ).eq("email", email).maybeSingle(),
    ]);
    if (profileLookup.error || accessLookup.error) {
      console.error("Recipe access lookup failed", profileLookup.error?.message || accessLookup.error?.message);
      return NextResponse.json({ error: "access_lookup_failed" }, { status: 500, headers: privateHeaders });
    }

    const isAdmin =
      profileLookup.data?.role === "admin" ||
      accessLookup.data?.app_role === "admin" ||
      adminEmails().includes(email);

    const allowed = accessLookup.data;
    const activeStudent =
      allowed?.active === true &&
      !allowed.blocked_at &&
      !allowed.paused_at &&
      (!allowed.activated_user_id || allowed.activated_user_id === user.id) &&
      (!allowed.access_ends_at || new Date(allowed.access_ends_at) > new Date());

    if (!isAdmin && !activeStudent) {
      return NextResponse.json({ error: "access_denied" }, { status: 403, headers: privateHeaders });
    }

    return NextResponse.json({
      version: "EPPPN 2025",
      source_document_id: 5,
      count: EPPPN_RECIPE_COUNT,
      recipes: EPPPN_RECIPES,
    }, { headers: privateHeaders });
  } catch (error) {
    console.error("Recipe catalog failed", error);
    return NextResponse.json({ error: "recipe_catalog_failed" }, { status: 500, headers: privateHeaders });
  }
}
