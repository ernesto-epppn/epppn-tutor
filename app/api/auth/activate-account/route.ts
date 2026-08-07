import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function addMonthsClamped(date: Date, monthsRaw: unknown) {
  const parsed = Number(monthsRaw ?? 4);
  const months = Number.isFinite(parsed)
    ? Math.min(6, Math.max(1, Math.floor(parsed)))
    : 4;
  const result = new Date(date);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}

function getEnvAdminEmails() {
  return (process.env.ERNESTO_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => normalizeEmail(email))
    .filter(Boolean);
}

export async function POST(req: Request) {
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
    if (!email) {
      return NextResponse.json({ error: "missing_email" }, { status: 403 });
    }

    const now = new Date();

    // Keep the login gate aligned with /api/tutor:
    // admin -> active paid subscription -> active EPPPN pilot access.
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    const isAdmin =
      profile?.role === "admin" || getEnvAdminEmails().includes(email);

    if (isAdmin) {
      return NextResponse.json({
        ok: true,
        access_type: "admin",
        access_ends_at: null,
      });
    }

    const { data: entitlement, error: entitlementLookupError } = await supabase
      .from("user_entitlements")
      .select("status,current_period_end,plan,stripe_subscription_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (entitlementLookupError) {
      console.error(
        "V14.2 entitlement lookup failed during login:",
        entitlementLookupError.message
      );
      return NextResponse.json({ error: "entitlement_lookup_failed" }, { status: 500 });
    }

    const hasPaidPlan =
      Boolean(entitlement?.stripe_subscription_id) ||
      entitlement?.plan === "monthly" ||
      entitlement?.plan === "yearly";

    const isPaidPro =
      hasPaidPlan &&
      entitlement?.status === "active" &&
      (!entitlement.current_period_end ||
        new Date(entitlement.current_period_end) > now);

    if (isPaidPro) {
      return NextResponse.json({
        ok: true,
        access_type: entitlement?.plan || "ernesto_plus",
        access_ends_at: entitlement?.current_period_end || null,
      });
    }

    const { data: allowed, error: lookupError } = await supabase
      .from("epppn_allowed_emails")
      .select("email,active,access_months,activated_at,access_ends_at,activated_user_id,blocked_at")
      .eq("email", email)
      .maybeSingle();

    if (lookupError) {
      console.error("V14.2 activation lookup failed:", lookupError.message);
      return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
    }

    if (!allowed || allowed.active !== true || allowed.blocked_at) {
      return NextResponse.json({ error: "access_denied" }, { status: 403 });
    }

    if (allowed.activated_user_id && allowed.activated_user_id !== user.id) {
      await supabase
        .from("epppn_allowed_emails")
        .update({
          last_security_event_at: now.toISOString(),
          last_security_event: "different_user_id",
          updated_at: now.toISOString(),
        })
        .eq("email", email);

      return NextResponse.json(
        {
          error: "account_already_bound",
          message: "Ce compte EPPPN est déjà associé à un autre utilisateur.",
        },
        { status: 403 }
      );
    }

    const activatedAt = allowed.activated_at ? new Date(allowed.activated_at) : now;
    const accessEndsAt = allowed.access_ends_at
      ? new Date(allowed.access_ends_at)
      : addMonthsClamped(activatedAt, allowed.access_months);

    if (Number.isNaN(accessEndsAt.getTime()) || accessEndsAt <= now) {
      return NextResponse.json(
        { error: "access_expired", access_ends_at: allowed.access_ends_at || null },
        { status: 403 }
      );
    }

    const { data: boundRow, error: bindError } = await supabase
      .from("epppn_allowed_emails")
      .update({
        activated_user_id: user.id,
        activated_at: activatedAt.toISOString(),
        access_ends_at: accessEndsAt.toISOString(),
        last_login_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("email", email)
      .or(`activated_user_id.is.null,activated_user_id.eq.${user.id}`)
      .select("activated_user_id")
      .maybeSingle();

    if (bindError) {
      console.error("V14.2 account binding failed:", bindError.message);
      return NextResponse.json({ error: "binding_failed" }, { status: 500 });
    }

    if (!boundRow || boundRow.activated_user_id !== user.id) {
      return NextResponse.json(
        { error: "account_already_bound" },
        { status: 403 }
      );
    }

    const { error: entitlementError } = await supabase
      .from("user_entitlements")
      .upsert(
        {
          user_id: user.id,
          status: "active",
          plan: "stagiaire_epppn",
          current_period_end: accessEndsAt.toISOString(),
          updated_at: now.toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (entitlementError) {
      console.error("V14.2 entitlement update failed:", entitlementError.message);
      return NextResponse.json({ error: "entitlement_update_failed" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      access_type: "stagiaire_epppn",
      access_ends_at: accessEndsAt.toISOString(),
    });
  } catch (error) {
    console.error("V14.2 activation route failed:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
